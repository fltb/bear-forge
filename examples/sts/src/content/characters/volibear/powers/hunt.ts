import {onProgram,modifyProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';

export const volibearHunt=rules.defineRules({requires:[battles,powers,cardInstances,volibearPlayCounts],build(){
  const ledgerSchema=z.object({turn:z.int32(),targets:z.array(z.object({actor:z.int32(),discount:z.number().int().nonnegative()})),last:z.object({play:z.int32(),target:z.int32(),amount:z.number().int()}).nullable()});
  const ledger=rules.defineComponent({schema:ledgerSchema,initial:()=>({turn:0,targets:[],last:null})});
  const priorDiscount=rules.defineQuery({input:z.object({power:z.int32(),use:cardUseSchema}),output:z.number().int().nonnegative(),reads:[ledger],dependencies:[battles.exports.current],base:(r,i)=>{
    const s=r.component(i.power,ledger);if(i.use.target===null||s.turn!==r.query(battles.exports.current,i.use.battle).turn)return 0;
    const total=s.targets.find(t=>t.actor===i.use.target)?.discount??0;
    return Math.max(0,total-(s.last?.play===i.use.play&&s.last.target===i.use.target?s.last.amount:0));
  }});
  const discount=modifyProgram(battles.exports.cost,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled,cardInstances.exports.metadata],base:(r,c)=>{
      if(c.input.owner!==c.owner||c.value<0||!r.query(powers.exports.enabled,c.source))return false;
      const m=r.query(cardInstances.exports.metadata,c.input.card),variant=m.variants[c.input.state.upgraded?1:0];
      return m.type===0&&variant.target&&variant.cost>=0;
    }}),'自身非X费指定单体攻击，当前费用非负且能力启用'),
    dependencies:[priorDiscount],transform:describeProgram((r:rules.QueryRead,c:rules.Borrowed<rules.ModifierContext<CardUse,number>>)=>Math.max(0,c.value-r.query(priorDiscount,{power:c.source,use:c.input})),'减去本回合对该目标累计减费，不计本次打出自身新增的减费，最低为0。'),
  });
  const record=onProgram(volibearPlayCounts.exports.counted,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.use.owner===c.owner&&c.event.targetOrdinal>0&&r.query(powers.exports.enabled,c.source)}),'自身实际打出指定目标攻击且能力启用'),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),ledger,b.read(v=>{
      const use=v.input.event.use,target=use.target;if(target===null)throw Error('Targeted attack requires a target');
      const before=v.get(rules.readComponent(v.input.source,ledger));
      const turn=v.get(rules.query(battles.exports.current,use.battle)).turn,amount=v.get(rules.query(powers.exports.level,v.input.source));
      const targets=before.turn===turn?before.targets.map(t=>({...t})):[];
      const entry=targets.find(t=>t.actor===target);if(entry)entry.discount+=amount;else targets.push({actor:target,discount:amount});
      return {turn,targets,last:{play:use.play,target,amount}};
    }))),'更新本回合对该目标的累计减费，增加本能力层数；同时记录本次打出及新增量，以便其自身费用不受本次新增减费影响。'),
  });
  const EndlessHunt=defineDescribedPower('不休之猎',counterPolicies({bits:32,zeroIsNoop:true}),{display:true,components:[ledger]},powerAbilities(discount,record));
  return {exports:{EndlessHunt:EndlessHunt.definition,programs:{EndlessHunt},statusTexts:{EndlessHunt:EndlessHunt.text}}};
}});
