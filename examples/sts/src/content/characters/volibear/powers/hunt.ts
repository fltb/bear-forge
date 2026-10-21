import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';

export const volibearHunt=rules.defineRules({requires:[battles,powers,cardInstances,volibearPlayCounts],build(){
  const ledgerSchema=z.object({turn:z.int32(),targets:z.array(z.object({actor:z.int32(),discount:z.number().int().nonnegative()})),last:z.object({play:z.int32(),target:z.int32(),amount:z.number().int()}).nullable()});
  const ledger=rules.defineComponent({schema:ledgerSchema,initial:()=>({turn:0,targets:[],last:null})});
  const priorDiscount=rules.defineQuery({input:z.object({power:z.int32(),use:cardUseSchema}),output:z.number().int().nonnegative(),reads:[ledger],dependencies:[battles.exports.current],base:(r,i)=>{
    const s=r.component(i.power,ledger);if(i.use.target===null||s.turn!==r.query(battles.exports.current,i.use.battle).turn)return 0;
    const total=s.targets.find(t=>t.actor===i.use.target)?.discount??0;
    return Math.max(0,total-(s.last?.play===i.use.play&&s.last.target===i.use.target?s.last.amount:0));
  }});
  const discount=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled,cardInstances.exports.metadata],base:(r,c)=>{
      if(c.input.owner!==c.owner||c.value<0||!r.query(powers.exports.enabled,c.source))return false;
      const m=r.query(cardInstances.exports.metadata,c.input.card),variant=m.variants[c.input.state.upgraded?1:0];
      return m.type===0&&variant.target&&variant.cost>=0;
    }}),
    dependencies:[priorDiscount],transform:(r,c)=>Math.max(0,c.value-r.query(priorDiscount,{power:c.source,use:c.input})),
  });
  const record=rules.on(volibearPlayCounts.exports.counted,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.use.owner===c.owner&&c.event.targetOrdinal>0&&r.query(powers.exports.enabled,c.source)}),
    effect:rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),ledger,b.read(v=>{
      const use=v.input.event.use,target=use.target;if(target===null)throw Error('Targeted attack requires a target');
      const before=v.get(rules.readComponent(v.input.source,ledger));
      const turn=v.get(rules.query(battles.exports.current,use.battle)).turn,amount=v.get(rules.query(powers.exports.level,v.input.source));
      const targets=before.turn===turn?before.targets.map(t=>({...t})):[];
      const entry=targets.find(t=>t.actor===target);if(entry)entry.discount+=amount;else targets.push({actor:target,discount:amount});
      return {turn,targets,last:{play:use.play,target,amount}};
    }))),
  });
  const EndlessHunt=rules.defineEntity(powers.exports.kind,{
    ...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(discount,record),
  },{components:[ledger]});
  return {exports:{EndlessHunt}};
}});
