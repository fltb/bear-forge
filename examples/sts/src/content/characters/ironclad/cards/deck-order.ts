import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../../rules/battles.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {zones} from "../../../../rules/zones.ts";
import {random} from "../../../../rules/random.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {cards} from "../../../../cards.ts";
import type {CardChoiceExports} from "../../../../rules/card-choices.types.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {CardPilesState} from "../../../../rules/card-piles.types.ts";
import {standardUpgrade,upgradeOnce} from "../../../cards/shared/lifecycle.ts";
const {defineRules,defineEntity,defineEffect,sequence,enqueue,query,call,when}=rules;
import {CardScreen as SelectionScreen} from "../../../../adapters/selection-presentations.ts";
export function createSelectionCards(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[battles,choices],build(){
  function putOneOnTop(source:(piles:Readonly<CardPilesState>)=>number,screen:number,rollSingleton:boolean){return defineEffect<number,void>(b=>{
    const from=b.local<number>(),candidates=b.local<readonly number[]>(),selected=b.local<number|null>(),moved=b.local<boolean>();return sequence(
      b.assign(from,b.read(v=>source(v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input)).piles))))),b.assign(candidates,query(zones.exports.members,from)),
      when(b.read(v=>rollSingleton&&v.get(candidates).length===1),call(random.exports.int,{stream:b.read(v=>v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input)).piles)).cardRng),start:0,end:1})),
      b.assign(selected,call(choices.exports.one,{battle:b.input,screen,cards:candidates})),when(b.read(v=>v.get(selected)===null),b.return(undefined)),
      b.assign(moved,call(zones.exports.move,b.read(v=>{const p=v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input)).piles));return{entity:v.get(selected)!,from:v.get(from),to:p.draw,index:v.get(query(zones.exports.members,p.draw)).length};}))),
      b.return(b.read(v=>{if(!v.get(moved))throw Error('Selected card movement was canceled');return undefined;})),
    );
  });}
  const headbuttChoice=putOneOnTop(p=>p.discard,SelectionScreen.Headbutt,false);
  const warcryChoice=putOneOnTop(p=>p.hand,SelectionScreen.Warcry,true);
  const headbutt=defineEffect<CardUse,void>(b=>sequence(
    enqueue(battles.exports.hit,b.read(v=>{if(v.input.target===null)throw Error('Headbutt needs a target');return{battle:v.input.battle,source:v.input.owner,target:v.input.target,amount:v.get(query(attributes.exports.attackAmount,{source:v.input.owner,target:v.input.target,base:v.input.state.upgraded?12:9,card:v.input.card})),attack:true,selfDamage:false};}),
      {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
    enqueue(headbuttChoice,b.read(v=>v.input.battle),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
  ));
  const warcry=defineEffect<CardUse,void>(b=>sequence(
    enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),count:b.read(v=>v.input.state.upgraded?2:1)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
    enqueue(warcryChoice,b.read(v=>v.input.battle),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
  ));
  return{exports:{Headbutt:defineEntity(cardInstances.exports.kind,{id:'HEADBUTT',metadata:cards.HEADBUTT,use:headbutt,canUpgrade:upgradeOnce(cards.HEADBUTT),upgrade:standardUpgrade(cards.HEADBUTT)}),
    Warcry:defineEntity(cardInstances.exports.kind,{id:'WARCRY',metadata:cards.WARCRY,use:warcry,canUpgrade:upgradeOnce(cards.WARCRY),upgrade:standardUpgrade(cards.WARCRY)})}};
}});}
