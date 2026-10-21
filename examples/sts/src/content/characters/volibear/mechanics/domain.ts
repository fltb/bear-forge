import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import type {PileCard} from '../../../../rules/card-piles.types.ts';
import {effectPolicy,EffectKind,type EffectQualification} from '../../../../rules/effect-policy.ts';

type Domain={battle:number;until:number|null};
type DrawPolicy={exhaust:boolean;ownEffects:boolean;replacementDraws:number};
const schema=z.object({battle:z.int32().nonnegative(),until:z.int32().positive().nullable()});

/** One combat-wide state. Turn-based qualification expires before start draws;
 * null is the permanent duration. Enemy effect gates are composed separately.
 */
export const volibearDomain=rules.defineRules({requires:[battles,cardPiles,cardInstances,effectPolicy],build(m){
  const state=m.own(rules.defineComponent({schema:schema.nullable(),initial:()=>null}));
  const find=rules.defineQuery({input:z.number(),output:z.number().nullable(),reads:[state],base:(r,battle)=>{
    const ids=r.entities(state).filter(id=>r.component(id,state)?.battle===battle);
    if(ids.length>1)throw Error('Duplicate combat domain');return ids[0]??null;
  }});
  const current=rules.defineQuery({input:z.number(),output:schema.nullable(),reads:[state],dependencies:[find],base:(r,battle)=>{const id=r.query(find,battle);return id===null?null:r.component(id,state);}});
  const active=rules.defineQuery({input:z.number(),output:z.boolean(),dependencies:[current,battles.exports.status],base:(r,battle)=>{
    const d=r.query(current,battle),b=r.query(battles.exports.status,battle);return d!==null&&b.outcome===0&&(d.until===null||b.turn<d.until);
  }});
  const write=m.atom({input:z.object({entity:z.number(),value:schema}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const cleanse=rules.modify(cardPiles.exports.drawPolicy,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<PileCard,DrawPolicy>>(),output:z.boolean(),reads:[state],dependencies:[active,cardPiles.exports.bindings,cardInstances.exports.metadata],base:(r,c)=>{
      const d=r.component(c.source,state),p=r.query(cardPiles.exports.bindings,c.input.piles),type=r.query(cardInstances.exports.metadata,c.input.card).type;
      return d!==null&&d.battle===p.battle&&r.query(active,d.battle)&&(type===3||type===4);
    }}),
    transform:()=>({exhaust:true,ownEffects:false,replacementDraws:1}),
  });
  const suppress=rules.modify(effectPolicy.exports.allowed,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<EffectQualification,boolean>>(),output:z.boolean(),reads:[state],dependencies:[active,battles.exports.status],base:(r,c)=>{
      const d=r.component(c.source,state);return d!==null&&r.query(active,d.battle)&&r.query(battles.exports.status,d.battle).enemies.includes(c.input.actor)&&c.input.polarity>=0;
    }}),
    transform:(_r,c)=>c.value&&(c.input.effect===EffectKind.Attack||c.input.effect===EffectKind.Block||c.input.effect===EffectKind.Strength),
  });
  const kind=m.kind({config:z.undefined(),setup:schema,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<Domain>,void>(b=>rules.sequence(
    rules.call(write,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),
    rules.install({ability:cleanse,source:b.read(v=>v.input.entity),owner:b.read(v=>v.query(battles.exports.status,v.input.setup.battle).actor),environment:{},lifetime:b.read(v=>v.input.scope)}),
    rules.install({ability:suppress,source:b.read(v=>v.input.entity),owner:b.read(v=>v.query(battles.exports.status,v.input.setup.battle).actor),environment:{},lifetime:b.read(v=>v.input.scope)}),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const change=(extend:boolean)=>rules.defineEffect<{battle:number;turns:number|null},void>(b=>{const entity=b.local<number|null>(),value=b.local<Domain>();return rules.sequence(
    b.assign(entity,rules.query(find,b.read(v=>v.input.battle))),
    b.assign(value,b.read(v=>{
      const before=v.query(current,v.input.battle),turn=v.query(battles.exports.status,v.input.battle).turn;
      if(v.input.turns!==null&&(!Number.isInteger(v.input.turns)||v.input.turns<=0))throw Error('Domain duration must be positive');
      const until=v.input.turns===null||before?.until===null?null:extend?Math.max(turn,before?.until??turn)+v.input.turns:Math.max(before?.until??turn,turn+v.input.turns);
      return{battle:v.input.battle,until};
    })),
    rules.when(b.read(v=>v.get(entity)===null),
      rules.spawnEntity({definition,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:value}),
      rules.call(write,{entity:b.read(v=>v.get(entity)!),value})),
  );});
  return {exports:{active,current,open:change(false),extend:change(true)}};
}});
