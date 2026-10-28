import {onProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardEffects,type CardBlock} from '../../../../rules/card-effects.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';

export const volibearBattleBody=rules.defineRules({requires:[cardEffects,battles,cardInstances,powers,basicPowers],build(){
  const key=z.object({battle:z.number(),play:z.number()});
  const blocked=rules.defineComponent({schema:z.array(key),initial:()=>[]});
  type Receipt={entity:number;battle:number;play:number};
  const mark=rules.defineEffect<Receipt,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.entity),blocked,b.read(v=>{
    const before=v.get(rules.readComponent(v.input.entity,blocked));
    return before.some(x=>x.battle===v.input.battle&&x.play===v.input.play)?before:[...before,{battle:v.input.battle,play:v.input.play}];
  })));
  const clear=rules.defineEffect<Receipt,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.entity),blocked,b.read(v=>
    v.get(rules.readComponent(v.input.entity,blocked)).filter(x=>x.battle!==v.input.battle||x.play!==v.input.play))));
  const observe=onProgram(cardEffects.exports.blockGranted,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ReactionContext<CardBlock>>(),output:z.boolean(),base:(_r,c)=>c.event.use.owner===c.owner&&c.event.amount>0}),'自身牌提供的格挡为正数'),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<CardBlock>,void>(b=>rules.call(mark,{entity:b.read(v=>v.input.source),battle:b.read(v=>v.input.event.use.battle),play:b.read(v=>v.input.event.use.play)})),'记录本次打出曾提供正数格挡。'),
  });
  const finish=onProgram(battles.exports.finished,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),base:(_r,c)=>c.event.owner===c.owner&&c.event.triggerOnUse&&!c.event.purgeOnUse}),'自身实际打出的非清除牌'),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>{
      const gain=(definition:typeof basicPowers.exports.Strength)=>rules.call(powers.exports.apply,{
        definition,actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,amount:rules.query(powers.exports.level,b.read(v=>v.input.source)),
        registry:b.read(v=>v.query(battles.exports.status,v.input.event.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),
      });
      return rules.sequence(
        rules.when(b.read(v=>v.query(cardInstances.exports.metadata,v.input.event.card).type===0),gain(basicPowers.exports.Strength)),
        rules.when(b.read(v=>{return v.query(cardInstances.exports.metadata,v.input.event.card).type===0&&v.get(rules.readComponent(v.input.source,blocked)).some(receipt=>receipt.battle===v.input.event.battle&&receipt.play===v.input.event.play);}),gain(basicPowers.exports.Dexterity)),
        rules.call(clear,{entity:b.read(v=>v.input.source),battle:b.read(v=>v.input.event.battle),play:b.read(v=>v.input.event.play)}),
      );
    }),'若为攻击，按层数获得力量；若本次打出记录过正数格挡，按层数获得敏捷；随后清除本次记录。'),
  });
  const BattleBody=defineDescribedPower('愈战神躯',counterPolicies({bits:32,zeroIsNoop:true}),{display:true,components:[blocked]},powerAbilities(observe,finish));
  return{exports:{BattleBody:BattleBody.definition,programs:{BattleBody},statusTexts:{BattleBody:BattleBody.text}}};
}});
