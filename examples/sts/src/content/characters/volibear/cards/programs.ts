import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {damage} from '../../../../rules/damage.ts';
import type {HitResult} from '../../../../rules/damage.types.ts';
import type {CardUse,CardConfig} from '../../../../rules/card-instances.types.ts';
import {standardUpgrade,upgradeOnce,registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearTraining} from '../mechanics/training.ts';
import {cardAmount,type CardAmount} from '../../../cards/shared/programs.ts';
import {lightning} from '../mechanics/lightning.ts';
import type {VolibearCardDescription} from './metadata.ts';

const {defineRules,defineQuery,defineEffect,sequence,call,when,query,forEach,enqueue}=rules;

/** Extension points are typed definition references using the existing L2 API.
 * Fixed per-segment growth is separate from dynamic damage (e.g. current block).
 * Single-target expansion never changes the original CardUse.target.
 */
export const volibearCardPrograms=defineRules({requires:[cardTargets,cardEffects,battles,attributes,resources,lightning,volibearTraining],build(){
  const fixedBonus=defineQuery({input:cardUseSchema,output:z.int32(),dependencies:[volibearTraining.exports.permanentBonus],base:(r,use)=>r.query(volibearTraining.exports.permanentBonus,use.card)});
  const singleTargets=cardTargets.exports.enemies;
  return {exports:{fixedBonus,singleTargets}};
}});

export function compose(...effects:rules.Effect<CardUse,void>[]):rules.Effect<CardUse,void>{
  return defineEffect<CardUse,void>(b=>sequence(...effects.map(effect=>when(
    b.read(v=>v.get(query(battles.exports.current,v.input.battle)).outcome===0),call(effect,b.input),
  ))));
}

/** Keep the ordinary combat queue and lifetime; do not call an alternate executor. */
export function card(description:VolibearCardDescription,use:rules.Effect<CardUse,void>,policies:Partial<Pick<CardConfig,'canUse'|'created'|'returned'|'removed'>>={}){
  const fixed=description.metadata.type===0&&description.metadata.variants[0].damage>0;
  const created=rules.defineEffect<rules.EntityLifecycle<import('../../../../rules/card-instances.types.ts').CardSetup>,void>(b=>sequence(
    ...(policies.created?[call(policies.created,b.input)]:[]),
    ...(fixed?[call(registerCardAbilities(volibearTraining.exports.fixedAttack),b.input)]:[]),
  ));
  return rules.defineEntity(cardInstances.exports.kind,{
    id:description.id,metadata:description.metadata,use,
    canUpgrade:upgradeOnce(description.metadata),upgrade:standardUpgrade(description.metadata),...policies,created,
  });
}

export function queued(effect:rules.Effect<CardUse,void>):rules.Effect<CardUse,void>{
  return defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{
    queue:actionQueue,source:b.read(v=>v.input.card),
    lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured',
  }));
}

export type CardHitReceipt={use:CardUse;target:number;hpBefore:number;result:HitResult};
export function attack(base:CardAmount,count:CardAmount=1,all=false,fixed=true,afterHit?:rules.Effect<CardHitReceipt,void>):rules.Effect<CardUse,void>{
  const hit=defineEffect<{use:CardUse;target:number},void>(b=>{
    const result=b.local<HitResult>(),hpBefore=b.local<number>();
    const request={
      battle:b.read(v=>v.input.use.battle),source:b.read(v=>v.input.use.owner),target:b.read(v=>v.input.target),
      amount:b.read(v=>v.get(query(attributes.exports.attackAmount,{
        source:v.input.use.owner,target:v.input.target,card:v.input.use.card,
        base:cardAmount(base,{input:v.input.use,get:v.get,query:v.query})+(fixed?v.get(query(volibearCardPrograms.exports.fixedBonus,v.input.use)):0),
      }))),attack:true,selfDamage:false,
    };
    return when(
    b.read(v=>v.get(query(battles.exports.current,v.input.use.battle)).outcome===0&&v.get(query(attributes.exports.damageable,v.input.target))),
    afterHit?sequence(
      b.assign(hpBefore,b.read(v=>v.get(query(resources.exports.current,v.input.target)).hp)),
      b.assign(result,call(cardEffects.exports.resolveHit,{use:b.read(v=>v.input.use),request,targeted:!all})),
      call(afterHit,{use:b.read(v=>v.input.use),target:b.read(v=>v.input.target),hpBefore,result}),
      call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)),
    ):call(cardEffects.exports.hit,{use:b.read(v=>v.input.use),request,targeted:!all}),
    );
  });
  // Each segment is a queue task: front-queued retaliation resolves before the
  // next segment, and death/victory can cancel remaining work normally.
  return defineEffect<CardUse,void>(b=>forEach(b.read(v=>Array.from({length:cardAmount(count,v)},(_,i)=>i)),()=>
    forEach(all?query(battles.exports.targets,b.read(v=>v.input.battle)):query(volibearCardPrograms.exports.singleTargets,b.input),target=>
      enqueue(hit,{use:b.input,target},{queue:actionQueue,source:b.read(v=>v.input.card),
        lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
    ),
  ));
}

export function block(base:CardAmount):rules.Effect<CardUse,void>{
  return queued(defineEffect<CardUse,void>(b=>call(cardEffects.exports.gainBlock,{
    use:b.input,amount:b.read(v=>Math.max(0,v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:cardAmount(base,v)})))),
  })));
}

export function thunder(base:CardAmount):rules.Effect<CardUse,void>{
  return queued(defineEffect<CardUse,void>(b=>call(lightning.exports.strike,{
    battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),base:b.read(v=>cardAmount(base,v)),exclude:null,
  })));
}

export function draw(count:CardAmount):rules.Effect<CardUse,void>{
  return queued(defineEffect<CardUse,void>(b=>call(cardPiles.exports.draw,{
    piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),
    count:b.read(v=>Math.max(0,cardAmount(count,v))),
  })));
}
