import {permanentCards} from "../src/content/characters/ironclad/cards/permanent.ts";
import {cursePermanentCards} from "../src/content/cards/curses/permanent.ts";
import {turnPowers} from "../src/content/characters/ironclad/powers/turn.ts";
import {enemyTurnPowers} from "../src/content/enemies/shared/ritual.ts";
import {basicCards} from "../src/content/characters/ironclad/cards/basic.ts";
import {colorlessBasicCards} from "../src/content/cards/colorless/basic.ts";
import {curseBasicCards} from "../src/content/cards/curses/ascenders-bane.ts";

import {ironcladPileCards} from "../src/content/characters/ironclad/cards/sentinel.ts";
import {drawPowers} from "../src/content/powers/draw.ts";

import {createSelectionCards} from "../src/content/characters/ironclad/cards/deck-order.ts";
import {createColorlessSelectionCards} from "../src/content/cards/colorless/thinking-ahead.ts";
import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {battles} from '../src/rules/battles.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';

import {turns} from '../src/rules/turns.ts';
import {enemies} from '../src/rules/enemies.ts';
import {cultist} from "../src/content/enemies/exordium/cultist.ts";

import {resources} from '../src/rules/resources.ts';
import {random} from '../src/rules/random.ts';
import {powers} from '../src/rules/powers.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';

import {basicPowers} from "../src/content/powers/attributes.ts";

import {createCardChoices} from '../src/rules/card-choices.ts';
import type {CardChoicePlayer} from '../src/rules/card-choices.types.ts';

import {actionQueue,combatScope} from '../src/rules/combat-actions.ts';

import {PS,MS} from '../src/combat-identifiers.ts';
import type {CardPlay,PlayOptions} from '../src/rules/battles.types.ts';
import type {CardConfig,CardSetup} from '../src/rules/card-instances.types.ts';
import type {EnemyAction} from '../src/rules/enemies.types.ts';
import type {PowerDefinition} from '../src/rules/powers.types.ts';
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,whileDo,call,query,spawnEntity,forEach}=rules;
const choiceWire=defineRules({requires:[cardInstances],build(){
  const publication=defineQuery({input:z.custom<rules.ChoiceRequest<number,CardChoicePlayer>>(),output:z.object({screen:z.int32().nonnegative(),cards:z.array(z.unknown()),bits:z.array(z.number())}),dependencies:[cardInstances.exports.combatView],base:(r,request)=>({screen:request.player.screen,cards:request.candidates.map(id=>r.query(cardInstances.exports.combatView,id)),bits:request.candidates.map((_,index)=>(2<<29)|index)})});
  return{exports:{adapter:ruleModules.choicePort({port:'decision',request:publication,reply:z.object({bits:z.number().int().nonnegative().max(0xffffffff)}),decode:(_request,reply)=>{
    if(reply.bits!==((2<<29)|(reply.bits&0xffff)))throw Error('Not a card-selection action');return{kind:'selected',indices:[reply.bits&0xffff]};
  }})}};
}});
export const choices=createCardChoices(choiceWire.exports.adapter,[choiceWire]);
const selectionCards=createSelectionCards(choices),colorlessSelectionCards=createColorlessSelectionCards(choices);
const contents={SEARING_BLOW:permanentCards.exports.SearingBlow,BARRICADE:permanentCards.exports.Barricade,REGRET:cursePermanentCards.exports.Regret,DEMON_FORM:basicCards.exports.DemonForm,ASCENDERS_BANE:curseBasicCards.exports.AscendersBane,STRIKE_RED:basicCards.exports.StrikeRed,DEFEND_RED:basicCards.exports.DefendRed,BASH:basicCards.exports.Bash,SENTINEL:ironcladPileCards.exports.Sentinel,INFLAME:basicCards.exports.Inflame,BATTLE_TRANCE:basicCards.exports.BattleTrance,POMMEL_STRIKE:basicCards.exports.PommelStrike,SHRUG_IT_OFF:basicCards.exports.ShrugItOff,IRON_WAVE:basicCards.exports.IronWave,FLASH_OF_STEEL:colorlessBasicCards.exports.FlashOfSteel,FINESSE:colorlessBasicCards.exports.Finesse,SEEING_RED:basicCards.exports.SeeingRed,HEADBUTT:selectionCards.exports.Headbutt,WARCRY:selectionCards.exports.Warcry};
const enemyProbe=defineRules({requires:[enemies,choices],build(){return{exports:{ability:rules.replace(enemies.exports.beforeIntent,{
  condition:defineQuery({input:z.custom<rules.ReplacementContext<EnemyAction>>(),output:z.boolean(),base:(_r,c)=>c.value.actor===c.owner}),
  effect:defineEffect<rules.ReplacementContext<EnemyAction>,rules.ReplacementResult<EnemyAction>>(b=>sequence(
    call(choices.exports.one,{battle:b.read(v=>v.input.value.battle),screen:2,cards:b.read(v=>{const board=v.get(query(battles.exports.current,v.input.value.battle)),p=v.get(query(cardPiles.exports.current,board.piles));return v.get(query(zones.exports.members,p.discard));})}),
    b.return({kind:'keep',value:b.read(v=>v.input.value)}),
  )),
})}};}});
export type Name=keyof typeof contents;
const names=Object.keys(contents) as Name[],definitions=names.map(id=>contents[id]);
const actor=defineEntity(resources.exports.actor,{side:0}),enemy=defineEntity(resources.exports.actor,{side:1}),registryDefinition=defineEntity(powers.exports.registryKind,undefined),stream=defineEntity(random.exports.stream,undefined),battleDefinition=defineEntity(battles.exports.kind,undefined),turnDefinition=defineEntity(turns.exports.kind,undefined),permanentDeckDefinition=defineEntity(permanentDecks.exports.kind,undefined);
const emptyCard={id:'INVALID',uniqueId:-1,specialData:0,cost:0,costForTurn:0,upgraded:false,freeToPlayOnce:false,retain:false};
const views=defineRules({requires:[basicCards,colorlessBasicCards,curseBasicCards,ironcladPileCards,selectionCards,colorlessSelectionCards,permanentDecks,permanentCards,cursePermanentCards],build(){return{exports:{view:defineQuery({input:z.number(),output:z.any(),dependencies:[battles.exports.current,cardPiles.exports.current,zones.exports.members,cardInstances.exports.combatView,resources.exports.current,random.exports.current,powers.exports.find,powers.exports.current],base(r,battle){
  const board=r.query(battles.exports.current,battle),p=r.query(cardPiles.exports.current,board.piles),player=r.query(resources.exports.current,board.actor),monster=r.query(resources.exports.current,board.enemies[0]!);
  const pile=(zone:number)=>r.query(zones.exports.members,zone).map(card=>r.query(cardInstances.exports.combatView,card));
  const play=(c:CardPlay|null)=>({card:c===null?emptyCard:{...r.query(cardInstances.exports.combatView,c.card),...c.state,id:c.vanished?'INVALID':r.query(cardInstances.exports.combatView,c.card).id,mode:undefined,master:undefined},target:c?.target===null||c===null?0:board.enemies.indexOf(c.target),isEndTurn:board.currentIsEndTurn,triggerOnUse:c?.triggerOnUse??true,ignoreEnergyTotal:c?.ignoreEnergyTotal??false,energyOnUse:c?.energyOnUse??0,freeToPlay:c?.freeToPlay??false,randomTarget:c?.randomTarget??false,autoplay:c?.autoplay??false,regretCardCount:c?.regretCardCount??0,purgeOnUse:c?.purgeOnUse??false,exhaustOnUse:c?.exhaustOnUse??false});
  const projected=(c:CardPlay|null)=>{const value=play(c);if(c!==null){const {mode:_mode,master:_master,...card}=value.card as typeof value.card&{mode?:unknown;master?:unknown};value.card=card;}return value;};
  const lookup=(definition:PowerDefinition,actor:number)=>{const id=r.query(powers.exports.find,{registry:board.registry,actor,definition});return id===null?null:r.query(powers.exports.current,id);};
  const strength=lookup(basicPowers.exports.Strength,board.actor),dexterity=lookup(basicPowers.exports.Dexterity,board.actor),frail=lookup(basicPowers.exports.Frail,board.actor),noDraw=lookup(drawPowers.exports.NoDraw,board.actor),vulnerable=lookup(basicPowers.exports.EnemyVulnerable,board.enemies[0]!);
  const bits=(noDraw?.active?1n<<BigInt(PS.NO_DRAW):0n)|(frail?.active?1n<<BigInt(PS.FRAIL):0n),statuses=[...(noDraw?[[PS.NO_DRAW,noDraw.level]]:[]),...(frail?[[PS.FRAIL,frail.level]]:[])].sort((a,b)=>a[0]!-b[0]!);
  return{cards:{draw:pile(p.draw),hand:pile(p.hand),discard:pile(p.discard),exhaust:pile(p.exhaust)},current:projected(board.current),queue:board.queue.map(c=>c.kind===0?projected(c.play):{...projected(null),isEndTurn:true}),outcome:board.outcome,drawn:p.drawn,
    player:{hp:player.hp,block:player.block,energy:player.energy,cardsPlayed:board.cardsPlayed,attacksPlayed:board.attacksPlayed,skillsPlayed:board.skillsPlayed,lastTarget:board.lastTargeted===null?1:board.enemies.indexOf(board.lastTargeted),strength:strength?.level??0,dexterity:dexterity?.level??0,bits:bits.toString(),statuses},
    enemy:{hp:monster.hp,block:monster.block,vulnerable:vulnerable?.level??0,bits:vulnerable?.active?(1n<<BigInt(MS.VULNERABLE)).toString():'0'},shuffleRng:r.query(random.exports.current,p.shuffleRng),cardRng:r.query(random.exports.current,p.cardRng)};
}})}};}});
const turnViews=defineRules({requires:[views,cultist],build(){return{exports:{view:defineQuery({input:z.number(),output:z.any(),dependencies:[views.exports.view,battles.exports.current,turns.exports.forBattle,turns.exports.current,enemies.exports.forActor,enemies.exports.current,enemies.exports.intent,powers.exports.find,powers.exports.current,random.exports.current,cardPiles.exports.current],base(r,battle){
  const base=r.query(views.exports.view,battle),board=r.query(battles.exports.current,battle),id=r.query(turns.exports.forBattle,battle);if(id===null)throw Error('No turn fixture controller');const controller=r.query(turns.exports.current,id),enemyId=r.query(enemies.exports.forActor,board.enemies[0]!);if(enemyId===null)throw Error('No enemy fixture controller');const e=r.query(enemies.exports.current,enemyId);
  const lookup=(definition:PowerDefinition,actor:number)=>{const id=r.query(powers.exports.find,{registry:board.registry,actor,definition});return id===null?null:r.query(powers.exports.current,id);};
  const barricade=lookup(permanentCards.exports.BarricadePower,board.actor),demon=lookup(turnPowers.exports.DemonForm,board.actor),ritual=lookup(enemyTurnPowers.exports.EnemyRitual,e.actor),strength=lookup(basicPowers.exports.Strength,e.actor),vulnerable=lookup(basicPowers.exports.EnemyVulnerable,e.actor);
  const statuses=[...base.player.statuses,...(demon?[[PS.DEMON_FORM,demon.level]]:[])].sort((a,b)=>a[0]-b[0]);
  return{...base,turn:board.turn,energyWasted:board.energyWasted,endTurnQueued:board.endTurnQueued,discarded:r.query(cardPiles.exports.current,board.piles).discarded,
    player:{...base.player,bits:(BigInt(base.player.bits)|(demon?.active?1n<<BigInt(PS.DEMON_FORM):0n)|(barricade?.active?1n<<BigInt(PS.BARRICADE):0n)).toString(),statuses},
    enemy:{...base.enemy,strength:strength?.level??0,ritual:ritual?.level??0,history:e.history,intent:r.query(enemies.exports.intent,enemyId),bits:((vulnerable?.active?1n<<BigInt(MS.VULNERABLE):0n)|(vulnerable?.justApplied?1n<<63n:0n)|(ritual?.active?1n<<BigInt(MS.RITUAL):0n)|(ritual?.justApplied?1n<<61n:0n)).toString()},aiRng:r.query(random.exports.current,e.aiRng)};
}})}};}});
export type Step={kind:'queue';id:Name;options?:Partial<PlayOptions>}|{kind:'cost';id:Name;amount:number}|{kind:'play'|'oneAction'|'settle'|'endTurn'|'earlyEnemy'|'fight'}|{kind:'retain';id:Name};
export type Setup={turns?:boolean;probeIntent?:boolean;deck:{id:Name;upgraded?:boolean;misc?:number}[];draw:number;energy?:number;enemyHp?:number;dexterity?:number;frail?:number};
export let initializations=0;
export function fixture(s:Setup,steps:readonly Step[],seed:string){
  const entry=defineEffect<void,unknown[]>(b=>{
    const deck=b.local<number>(),candidate=b.local<number|null>(),decisions=b.local<number>(),controller=b.local<number>(),enemyController=b.local<number>(),ai=b.local<number>(),catalog=b.local<readonly rules.EntityDefinition<CardConfig,CardSetup>[]>(),powerCatalog=b.local<readonly PowerDefinition[]>(),player=b.local<number>(),monster=b.local<number>(),registry=b.local<number>(),shuffle=b.local<number>(),cardRng=b.local<number>(),scope=b.local<number>(),masters=b.local<number[]>(),battle=b.local<number>(),history=b.local<unknown[]>();
    const view=()=>b.read(v=>({...v.get(query(s.turns?turnViews.exports.view:views.exports.view,v.get(battle))),actions:v.get(ruleModules.queueSize(actionQueue))}));
    const inHand=(id:Name)=>b.read(v=>{const board=v.get(query(battles.exports.current,v.get(battle))),p=v.get(query(cardPiles.exports.current,board.piles));const card=v.get(query(zones.exports.members,p.hand)).find(card=>v.get(query(cardInstances.exports.combatView,card)).id===id);if(card===undefined)throw Error('Card is not in fixture hand: '+id);return card;});
    return sequence(b.assign(catalog,definitions),b.assign(powerCatalog,[basicPowers.exports.Strength,basicPowers.exports.EnemyVulnerable,drawPowers.exports.NoDraw,basicPowers.exports.Dexterity,basicPowers.exports.Frail]),b.assign(scope,ruleModules.openScope(combatScope,0)),
      b.assign(player,spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:80,maxHp:80,energy:s.energy??10,block:0,gold:0}})),b.assign(monster,spawnEntity({definition:enemy,owner:null,scope,setup:{hp:s.enemyHp??100,maxHp:s.enemyHp??100,energy:0,block:0,gold:0}})),
      b.assign(registry,spawnEntity({definition:registryDefinition,owner:player,scope})),b.assign(shuffle,spawnEntity({definition:stream,owner:null,scope,setup:BigInt(seed)})),b.assign(cardRng,spawnEntity({definition:stream,owner:null,scope,setup:BigInt(seed)})),b.assign(deck,spawnEntity({definition:permanentDeckDefinition,owner:player,scope:0,setup:{actor:player}})),
      forEach(s.deck.map(c=>({...c,index:names.indexOf(c.id)})),card=>call(permanentDecks.exports.obtain,{deck,definition:b.read(v=>v.get(catalog)[v.get(card).index]!),count:1,upgraded:b.read(v=>v.get(card).upgraded??false),specialData:b.read(v=>v.get(card).misc??0),upgrade:false})),b.assign(masters,b.read(v=>[...v.get(query(permanentDecks.exports.current,v.get(deck))).cards])),
      b.assign(battle,spawnEntity({definition:battleDefinition,owner:player,scope,setup:{actor:player,registry,enemies:[monster],masters,bottled:[],shuffleRng:shuffle,cardRng,drawPerTurn:5}})),
      ...(s.turns?[
        b.assign(ai,spawnEntity({definition:stream,owner:null,scope,setup:BigInt(seed)})),b.assign(enemyController,spawnEntity({definition:cultist.exports.Cultist,owner:monster,scope,setup:{actor:monster,battle,aiRng:ai,ascension:20}})),
        b.assign(controller,spawnEntity({definition:turnDefinition,owner:player,scope,setup:{battle,enemies:[enemyController],drawPerTurn:5,energyPerTurn:3}})),
      ]:[]),
      ...(s.probeIntent?[rules.install({ability:enemyProbe.exports.ability,source:enemyController,owner:monster,environment:{},lifetime:scope})]:[]),
      ...(s.dexterity?[call(powers.exports.apply,{registry,actor:player,definition:basicPowers.exports.Dexterity,amount:s.dexterity,source:null,debuff:false,scope})]:[]),
      ...(s.frail?[call(powers.exports.apply,{registry,actor:player,definition:basicPowers.exports.Frail,amount:s.frail,source:null,debuff:false,scope})]:[]),
      call(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.get(battle))).piles),count:s.draw}),b.assign(history,[view()]),
      ...steps.flatMap(step=>{
        if(step.kind==='fight')return[b.assign(decisions,0),whileDo(b.read(v=>v.get(query(battles.exports.current,v.get(battle))).outcome===0),sequence(
          when(b.read(v=>v.get(decisions)>=200),b.return(b.read(()=>{throw Error('Battle policy exceeded its test horizon');}))),
          b.assign(candidate,b.read(v=>{const board=v.get(query(battles.exports.current,v.get(battle))),p=v.get(query(cardPiles.exports.current,board.piles));return v.get(query(zones.exports.members,p.hand)).find(card=>v.get(query(battles.exports.canQueue,{battle:v.get(battle),card,target:v.get(monster)})))??null;})),
          when(b.read(v=>v.get(candidate)===null),call(turns.exports.endTurn,controller),call(battles.exports.queueFromHand,{battle,card:b.read(v=>v.get(candidate)!),target:monster})),call(turns.exports.settle,controller),
          b.assign(decisions,b.read(v=>v.get(decisions)+1)),b.assign(history,b.read(v=>[...v.get(history),v.get(view())])),
        ))];
        const operation=step.kind==='endTurn'?call(turns.exports.endTurn,controller):step.kind==='earlyEnemy'?call(enemies.exports.takeTurn,enemyController):step.kind==='retain'?call(cardInstances.exports.setFlags,{entity:inHand(step.id),freeToPlayOnce:false,retain:true}):step.kind==='queue'?call(battles.exports.queueCard,{battle,card:inHand(step.id),target:monster,...(step.options?{options:step.options}:{})}):step.kind==='cost'?call(cardInstances.exports.overrideTurnCost,{entity:inHand(step.id),amount:step.amount})
          :step.kind==='play'?call(battles.exports.playNext,battle):step.kind==='oneAction'?ruleModules.drainOne(actionQueue):call(s.turns?turns.exports.settle:battles.exports.settle,s.turns?controller:battle);
        return[operation,b.assign(history,b.read(v=>[...v.get(history),v.get(view())]))];
      }),b.return(history),
    );
  });
  return linkRules<{},void,{decision:{input:{screen:number;cards:unknown[];bits:number[]};output:{bits:number}}},unknown[]>({
    id:'sts/battle-card-fixture-1',schemas:{setup:z.undefined(),result:z.array(z.unknown()),ports:{decision:{
      input:z.object({screen:z.int32().nonnegative(),cards:z.array(z.unknown()),bits:z.array(z.number())}),output:z.object({bits:z.number().int().nonnegative().max(0xffffffff)}),
    }}},initialize(){initializations++;return{};},entry,definitions:[entry],modules:[s.turns?turnViews:views,...(s.probeIntent?[enemyProbe]:[])],
  });
}
