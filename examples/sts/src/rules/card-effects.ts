import {z} from 'zod';
import {rules} from './execution.ts';
import {typedValue} from './value.schemas.ts';
import {battles} from './battles.ts';
import {resources} from './resources.ts';
import {damage} from './damage.ts';
import {attributes} from './attributes.ts';
import type {CardUse} from './card-instances.types.ts';
import type {HitRequest,HitResult} from './damage.types.ts';

export type CardHit={use:CardUse;request:HitRequest;targeted:boolean};
export type CardHitReceipt=CardHit&{result:HitResult};
export type CardBlock={use:CardUse;amount:number};
/** Explicit direct-effect provenance. Nested responses use their own ordinary
 * resource/damage calls and cannot inherit a card's receipt accidentally. */
export const cardEffects=rules.defineRules({requires:[battles,resources,damage,attributes],build(m){
  const hitResolved=m.own(rules.defineEvent({payload:typedValue<CardHitReceipt>(),dispatch:'immediate'}));
  const blockGranted=m.own(rules.defineEvent({payload:typedValue<CardBlock>(),dispatch:'immediate'}));
  const announceHit=m.atom({input:typedValue<CardHitReceipt>(),output:z.undefined(),reads:[],writes:[],emits:[hitResolved],run(_r,payload){return{writes:[],events:[{event:hitResolved,payload}],result:undefined};}});
  const announceBlock=m.atom({input:typedValue<CardBlock>(),output:z.undefined(),reads:[],writes:[],emits:[blockGranted],run(_r,payload){return{writes:[],events:[{event:blockGranted,payload}],result:undefined};}});
  const resolveHit=rules.defineEffect<CardHit,HitResult>(b=>{const result=b.local<HitResult>(),live=b.local<boolean>();return rules.sequence(
    b.assign(live,rules.query(attributes.exports.damageable,b.read(v=>v.input.request.target))),
    b.assign(result,rules.call(damage.exports.hit,b.read(v=>v.input.request))),
    rules.when(live,rules.call(announceHit,{use:b.read(v=>v.input.use),request:b.read(v=>v.input.request),targeted:b.read(v=>v.input.targeted),result})),
    b.return(result),
  );});
  const hit=rules.defineEffect<CardHit,HitResult>(b=>{const result=b.local<HitResult>(),live=b.local<boolean>();return rules.sequence(
    b.assign(live,rules.query(attributes.exports.damageable,b.read(v=>v.input.request.target))),
    b.assign(result,rules.call(resolveHit,b.input)),rules.when(live,rules.call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle))),b.return(result),
  );});
  const gainBlock=rules.defineEffect<CardBlock,void>(b=>{const amount=b.local<number>();return rules.sequence(
    b.assign(amount,rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.input.use.owner),amount:b.read(v=>v.input.amount)})),
    rules.when(b.read(v=>v.get(amount)>0),rules.call(announceBlock,{use:b.read(v=>v.input.use),amount})),
  );});
  return{exports:{resolveHit,hit,gainBlock,hitResolved:hitResolved.public,blockGranted:blockGranted.public}};
}});
