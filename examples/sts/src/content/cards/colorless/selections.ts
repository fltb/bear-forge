import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {random} from "../../../rules/random.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {CardScreen} from "../../../adapters/selection-presentations.ts";
import {concreteCard,cardAmount,describeAmounts,type CardAmount} from "../shared/programs.ts";
import {describeProgram,inheritPrograms} from '../shared/program-facts.ts';
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {CardChoiceExports} from "../../../rules/card-choices.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;

export function createColorlessSelectionCardPrograms(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[battles,choices],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),effect);
  const piles=(v:rules.ReadView<CardUse>)=>v.query(cardPiles.exports.current,v.query(battles.exports.current,v.input.battle).piles);
  const hand=(v:rules.ReadView<CardUse>)=>v.query(zones.exports.members,piles(v).hand);
  const purityMinimum=0,purityMaximum:CardAmount=[3,5];
  const purity=queue(describeAmounts(defineEffect<CardUse,void>(b=>{const selected=b.local<readonly number[]>();return sequence(b.assign(selected,call(choices.exports.many,{battle:b.read(v=>v.input.battle),screen:CardScreen.ExhaustMany,cards:b.read(hand),minimum:purityMinimum,maximum:b.read(v=>cardAmount(purityMaximum,v))})),forEach(b.read(v=>[...v.get(selected)].reverse()),card=>call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card})));}),[purityMinimum,purityMaximum],(minimum,maximum)=>`选择${minimum}至${maximum}张手牌消耗。`));
  const forethought=queue(describeProgram(defineEffect<CardUse,void>(b=>{const selected=b.local<number|null>();return sequence(b.assign(selected,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:CardScreen.Forethought,cards:b.read(hand)})),when(b.read(v=>v.get(selected)===null),b.return(undefined)),when(b.read(v=>v.query(cardInstances.exports.current,v.get(selected)!).cost>0),call(cardInstances.exports.setFlags,{entity:b.read(v=>v.get(selected)!),freeToPlayOnce:true,retain:b.read(v=>v.query(cardInstances.exports.current,v.get(selected)!).retain)})),call(zones.exports.move,{entity:b.read(v=>v.get(selected)!),from:b.read(v=>piles(v).hand),to:b.read(v=>piles(v).draw),index:0}));}),'选择1张手牌置于抽牌堆底；若该牌基础费用为正，则下次打出免费。'));
  function secret(type:0|1,screen:number){return queue(describeProgram(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),valid=b.local<number[]>(),picked=b.local<number|null>(),seen=b.local<number>();return sequence(call(cardPiles.exports.resolveDrawOrder,b.read(v=>v.query(battles.exports.status,v.input.battle).piles)),b.assign(list,b.read(v=>v.query(zones.exports.members,piles(v).draw))),b.assign(valid,b.read(v=>v.get(list).filter(card=>v.query(cardInstances.exports.metadata,card).type===type))),when(b.read(v=>v.get(valid).length>1),call(zones.exports.revealMembers,{zone:b.read(v=>piles(v).draw),members:valid})),b.assign(seen,0),forEach(valid,()=>sequence(when(b.read(v=>v.get(seen)>0),call(random.exports.int,{stream:b.read(v=>piles(v).cardRng),start:0,end:b.read(v=>v.get(seen)-1)})),b.assign(seen,b.read(v=>v.get(seen)+1)))),b.assign(picked,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen,cards:valid,indices:b.read(v=>v.get(valid).map(card=>v.get(list).indexOf(card)))})),when(b.read(v=>v.get(picked)!==null),call(cardPiles.exports.moveToHand,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(picked)!)})));}),`从抽牌堆选择1张${type===0?'攻击':'技能'}牌加入手牌。`));}
  return{exports:{Purity:concreteCard('PURITY',purity),
    Forethought:concreteCard('FORETHOUGHT',forethought),
    SecretTechnique:concreteCard('SECRET_TECHNIQUE',secret(1,CardScreen.SecretTechnique)),
    SecretWeapon:concreteCard('SECRET_WEAPON',secret(0,CardScreen.SecretWeapon))}};
}});}
