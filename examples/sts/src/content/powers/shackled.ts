import {rules} from '../../rules/execution.ts';
import {powers} from "../../rules/powers.ts";
import {turns} from "../../rules/turns.ts";
import {basicPowers} from "./attributes.ts";
import {counterPolicies,attachAbilities} from "./utils.ts";
import {ownsTurn} from "./turn-hooks.ts";
import {combatScope} from "../../rules/combat-actions.ts";
import {MS} from "../../combat-identifiers.ts";
import type {TurnActor} from "../../rules/turns.types.ts";

const {defineRules,defineEffect,defineEntity,sequence,call,query,on}=rules;
export const shackledPower=defineRules({requires:[powers,turns,basicPowers],build(){
  const shackled=on(turns.exports.enemyEnd,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:100},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>sequence(call(powers.exports.apply,{registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(powers.exports.level,b.read(v=>v.input.source)),source:null,debuff:false,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope)}),call(powers.exports.remove,b.read(v=>v.input.source))))});
  const Shackled=defineEntity(powers.exports.kind,{presentation:{key:MS.SHACKLED,flag:false},...counterPolicies({bits:32,harmful:true,clearOnRemove:true,zeroIsNoop:true}),attach:attachAbilities(shackled)});
  return{exports:{Shackled}};
}});
