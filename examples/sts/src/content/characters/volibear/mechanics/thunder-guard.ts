import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {damage} from '../../../../rules/damage.ts';
import {attributes} from '../../../../rules/attributes.ts';
import type {HitResult} from '../../../../rules/damage.types.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {lightning} from './lightning.ts';

const schema=z.object({battle:z.number(),owner:z.number(),until:z.number(),amount:z.number()});
type Guard=z.infer<typeof schema>;
/** Each play owns one reaction: do not merge independent lightning batches.
 * Expiry follows the player turn, not the separately extendable domain. */
export const volibearThunderGuard=rules.defineRules({requires:[battles,damage,attributes,lightning],build(m){
  const duration=1,amounts=[3,5] as const;
  const state=m.own(rules.defineComponent({schema:schema.nullable(),initial:()=>null}));
  const current=rules.defineQuery({input:z.number(),output:schema,reads:[state],base:(r,id)=>{const s=r.component(id,state);if(!s)throw Error('Missing thunder guard');return s;}});
  const active=rules.defineQuery({input:z.number(),output:z.array(schema),reads:[state],dependencies:[battles.exports.status],base:(r,battle)=>{
    const board=r.query(battles.exports.status,battle);
    return r.entities(state).flatMap(id=>{const s=r.component(id,state);return s&&s.battle===battle&&board.turn<s.until&&board.outcome===0?[s]:[];});
  }});
  const write=m.atom({input:z.object({entity:z.number(),value:schema}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const retaliate=rules.on(damage.exports.resolved,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<HitResult>>(),output:z.boolean(),reads:[state],dependencies:[battles.exports.status,attributes.exports.damageable],base:(r,c)=>{
      const s=r.component(c.source,state),hit=c.event;
      if(!s||hit.battle!==s.battle||hit.target!==s.owner||!hit.attack||hit.source===null)return false;
      const board=r.query(battles.exports.status,s.battle);
      return board.outcome===0&&board.turn<s.until&&board.enemies.includes(hit.source)&&r.query(attributes.exports.damageable,s.owner)&&r.query(attributes.exports.damageable,hit.source);
    }}),
    effect:rules.defineEffect<rules.ReactionContext<HitResult>,void>(b=>rules.call(lightning.exports.strike,{
      battle:b.read(v=>v.input.event.battle),owner:b.read(v=>v.input.owner),target:b.read(v=>v.input.event.source!),exclude:null,
      base:b.read(v=>v.query(current,v.input.source).amount),
    })),
  });
  const canContinue=rules.modify(battles.exports.canContinue,{condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,boolean>>(),output:z.boolean(),reads:[state],dependencies:[battles.exports.status],base:(r,c)=>{const s=r.component(c.source,state);return s!==null&&s.battle===c.input&&r.query(battles.exports.status,s.battle).turn<s.until;}}),transform:()=>true});
  const kind=m.kind({config:z.undefined(),setup:schema,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<Guard>,void>(b=>rules.sequence(
    rules.call(write,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),
    rules.install({ability:canContinue,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.owner),environment:{},lifetime:b.read(v=>v.input.scope)}),
    rules.install({ability:retaliate,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.owner),environment:{},lifetime:b.read(v=>v.input.scope)}),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const apply=rules.defineEffect<CardUse,void>(b=>rules.spawnEntity({definition,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:b.read(v=>({battle:v.input.battle,owner:v.input.owner,until:v.query(battles.exports.status,v.input.battle).turn+duration,amount:amounts[v.input.state.upgraded?1:0]}))}));
  const text=`直到${duration}轮后的玩家回合开始，每段攻击结算后，若自身与攻击者仍可受伤且战斗未结束，对攻击者反击${amounts[0]}（${amounts[1]}）雷伤；完全格挡也触发，每次打出独立结算，不随领域延长。`;
  describeProgram(apply,text);
  return{exports:{apply,active,text}};
}});
