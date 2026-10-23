import {describeProgram,amountText} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {resources} from '../../../../rules/resources.ts';
import {enemies} from '../../../../rules/enemies.ts';
import {damage} from '../../../../rules/damage.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,cardConfig,attack,type CardHitReceipt} from './programs.ts';

export const volibearLethalCards=rules.defineRules({requires:[volibearCardPrograms,cardInstances,resources,enemies,damage],build(){
  const healing=[4,6] as const;
  const healedPlay=rules.defineComponent({schema:z.int32(),initial:()=>-1});
  const reward=rules.defineEffect<CardHitReceipt,void>(b=>rules.when(b.read(v=>{
    if(v.input.result.lost<=0||v.input.result.lost<v.input.hpBefore||v.input.result.target!==v.input.target)return false;
    if(v.get(rules.query(resources.exports.current,v.input.target)).hp!==0||v.get(rules.query(resources.exports.current,v.input.use.owner)).hp<=0)return false;
    const enemy=v.get(rules.query(enemies.exports.forActor,v.input.target));
    if(enemy!==null&&v.get(rules.query(enemies.exports.current,enemy)).halfDead)return false;
    return v.get(rules.readComponent(v.input.use.card,healedPlay))!==v.input.use.play;
  }),rules.sequence(
    rules.updateLocalComponent(b.read(v=>v.input.use.card),healedPlay,b.read(v=>v.input.use.play)),
    rules.call(resources.exports.heal,{entity:b.read(v=>v.input.use.owner),amount:b.read(v=>healing[v.input.use.state.upgraded?1:0])}),
  )));
  describeProgram(reward,`本次打出直接造成生命损失并击杀非半死目标且自身存活，恢复${amountText(healing)}生命；每次实际打出至多治疗一次，重复效果不刷新。`);
  const BloodBattle=rules.defineEntity(cardInstances.exports.kind,cardConfig(cards.U24,attack([21,28],1,false,true,reward)),{components:[healedPlay]});
  return {exports:{BloodBattle}};
}});
