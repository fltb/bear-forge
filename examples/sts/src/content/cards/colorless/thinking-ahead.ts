import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../rules/battles.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {zones} from "../../../rules/zones.ts";
import {random} from "../../../rules/random.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cards} from "../../../cards.ts";
import type {CardChoiceExports} from "../../../rules/card-choices.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {CardPilesState} from "../../../rules/card-piles.types.ts";
import {standardUpgrade,upgradeOnce} from "../shared/lifecycle.ts";
const {defineRules,defineEntity,defineEffect,sequence,enqueue,query,call,when}=rules;
import {CardScreen as SelectionScreen} from "../../../adapters/selection-presentations.ts";
export function createColorlessSelectionCards(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[battles,choices],build(){
  function putOneOnTop(source:(piles:Readonly<CardPilesState>)=>number,screen:number,rollSingleton:boolean){return defineEffect<number,void>(b=>{
    const from=b.local<number>(),candidates=b.local<readonly number[]>(),selected=b.local<number|null>(),moved=b.local<boolean>();return sequence(
      b.assign(from,b.read(v=>source(v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input)).piles))))),b.assign(candidates,query(zones.exports.members,from)),
      when(b.read(v=>rollSingleton&&v.get(candidates).length===1),call(random.exports.int,{stream:b.read(v=>v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input)).piles)).cardRng),start:0,end:1})),
      b.assign(selected,call(choices.exports.one,{battle:b.input,screen,cards:candidates})),when(b.read(v=>v.get(selected)===null),b.return(undefined)),
      b.assign(moved,call(zones.exports.move,b.read(v=>{const p=v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input)).piles));return{entity:v.get(selected)!,from:v.get(from),to:p.draw,index:v.get(query(zones.exports.members,p.draw)).length};}))),
      b.return(b.read(v=>{if(!v.get(moved))throw Error('Selected card movement was canceled');return undefined;})),
    );
  });}
  const warcryChoice=putOneOnTop(p=>p.hand,SelectionScreen.Warcry,true);
  return{exports:{ThinkingAhead:defineEntity(cardInstances.exports.kind,{id:'THINKING_AHEAD',metadata:cards.THINKING_AHEAD,use:defineEffect<CardUse,void>(b=>sequence(enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),count:2},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),enqueue(warcryChoice,b.read(v=>v.input.battle),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}))),canUpgrade:upgradeOnce(cards.THINKING_AHEAD),upgrade:standardUpgrade(cards.THINKING_AHEAD)})}};
}});}
