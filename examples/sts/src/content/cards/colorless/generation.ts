import {xCost} from '../../../rules/x-cost.ts';
import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {resources} from "../../../rules/resources.ts";
import {random} from "../../../rules/random.ts";
import {combatGeneration} from "../../../program/card-generation.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {discoveryDescription,type createCombatSelectionUtils} from "../shared/selection-utils.ts";
import {concreteCard,cardDraw,cardAmount,describeAmounts,type CardAmount} from "../shared/programs.ts";
import {describeProgram,programText,inheritPrograms} from '../shared/program-facts.ts';
import {mutableCard} from "../shared/lifecycle.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {CardChoiceExports} from "../../../rules/card-choices.types.ts";
import type {PermanentCardDefinition} from "../../../rules/permanent-decks.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query,enqueue}=rules;
export function createColorlessGeneratedSkills(choices:rules.RuleModule<CardChoiceExports>,selectionUtils:ReturnType<typeof createCombatSelectionUtils>){return defineRules({requires:[xCost,combatGeneration,basicPowers,choices,selectionUtils],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),effect);
  const pileId=(v:rules.ReadView<CardUse>)=>v.query(battles.exports.current,v.input.battle).piles;
  const piles=(v:rules.ReadView<CardUse>)=>v.query(cardPiles.exports.current,pileId(v));
  const randomHand=(category:0|4)=>{const count:CardAmount=category===0?1:[1,2],zeroTurn=category===0;return queue(describeAmounts(defineEffect<CardUse,void>(b=>{const definition=b.local<PermanentCardDefinition>(),definitions=b.local<PermanentCardDefinition[]>();return sequence(b.assign(definitions,[]),forEach(b.read(v=>Array.from({length:cardAmount(count,v)},(_,index)=>index)),()=>sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.input.battle),category})),b.assign(definitions,b.read(v=>[...v.get(definitions),v.get(definition)])))),forEach(definitions,definition=>enqueue(combatGeneration.exports.create,{battle:b.read(v=>v.input.battle),definition,upgraded:false,zeroCombat:false,zeroTurn,destination:1,shuffle:false},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));}),[count],value=>`生成${value}张随机${category===0?'攻击':'无色'}牌加入手牌${zeroTurn?'，本回合费用为0':''}。`));};
  const randomDraw=(category:0|1)=>{const count:CardAmount=[3,5];return queue(describeAmounts(defineEffect<CardUse,void>(b=>{const definition=b.local<PermanentCardDefinition>(),definitions=b.local<PermanentCardDefinition[]>();return sequence(b.assign(definitions,[]),forEach(b.read(v=>Array.from({length:cardAmount(count,v)},(_,index)=>index)),()=>sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.input.battle),category})),b.assign(definitions,b.read(v=>[...v.get(definitions),v.get(definition)])))),forEach(definitions,definition=>call(combatGeneration.exports.create,{battle:b.read(v=>v.input.battle),definition,upgraded:false,zeroCombat:true,zeroTurn:true,destination:0,shuffle:true})));}),[count],value=>`生成${value}张随机${category===0?'攻击':'技能'}牌洗入抽牌堆，本场战斗及本回合费用设为0。`));};
  const discoveryCategory=3,discoveryCopies=1;
  const discovery=queue(describeAmounts(defineEffect<CardUse,void>(b=>call(selectionUtils.exports.discovery,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.owner),category:discoveryCategory,copies:discoveryCopies,undefinedBehavior:true})),[discoveryCopies],copies=>`${discoveryDescription(discoveryCategory)}将所选牌的${copies}张复制加入手牌。`));
  const breathDraw=cardDraw([1,2]);
  const deepBreath=describeProgram(defineEffect<CardUse,void>(b=>sequence(when(b.read(v=>v.query(zones.exports.members,piles(v).discard).length>0),sequence(call(cardPiles.exports.announceShuffle,b.read(pileId)),enqueue(cardPiles.exports.shuffleDiscard,b.read(pileId),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),enqueue(cardPiles.exports.shuffleDraw,b.read(pileId),{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),call(breathDraw,b.input))),`若弃牌堆非空，将弃牌堆洗入抽牌堆并再次洗牌。${programText(breathDraw)!}`);
  const transmutation=describeProgram(defineEffect<CardUse,void>(b=>{const energy=b.local<number>();return sequence(b.assign(energy,b.read(v=>v.input.ignoreEnergyTotal?Math.max(v.input.energyOnUse,v.query(resources.exports.stamina,v.input.owner).energy):v.query(resources.exports.stamina,v.input.owner).energy)),call(battles.exports.setEnergyOnUse,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play),value:energy}),enqueue(defineEffect<{use:CardUse;energy:number},void>(b=>{const count=b.local<number>(),definition=b.local<PermanentCardDefinition>(),definitions=b.local<PermanentCardDefinition[]>();return sequence(
    b.assign(count,b.read(v=>v.query(xCost.exports.iterations,{...v.input.use,energyOnUse:v.input.energy}))),when(b.read(v=>v.get(count)===0),b.return(undefined)),b.assign(definitions,[]),forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.input.use.battle),category:4})),b.assign(definitions,b.read(v=>[...v.get(definitions),v.get(definition)])))),forEach(definitions,definition=>enqueue(combatGeneration.exports.create,{battle:b.read(v=>v.input.use.battle),definition,upgraded:b.read(v=>v.input.use.state.upgraded),zeroCombat:false,zeroTurn:true,destination:1,shuffle:false},{queue:actionQueue,source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.use.battle).actionScope),eligible:'captured'})),when(b.read(v=>!(v.input.use.freeToPlay||v.input.use.state.freeToPlayOnce)),call(resources.exports.useEnergy,{entity:b.read(v=>v.input.use.owner),amount:b.read(v=>v.query(resources.exports.stamina,v.input.use.owner).energy)})),
  );}),{use:b.input,energy},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}),'按本次记录能量经X费用修正后的次数生成随机无色牌加入手牌，本回合费用为0；升级后生成升级牌。次数为0时无操作，否则若非免费打出则消耗当前全部能量。');
  const violenceCount:CardAmount=[3,4];
  const violence=queue(describeAmounts(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),attacks=b.local<number[]>(),at=b.local<number>(),take=b.local<number>(),picked=b.local<number[]>(),tail=b.local<readonly number[]>(),clone=b.local<number>();return sequence(
    call(cardPiles.exports.resolveDrawOrder,b.read(pileId)),b.assign(list,b.read(v=>v.query(zones.exports.members,piles(v).draw))),b.assign(attacks,[]),forEach(list,card=>when(b.read(v=>v.query(cardInstances.exports.metadata,v.get(card)).type===0),sequence(when(b.read(v=>v.get(attacks).length===0),b.assign(at,0),b.assign(at,call(random.exports.int,{stream:b.read(v=>piles(v).cardRng),start:0,end:b.read(v=>v.get(attacks).length-1)}))),b.assign(attacks,b.read(v=>{const next=[...v.get(attacks)];next.splice(v.get(at),0,v.get(card));return next;}))))),
    b.assign(take,b.read(v=>Math.min(cardAmount(violenceCount,v),v.get(attacks).length))),b.assign(picked,[]),forEach(b.read(v=>Array.from({length:v.get(take)},(_,index)=>index)),index=>sequence(
      b.assign(tail,random.exports.shuffle({stream:b.read(v=>piles(v).shuffleRng),items:b.read(v=>v.get(attacks).slice(v.get(index)))})),b.assign(attacks,b.read(v=>[...v.get(attacks).slice(0,v.get(index)),...v.get(tail)])),b.assign(picked,b.read(v=>[...v.get(picked),v.get(attacks)[v.get(index)]!])),
    )),when(b.read(v=>v.get(take)>0&&v.get(take)<(cardAmount(violenceCount,v))),sequence(
      forEach(picked,card=>sequence(b.assign(clone,rules.spawnEntity({kind:cardInstances.exports.kind,definition:rules.definitionOf(cardInstances.exports.kind,card),owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:b.read(v=>{const c=v.query(cardInstances.exports.current,v.get(card));return{mode:1 as const,master:c.master,uniqueId:c.uniqueId,specialData:c.specialData,upgraded:c.upgraded};})})),call(cardInstances.exports.setMutable,{entity:clone,value:b.read(v=>mutableCard(v.query(cardInstances.exports.current,v.get(card))))}),call(cardPiles.exports.moveToHand,{piles:b.read(pileId),card:clone}))),b.return(undefined),
    )),forEach(picked,card=>call(cardPiles.exports.moveToHand,{piles:b.read(pileId),card})),
  );}),[violenceCount],count=>`从抽牌堆随机选取至多${count}张攻击牌；若可选攻击牌少于${count}且非空，复制所选牌加入手牌而不移除原牌，否则将所选牌移入手牌。`));
  return{exports:{DeepBreath:concreteCard('DEEP_BREATH',deepBreath),
    Discovery:concreteCard('DISCOVERY',discovery),
    JackOfAllTrades:concreteCard('JACK_OF_ALL_TRADES',randomHand(4)),
    Chrysalis:concreteCard('CHRYSALIS',randomDraw(1)),
    Metamorphosis:concreteCard('METAMORPHOSIS',randomDraw(0)),
    Transmutation:concreteCard('TRANSMUTATION',transmutation),
    Violence:concreteCard('VIOLENCE',violence)}};
}});}
