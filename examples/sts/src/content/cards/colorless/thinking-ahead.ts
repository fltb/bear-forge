import {concreteCard,describeAmounts} from '../shared/programs.ts';
import {describeProgram,programText} from '../shared/program-facts.ts';
import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {random} from "../../../rules/random.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {CardChoiceExports} from "../../../rules/card-choices.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {CardPilesState} from "../../../rules/card-piles.types.ts";
const {defineRules,defineEffect,sequence,enqueue,query,call,when}=rules;
import {CardScreen as SelectionScreen} from "../../../adapters/selection-presentations.ts";
export function createColorlessSelectionCards(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[battles,choices],build(){
  function putOneOnTop(source:{read:(piles:rules.Borrowed<CardPilesState>)=>number;name:string},screen:number,rollSingleton:boolean){return describeProgram(defineEffect<number,void>(b=>{
    const from=b.local<number>(),candidates=b.local<readonly number[]>(),selected=b.local<number|null>(),moved=b.local<boolean>();return sequence(
      b.assign(from,b.read(v=>source.read(v.query(cardPiles.exports.current,v.query(battles.exports.status,v.input).piles)))),b.assign(candidates,query(zones.exports.members,from)),
      when(b.read(v=>rollSingleton&&v.get(candidates).length===1),call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input).piles).cardRng),start:0,end:1})),
      b.assign(selected,call(choices.exports.one,{battle:b.input,screen,cards:candidates})),when(b.read(v=>v.get(selected)===null),b.return(undefined)),
      b.assign(moved,call(zones.exports.move,b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input).piles);return{entity:v.get(selected)!,from:v.get(from),to:p.draw,index:v.query(zones.exports.members,p.draw).length};}))),
      b.return(b.read(v=>{if(!v.get(moved))throw Error('Selected card movement was canceled');return undefined;})),
    );
  }),`从${source.name}选择1张牌置于抽牌堆顶。`);}
  const warcryChoice=putOneOnTop({read:p=>p.hand,name:'手牌'},SelectionScreen.Warcry,true),drawCount=2;
  return{exports:{ThinkingAhead:concreteCard('THINKING_AHEAD',describeAmounts(defineEffect<CardUse,void>(b=>sequence(enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:drawCount},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),enqueue(warcryChoice,b.read(v=>v.input.battle),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),[drawCount],count=>`抽${count}张牌。${programText(warcryChoice)!}`))}};
}});}
