import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../rules/battles.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {attributes} from "../../../rules/attributes.ts";
import {resources} from "../../../rules/resources.ts";
import {damage} from "../../../rules/damage.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,targetAttack,cardAmount,type CardAmount} from "../shared/programs.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {HitRequest} from "../../../rules/damage.types.ts";

const {defineRules,defineEffect,defineQuery,sequence,forEach,when,call,query,enqueue,on,definitionOf}=rules;
export const colorlessAttackCards=defineRules({requires:[battles,basicPowers],build(){
  function heal(amount:CardAmount){return defineEffect<CardUse,void>(b=>enqueue(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'}));}
  function area(amount:CardAmount){const act=defineEffect<{use:CardUse;base:number},void>(b=>{const matrix=b.local<HitRequest[]>();return sequence(b.assign(matrix,b.read(v=>v.query(battles.exports.targets,v.input.use.battle).map(target=>({battle:v.input.use.battle,source:v.input.use.owner,target,amount:v.query(attributes.exports.attackAmount,{source:v.input.use.owner,target,base:v.input.base,card:v.input.use.card}),attack:true,selfDamage:false})))),forEach(matrix,hit=>call(damage.exports.hit,hit)),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)));});return defineEffect<CardUse,void>(b=>enqueue(act,{use:b.input,base:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}
  const definitions={Bite:concreteCard('BITE',composePrograms(targetAttack([7,8]),heal([2,3]))),
    DramaticEntrance:concreteCard('DRAMATIC_ENTRANCE',area([8,12])),
    MindBlast:concreteCard('MIND_BLAST',targetAttack(v=>v.query(zones.exports.members,v.query(cardPiles.exports.current,v.query(battles.exports.current,v.input.battle).piles).draw).length)),
    SwiftStrike:concreteCard('SWIFT_STRIKE',targetAttack([7,10]))};
  return{exports:{...definitions,definitions:Object.values(definitions)}};
}});
