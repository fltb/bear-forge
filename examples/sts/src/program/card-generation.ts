import { typedValue } from '../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../rules/execution.ts';
import {adventures} from "../rules/adventures.ts";
import {battles} from "../rules/battles.ts";
import {cardPiles} from "../rules/card-piles.ts";
import {cardInstances} from "../rules/card-instances.ts";
import {zones} from "../rules/zones.ts";
import {random} from "../rules/random.ts";
import {actionQueue} from "../rules/combat-actions.ts";
import type {PermanentCardDefinition} from "../rules/permanent-decks.types.ts";
const {defineRules,defineQuery,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;
export const combatGeneration=defineRules({requires:[adventures,battles],build(){
  const pool=defineQuery({input:z.object({battle:z.number(),category:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4)])}),output:z.array(typedValue<PermanentCardDefinition>()),dependencies:[adventures.exports.cardPools,adventures.exports.forActor,adventures.exports.card,battles.exports.current,battles.exports.status],base(r,i){const run=r.query(adventures.exports.forActor,r.query(battles.exports.status,i.battle).actor);if(run===null)throw Error('Combat generation needs the adventure catalog');const ids=r.query(adventures.exports.cardPools,run).combat[i.category]!;return ids.map(id=>r.query(adventures.exports.card,{run,id}));}});
  const randomCard=defineEffect<{battle:number;category:0|1|2|3|4},PermanentCardDefinition>(b=>{const definitions=b.local<PermanentCardDefinition[]>(),index=b.local<number>();return sequence(b.assign(definitions,query(pool,b.input)),b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(definitions).length-1)})),b.return(b.read(v=>v.get(definitions)[v.get(index)]!)));});
  const create=defineEffect<{battle:number;definition:PermanentCardDefinition;upgraded:boolean;zeroCombat:boolean;zeroTurn:boolean;destination:0|1|2|3;shuffle:boolean},number>(b=>{const entity=b.local<number>();return sequence(
    b.assign(entity,call(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition:b.read(v=>v.input.definition),upgraded:b.read(v=>v.input.upgraded),specialData:0,destination:b.read(v=>v.input.destination),shuffle:b.read(v=>v.input.shuffle),mutable:null})),when(b.read(v=>v.input.zeroCombat),call(cardInstances.exports.setCostForCombat,{entity,amount:0})),when(b.read(v=>v.input.zeroTurn),call(cardInstances.exports.setCostForTurn,{entity,amount:0})),b.return(entity),
  );});
  const playTop:rules.Effect<{battle:number;target:number|null;exhaust:boolean},void>=defineEffect(b=>{const draw=b.local<number>(),card=b.local<number>();return sequence(
    b.assign(draw,b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).draw)),when(b.read(v=>v.query(zones.exports.members,v.get(draw)).length===0),sequence(
      when(b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).discard).length===0),b.return(undefined)),
      enqueue(playTop,b.input,{queue:actionQueue,position:'front',source:b.read(v=>v.input.battle),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),enqueue(cardPiles.exports.shuffleDiscard,b.read(v=>v.query(battles.exports.status,v.input.battle).piles),{queue:actionQueue,position:'front',source:b.read(v=>v.input.battle),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),b.return(undefined),
    )),b.assign(card,b.read(v=>v.query(zones.exports.members,v.get(draw)).at(-1)!)),call(zones.exports.move,{entity:card,from:draw,to:null,index:0}),call(battles.exports.queueCard,{battle:b.read(v=>v.input.battle),card,target:b.read(v=>v.input.target),front:true,options:{autoplay:true,freeToPlay:true,exhaustOnUse:b.read(v=>v.input.exhaust)}}),
  );});
  const randomTarget=defineEffect<number,number|null>(b=>{const targets=b.local<number[]>(),index=b.local<number>();return sequence(b.assign(targets,query(battles.exports.targets,b.input)),when(b.read(v=>v.get(targets).length===0),b.return(null)),b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input).piles).cardRng),start:0,end:b.read(v=>v.get(targets).length-1)})),b.return(b.read(v=>v.get(targets)[v.get(index)]!)));});
  return{exports:{pool,randomCard,create,playTop,randomTarget}};
}});
