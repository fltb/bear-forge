import {targetAttack,cardPower} from '../../../cards/shared/programs.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {drawPowers} from "../../../powers/draw.ts";
import {turnPowers} from "../powers/turn.ts";
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {resources} from "../../../../rules/resources.ts";
import {powers} from "../../../../rules/powers.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {cards} from "../../../../cards.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../../rules/powers.types.ts";
import {standardUpgrade,upgradeOnce} from "../../../cards/shared/lifecycle.ts";
const {defineRules,defineEffect,defineEntity,sequence,query,enqueue}=rules;

/** Concrete programs share typed authoring utilities, never a name-based action dispatcher. */
export const basicCards=defineRules({requires:[cardTargets,cardEffects,battles,basicPowers,drawPowers,turnPowers],build(){
  function attack(base:number,upgraded:number){return targetAttack([base,upgraded]);}
  function block(base:number,upgraded:number){return defineEffect<CardUse,void>(b=>enqueue(cardEffects.exports.gainBlock,{use:b.input,amount:b.read(v=>{const amount=v.query(attributes.exports.blockAmount,{actor:v.input.owner,base:v.input.state.upgraded?upgraded:base});return amount;})},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}
  function power(definition:PowerDefinition,base:number,upgraded:number,targeted=false,debuff=false){return cardPower(definition,[base,upgraded],targeted,debuff);}
  function draw(base:number,upgraded:number){return defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:b.read(v=>v.input.state.upgraded?upgraded:base)},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}
  const compose=(...effects:rules.Effect<CardUse,void>[])=>defineEffect<CardUse,void>(b=>sequence(...effects.map(effect=>rules.call(effect,b.input))));
  const card=(id:keyof typeof cards,use:rules.Effect<CardUse,void>)=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  return{exports:{StrikeRed:card('STRIKE_RED',attack(6,9)),
    DefendRed:card('DEFEND_RED',block(5,8)),
    Bash:card('BASH',compose(attack(8,10),power(basicPowers.exports.EnemyVulnerable,2,3,true,true))),
    DemonForm:card('DEMON_FORM',power(turnPowers.exports.DemonForm,2,3)),
    Inflame:card('INFLAME',power(basicPowers.exports.Strength,2,3)),
    BattleTrance:card('BATTLE_TRANCE',compose(draw(3,4),power(drawPowers.exports.NoDraw,1,1,false,true))),
    PommelStrike:card('POMMEL_STRIKE',compose(attack(9,10),draw(1,2))),
    ShrugItOff:card('SHRUG_IT_OFF',compose(block(8,11),draw(1,1))),
    IronWave:card('IRON_WAVE',compose(block(5,7),attack(5,7))),
    SeeingRed:card('SEEING_RED',defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:2},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})))}};
}});
