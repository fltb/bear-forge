import {rules} from '../../rules/execution.ts';
import {sacredBark} from './relics.ts';
import {resources} from '../../rules/resources.ts';

// These parameters belong to the executing operations, not to a presentation table.
const bloodFraction = .2;
const fruitIncrease = 5;
export function bloodPotionHealing(maxHp:number,multiplier:1|2):number {
  return Math.trunc(Math.fround(Math.fround(maxHp)*Math.fround(bloodFraction*multiplier)));
}
export function fruitJuiceIncrease(multiplier:1|2):number { return fruitIncrease*multiplier; }
export const bloodPotionText=`回复最大生命${bloodFraction*100}%（持神圣树皮时${bloodFraction*sacredBark.multiplier(true)*100}%），向下取整。`;
export const fruitJuiceText=`最大生命+${fruitIncrease}。`;
const fairyFraction=.3;
const fairyMinimum=1;
/** Preserve the existing outside-combat Bark branch, including its anomalous minimum-one result. */
export function fairyPotionHealing(maxHp:number,bark:boolean,inCombat:boolean):number {
  return Math.max(fairyMinimum,Math.trunc(!inCombat&&bark?fairyFraction*sacredBark.multiplier(bark):Math.fround(Math.fround(maxHp)*Math.fround(fairyFraction*sacredBark.multiplier(bark)))));
}
export const fairyPotionText=`致死时自动复活并回复最大生命${fairyFraction*100}%（战斗中持神圣树皮时${fairyFraction*sacredBark.multiplier(true)*100}%），向下取整且至少${fairyMinimum}点；当前冒险中持树皮时回复${fairyPotionHealing(fairyMinimum,true,false)}点。不可主动使用。`;
export const potionVitality=rules.defineRules({requires:[resources],build(){
  const blood=rules.defineEffect<{actor:number;multiplier:1|2},void>(b=>rules.call(resources.exports.heal,{
    entity:b.read(v=>v.input.actor),amount:b.read(v=>bloodPotionHealing(v.query(resources.exports.vitality,v.input.actor).maxHp,v.input.multiplier)),
  }));
  const fruit=rules.defineEffect<{actor:number;multiplier:1|2},void>(b=>rules.call(resources.exports.raiseMaxHp,{
    entity:b.read(v=>v.input.actor),amount:b.read(v=>fruitJuiceIncrease(v.input.multiplier)),
  }));
  return {exports:{blood,fruit}};
}});
