import {rules} from '../../rules/execution.ts';
import {battles} from '../../rules/battles.ts';
import {damage} from '../../rules/damage.ts';
const {defineRules,defineEffect,sequence,forEach,call,query}=rules;
/** Shared third-layer composition; damage and outcome still commit through their owners. */
export const areaDamage=defineRules({requires:[battles,damage],build(){
  const damageAll=defineEffect<{battle:number;actor:number;amount:number},void>(b=>sequence(forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>call(damage.exports.hit,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.actor),target,amount:b.read(v=>Math.max(0,v.input.amount)),attack:false,selfDamage:false})),call(battles.exports.checkOutcome,b.read(v=>v.input.battle))));
  return{exports:{hit:damageAll}};
}});
