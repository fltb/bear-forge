import {rules} from '@bear-forge/card-engine';
import {z} from 'zod';
import {cardEvaluationSchema} from '../rules/card-instances.schemas.ts';
import {battles} from '../rules/battles.ts';
import {cardInstances} from '../rules/card-instances.ts';
import {cardPiles} from '../rules/card-piles.ts';
import {attributes} from '../rules/attributes.ts';
import {resources} from '../rules/resources.ts';
import {powers} from '../rules/powers.ts';
import {basicPowers} from './basic-powers.ts';
import {drawPowers} from './draw-powers.ts';
import {turnPowers} from './turn-powers.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import {cards} from '../cards.ts';
import type {CardUse} from '../rules/card-instances.types.ts';
import type {PowerDefinition} from '../rules/powers.types.ts';
import {standardUpgrade,upgradeOnce} from './card-utils.ts';
const {defineRules,defineEffect,defineEntity,sequence,query,enqueue}=rules;

/** Concrete programs share typed authoring utilities, never a name-based action dispatcher. */
export const basicCards=defineRules({requires:[battles,basicPowers,drawPowers,turnPowers],build(){
  function attack(base:number,upgraded:number){return defineEffect<CardUse,void>(b=>enqueue(battles.exports.hit,b.read(v=>{
    if(v.input.target===null)throw Error('Attack needs a target');return{battle:v.input.battle,source:v.input.owner,target:v.input.target,amount:v.get(query(attributes.exports.attackAmount,{source:v.input.owner,target:v.input.target,base:v.input.state.upgraded?upgraded:base,card:v.input.card})),attack:true,selfDamage:false};
  }),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  function block(base:number,upgraded:number,twice=false){return defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>{const amount=v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:v.input.state.upgraded?upgraded:base}));return twice?v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:amount})):amount;})},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  function power(definition:PowerDefinition,base:number,upgraded:number,targeted=false,debuff=false){return defineEffect<CardUse,void>(b=>enqueue(powers.exports.apply,{definition,registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),
    actor:b.read(v=>{if(targeted&&v.input.target===null)throw Error('Power needs a target');return targeted?v.input.target!:v.input.owner;}),amount:b.read(v=>v.input.state.upgraded?upgraded:base),source:b.read(v=>v.input.owner),debuff,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  function draw(base:number,upgraded:number){return defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),count:b.read(v=>v.input.state.upgraded?upgraded:base)},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  const compose=(...effects:rules.Effect<CardUse,void>[])=>defineEffect<CardUse,void>(b=>sequence(...effects.map(effect=>rules.call(effect,b.input))));
  const card=(id:keyof typeof cards,use:rules.Effect<CardUse,void>)=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use,...(id==='ASCENDERS_BANE'?{canTransform:rules.defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>false})}:{}),canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  return{exports:{StrikeRed:card('STRIKE_RED',attack(6,9)),DefendRed:card('DEFEND_RED',block(5,8)),Bash:card('BASH',compose(attack(8,10),power(basicPowers.exports.EnemyVulnerable,2,3,true,true))),
    DemonForm:card('DEMON_FORM',power(turnPowers.exports.DemonForm,2,3)),AscendersBane:card('ASCENDERS_BANE',defineEffect<CardUse,void>(b=>b.return(undefined))),
    Inflame:card('INFLAME',power(basicPowers.exports.Strength,2,3)),BattleTrance:card('BATTLE_TRANCE',compose(draw(3,4),power(drawPowers.exports.NoDraw,1,1,false,true))),
    PommelStrike:card('POMMEL_STRIKE',compose(attack(9,10),draw(1,2))),ShrugItOff:card('SHRUG_IT_OFF',compose(block(8,11),draw(1,1))),IronWave:card('IRON_WAVE',compose(block(5,7,true),attack(5,7))),
    FlashOfSteel:card('FLASH_OF_STEEL',compose(attack(3,6),draw(1,1))),Finesse:card('FINESSE',compose(block(2,4),draw(1,1))),SeeingRed:card('SEEING_RED',defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:2},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}))),
  }};
}});
