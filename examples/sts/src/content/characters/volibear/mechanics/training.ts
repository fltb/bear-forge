import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {volibearCopying,type CombatCopy} from './copying.ts';

const setup=z.object({battle:z.int32(),card:z.int32(),amount:z.number().int()});
export const volibearTraining=rules.defineRules({requires:[battles,cardInstances,volibearCopying],build(m){
  const state=m.own(rules.defineComponent({schema:setup.nullable(),initial:()=>null}));
  const eligible=rules.defineQuery({input:z.int32(),output:z.boolean(),base:()=>false});
  const permanentBonus=rules.defineQuery({input:z.int32(),output:z.number().int(),base:()=>0});
  const amount=rules.defineQuery({input:z.int32(),output:z.number().int(),reads:[state],base:(r,entity)=>r.component(entity,state)?.amount??0});
  const fixedAttack=rules.modify(eligible,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,boolean>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),
    transform:()=>true,
  });
  const bonus=rules.modify(permanentBonus,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),reads:[state],base:(r,c)=>r.component(c.source,state)?.card===c.input}),
    dependencies:[amount],transform:(r,c)=>c.value+r.query(amount,c.source),
  });
  const find=rules.defineQuery({input:z.int32(),output:z.int32().nullable(),reads:[state],base:(r,card)=>r.entities(state).find(id=>r.component(id,state)?.card===card)??null});
  const save=m.atom({input:z.object({entity:z.int32(),value:setup}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return {writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const increase=m.atom({input:z.object({entity:z.int32(),amount:z.number().int()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){
    const s=r.component(i.entity,state);if(s===null)throw Error('Missing card training');
    return {writes:[{entity:i.entity,component:state,value:{...s,amount:s.amount+i.amount}}],events:[],result:undefined};
  }});
  const copyGrowth=rules.on(volibearCopying.exports.copied,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CombatCopy>>(),output:z.boolean(),reads:[state],base:(r,c)=>r.component(c.source,state)?.card===c.event.source}),
    effect:rules.defineEffect<rules.ReactionContext<CombatCopy>,void>(b=>rules.call(add,{
      battle:b.read(v=>v.input.event.battle),card:b.read(v=>v.input.event.copy),
      amount:b.read(v=>v.get(rules.query(amount,v.input.source))),
    })),
  });
  const kind=m.kind({config:z.undefined(),setup,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.sequence(
    rules.call(save,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),
    ...[bonus,copyGrowth].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{if(v.input.owner===null)throw Error('Training needs an owner');return v.input.owner;}),environment:{},lifetime:b.read(v=>v.input.scope)})),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const add:rules.Effect<z.infer<typeof setup>,void>=rules.defineEffect<z.infer<typeof setup>,void>(b=>{
    const existing=b.local<number|null>();
    return rules.sequence(
      b.assign(existing,rules.query(find,b.read(v=>v.input.card))),
      rules.when(b.read(v=>v.get(existing)!==null),rules.call(increase,{entity:b.read(v=>v.get(existing)!),amount:b.read(v=>v.input.amount)}),
        rules.spawnEntity({definition,setup:b.input,owner:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actor),scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)})),
    );
  });
  return {exports:{eligible,fixedAttack,permanentBonus,add}};
}});
