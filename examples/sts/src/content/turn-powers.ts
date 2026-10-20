import {rules} from '@bear-forge/card-engine';
import {powers} from '../rules/powers.ts';
import {turns} from '../rules/turns.ts';
import {battles} from '../rules/battles.ts';
import {basicPowers} from './basic-powers.ts';
import {counterPolicies,attachAbilities} from './power-utils.ts';
import {ownsTurn} from './turn-power-utils.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import {PS,MS} from '../combat-identifiers.ts';
import type {TurnActor} from '../rules/turns.types.ts';
const {defineRules,defineEntity,defineEffect,on,when,call,query,enqueue}=rules;
export const turnPowers=defineRules({requires:[turns,basicPowers],build(){
  const application=(b:rules.Builder<rules.ReactionContext<TurnActor>,void>)=>({registry:b.read(v=>v.get(query(battles.exports.current,v.input.event.battle)).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(powers.exports.level,b.read(v=>v.input.source)),source:null,debuff:false,scope:b.read(v=>v.get(query(battles.exports.current,v.input.event.battle)).scope)});
  const demon=on(turns.exports.playerPostDrawPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.DEMON_FORM},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>enqueue(powers.exports.apply,application(b),
    {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.event.battle)).actionScope),eligible:'captured'}))});
  const ritual=on(turns.exports.enemyRoundEnd,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:0},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>when(b.read(v=>v.get(query(powers.exports.current,v.input.source)).justApplied),call(powers.exports.clearJustApplied,b.read(v=>v.input.source)),
    call(powers.exports.apply,application(b)),
  ))});
  return{exports:{DemonForm:defineEntity(powers.exports.kind,{presentation:{key:PS.DEMON_FORM,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(demon)}),
    EnemyRitual:defineEntity(powers.exports.kind,{presentation:{key:MS.RITUAL,flag:false,slot:0},...counterPolicies({bits:32,markOnBuff:true}),attach:attachAbilities(ritual)})}};
}});
