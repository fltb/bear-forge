import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {ruleModules,linkRules} from '@bear-forge/card-engine';
import {portEffect} from '../../../packages/card-engine/src/rules-internal.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {resources} from '../src/rules/resources.ts';
import {random} from '../src/rules/random.ts';
import {zones} from '../src/rules/zones.ts';
import {actionQueue,combatScope} from '../src/rules/combat-actions.ts';
import {cards} from '../src/cards.ts';
import type {CardUse} from '../src/rules/card-instances.types.ts';
import type {PileCard} from '../src/rules/card-piles.types.ts';
import {registerCardAbilities,standardUpgrade,upgradeOnce} from "../src/content/cards/shared/lifecycle.ts";
const {defineRules,defineComponent,defineQuery,defineEntity,defineEffect,on,sequence,call,query,spawnEntity,forEach}=rules;
const choose=portEffect<unknown,number>('choose');
const logger=defineRules({requires:[],build(m){
  const events=m.own(defineComponent({schema:z.array(z.number()),initial:()=>[]}));
  const kind=m.kind({config:z.undefined(),components:[events]});
  const append=m.atom({input:z.object({log:z.number(),card:z.number()}),output:z.undefined(),reads:[events],writes:[events],emits:[],run(r,i){return{writes:[{entity:i.log,component:events,value:[...r.component(i.log,events),i.card]}],events:[],result:undefined};}});
  const current=defineQuery({input:z.number(),output:z.array(z.number()),reads:[events],base:(r,entity)=>[...r.component(entity,events)]});
  return{exports:{kind,append,current}};
}});
const fixtureRules=defineRules({requires:[cardPiles,logger],build(){
  const view=defineQuery({input:z.object({piles:z.number(),log:z.number()}),output:z.any(),dependencies:[cardPiles.exports.current,zones.exports.members,cardInstances.exports.combatView,random.exports.current,logger.exports.current],base:(r,i)=>{
    const p=r.query(cardPiles.exports.current,i.piles),unique=(zone:number)=>r.query(zones.exports.members,zone).map(card=>r.query(cardInstances.exports.combatView,card));
    return{draw:unique(p.draw),hand:unique(p.hand),discard:unique(p.discard),exhaust:unique(p.exhaust),drawn:p.drawn,events:r.query(logger.exports.current,i.log),shuffle:r.query(random.exports.current,p.shuffleRng)};
  }});
  const self=defineQuery({input:z.custom<rules.ReactionContext<PileCard>>(),output:z.boolean(),base:(_r,c)=>c.source===c.event.card});
  const pause=on(cardPiles.exports.drawing,{condition:self,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>{const reply=b.local<number>();return sequence(
    call(logger.exports.append,{log:b.read(v=>v.input.owner),card:b.read(v=>v.get(query(cardInstances.exports.current,v.input.source)).uniqueId)}),
    b.assign(reply,call(choose,b.read(v=>({...v.get(query(view,{piles:v.input.event.piles,log:v.input.owner})),card:v.get(query(cardInstances.exports.current,v.input.source)).uniqueId,queueSize:v.get(ruleModules.queueSize(actionQueue))})))),
    call(cardInstances.exports.overrideTurnCost,{entity:b.read(v=>v.input.source),amount:reply}),
  );})});
  // The pile fixture only pauses on draw; its noop use has no attack damage.
  const metadata={...cards.ANGER,variants:[{...cards.ANGER.variants[0],damage:-1},{...cards.ANGER.variants[1],damage:-1}] as const};
  return{exports:{view,card:defineEntity(cardInstances.exports.kind,{id:'ANGER',metadata,use:defineEffect<CardUse,void>(b=>b.return(undefined)),canUpgrade:upgradeOnce(metadata),upgrade:standardUpgrade(metadata),created:registerCardAbilities(pause)})}};
}});
const actor=defineEntity(resources.exports.actor,{side:0}),unbounded=defineEntity(zones.exports.kind,{capacity:null}),hand=defineEntity(zones.exports.kind,{capacity:10}),stream=defineEntity(random.exports.stream,undefined),pile=defineEntity(cardPiles.exports.kind,undefined),log=defineEntity(logger.exports.kind,undefined);
const entry=defineEffect<void,unknown>(b=>{
  const actorId=b.local<number>(),logId=b.local<number>(),scope=b.local<number>(),draw=b.local<number>(),inHand=b.local<number>(),discard=b.local<number>(),exhaust=b.local<number>(),shuffle=b.local<number>(),cardRng=b.local<number>(),piles=b.local<number>();
  return sequence(b.assign(actorId,spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:80,maxHp:80,gold:0,energy:3,block:0}})),b.assign(logId,spawnEntity({definition:log,owner:null,scope:0})),b.assign(scope,ruleModules.openScope(combatScope,0)),
    b.assign(draw,spawnEntity({definition:unbounded,owner:actorId,scope})),b.assign(inHand,spawnEntity({definition:hand,owner:actorId,scope})),b.assign(discard,spawnEntity({definition:unbounded,owner:actorId,scope})),b.assign(exhaust,spawnEntity({definition:unbounded,owner:actorId,scope})),
    b.assign(shuffle,spawnEntity({definition:stream,owner:null,scope,setup:130n})),b.assign(cardRng,spawnEntity({definition:stream,owner:null,scope,setup:130n})),
    b.assign(piles,spawnEntity({definition:pile,owner:actorId,scope,setup:{actor:actorId,battle:actorId,draw,hand:inHand,discard,exhaust,shuffleRng:shuffle,cardRng,actionScope:scope}})),
    forEach([0,1,2],index=>{const entity=b.local<number>();return sequence(b.assign(entity,spawnEntity({definition:fixtureRules.exports.card,owner:logId,scope,setup:{mode:1,master:null,uniqueId:index,specialData:0,upgraded:false}})),
      call(zones.exports.move,{entity,from:null,to:b.read(v=>v.get(index)===2?v.get(discard):v.get(draw)),index:b.read(v=>v.get(index)===2?0:v.get(index))}),
    );}),call(cardPiles.exports.draw,{piles,count:3}),ruleModules.drainQueue(actionQueue),b.return(b.read(v=>({...v.get(query(fixtureRules.exports.view,{piles:v.get(piles),log:v.get(logId)})),queueSize:v.get(ruleModules.queueSize(actionQueue))}))),
  );
});
export let initializations=0;
export const definition=linkRules<{},void,{choose:{input:unknown;output:number}},unknown>({id:'sts/card-piles-persistence-1',schemas:{setup:z.undefined(),result:z.unknown(),ports:{choose:{input:z.unknown(),output:z.int32().min(0).max(9)}}},initialize(){initializations++;return{};},entry,definitions:[entry,choose],modules:[fixtureRules]});
