import {rules} from '../../rules/execution.ts';
import {adventures} from '../../rules/adventures.ts';
import {resources} from '../../rules/resources.ts';
const {defineRules,defineEffect,when,call,query}=rules;
const barkMultiplier=2,ornithopterHealing=5;
/** The actual potion-parameter composition is shared by offers, drinking and revival. */
export const sacredBark=Object.freeze({
  multiplier:(present:boolean):1|2=>present?barkMultiplier:1,
  text:`持有时为药水规则提供${barkMultiplier}倍效果参数；不接收倍率的效果不额外重复。妖精药水在冒险中仍按其既有独立分支结算。`,
});
/** Shared trigger for an actual drink, never for discarding or automatic Fairy revival. */
export const potionRelics=defineRules({requires:[adventures,resources],build(){
  const used=defineEffect<number,void>(b=>when(query(adventures.exports.hasRelic,{run:b.input,id:'TOY_ORNITHOPTER'}),call(resources.exports.heal,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:ornithopterHealing})));
  return{exports:{used,relicTexts:{SACRED_BARK:sacredBark.text,TOY_ORNITHOPTER:`战斗或冒险中主动使用药水后回复${ornithopterHealing}生命，实际回复受治疗规则修正。丢弃药水和妖精自动复活不触发。`}}};
}});
