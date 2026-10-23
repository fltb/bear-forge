import {programMetadata,inheritPrograms,describeProgram,programText} from '../../../cards/shared/program-facts.ts';
import {targetAttack,concreteCard,cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {rules} from '../../../../rules/execution.ts';
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
export function createSelectionCards(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[cardTargets,cardEffects,battles,choices],build(){
  function putOneOnTop(source:(piles:rules.Borrowed<CardPilesState>)=>number,screen:number,rollSingleton:boolean){const effect=defineEffect<number,void>(b=>{
    const from=b.local<number>(),candidates=b.local<readonly number[]>(),selected=b.local<number|null>(),moved=b.local<boolean>();return sequence(
      b.assign(from,b.read(v=>source(v.query(cardPiles.exports.current,v.query(battles.exports.status,v.input).piles)))),b.assign(candidates,query(zones.exports.members,from)),
      when(b.read(v=>rollSingleton&&v.get(candidates).length===1),call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input).piles).cardRng),start:0,end:1})),
      b.assign(selected,call(choices.exports.one,{battle:b.input,screen,cards:candidates})),when(b.read(v=>v.get(selected)===null),b.return(undefined)),
      b.assign(moved,call(zones.exports.move,b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input).piles);return{entity:v.get(selected)!,from:v.get(from),to:p.draw,index:v.query(zones.exports.members,p.draw).length};}))),
      b.return(b.read(v=>{if(!v.get(moved))throw Error('Selected card movement was canceled');return undefined;})),
    );
  });const sourceText=programText(source);return sourceText===undefined?effect:describeProgram(effect,`选择${sourceText}中的1张牌放到抽牌堆顶。`);}
  const headbuttChoice=putOneOnTop(describeProgram((p:rules.Borrowed<CardPilesState>)=>p.discard,'弃牌堆'),SelectionScreen.Headbutt,false);
  const warcryChoice=putOneOnTop(describeProgram((p:rules.Borrowed<CardPilesState>)=>p.hand,'手牌'),SelectionScreen.Warcry,true);
  const headbuttAttack=targetAttack([9,12]);
  const headbutt=describeProgram(inheritPrograms(defineEffect<CardUse,void>(b=>sequence(
    call(headbuttAttack,b.input),
    enqueue(headbuttChoice,b.read(v=>v.input.battle),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
  )),headbuttAttack),`${programText(headbuttAttack)}${programText(headbuttChoice)}`);
  const warcryDraw=[1,2] as const;
  const warcry=describeAmounts(defineEffect<CardUse,void>(b=>sequence(
    enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:b.read(v=>cardAmount(warcryDraw,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
    enqueue(warcryChoice,b.read(v=>v.input.battle),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
  )),[warcryDraw],count=>`抽${count}张牌。${programText(warcryChoice)}`);
  return{exports:{Headbutt:concreteCard('HEADBUTT',headbutt),Warcry:concreteCard('WARCRY',warcry)}};
}});}
