import {mapRelics} from '../src/content/relics/common/map.ts';
import {adventurePotions} from '../src/content/potions/adventure.ts';
import {adventureDraws} from '../src/content/rewards/draws.ts';
import {potions} from '../src/rules/potions.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {adventureStart} from "../src/program/start.ts";
import {adventureContent} from "../src/program/adventure.ts";
import {adventureViews} from "../src/adapters/adventure-views.ts";
import {adventures} from '../src/rules/adventures.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {resources} from '../src/rules/resources.ts';
import {relics} from '../src/rules/relics.ts';
import type {RelicTier} from '../src/rules/adventures.types.ts';

import {programSchemas,GameViewSchema,type Setup,type Ports} from '../src/game.schemas.ts';
import type {CardId,RelicId} from '../src/identifiers.ts';
const {defineEffect,sequence,forEach,call,query}=rules;
export type DeckCaseStep={kind:'obtain';id:CardId;count?:number;upgraded?:boolean;misc?:number}|{kind:'remove'|'upgrade';index:number}|{kind:'upgrade-random';count:number}|{kind:'bottle';index:number;type:0|1|2};
type GameView=z.infer<typeof GameViewSchema>;
export function relicFallbackFixture(clear:readonly RelicTier[],tier:RelicTier,front:boolean){
  const result=z.object({picked:z.string(),remaining:z.record(z.string(),z.int32())});
  const fixture=rules.defineRules({requires:[adventureContent.cards,adventureContent.acquisition,adventureStart],build(){
  const name=rules.defineQuery({input:z.custom<import('../src/rules/relics.ts').RelicDefinition>(),output:z.string(),kinds:[relics.exports.kind],base:(r,definition)=>r.definitionConfiguration(definition,relics.exports.kind).id});
  const entry=defineEffect<Setup,z.infer<typeof result>>(b=>{const run=b.local<number>(),picked=b.local<import('../src/rules/relics.ts').RelicDefinition>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
    ...clear.map(emptyTier=>forEach(b.read(v=>v.query(adventures.exports.pools,v.get(run)).relicPools[emptyTier]),()=>call(adventures.exports.takeRelic,{run,tier:emptyTier,front:true}))),
    b.assign(picked,call(adventureContent.acquisition.exports.draw,{run,tier,front,shop:false,screenless:false})),
    b.return({picked:query(name,picked),remaining:b.read(v=>Object.fromEntries(Object.entries(v.query(adventures.exports.pools,v.get(run)).relicPools).map(([key,pool])=>[key,pool.length])))}),
  );});
    return{exports:{entry}};
  }});
  return linkRules<{},Setup,Ports,z.infer<typeof result>>({id:'sts/relic-fallback-case',schemas:{...programSchemas,result},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
}
/** Normal construction followed only by explicit production owner operations. */
export function deckCaseFixture(steps:readonly DeckCaseStep[],owned:readonly RelicId[]){
  const entry=defineEffect<Setup,GameView[]>(b=>{
    const run=b.local<number>(),history=b.local<GameView[]>();
    const cardAt=(index:number)=>b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(run))),card=v.get(query(permanentDecks.exports.current,s.deck)).cards[index];if(card===undefined)throw Error('Invalid deck case index');return card;});
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
      forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),b.assign(history,[query(adventureViews.exports.privateGame,run)]),
      ...steps.flatMap(step=>{
        const deck=b.read(v=>v.get(query(adventures.exports.current,v.get(run))).deck);
        const operation=step.kind==='obtain'?call(permanentDecks.exports.obtain,{deck,definition:query(adventures.exports.card,{run,id:step.id}),count:step.count??1,upgraded:step.upgraded??false,specialData:step.misc??0,upgrade:false}):step.kind==='remove'?call(permanentDecks.exports.remove,{deck,card:cardAt(step.index)}):step.kind==='upgrade'?call(permanentDecks.exports.upgrade,{deck,card:cardAt(step.index)}):step.kind==='bottle'?call(permanentDecks.exports.bottle,{deck,index:step.index,type:step.type}):call(permanentDecks.exports.upgradeRandom,{deck,stream:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).streams.misc),count:step.kind==='upgrade-random'?step.count:0});
        return[operation,b.assign(history,b.read(v=>[...v.get(history),v.get(query(adventureViews.exports.privateGame,v.get(run)))]))];
      }),b.return(history),
    );
  });
  return linkRules<{},Setup,Ports,GameView[]>({id:'sts/adventure-deck-case',schemas:{...programSchemas,result:z.array(GameViewSchema)},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureViews]});
}
export function shopCaseFixture(owned:readonly RelicId[]){
  const entry=defineEffect<Setup,GameView>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
    call(resources.exports.gainGold,{entity:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).actor),amount:b.read(v=>10000-v.get(query(resources.exports.current,v.get(query(adventures.exports.current,v.get(run))).actor)).gold)}),call(adventures.exports.setRoom,{run,room:'SHOP',event:0}),call(adventures.exports.setScene,{run,screen:'SHOP_ROOM',continuation:true}),call(adventureContent.merchant.exports.open,run),b.return(query(adventureViews.exports.privateGame,run)),
  );});
  return linkRules<{},Setup,Ports,GameView>({id:'sts/adventure-shop-case',schemas:{...programSchemas,result:GameViewSchema},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureContent.merchant,adventureViews]});
}

export function eventSamplingFixture(owned:readonly RelicId[],lastShops:readonly boolean[]){
  const entry=defineEffect<Setup,{outcomes:{room:string;event:number}[];state:GameView}>(b=>{const run=b.local<number>(),outcomes=b.local<{room:string;event:number}[]>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),b.assign(outcomes,[]),
    forEach(lastShops,lastRoomWasShop=>sequence(call(adventureContent.events.exports.sample,{run,lastRoomWasShop}),b.assign(outcomes,b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(run)));return[...v.get(outcomes),{room:s.room,event:s.event}];})))),b.return({outcomes,state:query(adventureViews.exports.privateGame,run)}),
  );});
  return linkRules({id:'sts/adventure-event-sampling-case',schemas:{...programSchemas,result:z.object({outcomes:z.array(z.object({room:z.string(),event:z.int32()})),state:GameViewSchema})},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureContent.events,adventureViews]});
}

/** Directed legal-map boundary cases use the same content query and move effect as the root. */
export function mapRelicFixture(positions:readonly {x:number;y:number;target:number|null}[]){
  const result=z.array(z.object({options:z.array(z.number()),counter:z.number()}));
  const fixture=rules.defineRules({requires:[adventureContent.cards,adventureContent.acquisition,adventureStart,mapRelics],build(){
    const entry=defineEffect<Setup,z.infer<typeof result>>(b=>{const run=b.local<number>(),out=b.local<z.infer<typeof result>>(),options=b.local<number[]>();return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
      call(adventureContent.acquisition.exports.give,{run,definition:mapRelics.exports.WingBoots}),b.assign(out,[]),
      ...positions.map(p=>sequence(call(adventures.exports.arrive,{run,x:p.x,y:p.y,room:'MONSTER',event:0}),b.assign(options,query(mapRelics.exports.options,run)),...(p.target===null?[]:[call(mapRelics.exports.move,{run,x:p.target})]),b.assign(out,b.read(v=>{const actor=v.query(adventures.exports.bindings,v.get(run)).actor,entity=v.query(relics.exports.find,{actor,definition:mapRelics.exports.WingBoots});if(entity===null)throw Error('Missing boots');return[...v.get(out),{options:v.get(options),counter:v.query(relics.exports.data,entity)}];})))),b.return(out),
    );});return{exports:{entry}};
  }});
  return linkRules<{},Setup,Ports,z.infer<typeof result>>({id:'sts/map-relic-case',schemas:{...programSchemas,result},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
}

export function potionRelicFixture(owned:readonly RelicId[],potion:number,discard:boolean){
  const entry=defineEffect<Setup,GameView>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
    forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
    call(resources.exports.setHealth,{entity:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).actor),hp:10,maxHp:80}),call(potions.exports.obtain,{inventory:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).potions),potion}),
    call(adventurePotions.exports.drink,{run,bits:discard?0xc0000000:0x80000000}),b.return(query(adventureViews.exports.privateGame,run)),
  );});
  return linkRules<{},Setup,Ports,GameView>({id:'sts/potion-relic-case',schemas:{...programSchemas,result:GameViewSchema},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureContent.acquisition,adventureStart,adventurePotions,adventureViews]});
}

export function prismRelicFixture(owned:boolean){
  const result=z.object({generated:z.array(z.string()),held:z.boolean(),cards:z.array(z.string())});
  const fixture=rules.defineRules({requires:[adventureContent.cards,adventureContent.acquisition,adventureStart,adventureDraws],build(){
    const name=rules.defineQuery({input:z.custom<import('../src/rules/relics.ts').RelicDefinition>(),output:z.string(),kinds:[relics.exports.kind],base:(r,d)=>r.definitionConfiguration(d,relics.exports.kind).id});
    const cardName=rules.defineQuery({input:z.custom<import('../src/rules/permanent-decks.types.ts').PermanentCardDefinition>(),output:z.string(),kinds:[cardInstances.exports.kind],base:(r,d)=>r.definitionConfiguration(d,cardInstances.exports.kind).id});
    const entry=defineEffect<Setup,z.infer<typeof result>>(b=>{const run=b.local<number>(),picked=b.local<import('../src/rules/relics.ts').RelicDefinition>(),generated=b.local<string[]>(),cards=b.local<import('../src/rules/adventures.types.ts').CardPreview[]>();return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),b.assign(generated,[]),
      forEach(b.read(v=>v.query(adventures.exports.pools,v.get(run)).relicPools.shop),()=>sequence(b.assign(picked,call(adventureContent.acquisition.exports.draw,{run,tier:'shop',shop:true,front:true,screenless:false})),b.assign(generated,b.read(v=>[...v.get(generated),v.query(name,v.get(picked))])))),
      ...(owned?[call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id:'PRISMATIC_SHARD'})})]:[]),
      b.assign(cards,call(adventureDraws.exports.reward,{run,room:'MONSTER'})),b.return({generated,held:query(adventures.exports.hasRelic,{run,id:'PRISMATIC_SHARD'}),cards:b.read(v=>v.get(cards).map(c=>v.query(cardName,c.definition)))}),
    );});return{exports:{entry}};
  }});
  return linkRules<{},Setup,Ports,z.infer<typeof result>>({id:'sts/prism-policy-case',schemas:{...programSchemas,result},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
}

/** Reward screen with a potion reward, optionally starting from a full potion inventory. */
export function potionRewardCapacityFixture(owned:readonly RelicId[],held:readonly number[],rewardPotions:readonly number[]){
  const entry=defineEffect<Setup,GameView>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
    forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
    forEach(held,potion=>call(potions.exports.obtain,{inventory:b.read(v=>v.get(query(adventures.exports.bindings,v.get(run))).potions),potion})),
    call(adventurePotions.exports.initialize,run),
    call(adventures.exports.setRewards,{run,rewards:{gold:[],cards:[],relics:[],potions:[...rewardPotions],emeraldKey:false,sapphireKey:false}}),
    call(adventureContent.acquisition.exports.rewards,run),
    b.return(query(adventureViews.exports.privateGame,run)),
  );});
  return linkRules<{},Setup,Ports,GameView>({id:'sts/adventure-potion-reward-case',schemas:{...programSchemas,result:GameViewSchema},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureContent.merchant,adventureViews,adventurePotions,potions]});
}

/** Shop screen used to check potion purchase availability against the potion inventory. */
export function shopPotionCapacityFixture(owned:readonly RelicId[],held:readonly number[]){
  const entry=defineEffect<Setup,GameView>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
    forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
    forEach(held,potion=>call(potions.exports.obtain,{inventory:b.read(v=>v.get(query(adventures.exports.bindings,v.get(run))).potions),potion})),
    call(resources.exports.gainGold,{entity:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).actor),amount:b.read(v=>10000-v.get(query(resources.exports.current,v.get(query(adventures.exports.current,v.get(run))).actor)).gold)}),
    call(adventurePotions.exports.initialize,run),
    call(adventures.exports.setRoom,{run,room:'SHOP',event:0}),call(adventures.exports.setScene,{run,screen:'SHOP_ROOM',continuation:true}),call(adventureContent.merchant.exports.open,run),
    b.return(query(adventureViews.exports.privateGame,run)),
  );});
  return linkRules<{},Setup,Ports,GameView>({id:'sts/adventure-potion-shop-case',schemas:{...programSchemas,result:GameViewSchema},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureContent.merchant,adventureViews,adventurePotions,potions]});
}
