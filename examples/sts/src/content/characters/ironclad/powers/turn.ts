import {rules} from '../../../../rules/execution.ts';
import {powers} from "../../../../rules/powers.ts";
import {turns} from "../../../../rules/turns.ts";
import {battles} from "../../../../rules/battles.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {counterPolicies,attachAbilities} from "../../../powers/utils.ts";
import {ownsTurn} from "../../../powers/turn-hooks.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {PS} from "../../../../combat-identifiers.ts";
import type {TurnActor} from "../../../../rules/turns.types.ts";
const {defineRules,defineEntity,defineEffect,on,when,call,query,enqueue}=rules;
export const turnPowers=defineRules({requires:[turns,basicPowers],build(){
  const application=(b:rules.Builder<rules.ReactionContext<TurnActor>,void>)=>({registry:b.read(v=>v.query(battles.exports.status,v.input.event.battle).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(powers.exports.level,b.read(v=>v.input.source)),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope)});
  const demon=on(turns.exports.playerPostDrawPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.DEMON_FORM},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>enqueue(powers.exports.apply,application(b),
    {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}))});
  return{exports:{DemonForm:defineEntity(powers.exports.kind,{presentation:{key:PS.DEMON_FORM,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(demon)})}};
}});
