import { typedValue } from './value.schemas.ts';
import {describeProgram} from './program-descriptions.ts';
import {z} from 'zod';
import {rules} from './execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {battles} from './battles.ts';
import {enemies} from './enemies.ts';
import {resources} from './resources.ts';
import {cardInstances} from './card-instances.ts';
import {cardPiles} from './card-piles.ts';
import {zones} from './zones.ts';
import {actionQueue,combatScope} from './combat-actions.ts';
import {entityId,resourceAmountSchema} from './resources.schemas.ts';
import {turnSetupSchema,turnStateSchema,turnActorSchema} from './turns.schemas.ts';
import type {TurnSetup,TurnActor} from './turns.types.ts';
import type {CardConfig} from './card-instances.types.ts';
import type {EnemyAction} from './enemies.types.ts';
const queuedCountForActionQueue=ruleModules.queueSize(actionQueue);
const {defineRules,defineComponent,defineEvent,defineCheckpoint,defineQuery,defineEffect,defineEntity,sequence,when,whileDo,forEach,call,query,spawnEntity,enqueue,install,on}=rules;

/** Phase ordering and movement belong here; named powers/relics/cards register their own effects. */
export const turns=defineRules({requires:[enemies],build(m){
  const state=m.own(defineComponent({schema:turnStateSchema.nullable(),initial:()=>null}));
  const current=defineQuery({input:entityId,output:turnStateSchema,reads:[state],base:(r,id)=>{const s=r.component(id,state);if(s===null)throw Error('Uninitialized turn controller');return s;}});
  const forBattle=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,battle)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.battle===battle);if(ids.length>1)throw Error('Duplicate turn controller');return ids[0]??null;}});
  const actor=defineQuery({input:entityId,output:turnActorSchema,dependencies:[current,battles.exports.current,battles.exports.status],base:(r,controller)=>{const s=r.query(current,controller);return{controller,battle:s.battle,actor:r.query(battles.exports.status,s.battle).actor};}});
  const content={},stages={content};
  describeProgram(content,'回合内容响应阶段');
  const event=()=>m.own(defineEvent({payload:turnActorSchema,dispatch:'immediate',order:{phases:[{phase:content}],default:content}}));
  const playerEndRelics=event(),playerEndPreCards=event(),playerEndPowers=event(),enemyStart=event(),enemyEnd=event(),playerRoundEnd=event(),enemyRoundEnd=event(),playerStartRelics=event(),playerStartPowers=event(),playerPostDrawRelics=event(),playerPostDrawPowers=event(),afterRecharge=event(),idle=event();
  const beforeBlockReset=m.own(defineCheckpoint({input:resourceAmountSchema,output:resourceAmountSchema}));
  const drawCount=defineQuery({input:entityId,output:z.int32().nonnegative(),dependencies:[current],base:(r,id)=>r.query(current,id).drawPerTurn});
  const retainedEnergy=defineQuery({input:entityId,output:z.int32().nonnegative(),base:()=>0});
  const rechargeAmount=defineQuery({input:entityId,output:z.int32().nonnegative(),dependencies:[current],base:(r,id)=>r.query(current,id).energyPerTurn});
  const discardRemaining=defineQuery({input:entityId,output:z.boolean(),base:()=>true});
  // Selection is a pure linked Query table, never a runtime card-name dispatch.
  const yes=defineQuery({input:entityId,output:z.boolean(),base:()=>true}),no=defineQuery({input:entityId,output:z.boolean(),base:()=>false});
  const endPolicy={kind:cardInstances.exports.kind,select:(c:rules.Borrowed<CardConfig>)=>c.endTurn?yes:no};
  const endCard=defineQuery({input:entityId,output:z.boolean(),selections:[endPolicy],base:(r,id)=>r.selected(endPolicy,id,id)});
  const changePhase=m.atom({input:z.object({controller:entityId,phase:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3)]),cursor:z.int32().nonnegative()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.controller,state);if(s===null)throw Error('Missing turn controller');return{writes:[{entity:i.controller,component:state,value:{...s,phase:i.phase,cursor:i.cursor}}],events:[],result:undefined};}});
  /** Seek within the ordered enemy opportunity slots; omitted slots stay empty. */
  const seekEnemy=m.atom({input:z.object({controller:entityId,cursor:z.int32().nonnegative()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.controller,state);if(s===null||s.phase!==3||i.cursor<s.cursor)throw Error('Enemy cursor must advance within its phase');return{writes:[{entity:i.controller,component:state,value:{...s,cursor:i.cursor}}],events:[],result:undefined};}});
  const nextEnemy=defineQuery({input:entityId,output:entityId.nullable(),dependencies:[current,enemies.exports.current],base:(r,id)=>{const s=r.query(current,id);return s.enemies.map((enemy,index)=>({enemy,slot:r.query(enemies.exports.current,enemy).slot??index})).filter(e=>e.slot>=s.cursor).sort((a,b)=>a.slot-b.slot)[0]?.enemy??null;}});
  // Preserve the normal phase's cursor transition after staging, before child
  // actions run. An early action in the player phase does not advance it.
  const advanceStaged=on(enemies.exports.staged,{
    condition:defineQuery({input:typedValue<rules.ReactionContext<EnemyAction>>(),output:z.boolean(),dependencies:[current],base:(r,c)=>{const s=r.query(current,c.source);return s.battle===c.event.battle&&s.phase===3;}}),
    effect:defineEffect<rules.ReactionContext<EnemyAction>,void>(b=>call(seekEnemy,{controller:b.read(v=>v.input.source),cursor:b.read(v=>{
      const s=v.query(current,v.input.source),enemy=v.query(enemies.exports.current,v.input.event.enemy);
      return Math.max(s.cursor,(enemy.slot??s.enemies.indexOf(v.input.event.enemy))+1);
    })})),
  });
  function announce(e:typeof playerEndRelics){return m.atom({input:turnActorSchema,output:z.undefined(),reads:[],writes:[],emits:[e],run(_r,payload){return{writes:[],events:[{event:e,payload}],result:undefined};}});}
  const endRelics=announce(playerEndRelics),endPreCards=announce(playerEndPreCards),endPowers=announce(playerEndPowers),startEnemy=announce(enemyStart),endEnemy=announce(enemyEnd),endPlayerRound=announce(playerRoundEnd),endEnemyRound=announce(enemyRoundEnd),startRelics=announce(playerStartRelics),startPowers=announce(playerStartPowers),postRelics=announce(playerPostDrawRelics),postPowers=announce(playerPostDrawPowers),recharged=announce(afterRecharge),announceIdle=announce(idle);
  const piles=defineQuery({input:entityId,output:entityId,dependencies:[current,battles.exports.current,battles.exports.status],base:(r,id)=>r.query(battles.exports.status,r.query(current,id).battle).piles});
  const hand=defineQuery({input:entityId,output:entityId,dependencies:[piles,cardPiles.exports.current,cardPiles.exports.bindings],base:(r,id)=>r.query(cardPiles.exports.bindings,r.query(piles,id)).hand});
  const endCards=on(battles.exports.endTurnCards,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),base:(_r,c)=>c.event===c.owner}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>sequence(
    call(changePhase,{controller:b.read(v=>v.input.source),phase:1,cursor:b.read(v=>v.query(current,v.input.source).cursor)}),call(endRelics,query(actor,b.read(v=>v.input.source))),call(endPreCards,query(actor,b.read(v=>v.input.source))),
    forEach(query(zones.exports.members,query(hand,b.read(v=>v.input.source))),card=>when(query(endCard,card),call(battles.exports.queueCard,{battle:b.read(v=>v.input.event),card,target:null,energyOnUse:0,options:{triggerOnUse:false,regretCardCount:b.read(v=>v.query(zones.exports.members,v.query(hand,v.input.source)).length)}}))),
  ))});
  const readyPlay=rules.modify(battles.exports.playAllowed,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),base:(_r,c)=>c.input===c.owner}),dependencies:[current],transform:(r,c)=>c.value&&r.query(current,c.source).phase===0});
  const begin=m.atom({input:turnStateSchema.extend({entity:entityId}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){const {entity,...value}=i;return{writes:[{entity,component:state,value}],events:[],result:undefined};}});
  const validate=defineQuery({input:turnSetupSchema,output:turnSetupSchema,dependencies:[battles.exports.current,enemies.exports.current,forBattle,battles.exports.status],base:(r,i)=>{const b=r.query(battles.exports.status,i.battle);if(r.query(forBattle,i.battle)!==null||i.enemies.length!==b.enemies.length||i.enemies.some((id,index)=>{const e=r.query(enemies.exports.current,id);return e.battle!==i.battle||e.actor!==b.enemies[index];}))throw Error('Invalid turn enemy roster');const slots=i.enemies.map((id,index)=>r.query(enemies.exports.current,id).slot??index);if(new Set(slots).size!==slots.length||slots.some(slot=>slot>=(i.extent??i.enemies.length)))throw Error('Invalid turn slot extent');return i;}});
  const retainedDefinition=defineEntity(zones.exports.kind,{capacity:null});
  const initialize=defineEffect<rules.EntityLifecycle<TurnSetup>,void>(b=>{const s=b.local<TurnSetup>(),retained=b.local<number>();return sequence(
    b.assign(s,query(validate,b.read(v=>v.input.setup))),b.assign(retained,spawnEntity({definition:retainedDefinition,owner:b.read(v=>v.input.entity),scope:b.read(v=>v.input.scope)})),call(begin,b.read(v=>({...v.get(s),entity:v.input.entity,extent:v.get(s).extent??v.get(s).enemies.length,scope:v.input.scope,retained:v.get(retained),phase:0 as const,cursor:0,skipEnemies:false}))),
    install({ability:endCards,source:b.read(v=>v.input.entity),owner:b.read(v=>v.get(s).battle),environment:{},lifetime:b.read(v=>v.input.scope)}),install({ability:readyPlay,source:b.read(v=>v.input.entity),owner:b.read(v=>v.get(s).battle),environment:{},lifetime:b.read(v=>v.input.scope)}),install({ability:advanceStaged,source:b.read(v=>v.input.entity),owner:b.read(v=>v.get(s).battle),environment:{},lifetime:b.read(v=>v.input.scope)}),
  );});
  const kind=m.kind({config:z.undefined(),setup:turnSetupSchema,components:[state],initialize});
  const move=defineEffect<{card:number;from:number;to:number},void>(b=>{const moved=b.local<boolean>();return sequence(b.assign(moved,call(zones.exports.move,{entity:b.read(v=>v.input.card),from:b.read(v=>v.input.from),to:b.read(v=>v.input.to),index:b.read(v=>v.query(zones.exports.members,v.input.to).length)})),when(b.read(v=>!v.get(moved)),b.return(b.read(()=>{throw Error('Required turn movement was canceled');}))));});
  const restoreRetained=defineEffect<number,void>(b=>forEach(query(zones.exports.members,b.read(v=>v.query(current,v.input).retained)),card=>sequence(
    call(cardInstances.exports.setFlags,{entity:card,freeToPlayOnce:b.read(v=>v.query(cardInstances.exports.current,v.get(card)).freeToPlayOnce),retain:false}),call(move,{card,from:b.read(v=>v.query(current,v.input).retained),to:query(hand,b.input)}),
  )));
  const discardHand=defineEffect<number,void>(b=>when(b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).outcome===0),call(cardPiles.exports.discardHand,{piles:query(piles,b.input),endTurn:true})));
  const discardAtEnd=defineEffect<number,void>(b=>sequence(
    forEach(query(zones.exports.members,query(hand,b.input)),card=>when(b.read(v=>v.query(cardInstances.exports.current,v.get(card)).retain||v.query(cardInstances.exports.variant,v.get(card)).retain),call(move,{card,from:query(hand,b.input),to:b.read(v=>v.query(current,v.input).retained)}))),
    when(b.read(v=>v.query(zones.exports.members,v.query(current,v.input).retained).length>0),enqueue(restoreRetained,b.input,{queue:actionQueue,position:'front',lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'})),
    when(query(discardRemaining,b.input),enqueue(discardHand,b.input,{queue:actionQueue,position:'front',lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'})),
    forEach(query(zones.exports.members,query(hand,b.input)),card=>when(b.read(v=>v.query(cardInstances.exports.variant,v.get(card)).ethereal),enqueue(cardPiles.exports.exhaust,{piles:query(piles,b.input),card},{queue:actionQueue,position:'front',source:card,lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'}))),
  ));
  const resetBlock=defineEffect<TurnActor,void>(b=>{const checked=b.local<rules.ReplacementResult<{entity:number;amount:number}>>();return sequence(b.assign(checked,m.resolve(beforeBlockReset,{entity:b.read(v=>v.input.actor),amount:b.read(v=>v.query(resources.exports.defense,v.input.actor).block)})),when(b.read(v=>v.get(checked).kind!=='cancel'),call(resources.exports.consumeBlock,b.read(v=>{const c=v.get(checked);if(c.kind==='cancel'||c.value.entity!==v.input.actor)throw Error('Block reset cannot change its actor');return c.value;}))));});
  const preEnemies=defineEffect<number,void>(b=>forEach(b.read(v=>v.query(current,v.input).enemies),id=>when(query(enemies.exports.live,id),sequence(
    call(resetBlock,b.read(v=>({...v.query(actor,v.input),actor:v.query(enemies.exports.current,v.get(id)).actor}))),call(startEnemy,b.read(v=>({...v.query(actor,v.input),actor:v.query(enemies.exports.current,v.get(id)).actor}))),
  ))));
  const enterEnemies=defineEffect<number,void>(b=>sequence(call(changePhase,{controller:b.input,phase:3,cursor:0}),when(b.read(v=>!v.query(current,v.input).skipEnemies),enqueue(preEnemies,b.input,{queue:actionQueue,lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'}))));
  const onEnding=defineEffect<number,void>(b=>sequence(
    call(battles.exports.consumeEndTurn,b.read(v=>v.query(current,v.input).battle)),call(changePhase,{controller:b.input,phase:2,cursor:b.read(v=>v.query(current,v.input).cursor)}),call(endPowers,query(actor,b.input)),
    enqueue(battles.exports.clearCardQueue,b.read(v=>v.query(current,v.input).battle),{queue:actionQueue,lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'}),
    enqueue(discardAtEnd,b.input,{queue:actionQueue,lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'}),call(cardPiles.exports.resetTurnCosts,query(piles,b.input)),
    enqueue(enterEnemies,b.input,{queue:actionQueue,lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'}),
  ));
  const afterEnemies=defineEffect<number,void>(b=>sequence(
    when(b.read(v=>!v.query(current,v.input).skipEnemies),sequence(
      forEach(b.read(v=>v.query(current,v.input).enemies),id=>when(query(enemies.exports.live,id),call(endEnemy,b.read(v=>({...v.query(actor,v.input),actor:v.query(enemies.exports.current,v.get(id)).actor}))))),
      call(endPlayerRound,query(actor,b.input)),forEach(b.read(v=>v.query(current,v.input).enemies),id=>when(query(enemies.exports.live,id),call(endEnemyRound,b.read(v=>({...v.query(actor,v.input),actor:v.query(enemies.exports.current,v.get(id)).actor}))))),
    )),call(battles.exports.advanceTurn,b.read(v=>v.query(current,v.input).battle)),
    forEach(b.read(v=>v.query(current,v.input).enemies),id=>call(enemies.exports.openOpportunity,{enemy:id,turn:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).turn)})),
    call(startRelics,query(actor,b.input)),call(startPowers,query(actor,b.input)),call(resetBlock,query(actor,b.input)),
    enqueue(cardPiles.exports.draw,{piles:query(piles,b.input),count:query(drawCount,b.input)},{queue:actionQueue,lifetime:b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).actionScope),eligible:'captured'}),
    call(postRelics,query(actor,b.input)),call(postPowers,query(actor,b.input)),call(battles.exports.resetTurn,b.read(v=>{const s=v.query(current,v.input);return{battle:s.battle,turn:v.query(battles.exports.status,s.battle).turn};})),call(cardPiles.exports.resetDiscardCount,query(piles,b.input)),
    call(resources.exports.rechargeEnergy,{entity:b.read(v=>v.query(actor,v.input).actor),amount:b.read(v=>v.query(rechargeAmount,v.input)+v.query(retainedEnergy,v.input))}),call(recharged,query(actor,b.input)),call(changePhase,{controller:b.input,phase:0,cursor:b.read(v=>v.query(current,v.input).cursor)}),
  ));
  const endTurn=defineEffect<number,void>(b=>sequence(when(b.read(v=>v.query(current,v.input).phase!==0),b.return(b.read(()=>{throw Error('Not a player turn');}))),call(battles.exports.endTurn,b.read(v=>v.query(current,v.input).battle))));
  const settle=defineEffect<number,void>(b=>{const enemy=b.local<number>();return whileDo(true,sequence(
    call(battles.exports.settle,b.read(v=>v.query(current,v.input).battle)),when(b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).outcome!==0),b.return(undefined)),
    when(b.read(v=>v.query(current,v.input).phase===0),sequence(call(announceIdle,query(actor,b.input)),when(b.read(v=>v.get(queuedCountForActionQueue)===0&&v.query(battles.exports.opportunities,v.query(current,v.input).battle).queue.length===0),b.return(undefined)))),
    when(b.read(v=>v.query(current,v.input).phase===1),call(onEnding,b.input),when(b.read(v=>v.query(current,v.input).phase===3),
      when(b.read(v=>!v.query(current,v.input).skipEnemies&&v.query(nextEnemy,v.input)!==null),sequence(
        b.assign(enemy,b.read(v=>v.query(nextEnemy,v.input)!)),call(seekEnemy,{controller:b.input,cursor:b.read(v=>{const s=v.query(current,v.input);return v.query(enemies.exports.current,v.get(enemy)).slot??s.enemies.indexOf(v.get(enemy));})}),call(enemies.exports.takeTurn,enemy),call(seekEnemy,{controller:b.input,cursor:b.read(v=>{const s=v.query(current,v.input),e=v.query(enemies.exports.current,v.get(enemy));return Math.max(s.cursor,(e.slot??s.enemies.indexOf(v.get(enemy)))+1);})}),
      ),sequence(call(seekEnemy,{controller:b.input,cursor:b.read(v=>{const s=v.query(current,v.input);return Math.max(s.cursor,s.extent);})}),call(afterEnemies,b.input))),when(b.read(v=>v.query(current,v.input).phase!==0),b.return(b.read(()=>{throw Error('Turn actions failed to advance their phase');}))))),
  ));});
  const inScope=defineQuery({input:z.int32().nonnegative(),output:z.array(entityId),reads:[state],base:(r,scope)=>r.entities(state).filter(id=>r.component(id,state)?.scope===scope)});
  m.lifecycle(combatScope,{dispose:defineEffect<rules.ScopeLifecycle,void>(b=>{const moved=b.local<boolean>();return forEach(query(inScope,b.read(v=>v.input.scope)),id=>forEach(query(zones.exports.members,b.read(v=>v.query(current,v.get(id)).retained)),entity=>sequence(
    b.assign(moved,call(zones.exports.move,{entity,from:b.read(v=>v.query(current,v.get(id)).retained),to:null,index:0})),when(b.read(v=>!v.get(moved)),b.return(b.read(()=>{throw Error('Retained cleanup movement was canceled');}))),
  )));})});
  const rosterInput=z.object({controller:entityId,enemies:z.array(entityId).max(5),extent:z.int32().min(0).max(5).optional()});
  const rosterUpdate=defineQuery({input:rosterInput,output:rosterInput.extend({extent:z.int32().min(0).max(5)}),dependencies:[current,enemies.exports.current,battles.exports.current,battles.exports.status],base:(r,i)=>{const s=r.query(current,i.controller),b=r.query(battles.exports.status,s.battle),es=i.enemies.map(id=>r.query(enemies.exports.current,id)),slots=es.map((e,index)=>e.slot??index),extent=i.extent??Math.max(s.extent,...slots.map(n=>n+1));if(new Set(i.enemies).size!==i.enemies.length||new Set(slots).size!==slots.length||slots.some(n=>n>=extent)||es.some((e,index)=>e.battle!==s.battle||e.actor!==b.enemies[index])||es.length!==b.enemies.length)throw Error('Invalid turn roster');return{...i,extent};}});
  const commitEnemies=m.atom({input:rosterInput.extend({extent:z.int32().min(0).max(5)}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.controller,state);if(before===null)throw Error('Missing turn controller');return{writes:[{entity:i.controller,component:state,value:{...before,enemies:[...i.enemies],extent:i.extent}}],events:[],result:undefined};}});
  const setEnemies=defineEffect<z.infer<typeof rosterInput>,void>(b=>call(commitEnemies,query(rosterUpdate,b.input)));

  return{exports:{setEnemies,seekEnemy,kind,current,forBattle,actor,stages,endTurn,settle,drawCount:describeProgram(drawCount,'玩家每回合抽牌数量'),rechargeAmount:describeProgram(rechargeAmount,'每回合能量补充量'),retainedEnergy:describeProgram(retainedEnergy,'留到下回合的能量'),idle:describeProgram(idle.public,'玩家回合结算队列空闲阶段'),discardRemaining:describeProgram(discardRemaining,'回合结束是否弃置剩余手牌'),beforeBlockReset:describeProgram(beforeBlockReset.public,'回合开始格挡重置前'),
    playerEndRelics:describeProgram(playerEndRelics.public,'玩家回合结束的遗物阶段'),playerEndPreCards:describeProgram(playerEndPreCards.public,'玩家回合结束的手牌处理前阶段'),playerEndPowers:describeProgram(playerEndPowers.public,'玩家回合结束的能力阶段'),enemyStart:describeProgram(enemyStart.public,'敌人回合开始'),enemyEnd:describeProgram(enemyEnd.public,'敌人回合结束'),playerRoundEnd:describeProgram(playerRoundEnd.public,'敌人行动后玩家整轮结束阶段'),enemyRoundEnd:describeProgram(enemyRoundEnd.public,'敌人行动后敌方整轮结束阶段'),playerStartRelics:describeProgram(playerStartRelics.public,'玩家回合开始的遗物阶段'),playerStartPowers:describeProgram(playerStartPowers.public,'玩家回合开始的能力阶段'),playerPostDrawRelics:describeProgram(playerPostDrawRelics.public,'回合抽牌入队后的遗物阶段'),playerPostDrawPowers:describeProgram(playerPostDrawPowers.public,'回合抽牌入队后的能力阶段'),afterRecharge:describeProgram(afterRecharge.public,'能量补充完成后')}};
}});
