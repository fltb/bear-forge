import {describeProgram,inheritPrograms,programText} from '../../../cards/shared/program-facts.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {zones} from "../../../../rules/zones.ts";
import {random} from "../../../../rules/random.ts";
import {resources} from "../../../../rules/resources.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {CardScreen} from "../../../../adapters/selection-presentations.ts";
import {concreteCard,composePrograms,cardBlock,cardDraw,cardAmount,describeAmounts} from "../../../cards/shared/programs.ts";
import type {PermanentCardDefinition} from "../../../../rules/permanent-decks.types.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {CardChoiceExports} from "../../../../rules/card-choices.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;

export function createSelectionCardPrograms(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[cardEffects,battles,choices],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),effect);
  const piles=(v:rules.ReadView<CardUse>)=>v.query(cardPiles.exports.current,v.query(battles.exports.current,v.input.battle).piles);
  const hand=(v:rules.ReadView<CardUse>)=>v.query(zones.exports.members,piles(v).hand);
  const exhaustOne=defineEffect<CardUse,void>(b=>{const selected=b.local<number|null>();return sequence(b.assign(selected,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:CardScreen.ExhaustOne,cards:b.read(hand)})),when(b.read(v=>v.get(selected)!==null),call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(selected)!)})));});
  const exhaustRandom=defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),index=b.local<number>();return sequence(b.assign(list,b.read(hand)),when(b.read(v=>v.get(list).length===0),b.return(undefined)),b.assign(index,call(random.exports.int,{stream:b.read(v=>piles(v).cardRng),start:0,end:b.read(v=>v.get(list).length-1)})),call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(list)[v.get(index)]!)}));});
  describeProgram(exhaustOne,'选择消耗1张手牌。');
  describeProgram(exhaustRandom,'随机消耗1张手牌。');
  const armaments=queue(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),valid=b.local<number[]>(),picked=b.local<number|null>();return sequence(
    b.assign(list,b.read(hand)),when(b.read(v=>v.input.state.upgraded),sequence(forEach(list,card=>call(cardInstances.exports.upgradeDetailed,{entity:card,force:true})),b.return(undefined))),
    b.assign(valid,b.read(v=>v.get(list).filter(card=>v.query(cardInstances.exports.canUpgrade,card)))),b.assign(picked,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:CardScreen.Armaments,cards:valid,indices:b.read(v=>v.get(valid).map(card=>v.get(list).indexOf(card)))})),when(b.read(v=>v.get(picked)===null),b.return(undefined)),call(cardInstances.exports.upgrade,b.read(v=>v.get(picked)!)),
    when(b.read(v=>v.get(valid).length>1),call(zones.exports.reorder,{zone:b.read(v=>piles(v).hand),order:b.read(v=>[...v.get(valid).filter(card=>card!==v.get(picked)),v.get(picked)!,...v.get(list).filter(card=>!v.get(valid).includes(card))])})),
  );}));
  describeProgram(armaments,'升级1张可升级手牌（升级后改为强制升级所有手牌）。');
  const dualCopies=[1,2] as const;
  const dualWield=describeAmounts(queue(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),valid=b.local<number[]>(),picked=b.local<number|null>(),identity=b.local<number>();return sequence(
    b.assign(list,b.read(hand)),b.assign(valid,b.read(v=>v.get(list).filter(card=>{const type=v.query(cardInstances.exports.metadata,card).type;return type===0||type===2;}))),b.assign(picked,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:CardScreen.DualWield,cards:valid,indices:b.read(v=>v.get(valid).map(card=>v.get(list).indexOf(card)))})),when(b.read(v=>v.get(picked)===null),b.return(undefined)),
    when(b.read(v=>v.get(valid).length>1),sequence(call(zones.exports.reorder,{zone:b.read(v=>piles(v).hand),order:b.read(v=>[...v.get(valid).filter(card=>card!==v.get(picked)),...v.get(list).filter(card=>!v.get(valid).includes(card)),v.get(picked)!])}),b.assign(identity,call(cardPiles.exports.allocateIdentity,b.read(v=>v.query(battles.exports.status,v.input.battle).piles))),call(cardInstances.exports.setCombatIdentity,{entity:b.read(v=>v.get(picked)!),uniqueId:identity,master:null}))),
    forEach(b.read(v=>Array.from({length:cardAmount(dualCopies,v)},(_,index)=>index)),()=>call(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition:rules.definitionOf(cardInstances.exports.kind,b.read(v=>v.get(picked)!)),upgraded:b.read(v=>v.query(cardInstances.exports.current,v.get(picked)!).upgraded),specialData:b.read(v=>v.query(cardInstances.exports.current,v.get(picked)!).specialData),destination:1,shuffle:false,mutable:b.read(v=>v.query(cardInstances.exports.current,v.get(picked)!))})),
  );})),[dualCopies],count=>`选择1张攻击或能力手牌，将${count}张保留其当前属性的复制加入手牌。`);
  const exhumeHandLimit=10;
  const Exhume:PermanentCardDefinition=concreteCard('EXHUME',describeProgram(queue(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),valid=b.local<number[]>(),picked=b.local<number|null>(),self=b.local<PermanentCardDefinition>();return sequence(b.assign(self,Exhume),when(b.read(v=>hand(v).length===exhumeHandLimit),b.return(undefined)),b.assign(list,b.read(v=>v.query(zones.exports.members,piles(v).exhaust))),b.assign(valid,b.read(v=>v.get(list).filter(card=>!v.query(cardInstances.exports.matchesDefinition,{entity:card,definition:v.get(self)})))),b.assign(picked,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:CardScreen.Exhume,cards:valid,indices:b.read(v=>v.get(valid).map(card=>v.get(list).indexOf(card)))})),when(b.read(v=>v.get(picked)===null),b.return(undefined)),call(zones.exports.move,{entity:b.read(v=>v.get(picked)!),from:b.read(v=>piles(v).exhaust),to:null,index:0}),call(cardPiles.exports.register,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(picked)!)}),call(cardPiles.exports.moveToHand,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(picked)!)}));})),`手牌不为${exhumeHandLimit}张时，从消耗堆选择1张非本牌的牌回到手牌。`));
  const secondBlock=[5,7] as const;
  const secondWind=describeAmounts(defineEffect<CardUse,void>(b=>{const block=b.local<number>();return sequence(b.assign(block,query(attributes.exports.blockAmount,{actor:b.read(v=>v.input.owner),base:b.read(v=>cardAmount(secondBlock,v))})),enqueue(defineEffect<{use:CardUse;block:number},void>(b=>{const list=b.local<number[]>();return sequence(b.assign(list,b.read(v=>{const board=v.query(battles.exports.status,v.input.use.battle),p=v.query(cardPiles.exports.bindings,board.piles);return v.query(zones.exports.members,p.hand).filter(card=>v.query(cardInstances.exports.metadata,card).type!==0);})),forEach(list,()=>enqueue(cardEffects.exports.gainBlock,{use:b.read(v=>v.input.use),amount:b.read(v=>v.input.block)},{queue:actionQueue,position:'front',source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.use.battle).actionScope),eligible:'captured'})),forEach(list,card=>enqueue(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.use.battle).piles),card},{queue:actionQueue,position:'front',source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.use.battle).actionScope),eligible:'captured'})));}),{use:b.input,block},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}),[secondBlock],block=>`消耗所有非攻击手牌，每张获得${block}格挡。`);
  return{exports:{Armaments:concreteCard('ARMAMENTS',composePrograms(cardBlock(5),armaments)),
    BurningPact:concreteCard('BURNING_PACT',composePrograms(queue(exhaustOne),cardDraw([2,3]))),
    TrueGrit:concreteCard('TRUE_GRIT',composePrograms(cardBlock([7,9]),describeProgram(defineEffect<CardUse,void>(b=>call(queue(defineEffect<CardUse,void>(b=>when(b.read(v=>v.input.state.upgraded),call(exhaustOne,b.input),call(exhaustRandom,b.input)))),b.input)),`未升级：${programText(exhaustRandom)}升级后：${programText(exhaustOne)}`))),
    DualWield:concreteCard('DUAL_WIELD',dualWield),
    Exhume,
    SecondWind:concreteCard('SECOND_WIND',secondWind)}};
}});}
