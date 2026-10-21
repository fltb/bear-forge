import {rules} from '@bear-forge/card-engine';
import {adventures} from "../../rules/adventures.ts";
import {resources,HpLossOrigin} from "../../rules/resources.ts";
const {defineRules,defineEffect,call,query}=rules;
/** L3 adventure damage uses the same health owner and its ordinary replacement hooks. */
export const adventureEventUtils=defineRules({requires:[adventures,resources],build(){
  const hurt=defineEffect<{run:number;amount:number;direct:boolean},void>(b=>call(resources.exports.loseHp,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount:b.read(v=>!v.input.direct&&v.input.amount<=5&&v.query(adventures.exports.hasRelic,{run:v.input.run,id:'TORII'})?1:v.input.amount),selfDamage:false,origin:HpLossOrigin.Direct}));
  return{exports:{hurt}};
}});
export function sourceFraction(maxHp:number,amount:number,rounding:'floor'|'round'|'ceil'='floor'){
  const value=Math.fround(Math.fround(maxHp)*Math.fround(amount));return rounding==='ceil'?Math.ceil(value):rounding==='round'?Math.round(value):Math.trunc(value);
}
