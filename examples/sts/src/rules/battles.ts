import {componentPart} from './component-parts.ts';
import {z} from 'zod';
import {rules,ruleModules} from '@bear-forge/card-engine';
import {resources} from './resources.ts';
import {random} from './random.ts';
import {zones} from './zones.ts';
import {cardInstances} from './card-instances.ts';
import {cardPiles} from './card-piles.ts';
import {powers} from './powers.ts';
import {attributes} from './attributes.ts';
import {damage} from './damage.ts';
import type {HitRequest,HitResult} from './damage.types.ts';
import {actionQueue,combatActionScope} from './combat-actions.ts';
import {entityId} from './resources.schemas.ts';
import {cardUseSchema} from './card-instances.schemas.ts';
import {battleSetupSchema,battleStateSchema,battleStorageSchema,battleStatusSchema,battleOpportunitiesSchema,cardPlaySchema,cardOpportunitySchema,queueCardSchema,cardDestinationSchema} from './battles.schemas.ts';
import type {CardConfig,CardUse,CardMutable} from './card-instances.types.ts';
import type {BattleSetup,BattleState,PlayOptions,CardPlay,CardOpportunity,QueueCard,CardDestination} from './battles.types.ts';
const queuedCountForActionQueue=ruleModules.queueSize(actionQueue);
const {defineRules,defineComponent,defineEvent,defineCheckpoint,defineQuery,defineEffect,defineEntity,sequence,when,whileDo,forEach,call,query,spawnEntity,entityEffect,enqueue}=rules;
export const CardDisposition={Discard:0,Exhaust:1,DrawTop:2,Vanish:3} as const;
const defaults={autoplay:false,triggerOnUse:true,purgeOnUse:false,freeToPlay:false,ignoreEnergyTotal:false,randomTarget:false,exhaustOnUse:false,regretCardCount:0};
// An optional key may be explicitly undefined in the schema's output type.
// Preserve the old invalid-result rejection for that case; ordinary absent
// keys inherit defaults. No boolean/number structural checks run here.
function playOptions(options:z.output<typeof queueCardSchema>['options']):PlayOptions{
  const result={...defaults,...options};
  for(const key of Object.keys(defaults) as (keyof PlayOptions)[])if(result[key]===undefined)throw Error('Undefined card play option');
  return result as PlayOptions;
}
const narrow16=(value:number)=>(value<<16)>>16;
const mutable=(c:rules.Borrowed<CardMutable>):CardMutable=>({specialData:c.specialData,cost:c.cost,costForTurn:c.costForTurn,upgraded:c.upgraded,freeToPlayOnce:c.freeToPlayOnce,retain:c.retain});

/** One battle owner coordinates typed card programs. All named mechanics remain content registrations. */
export const battles=defineRules({requires:[cardPiles,powers,attributes,damage],build(m){
  m.lifecycle(combatActionScope,{});
  const state=m.own(defineComponent({schema:battleStatusSchema.nullable(),initial:()=>null}));
  const opportunities=componentPart(m,battleOpportunitiesSchema),plays=opportunities.component;
  const power={},relic={},enemy={},after={},stages={power,relic,enemy,after};
  const order={phases:[{phase:power,before:[relic]},{phase:relic,before:[enemy]},{phase:enemy,before:[after]},{phase:after}],default:power};
  const using=m.own(defineEvent({payload:cardUseSchema,dispatch:'immediate',order})),used=m.own(defineEvent({payload:cardUseSchema,dispatch:'immediate',order}));
  const otherCardPlayed=m.own(defineEvent({payload:cardUseSchema,dispatch:'immediate',order})),afterUse=m.own(defineEvent({payload:cardUseSchema,dispatch:'immediate',order}));
  const finished=m.own(defineEvent({payload:cardUseSchema,dispatch:'immediate',order})),endTurnCards=m.own(defineEvent({payload:entityId,dispatch:'immediate',order}));
  const started=m.own(defineEvent({payload:entityId,dispatch:'immediate',order}));
  const openingQueued=m.own(defineEvent({payload:entityId,dispatch:'immediate',order}));
  const announceOpeningQueued=m.atom({input:entityId,output:z.undefined(),reads:[],writes:[],emits:[openingQueued],run(_r,payload){return{writes:[],events:[{event:openingQueued,payload}],result:undefined};}});
  const exiting=m.own(defineEvent({payload:z.object({battle:entityId,actor:entityId,outcome:z.union([z.literal(1),z.literal(2)])}).strict(),dispatch:'immediate',order}));
  const beforePlay=m.own(defineCheckpoint({input:cardUseSchema,output:cardUseSchema,order})),disposing=m.own(defineCheckpoint({input:cardDestinationSchema,output:cardDestinationSchema,order}));
  const status=defineQuery({input:entityId,output:battleStatusSchema.extend({piles:entityId}),reads:[state],base:(r,battle)=>{const value=r.component(battle,state);if(value===null||value.piles===null)throw Error('Battle initialization is incomplete');return{...value,piles:value.piles};}});
  const current=defineQuery({input:entityId,output:battleStateSchema,dependencies:[status,opportunities.current],base:(r,battle)=>({...r.query(status,battle),...r.query(opportunities.current,battle)})});
  const forActor=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,actor)=>{
    const candidates=r.entities(state).filter(id=>{const value=r.component(id,state);return value!==null&&value.piles!==null&&value.actor===actor&&value.outcome===0;});
    if(candidates.length>1)throw Error('One actor cannot participate in two active battles');return candidates[0]??null;
  }});
  const presentForActor=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,actor)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.actor===actor);if(ids.length>1)throw Error('Actor has multiple live battle scopes');return ids[0]??null;}});
  const forRegistry=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,registry)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.registry===registry);if(ids.length>1)throw Error('Power registry belongs to two battles');return ids[0]??null;}});
  const active=defineQuery({input:z.object({battle:entityId,play:entityId}),output:cardPlaySchema,dependencies:[current,opportunities.current],base:(r,i)=>{const value=r.query(opportunities.current,i.battle).current;if(value===null||value.id!==i.play)throw Error('Card play is no longer current');return value;}});
  const context=defineQuery({input:z.object({battle:entityId,play:entityId}),output:cardUseSchema,dependencies:[current,active,status],base:(r,i)=>{
    const p=r.query(active,i);return{battle:i.battle,play:p.id,card:p.card,owner:r.query(status,i.battle).actor,target:p.target,state:p.state,energyOnUse:p.energyOnUse,autoplay:p.autoplay,freeToPlay:p.freeToPlay,ignoreEnergyTotal:p.ignoreEnergyTotal,purgeOnUse:p.purgeOnUse,triggerOnUse:p.triggerOnUse,regretCardCount:p.regretCardCount};
  }});
  const targetable=defineQuery({input:entityId,output:z.boolean(),dependencies:[attributes.exports.damageable],base:(r,actor)=>r.query(attributes.exports.damageable,actor)});
  const targets=defineQuery({input:entityId,output:z.array(entityId),dependencies:[current,targetable,status],base:(r,battle)=>r.query(status,battle).enemies.filter(actor=>r.query(targetable,actor))});
  const victoryTargets=defineQuery({input:entityId,output:z.array(entityId),dependencies:[targets],base:(r,battle)=>r.query(targets,battle)});
  const victoryDeferred=defineQuery({input:entityId,output:z.boolean(),base:()=>false});
  const freeToPlay=defineQuery({input:cardUseSchema,output:z.boolean(),base:(_r,c)=>c.state.freeToPlayOnce});
  const waivedPayment=defineQuery({input:cardUseSchema,output:z.boolean(),base:()=>false});
  const cost=defineQuery({input:cardUseSchema,output:z.int32(),base:(_r,c)=>c.state.costForTurn});
  const defaultCanUse=defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>{const type=r.query(cardInstances.exports.metadata,c.card).type;return type>=0&&type<=2;}});
  const usePolicy={kind:cardInstances.exports.kind,select:(c:rules.Borrowed<CardConfig>)=>c.canUse??defaultCanUse};
  const intrinsic=defineQuery({input:cardUseSchema,output:z.boolean(),selections:[usePolicy],base:(r,c)=>r.selected(usePolicy,c.card,c)});
  const canUse=defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[current,targets,intrinsic,freeToPlay,waivedPayment,cost,resources.exports.current,cardInstances.exports.metadata,status,resources.exports.stamina],base:(r,c)=>{
    const board=r.query(status,c.battle),metadata=r.query(cardInstances.exports.metadata,c.card),requiresTarget=metadata.variants[c.state.upgraded?1:0].target;
    return(!requiresTarget||c.target!==null&&r.query(targets,c.battle).includes(c.target))&&r.query(intrinsic,c)&&(c.autoplay||r.query(freeToPlay,c)||r.query(waivedPayment,c)||r.query(resources.exports.stamina,board.actor).energy>=r.query(cost,c));
  }});
  const recoveredGold=defineQuery({input:entityId,output:z.int32().nonnegative(),base:()=>0});
  const rewardEligible=defineQuery({input:z.object({battle:entityId,target:entityId}),output:z.boolean(),base:()=>true});
  const playAllowed=defineQuery({input:entityId,output:z.boolean(),base:()=>true});
  const canContinue=defineQuery({input:entityId,output:z.boolean(),dependencies:[current,cardPiles.exports.current,zones.exports.members,cardPiles.exports.bindings,status],base:(r,battle)=>{const p=r.query(cardPiles.exports.bindings,r.query(status,battle).piles);return[p.hand,p.draw,p.discard].some(zone=>r.query(zones.exports.members,zone).length>0);}});
  const payment=defineQuery({input:cardUseSchema,output:z.int32().nonnegative(),dependencies:[freeToPlay,waivedPayment,cost],base:(r,c)=>c.autoplay||c.purgeOnUse||r.query(freeToPlay,c)||r.query(waivedPayment,c)?0:Math.max(0,r.query(cost,c))});
  const initialExhaust=defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>r.query(cardInstances.exports.metadata,c.card).variants[c.state.upgraded?1:0].exhaust});
  const exhaustAfterUse=defineQuery({input:cardUseSchema,output:z.boolean(),base:()=>false});
  const expectedOutcome=defineQuery({input:entityId,output:z.union([z.literal(0),z.literal(1),z.literal(2)]),dependencies:[current,resources.exports.current,victoryTargets,victoryDeferred,resources.exports.vitality,status],base:(r,battle)=>r.query(resources.exports.vitality,r.query(status,battle).actor).hp<=0?2 as const:r.query(victoryTargets,battle).length===0&&!r.query(victoryDeferred,battle)?1 as const:0 as const});
  const outcomeCommit=m.atom({input:z.object({battle:entityId,outcome:z.union([z.literal(0),z.literal(1),z.literal(2)])}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.battle,state);if(before===null)throw Error('Missing battle');return{writes:before.outcome===0||i.outcome===2?[{entity:i.battle,component:state,value:{...before,outcome:i.outcome}}]:[],events:[],result:undefined};}});
  const setActionScope=m.atom({input:z.object({battle:entityId,scope:z.int32().nonnegative()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const value=r.component(i.battle,state);if(value===null)throw Error('Missing battle');return{writes:[{entity:i.battle,component:state,value:{...value,actionScope:i.scope}}],events:[],result:undefined};}});
  const checkOutcome=defineEffect<number,void>(b=>{const nextScope=b.local<number>();return sequence(call(outcomeCommit,{battle:b.input,outcome:query(expectedOutcome,b.input)}),when(b.read(v=>v.query(status,v.input).outcome===1),sequence(
    ruleModules.closeScope(b.read(v=>v.query(status,v.input).actionScope)),b.assign(nextScope,ruleModules.openScope(combatActionScope,b.read(v=>v.query(status,v.input).scope))),
    call(setActionScope,{battle:b.input,scope:nextScope}),call(cardPiles.exports.setActionScope,{piles:b.read(v=>v.query(status,v.input).piles),scope:nextScope}),
  )));});
  const hit=defineEffect<HitRequest,HitResult>(b=>{const result=b.local<HitResult>(),live=b.local<boolean>();return sequence(b.assign(live,query(attributes.exports.damageable,b.read(v=>v.input.target))),b.assign(result,call(damage.exports.hit,b.input)),when(live,call(checkOutcome,b.read(v=>v.input.battle))),b.return(result));});
  const begin=m.atom({input:z.object({battle:entityId,actor:entityId,registry:entityId,enemies:z.array(entityId),scope:z.int32().nonnegative(),actionScope:z.int32().nonnegative()}),output:z.undefined(),reads:[],writes:[state,plays],emits:[],run(_r,i){return{writes:[{entity:i.battle,component:state,value:{actor:i.actor,registry:i.registry,enemies:i.enemies,scope:i.scope,actionScope:i.actionScope,piles:null,started:false,turn:1,outcome:0 as const,endTurnQueued:false,energyWasted:0,cardsPlayed:0,attacksPlayed:0,skillsPlayed:0,lastTargeted:null}},{entity:i.battle,component:plays,value:{queue:[],current:null,currentIsEndTurn:false,nextPlay:1}}],events:[],result:undefined};}});
  const setPiles=m.atom({input:z.object({battle:entityId,piles:entityId}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.battle,state);if(before===null||before.piles!==null)throw Error('Battle piles already attached');return{writes:[{entity:i.battle,component:state,value:{...before,piles:i.piles}}],events:[],result:undefined};}});
  const unbounded=defineEntity(zones.exports.kind,{capacity:null}),hand=defineEntity(zones.exports.kind,{capacity:10}),pile=defineEntity(cardPiles.exports.kind,undefined);
  const validateSetup=defineQuery({input:battleSetupSchema,output:battleSetupSchema,dependencies:[resources.exports.side,powers.exports.entries,random.exports.current,forActor],base:(r,i)=>{
    if(r.query(resources.exports.side,i.actor)!==0||new Set(i.enemies).size!==i.enemies.length||i.enemies.some(actor=>r.query(resources.exports.side,actor)!==1))throw Error('Invalid battle actors');
    if(r.query(forActor,i.actor)!==null)throw Error('Actor is already in an active battle');
    r.query(powers.exports.entries,i.registry);r.query(random.exports.current,i.shuffleRng);r.query(random.exports.current,i.cardRng);return i;
  }});
  const initialize=defineEffect<rules.EntityLifecycle<BattleSetup>,void>(b=>{
    const setup=b.local<BattleSetup>(),draw=b.local<number>(),inHand=b.local<number>(),discard=b.local<number>(),exhaust=b.local<number>(),piles=b.local<number>(),actionScope=b.local<number>();return sequence(
      b.assign(setup,query(validateSetup,b.read(v=>v.input.setup))),b.assign(actionScope,ruleModules.openScope(combatActionScope,b.read(v=>v.input.scope))),
      call(begin,{battle:b.read(v=>v.input.entity),actor:b.read(v=>v.get(setup).actor),registry:b.read(v=>v.get(setup).registry),enemies:b.read(v=>v.get(setup).enemies),scope:b.read(v=>v.input.scope),actionScope}),
      b.assign(draw,spawnEntity({definition:unbounded,owner:b.read(v=>v.input.entity),scope:b.read(v=>v.input.scope)})),b.assign(inHand,spawnEntity({definition:hand,owner:b.read(v=>v.input.entity),scope:b.read(v=>v.input.scope)})),
      b.assign(discard,spawnEntity({definition:unbounded,owner:b.read(v=>v.input.entity),scope:b.read(v=>v.input.scope)})),b.assign(exhaust,spawnEntity({definition:unbounded,owner:b.read(v=>v.input.entity),scope:b.read(v=>v.input.scope)})),
      b.assign(piles,spawnEntity({definition:pile,owner:b.read(v=>v.get(setup).actor),scope:b.read(v=>v.input.scope),setup:{actor:b.read(v=>v.get(setup).actor),battle:b.read(v=>v.input.entity),draw,hand:inHand,discard,exhaust,shuffleRng:b.read(v=>v.get(setup).shuffleRng),cardRng:b.read(v=>v.get(setup).cardRng),actionScope}})),
      call(setPiles,{battle:b.read(v=>v.input.entity),piles}),call(cardPiles.exports.initializeDeck,{piles,masters:b.read(v=>v.get(setup).masters),bottled:b.read(v=>v.get(setup).bottled),drawPerTurn:b.read(v=>v.get(setup).drawPerTurn)}),
    );
  });
  const kind=m.kind({config:z.undefined(),setup:battleSetupSchema,components:[state,plays],initialize});
  const queued=defineQuery({input:queueCardSchema,output:cardPlaySchema,dependencies:[current,cardInstances.exports.current,resources.exports.current,resources.exports.stamina],base:(r,i)=>{
    const board=r.query(current,i.battle),physical=r.query(cardInstances.exports.current,i.card),snapshot=i.state??physical;
    if(snapshot.mode!==1||snapshot.mode!==physical.mode||snapshot.master!==physical.master||snapshot.uniqueId!==physical.uniqueId)throw Error('Queued card identity does not match its physical instance');
    return {...playOptions(i.options),id:board.nextPlay,card:i.card,state:snapshot,target:i.target,energyOnUse:i.energyOnUse??r.query(resources.exports.stamina,board.actor).energy,vanished:false};
  }});
  const queueCommit=m.atom({input:z.object({battle:entityId,item:cardOpportunitySchema,front:z.boolean(),afterFirst:z.boolean().default(false)}),output:entityId,reads:[state,plays],writes:[plays],emits:[],run(r,i){const before=r.component(i.battle,plays),status=r.component(i.battle,state);if(before===null||status===null||status.outcome!==0||before.queue.length>=10||before.nextPlay>=Number.MAX_SAFE_INTEGER)throw Error('Cannot queue another card opportunity');return{writes:[{entity:i.battle,component:plays,value:{...before,queue:i.afterFirst&&before.queue.length>0?[before.queue[0]!,i.item,...before.queue.slice(1)]:i.front?[i.item,...before.queue]:[...before.queue,i.item],nextPlay:before.nextPlay+1}}],events:[],result:before.nextPlay};}});
  const queueCard=defineEffect<QueueCard,number>(b=>{const result=b.local<number>();return sequence(b.assign(result,call(queueCommit,{battle:b.read(v=>v.input.battle),item:{kind:0,play:query(queued,b.input)},front:b.read(v=>v.input.front??false),afterFirst:b.read(v=>v.input.afterFirst??false)})),b.return(result));});
  const canQueue=defineQuery({input:queueCardSchema,output:z.boolean(),dependencies:[queued,current,context,canUse,playAllowed,zones.exports.location,cardPiles.exports.current,status,cardPiles.exports.bindings],base:(r,i)=>{
    const board=r.query(status,i.battle),p=r.query(queued,i);return board.outcome===0&&!board.endTurnQueued&&r.query(playAllowed,i.battle)&&r.query(zones.exports.location,i.card)===r.query(cardPiles.exports.bindings,board.piles).hand&&r.query(canUse,{battle:i.battle,play:p.id,card:p.card,owner:board.actor,target:p.target,state:p.state,energyOnUse:p.energyOnUse,autoplay:p.autoplay,freeToPlay:p.freeToPlay,ignoreEnergyTotal:p.ignoreEnergyTotal,purgeOnUse:p.purgeOnUse,triggerOnUse:p.triggerOnUse,regretCardCount:p.regretCardCount});
  }});
  const queueFromHand=defineEffect<QueueCard,number>(b=>{const result=b.local<number>();return sequence(when(b.read(v=>!v.query(canQueue,v.input)),b.return(b.read(()=>{throw Error('Illegal card play');}))),b.assign(result,call(queueCard,b.input)),b.return(result));});
  const endCommit=m.atom({input:z.object({battle:entityId,energy:z.int32().nonnegative()}),output:z.undefined(),reads:[state,plays],writes:[state,plays],emits:[],run(r,i){const s=r.component(i.battle,state),p=r.component(i.battle,plays);if(s===null||p===null||s.outcome!==0||s.endTurnQueued||p.queue.length>=10)throw Error('Cannot end this turn');return{writes:[{entity:i.battle,component:state,value:{...s,endTurnQueued:true,energyWasted:s.energyWasted+i.energy}},{entity:i.battle,component:plays,value:{...p,queue:[...p.queue,{kind:1 as const,id:p.nextPlay}],nextPlay:p.nextPlay+1}}],events:[],result:undefined};}});
  const endTurn=defineEffect<number,void>(b=>call(endCommit,{battle:b.input,energy:b.read(v=>v.query(resources.exports.stamina,v.query(status,v.input).actor).energy)}));
  const consumeEndTurn=m.atom({input:entityId,output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,entity){const s=r.component(entity,state);if(s===null||!s.endTurnQueued)throw Error('No queued end turn');return{writes:[{entity,component:state,value:{...s,endTurnQueued:false}}],events:[],result:undefined};}});
  const clearCardQueue=m.atom({input:entityId,output:z.undefined(),reads:[plays],writes:[plays],emits:[],run(r,entity){const s=r.component(entity,plays);if(s===null)throw Error('Missing battle');return{writes:[{entity,component:plays,value:{...s,queue:[]}}],events:[],result:undefined};}});
  const pop=m.atom({input:entityId,output:cardOpportunitySchema.nullable(),reads:[plays],writes:[plays],emits:[],run(r,battle){const before=r.component(battle,plays);if(before===null)throw Error('Missing battle');const item=before.queue[0];return{writes:item?[{entity:battle,component:plays,value:{...before,queue:before.queue.slice(1),current:item.kind===0?item.play:null,currentIsEndTurn:item.kind===1}}]:[],events:[],result:item??null};}});
  const setActive=m.atom({input:z.object({battle:entityId,play:cardPlaySchema}),output:z.undefined(),reads:[plays],writes:[plays],emits:[],run(r,i){const before=r.component(i.battle,plays);if(before===null||before.current?.id!==i.play.id||before.current.card!==i.play.card)throw Error('Stale card play update');return{writes:[{entity:i.battle,component:plays,value:{...before,current:i.play}}],events:[],result:undefined};}});
  const markStarted=m.atom({input:cardUseSchema.extend({requiresTarget:z.boolean()}),output:z.undefined(),reads:[state,plays],writes:[state],emits:[using],run(r,i){const before=r.component(i.battle,state),play=r.component(i.battle,plays);if(before===null||play?.current?.id!==i.play)throw Error('Stale card start');const {requiresTarget,...payload}=i;return{writes:[{entity:i.battle,component:state,value:{...before,cardsPlayed:narrow16(before.cardsPlayed+1),lastTargeted:requiresTarget?i.target:before.lastTargeted}}],events:[{event:using,payload}],result:undefined};}});
  const markUsed=m.atom({input:cardUseSchema.extend({type:z.int32()}),output:z.undefined(),reads:[state,plays],writes:[state],emits:[used],run(r,i){const before=r.component(i.battle,state),play=r.component(i.battle,plays);if(before===null||play?.current?.id!==i.play)throw Error('Stale card completion');const {type,...payload}=i;return{writes:[{entity:i.battle,component:state,value:{...before,attacksPlayed:narrow16(before.attacksPlayed+Number(type===0)),skillsPlayed:narrow16(before.skillsPlayed+Number(type===1))}}],events:[{event:used,payload}],result:undefined};}});
  function announce<T>(schema:rules.Schema<T>,event:ruleModules.Owned<rules.RuleEvent<T>>):rules.Effect<T,void>{return m.atom({input:schema,output:z.undefined(),reads:[],writes:[],emits:[event],run(_r,payload){return{writes:[],events:[{event,payload}],result:undefined};}});}
  const announceOther=announce(cardUseSchema,otherCardPlayed),announceAfter=announce(cardUseSchema,afterUse),announceFinished=announce(cardUseSchema,finished),announceEnd=announce(entityId,endTurnCards);
  const start=m.atom({input:entityId,output:z.undefined(),reads:[state],writes:[state],emits:[started],run(r,battle){const s=r.component(battle,state);if(s===null||s.piles===null||s.started)throw Error('Battle can start exactly once after its owners are ready');return{writes:[{entity:battle,component:state,value:{...s,started:true}}],events:[{event:started,payload:battle}],result:undefined};}});
  const announceExit=announce(z.object({battle:entityId,actor:entityId,outcome:z.union([z.literal(1),z.literal(2)])}).strict(),exiting);
  const noReturn=defineEffect<import('./card-instances.types.ts').CardReturn,void>(b=>b.return(undefined));
  const returnCards=defineEffect<number,void>(b=>forEach(b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(status,v.input).piles);return[p.draw,p.discard,p.exhaust,p.hand];}),zone=>forEach(query(zones.exports.members,zone),card=>when(b.read(v=>v.query(cardInstances.exports.current,v.get(card)).master!==null),call(entityEffect(cardInstances.exports.kind,card,c=>c.returned??noReturn),{battle:b.input,card,master:b.read(v=>v.query(cardInstances.exports.current,v.get(card)).master!)})))));
  const close=defineEffect<number,void>(b=>{const board=b.local<BattleState>();return sequence(b.assign(board,query(current,b.input)),when(b.read(v=>v.get(board).outcome===0||v.get(board).outcome===1&&v.get(queuedCountForActionQueue)>0),b.return(b.read(()=>{throw Error('Battle must settle to a terminal result before exit');}))),call(announceExit,b.read(v=>{const s=v.get(board);if(s.outcome===0)throw Error('Battle is still active');return{battle:v.input,actor:s.actor,outcome:s.outcome};})),call(returnCards,b.input),ruleModules.closeScope(b.read(v=>v.get(board).scope)));});
  const moveRequired=defineEffect<{card:number;from:number|null;to:number|null;index:number},void>(b=>{const moved=b.local<boolean>();return sequence(b.assign(moved,call(zones.exports.move,{entity:b.read(v=>v.input.card),from:b.read(v=>v.input.from),to:b.read(v=>v.input.to),index:b.read(v=>v.input.index)})),b.return(b.read(v=>{if(!v.get(moved))throw Error('Required play-card movement was canceled');return undefined;})));});
  const leaveHand=defineEffect<{battle:number;play:number},void>(b=>{const use=b.local<CardUse>(),handId=b.local<number>();return sequence(b.assign(use,query(context,b.input)),b.assign(handId,b.read(v=>v.query(cardPiles.exports.bindings,v.query(status,v.input.battle).piles).hand)),
    when(b.read(v=>v.query(zones.exports.location,v.get(use).card)===v.get(handId)),call(moveRequired,{card:b.read(v=>v.get(use).card),from:handId,to:null,index:0})),
  );});
  const applyUse=defineEffect<CardUse,void>(b=>{const p=b.local<CardPlay>();return sequence(b.assign(p,query(active,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play)})),call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>{
    const before=v.get(p),use=v.input;if(use.card!==before.card||use.owner!==v.query(status,use.battle).actor||use.state.mode!==before.state.mode||use.state.master!==before.state.master||use.state.uniqueId!==before.state.uniqueId)throw Error('A play replacement cannot change identity');
    return{...before,target:use.target,state:use.state,energyOnUse:use.energyOnUse,autoplay:use.autoplay,freeToPlay:use.freeToPlay,ignoreEnergyTotal:use.ignoreEnergyTotal,purgeOnUse:use.purgeOnUse,triggerOnUse:use.triggerOnUse,regretCardCount:use.regretCardCount};
  })}));});
  const disposition=defineQuery({input:z.object({battle:entityId,play:entityId}),output:cardDestinationSchema,dependencies:[active,cardInstances.exports.metadata],base:(r,i)=>{const p=r.query(active,i);return{...i,destination:r.query(cardInstances.exports.metadata,p.card).type===2?3 as const:p.exhaustOnUse?1 as const:0 as const};}});
  const afterCard=defineEffect<{battle:number;play:number},void>(b=>{
    const use=b.local<CardUse>(),play=b.local<CardPlay>(),selected=b.local<rules.ReplacementResult<CardDestination>>(),destination=b.local<CardDestination>();return sequence(
      b.assign(use,query(context,b.input)),call(announceAfter,use),b.assign(play,query(active,b.input)),when(b.read(v=>v.get(play).purgeOnUse),b.return(undefined)),
      call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.get(play),state:{...v.get(play).state,freeToPlayOnce:false}}))}),b.assign(play,query(active,b.input)),
      b.assign(selected,m.resolve(disposing,query(disposition,b.input))),when(b.read(v=>v.get(selected).kind==='cancel'),b.return(undefined)),
      b.assign(destination,b.read(v=>{const result=v.get(selected);if(result.kind==='cancel')throw Error('Canceled card disposition');if(result.value.battle!==v.input.battle||result.value.play!==v.input.play)throw Error('A disposition cannot change card play identity');return result.value;})),
      call(cardInstances.exports.setMutable,{entity:b.read(v=>v.get(play).card),value:b.read(v=>mutable(v.get(play).state))}),
      when(b.read(v=>v.get(destination).destination===3),call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.get(play),vanished:true}))}),
        when(b.read(v=>v.get(destination).destination===1),call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(status,v.input.battle).piles),card:b.read(v=>v.get(play).card)}),
          call(moveRequired,b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(status,v.input.battle).piles),to=v.get(destination).destination===2?p.draw:p.discard;return{card:v.get(play).card,from:null,to,index:v.query(zones.exports.members,to).length};})))),
      call(announceFinished,query(context,b.input)),
    );
  });
  const noTrigger=defineEffect<CardUse,void>(b=>b.return(undefined));
  const afterNoTrigger=defineEffect<{battle:number;play:number},void>(b=>call(moveRequired,b.read(v=>{const use=v.query(context,v.input),p=v.query(cardPiles.exports.bindings,v.query(status,v.input.battle).piles);return{card:use.card,from:null,to:p.discard,index:v.query(zones.exports.members,p.discard).length};})));
  const adoptCleanup=m.atom({input:z.object({battle:entityId,play:cardPlaySchema}),output:z.undefined(),reads:[plays],writes:[plays],emits:[],run(r,i){const s=r.component(i.battle,plays);if(s===null||!i.play.autoplay||i.play.purgeOnUse)throw Error('Only canceled autoplay opportunities require cleanup');return{writes:[{entity:i.battle,component:plays,value:{...s,current:{...i.play,triggerOnUse:false},currentIsEndTurn:false}}],events:[],result:undefined};}});
  const cleanupCanceledAutoplay=defineEffect<{battle:number;play:CardPlay},void>(b=>sequence(
    call(adoptCleanup,{battle:b.read(v=>v.input.battle),play:b.read(v=>{const previous=v.query(opportunities.current,v.input.battle).current;const exhaust=previous===null?false:v.query(cardInstances.exports.metadata,previous.card).variants[previous.state.upgraded?1:0].exhaust;return{...v.input.play,exhaustOnUse:v.input.play.exhaustOnUse||exhaust};})}),
    call(afterCard,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play.id)}),
  ));
  const earlyEndCommit=m.atom({input:entityId,output:z.undefined(),reads:[state,plays],writes:[state,plays],emits:[],run(r,entity){const s=r.component(entity,state),p=r.component(entity,plays);if(s===null||p===null||s.outcome!==0)throw Error('Cannot end a terminal battle turn');return{writes:[{entity,component:state,value:{...s,endTurnQueued:true}},{entity,component:plays,value:{...p,queue:[{kind:1 as const,id:p.nextPlay}],nextPlay:p.nextPlay+1}}],events:[],result:undefined};}});
  /** Drain queued opportunities through their normal cleanup, then claim the turn boundary. */
  const endTurnEarly=defineEffect<number,void>(b=>sequence(
    forEach(b.read(v=>v.query(opportunities.current,v.input).queue.flatMap(item=>item.kind===0&&item.play.autoplay&&!item.play.purgeOnUse?[item.play]:[])),play=>enqueue(cleanupCanceledAutoplay,{battle:b.input,play},{queue:actionQueue,lifetime:b.read(v=>v.query(status,v.input).scope),eligible:'captured'})),
    call(earlyEndCommit,b.input),
  ));
  const perform=defineEffect<{battle:number;play:number},void>(b=>{
    const use=b.local<CardUse>(),checked=b.local<rules.ReplacementResult<CardUse>>(),play=b.local<CardPlay>(),roll=b.local<number>();return sequence(
      b.assign(play,query(active,b.input)),when(b.read(v=>v.get(play).randomTarget),sequence(
        when(b.read(v=>v.query(targets,v.input.battle).length===0),b.return(undefined)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.query(targets,v.input.battle).length-1)})),
        call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.get(play),target:v.query(targets,v.input.battle)[v.get(roll)]!}))}),
      )),b.assign(use,query(context,b.input)),
      when(b.read(v=>v.get(use).purgeOnUse||v.get(use).triggerOnUse&&v.query(canUse,v.get(use))),sequence(
        b.assign(checked,m.resolve(beforePlay,use)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(undefined)),
        call(applyUse,b.read(v=>{const result=v.get(checked);if(result.kind==='cancel')throw Error('Canceled card play');return result.value;})),b.assign(use,query(context,b.input)),
        when(b.read(v=>v.query(cardInstances.exports.metadata,v.get(use).card).variants[v.get(use).state.upgraded?1:0].target&&!v.query(targets,v.input.battle).includes(v.get(use).target!)),b.return(undefined)),
        call(applyUse,b.read(v=>({...v.get(use),state:{...v.get(use).state,freeToPlayOnce:v.query(freeToPlay,v.get(use))}}))),b.assign(use,query(context,b.input)),b.assign(play,query(active,b.input)),
        call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.get(play),exhaustOnUse:v.get(play).exhaustOnUse||v.query(initialExhaust,v.get(use))}))}),
        call(markStarted,b.read(v=>({...v.get(use),requiresTarget:v.query(cardInstances.exports.metadata,v.get(use).card).variants[v.get(use).state.upgraded?1:0].target}))),
        call(entityEffect(cardInstances.exports.kind,b.read(v=>v.get(use).card),c=>c.use),use),b.assign(use,query(context,b.input)),call(markUsed,b.read(v=>({...v.get(use),type:v.query(cardInstances.exports.metadata,v.get(use).card).type}))),
        b.assign(play,query(active,b.input)),b.assign(use,query(context,b.input)),call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.get(play),exhaustOnUse:v.get(play).exhaustOnUse||v.query(exhaustAfterUse,v.get(use))}))}),
        enqueue(afterCard,b.input,{queue:actionQueue,source:b.read(v=>v.get(use).card),lifetime:b.read(v=>v.query(status,v.input.battle).scope),eligible:'captured'}),call(announceOther,query(context,b.input)),
        when(b.read(v=>!v.get(use).purgeOnUse),sequence(call(leaveHand,b.input),call(resources.exports.useEnergy,{entity:b.read(v=>v.get(use).owner),amount:query(payment,query(context,b.input))}))),
      )),b.assign(use,query(context,b.input)),when(b.read(v=>!v.get(use).triggerOnUse),sequence(
        call(entityEffect(cardInstances.exports.kind,b.read(v=>v.get(use).card),c=>c.endTurn??noTrigger),use),call(leaveHand,b.input),
        enqueue(afterNoTrigger,b.input,{queue:actionQueue,source:b.read(v=>v.get(use).card),lifetime:b.read(v=>v.query(status,v.input.battle).actionScope),eligible:'captured'}),
      )),
    );
  });
  const playNext=defineEffect<number,boolean>(b=>{const opportunity=b.local<CardOpportunity|null>();return sequence(
    when(b.read(v=>v.get(queuedCountForActionQueue)>0),b.return(b.read(()=>{throw Error('Actions must finish before the next card opportunity');}))),
    when(b.read(v=>v.query(status,v.input).outcome!==0),b.return(false)),b.assign(opportunity,call(pop,b.input)),when(b.read(v=>v.get(opportunity)===null),b.return(false)),
    when(b.read(v=>v.get(opportunity)!.kind===1),call(announceEnd,b.input),call(perform,b.read(v=>{const item=v.get(opportunity);if(!item||item.kind!==0)throw Error('Not a card opportunity');return{battle:v.input,play:item.play.id};}))),b.return(true),
  );});
  const settle=defineEffect<number,void>(b=>{const more=b.local<boolean>();return whileDo(true,sequence(
    when(b.read(v=>v.query(status,v.input).outcome===2),b.return(undefined)),
    when(b.read(v=>v.get(queuedCountForActionQueue)>0),ruleModules.drainOne(actionQueue),sequence(
      b.assign(more,call(playNext,b.input)),when(b.read(v=>!v.get(more)),sequence(when(b.read(v=>v.query(status,v.input).outcome===0&&!v.query(canContinue,v.input)),call(outcomeCommit,{battle:b.input,outcome:2})),b.return(undefined))),
    )),
  ));});
  const setExhaust=defineEffect<{battle:number;play:number;value:boolean},void>(b=>call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.query(active,{battle:v.input.battle,play:v.input.play}),exhaustOnUse:v.input.value}))}));
  const setPlayState=defineEffect<{battle:number;play:number;state:CardUse['state']},void>(b=>call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.query(active,{battle:v.input.battle,play:v.input.play}),state:v.input.state}))}));
  const setEnergyOnUse=defineEffect<{battle:number;play:number;value:number},void>(b=>call(setActive,{battle:b.read(v=>v.input.battle),play:b.read(v=>({...v.query(active,{battle:v.input.battle,play:v.input.play}),energyOnUse:v.input.value}))}));
  const setEnemies=m.atom({input:z.object({battle:entityId,enemies:z.array(entityId).max(5),replacements:z.array(z.object({from:entityId,to:entityId})).default([])}),output:z.undefined(),reads:[state,plays],writes:[state,plays],emits:[],run(r,i){
    const before=r.component(i.battle,state),p=r.component(i.battle,plays);if(before===null||p===null||new Set(i.enemies).size!==i.enemies.length||new Set(i.replacements.map(p=>p.from)).size!==i.replacements.length||i.replacements.some(p=>!before.enemies.includes(p.from)||!i.enemies.includes(p.to)))throw Error('Invalid battle roster');
    const target=(entity:number|null)=>entity===null?null:i.replacements.find(p=>p.from===entity)?.to??entity;
    const play=(p:CardPlay):CardPlay=>({...p,target:target(p.target)});
    return{writes:[{entity:i.battle,component:state,value:{...before,enemies:[...i.enemies],lastTargeted:target(before.lastTargeted)}},{entity:i.battle,component:plays,value:{...p,current:p.current===null?null:play(p.current),queue:p.queue.map(item=>item.kind===0?{...item,play:play(item.play)}:item)}}],events:[],result:undefined};
  }});
  const advanceTurn=m.atom({input:entityId,output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,entity){const s=r.component(entity,state);if(s===null)throw Error('Missing battle');return{writes:[{entity,component:state,value:{...s,turn:s.turn+1}}],events:[],result:undefined};}});
  const resetTurn=m.atom({input:z.object({battle:entityId,turn:z.int32().positive()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.battle,state);if(before===null)throw Error('Missing battle');return{writes:[{entity:i.battle,component:state,value:{...before,turn:i.turn,cardsPlayed:0,attacksPlayed:0,skillsPlayed:0,endTurnQueued:false}}],events:[],result:undefined};}});
  return{exports:{kind,current,status,opportunities:opportunities.current,forActor,presentForActor,forRegistry,start,announceOpeningQueued,active,context,targetable,targets,victoryTargets,victoryDeferred,recoveredGold,rewardEligible,freeToPlay,waivedPayment,cost,intrinsic,canUse,canQueue,playAllowed,canContinue,payment,initialExhaust,exhaustAfterUse,expectedOutcome,checkOutcome,hit,queueCard,queueFromHand,endTurn,consumeEndTurn,clearCardQueue,close,playNext,settle,setExhaust,setPlayState,setEnergyOnUse,setEnemies,advanceTurn,resetTurn,
    endTurnEarly,beforePlay:beforePlay.public,disposing:disposing.public,using:using.public,used:used.public,otherCardPlayed:otherCardPlayed.public,afterUse:afterUse.public,finished:finished.public,endTurnCards:endTurnCards.public,exiting:exiting.public,started:started.public,openingQueued:openingQueued.public,stages}};
}});
