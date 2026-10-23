import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {typedValue} from '../../rules/value.schemas.ts';
import {powers} from '../../rules/powers.ts';
import {battles} from '../../rules/battles.ts';
import {turns} from '../../rules/turns.ts';
import {resources} from '../../rules/resources.ts';
import {attributes} from '../../rules/attributes.ts';
import {cardInstances} from '../../rules/card-instances.ts';
import {actionQueue} from '../../rules/combat-actions.ts';
import {PS} from '../../combat-identifiers.ts';
import {counterPolicies,defineDescribedPower,powerAbilities,composePowerProgram} from './utils.ts';
import {describeProgram} from '../cards/shared/program-facts.ts';
import {ownsTurn} from './turn-hooks.ts';
import type {TurnActor} from '../../rules/turns.types.ts';
import type {CardUse} from '../../rules/card-instances.types.ts';
const {defineRules,defineQuery,defineEffect,sequence,enqueue,call,query,on,modify}=rules;
type Attack={source:number;target:number;base:number;card:number|null};
/** Native power primitives retain captured queue arguments, stage and source lifetime. */
export const relicPowers=defineRules({requires:[powers,battles,turns,resources,attributes,cardInstances],build(){
  function sequenceEffects<I>(...effects:rules.Effect<I,void>[]){
    return composePowerProgram(defineEffect<I,void>(b=>sequence(...effects.map(effect=>call(effect,b.input)))),...effects);
  }
  function removeSource<I extends {source:number}>(){
    return describeProgram(defineEffect<I,void>(b=>call(powers.exports.remove,b.read(v=>v.input.source))),'移除此效果。');
  }
  function queuedRemoval<I extends {source:number;event:{battle:number}}>(){
    // The source id is captured now, exactly as in the original queue entry.
    return describeProgram(defineEffect<I,void>(b=>enqueue(powers.exports.remove,b.read(v=>v.input.source),{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'})),'排队移除此效果。');
  }
  function capturedLevelBlock(){
    // Do not enqueue an effect which re-reads level: removal follows scheduling.
    // Both owner and amount must be captured before that immediate removal.
    return describeProgram(defineEffect<rules.ReactionContext<TurnActor>,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:query(powers.exports.level,b.read(v=>v.input.source))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'})),'排队给予自身层数点格挡（入队时确定数量）。');
  }
  function onOwnStart(effect:rules.Effect<rules.ReactionContext<TurnActor>,void>){
    const condition=describeProgram(ownsTurn(),'自身回合开始时，');
    return composePowerProgram(on(turns.exports.playerStartPowers,{condition,order:{phase:turns.exports.stages.content,priority:PS.NEXT_TURN_BLOCK},effect}),condition,effect);
  }
  function enabledAttackSource(){
    return describeProgram(defineQuery({input:typedValue<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.source===c.owner&&r.query(powers.exports.enabled,c.source)}),'此效果启用且自身为攻击伤害来源时，');
  }
  function addSourceLevel(){
    const condition=enabledAttackSource();
    const ability=describeProgram(modify(attributes.exports.playerAttack,{condition,dependencies:[powers.exports.level],order:{phase:attributes.exports.stages.addition,priority:-10},transform:(r,c)=>Math.fround(c.value+r.query(powers.exports.level,c.source))}),'攻击伤害增加层数。');
    return composePowerProgram(ability,condition,ability);
  }
  function multiplyAttack(multiplier:number){
    const condition=enabledAttackSource();
    const ability=describeProgram(modify(attributes.exports.playerAttack,{condition,order:{phase:attributes.exports.stages.sourceScale,priority:30},transform:(_r,c)=>Math.fround(c.value*multiplier)}),`攻击伤害乘以${multiplier}。`);
    return composePowerProgram(ability,condition,ability);
  }
  function afterOwnAttack(effect:rules.Effect<rules.ReactionContext<CardUse>,void>){
    const attackType=0;
    const condition=describeProgram(defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled,cardInstances.exports.metadata],base:(r,c)=>c.event.owner===c.owner&&r.query(powers.exports.enabled,c.source)&&r.query(cardInstances.exports.metadata,c.event.card).type===attackType}),`自身打出${['攻击','技能','能力'][attackType]}牌后，若此效果启用，`);
    return composePowerProgram(on(battles.exports.used,{condition,effect}),condition,effect);
  }
  const NextTurnBlock=defineDescribedPower('下回合格挡',{presentation:{key:PS.NEXT_TURN_BLOCK,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},powerAbilities(onOwnStart(sequenceEffects(capturedLevelBlock(),removeSource<rules.ReactionContext<TurnActor>>()))));
  const Vigor=defineDescribedPower('活力',{presentation:{key:PS.VIGOR,flag:false},...counterPolicies({bits:16,resetWhenInactive:true})},powerAbilities(addSourceLevel(),afterOwnAttack(removeSource<rules.ReactionContext<CardUse>>())));
  function penNib(multiplier:number){return Object.freeze({...defineDescribedPower('钢笔尖',{presentation:{key:PS.PEN_NIB,flag:true},...counterPolicies({bits:16,flag:true,zeroIsNoop:true})},powerAbilities(multiplyAttack(multiplier),afterOwnAttack(queuedRemoval<rules.ReactionContext<CardUse>>()))),multiplier});}
  const PenNib=penNib(2);
  // Substitute the actual level operand in the assembled projection, not a second rule sentence.
  const vigorText=(amount:number|string)=>Vigor.text.replaceAll('层数',String(amount));
  const nextBlockText=(amount:number|string)=>NextTurnBlock.text.replaceAll('层数',String(amount));
  return{exports:{Vigor:Vigor.definition,NextTurnBlock:NextTurnBlock.definition,PenNib:PenNib.definition,vigorText,nextBlockText,programs:{Vigor,NextTurnBlock,PenNib},statusTexts:{VIGOR:Vigor.text,NEXT_TURN_BLOCK:NextTurnBlock.text,PEN_NIB:PenNib.text}}};
}});
