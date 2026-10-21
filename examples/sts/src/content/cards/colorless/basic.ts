import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {attributes} from "../../../rules/attributes.ts";
import {resources} from "../../../rules/resources.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cards} from "../../../cards.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import {standardUpgrade,upgradeOnce} from "../shared/lifecycle.ts";
const {defineRules,defineEffect,defineEntity,sequence,query,enqueue}=rules;

/** Concrete programs share typed authoring utilities, never a name-based action dispatcher. */
export const colorlessBasicCards=defineRules({requires:[battles,basicPowers],build(){
  function attack(base:number,upgraded:number){return defineEffect<CardUse,void>(b=>enqueue(battles.exports.hit,b.read(v=>{
    if(v.input.target===null)throw Error('Attack needs a target');return{battle:v.input.battle,source:v.input.owner,target:v.input.target,amount:v.get(query(attributes.exports.attackAmount,{source:v.input.owner,target:v.input.target,base:v.input.state.upgraded?upgraded:base,card:v.input.card})),attack:true,selfDamage:false};
  }),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  function block(base:number,upgraded:number,twice=false){return defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>{const amount=v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:v.input.state.upgraded?upgraded:base}));return twice?v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:amount})):amount;})},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  function draw(base:number,upgraded:number){return defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),count:b.read(v=>v.input.state.upgraded?upgraded:base)},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  const compose=(...effects:rules.Effect<CardUse,void>[])=>defineEffect<CardUse,void>(b=>sequence(...effects.map(effect=>rules.call(effect,b.input))));
  const card=(id:keyof typeof cards,use:rules.Effect<CardUse,void>)=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  return{exports:{FlashOfSteel:card('FLASH_OF_STEEL',compose(attack(3,6),draw(1,1))),
    Finesse:card('FINESSE',compose(block(2,4),draw(1,1)))}};
}});
