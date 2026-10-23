// Use the pure domain card: Manifest Divinity now also applies Weak.
import {damage} from '../src/rules/damage.ts';
import {hitResultSchema} from '../src/rules/damage.schemas.ts';
import type {HitResult} from '../src/rules/damage.types.ts';
import {volibearCommonCards} from '../src/content/characters/volibear/cards/common.ts';
import {enemyDefensePowers} from '../src/content/enemies/shared/defense-powers.ts';
import {beyondPowers} from '../src/content/enemies/beyond/powers.ts';
import {potionPowers} from '../src/content/potions/powers.ts';
import {z} from 'zod';
import {linkRules} from '@bear-forge/card-engine';
import {rules} from '../src/rules/execution.ts';
import {combatContentRules} from './combat-content-fixture.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {battles} from '../src/rules/battles.ts';
import {turns} from '../src/rules/turns.ts';
import {resources} from '../src/rules/resources.ts';
import {enemies} from '../src/rules/enemies.ts';
import {adventures} from '../src/rules/adventures.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {enemyDeployment} from '../src/content/enemies/shared/deployment.ts';
import {slimes} from '../src/content/enemies/exordium/slimes.ts';
import {volibearEngageCards} from '../src/content/characters/volibear/cards/engage.ts';
import {volibearBasicCards} from '../src/content/characters/volibear/cards/basic.ts';
import {volibearDomainCards} from '../src/content/characters/volibear/cards/domain.ts';
import {volibearDomain} from '../src/content/characters/volibear/mechanics/domain.ts';
import {powers} from '../src/rules/powers.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
import {beyondBosses} from '../src/content/enemies/beyond/bosses.ts';
import {bronzeOrb} from '../src/content/enemies/city/bronze-orb.ts';
import {moveId} from '../src/combat-identifiers.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import type {TurnActor} from '../src/rules/turns.types.ts';
import {enemyActionSchema} from '../src/rules/enemies.schemas.ts';
import type {EnemyAction} from '../src/rules/enemies.types.ts';

const setupSchema=programSchemas.setup.extend({scenario:z.enum(['boss','acid','spike','corpse','revive','escaped','time','champ','harden','warp','implant','thieves','orb','awakened','slow','heart','flight','plated','shifting','wither','minion','retaliation','gremlin','collector','repto']),domain:z.boolean().optional(),thiefSlot:z.number().int().min(0).max(1).optional(),thiefMove:z.enum(['mug','smoke','escape']).optional(),fullHand:z.boolean().optional(),opsCards:z.boolean().optional(),midRevivalDomain:z.boolean().optional()});
export type EnemyContinuationCase=z.infer<typeof setupSchema>;
const {defineRules,defineQuery,defineEffect,defineComponent,defineEntity,sequence,call,query,when,forEach,spawnEntity,install,on,updateLocalComponent}=rules;
// Only constructs an explicit position. Cards, splits, deployment, revival, queues and
// turn advancement remain the production implementations in the controlled Context.
const fixture=defineRules({requires:[volibearCommonCards,enemyDefensePowers,beyondPowers,potionPowers,combatContentRules,enemyDeployment,slimes,volibearEngageCards,volibearBasicCards,volibearDomainCards,volibearDomain,basicPowers,beyondBosses,bronzeOrb],build(m){
  const done=defineComponent({schema:z.boolean(),initial:()=>false});
  const filled=defineComponent({schema:z.boolean(),initial:()=>false});
  const actions=defineComponent({schema:z.array(enemyActionSchema),initial:()=>[]});
  const performed=defineQuery({input:z.undefined(),output:z.array(enemyActionSchema),reads:[actions],base:r=>r.entities(actions).flatMap(id=>r.component(id,actions))});
  const recorded=defineQuery({input:z.number(),output:z.array(enemyActionSchema),reads:[actions],base:(r,id)=>r.component(id,actions)});
  const hits=defineComponent({schema:z.array(hitResultSchema),initial:()=>[]});
  const hitList=defineQuery({input:z.undefined(),output:z.array(hitResultSchema),reads:[hits],base:r=>r.entities(hits).flatMap(id=>r.component(id,hits))});
  const ownHits=defineQuery({input:z.number(),output:z.array(hitResultSchema),reads:[hits],base:(r,id)=>r.component(id,hits)});
  const trackHits=on(damage.exports.resolved,{effect:defineEffect<rules.ReactionContext<HitResult>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),hits,b.read(v=>[...v.query(ownHits,v.input.source),v.input.event])))});
  const revivalObservations=defineComponent({schema:z.array(z.object({hp:z.number(),halfDead:z.boolean(),revivals:z.number()})),initial:()=>[]});
  const revivalViews=defineQuery({input:z.undefined(),output:z.array(z.object({hp:z.number(),halfDead:z.boolean(),revivals:z.number()})),reads:[revivalObservations],base:r=>r.entities(revivalObservations).flatMap(id=>r.component(id,revivalObservations))});
  const ownRevivalViews=defineQuery({input:z.number(),output:z.array(z.object({hp:z.number(),halfDead:z.boolean(),revivals:z.number()})),reads:[revivalObservations],base:(r,id)=>r.component(id,revivalObservations)});
  const observeRevival=on(resources.exports.changed,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<{entity:number;resource:string;after:number}>>(),output:z.boolean(),dependencies:[enemies.exports.forActor],base:(r,c)=>c.event.resource==='hp'&&c.event.after>0&&r.query(enemies.exports.forActor,c.event.entity)!==null}),
    effect:defineEffect<rules.ReactionContext<{entity:number;after:number}>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),revivalObservations,b.read(v=>{const controller=v.query(enemies.exports.forActor,v.input.event.entity)!;return[...v.query(ownRevivalViews,v.input.source),{hp:v.input.event.after,halfDead:v.query(enemies.exports.current,controller).halfDead,revivals:v.query(enemies.exports.revivals,controller)}];}))),
  });
  const domainDuringRevival=on(resources.exports.changed,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<{entity:number;resource:string;after:number},EnemyContinuationCase>>(),output:z.boolean(),dependencies:[enemies.exports.forActor,enemies.exports.revivals],base:(r,c)=>{const controller=r.query(enemies.exports.forActor,c.event.entity);return c.environment.midRevivalDomain===true&&c.event.resource==='hp'&&c.event.after>0&&controller!==null&&r.query(enemies.exports.revivals,controller)>0;}}),
    effect:defineEffect<rules.ReactionContext<{entity:number},EnemyContinuationCase>,void>(b=>call(volibearDomain.exports.open,{battle:b.read(v=>v.query(enemies.exports.current,v.query(enemies.exports.forActor,v.input.event.entity)!).battle),turns:2})),
  });
  const track=on(enemies.exports.staged,{effect:defineEffect<rules.ReactionContext<EnemyAction>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),actions,b.read(v=>[...v.query(recorded,v.input.source),v.input.event])))});
  // The Darkling must die before the domain opens, otherwise its death power is
  // already suppressed. Open a one-round domain at the next player boundary.
  const delayedDomain=on(turns.exports.afterRecharge,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor,EnemyContinuationCase>>(),output:z.boolean(),dependencies:[battles.exports.status],base:(r,c)=>c.environment.scenario==='revive'&&c.environment.domain===true&&r.query(battles.exports.status,c.event.battle).turn===2}),
    effect:defineEffect<rules.ReactionContext<TurnActor,EnemyContinuationCase>,void>(b=>call(volibearDomain.exports.open,{battle:b.read(v=>v.input.event.battle),turns:1})),
  });
  const orbCards=on(turns.exports.afterRecharge,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor,EnemyContinuationCase>>(),output:z.boolean(),dependencies:[battles.exports.status],base:(r,c)=>c.environment.scenario==='orb'&&r.query(battles.exports.status,c.event.battle).turn===2}),
    effect:defineEffect<rules.ReactionContext<TurnActor,EnemyContinuationCase>,void>(b=>sequence(
      call(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.battle).piles),definition:volibearBasicCards.exports.Strike,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null}),
      when(b.read(v=>v.input.environment.domain===true),call(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.battle).piles),definition:volibearDomainCards.exports.LingeringStorm,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null})),
    )),
  });
  const fillHand=on(turns.exports.idle,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor,EnemyContinuationCase>>(),output:z.boolean(),reads:[filled],dependencies:[battles.exports.status,combatSessions.exports.forBattle,combatSessions.exports.current,powers.exports.find,bronzeOrb.exports.heldZone,zones.exports.members,volibearDomain.exports.active],base:(r,c)=>{
      if(c.environment.scenario!=='orb'||!c.environment.fullHand||r.component(c.source,filled)||c.environment.domain&&!r.query(volibearDomain.exports.active,c.event.battle))return false;
      const session=r.query(combatSessions.exports.forBattle,c.event.battle);if(session===null)return false;
      const actor=r.query(combatSessions.exports.current,session).roster[0]?.actor;if(actor==null)return false;
      const power=r.query(powers.exports.find,{registry:r.query(battles.exports.status,c.event.battle).registry,actor,definition:bronzeOrb.exports.Stasis});
      const zone=power===null?null:r.query(bronzeOrb.exports.heldZone,power);return zone!==null&&r.query(zones.exports.members,zone).length===1;
    }}),
    effect:defineEffect<rules.ReactionContext<TurnActor,EnemyContinuationCase>,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.source),filled,true),forEach(b.read(v=>{
      const piles=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.event.battle).piles);return Array.from({length:10-v.query(zones.exports.members,piles.hand).length});
    }),()=>call(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.battle).piles),definition:volibearBasicCards.exports.Defend,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null})))),
  });
  const enter=on(turns.exports.idle,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor,EnemyContinuationCase>>(),output:z.boolean(),reads:[done],base:(r,c)=>!r.component(c.source,done)}),
    effect:defineEffect<rules.ReactionContext<TurnActor,EnemyContinuationCase>,void>(b=>{
      const session=b.local<number>(),target=b.local<number>(),controller=b.local<number>(),piles=b.local<number>();
      const board=(v:rules.ReadView<rules.ReactionContext<TurnActor,EnemyContinuationCase>>)=>v.query(battles.exports.status,v.input.event.battle);
      return sequence(
        updateLocalComponent(b.read(v=>v.input.source),done,true),
        b.assign(session,b.read(v=>{const id=v.query(combatSessions.exports.forBattle,v.input.event.battle);if(id===null)throw Error('Missing session');return id;})),
        call(adventures.exports.enableDetails,b.read(v=>v.query(combatSessions.exports.current,v.get(session)).run)),
        ...([['acid',slimes.exports.AcidL],['spike',slimes.exports.SpikeL]] as const).map(([name,definition])=>when(b.read(v=>v.input.environment.scenario===name),call(enemyDeployment.exports.deploy,{battle:b.read(v=>v.input.event.battle),slot:0,definition,hp:null,currentMove:null}))),
        when(b.read(v=>v.input.environment.scenario==='orb'),sequence(
          call(enemyDeployment.exports.deploy,{battle:b.read(v=>v.input.event.battle),slot:0,definition:bronzeOrb.exports.BronzeOrb,hp:null,currentMove:moveId.BRONZE_ORB_STASIS}),
          call(enemies.exports.setMove,{enemy:b.read(v=>v.query(combatSessions.exports.current,v.get(session)).roster[1]!.controller!),move:moveId.BRONZE_AUTOMATON_STUNNED}),
        )),
        b.assign(target,b.read(v=>v.query(combatSessions.exports.current,v.get(session)).roster[v.input.environment.scenario==='awakened'?2:v.input.environment.scenario==='minion'?1:v.input.environment.scenario==='gremlin'?3:['collector','repto'].includes(v.input.environment.scenario)?2:0]!.actor!)),
        b.assign(controller,b.read(v=>v.query(combatSessions.exports.current,v.get(session)).roster[v.input.environment.scenario==='awakened'?2:v.input.environment.scenario==='minion'?1:v.input.environment.scenario==='gremlin'?3:['collector','repto'].includes(v.input.environment.scenario)?2:0]!.controller!)),
        when(b.read(v=>v.input.environment.scenario==='orb'),call(resources.exports.setHealth,{entity:target,hp:10,maxHp:b.read(v=>v.query(resources.exports.vitality,v.get(target)).maxHp)})),
        when(b.read(v=>['boss','acid','spike'].includes(v.input.environment.scenario)),
          call(resources.exports.loseHp,{entity:target,amount:b.read(v=>v.query(resources.exports.vitality,v.get(target)).hp-20),selfDamage:false}),
          when(b.read(v=>['corpse','revive','escaped','time','champ','harden'].includes(v.input.environment.scenario)),call(resources.exports.setHealth,{entity:target,hp:1,maxHp:b.read(v=>v.query(resources.exports.vitality,v.get(target)).maxHp)}))),
        when(b.read(v=>['time','champ'].includes(v.input.environment.scenario)),sequence(
          call(resources.exports.setHealth,{entity:target,hp:100,maxHp:b.read(v=>v.query(resources.exports.vitality,v.get(target)).maxHp)}),
          ...([basicPowers.exports.EnemyWeak,basicPowers.exports.EnemyVulnerable,basicPowers.exports.Strength] as const).map((definition,index)=>call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor:target,definition,amount:index===2?-3:2,source:b.read(v=>v.input.event.actor),debuff:true,scope:b.read(v=>board(v).scope)})),
          call(enemies.exports.roll,controller),
        )),
        when(b.read(v=>['awakened','minion'].includes(v.input.environment.scenario)),call(resources.exports.setHealth,{entity:target,hp:1,maxHp:b.read(v=>v.query(resources.exports.vitality,v.get(target)).maxHp)})),
        when(b.read(v=>['gremlin','collector','repto'].includes(v.input.environment.scenario)),sequence(
          forEach(b.read(v=>v.query(combatSessions.exports.current,v.get(session)).roster.flatMap(e=>e.actor!==null&&e.actor!==v.get(target)?[e.actor]:[])),entity=>call(resources.exports.setHealth,{entity,hp:0,maxHp:b.read(v=>v.query(resources.exports.vitality,v.get(entity)).maxHp)})),
          call(enemies.exports.setMove,{enemy:controller,move:b.read(v=>v.input.environment.scenario==='gremlin'?moveId.GREMLIN_LEADER_RALLY:v.input.environment.scenario==='collector'?moveId.THE_COLLECTOR_SPAWN:moveId.REPTOMANCER_SUMMON)}),
        )),
        when(b.read(v=>v.input.environment.scenario==='heart'),sequence(
          call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor:target,definition:basicPowers.exports.Strength,amount:-3,source:b.read(v=>v.input.event.actor),debuff:true,scope:b.read(v=>board(v).scope)}),
          call(enemies.exports.setMove,{enemy:controller,move:moveId.CORRUPT_HEART_BUFF}),
        )),
        when(b.read(v=>v.input.environment.scenario==='wither'),call(enemies.exports.setMove,{enemy:controller,move:moveId.WRITHING_MASS_WITHER})),
        when(b.read(v=>v.input.environment.scenario==='flight'),sequence(
          call(resources.exports.setHealth,{entity:target,hp:100,maxHp:100}),
          call(enemies.exports.setMove,{enemy:controller,move:moveId.BYRD_PECK}),
        )),
        when(b.read(v=>v.input.environment.scenario==='plated'),sequence(
          call(resources.exports.consumeBlock,{entity:target,amount:100}),
          call(powers.exports.set,{entity:b.read(v=>v.query(powers.exports.find,{registry:board(v).registry,actor:v.get(target),definition:enemyDefensePowers.exports.PlatedArmor})!),next:{level:2,active:true,justApplied:false}}),
          call(enemies.exports.setMove,{enemy:controller,move:moveId.SHELLED_PARASITE_STUNNED}),
        )),
        when(b.read(v=>v.input.environment.scenario==='retaliation'),sequence(
          call(resources.exports.setHealth,{entity:target,hp:1,maxHp:100}),
          call(enemies.exports.setMove,{enemy:controller,move:moveId.BYRD_PECK}),
          call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor:b.read(v=>v.input.event.actor),definition:potionPowers.exports.Thorns,amount:100,source:b.read(v=>v.input.event.actor),debuff:false,scope:b.read(v=>board(v).scope)}),
        )),
        when(b.read(v=>v.input.environment.scenario==='harden'),call(enemies.exports.setMove,{enemy:controller,move:moveId.DARKLING_HARDEN})),
        when(b.read(v=>v.input.environment.scenario==='escaped'),call(enemies.exports.setFlags,{enemy:controller,escaped:true})),
        when(b.read(v=>v.input.environment.scenario==='warp'),sequence(
          call(enemies.exports.setMove,{enemy:controller,move:moveId.TIME_EATER_REVERBERATE}),
          call(powers.exports.set,{entity:b.read(v=>{const power=v.query(powers.exports.find,{registry:board(v).registry,actor:v.get(target),definition:beyondBosses.exports.TimeWarp});if(power===null)throw Error('Missing time warp');return power;}),next:{level:10,active:true,justApplied:false}}),
        )),
        when(b.read(v=>v.input.environment.scenario==='implant'),call(enemies.exports.setMove,{enemy:controller,move:moveId.WRITHING_MASS_IMPLANT})),
        when(b.read(v=>v.input.environment.scenario==='thieves'),call(enemies.exports.setMove,{enemy:b.read(v=>v.query(combatSessions.exports.current,v.get(session)).roster[v.input.environment.thiefSlot??0]!.controller!),move:b.read(v=>{
          const mugger=v.input.environment.thiefSlot===1,move=v.input.environment.thiefMove;return move==='escape'?(mugger?moveId.MUGGER_ESCAPE:moveId.LOOTER_ESCAPE):move==='smoke'?(mugger?moveId.MUGGER_SMOKE_BOMB:moveId.LOOTER_SMOKE_BOMB):(mugger?moveId.MUGGER_MUG:moveId.LOOTER_MUG);
        })})),
        b.assign(piles,b.read(v=>board(v).piles)),
        forEach(b.read(v=>[...v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.get(piles)).hand)]),card=>call(cardPiles.exports.exhaust,{piles,card})),
        forEach([0,1],()=>call(cardPiles.exports.create,{piles,definition:volibearEngageCards.exports.StandAndFight,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null})),
        call(cardPiles.exports.create,{piles,definition:volibearBasicCards.exports.Strike,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null}),
        when(b.read(v=>v.input.environment.opsCards===true),forEach([volibearCommonCards.exports.Pursuit,volibearCommonCards.exports.HoldGround],definition=>call(cardPiles.exports.create,{piles,definition,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null}))),
        when(b.read(v=>['flight','slow'].includes(v.input.environment.scenario)),forEach([0,1,2],()=>call(cardPiles.exports.create,{piles,definition:volibearBasicCards.exports.Strike,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null}))),
        when(b.read(v=>v.input.environment.scenario==='slow'),call(cardPiles.exports.create,{piles,definition:volibearBasicCards.exports.Defend,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null})),
        when(b.read(v=>v.input.environment.scenario==='warp'),forEach([0,1],()=>call(cardPiles.exports.create,{piles,definition:volibearBasicCards.exports.Defend,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null}))),
        when(b.read(v=>v.input.environment.domain===true&&v.input.environment.scenario!=='revive'),call(cardPiles.exports.create,{piles,definition:volibearDomainCards.exports.LingeringStorm,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null})),
        call(resources.exports.rechargeEnergy,{entity:b.read(v=>v.input.event.actor),amount:30}),
      );
    }),
  });
  const kind=m.kind({config:z.undefined(),setup:setupSchema,components:[],initialize:defineEffect<rules.EntityLifecycle<EnemyContinuationCase>,void>(b=>sequence(...[enter,delayedDomain,orbCards,fillHand].map(ability=>install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:b.read(v=>v.input.setup),lifetime:0})),install({ability:domainDuringRevival,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:b.read(v=>v.input.setup),lifetime:0}),install({ability:observeRevival,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:{},lifetime:0}),install({ability:trackHits,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:{},lifetime:0}),install({ability:track,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:{},lifetime:0})))});
  const anchor=defineEntity(kind,undefined,{components:[done,filled,actions,hits,revivalObservations]});
  const entry=defineEffect<EnemyContinuationCase,Frame>(b=>{const result=b.local<Frame>();return sequence(
    spawnEntity({definition:anchor,owner:null,scope:0,setup:b.input}),
    b.assign(result,call(combatContentRules.exports.entry,{seed:b.read(v=>v.input.seed),encounter:b.read(v=>v.input.scenario==='gremlin'?encounterId.GREMLIN_LEADER:v.input.scenario==='collector'?encounterId.COLLECTOR:v.input.scenario==='repto'?encounterId.REPTOMANCER:v.input.scenario==='awakened'?encounterId.AWAKENED_ONE:v.input.scenario==='slow'?encounterId.GIANT_HEAD:v.input.scenario==='heart'?encounterId.THE_HEART:['flight','retaliation'].includes(v.input.scenario)?encounterId.THREE_BYRDS:v.input.scenario==='plated'?encounterId.SHELL_PARASITE:v.input.scenario==='shifting'?encounterId.TRANSIENT:v.input.scenario==='wither'?encounterId.WRITHING_MASS:v.input.scenario==='minion'?encounterId.AUTOMATON:['boss','acid','spike'].includes(v.input.scenario)?encounterId.SLIME_BOSS:['revive','harden'].includes(v.input.scenario)?encounterId.THREE_DARKLINGS:['time','warp'].includes(v.input.scenario)?encounterId.TIME_EATER:v.input.scenario==='champ'?encounterId.CHAMP:v.input.scenario==='implant'?encounterId.WRITHING_MASS:v.input.scenario==='thieves'?encounterId.TWO_THIEVES:v.input.scenario==='orb'?encounterId.AUTOMATON:encounterId.TWO_LOUSE),relics:[],potion:b.read(v=>v.input.scenario==='orb'?potionId.FIRE_POTION:null),durable:true,elite:false})),b.return(result),
  );});
  return{exports:{entry,performed,hitList,revivalViews}};
}});
export const enemyContinuationDefinition=linkRules<{},EnemyContinuationCase,Ports,Frame>({id:'sts/enemy-continuation-cases',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
export const performedEnemyActions=fixture.exports.performed;

export const performedEnemyHits=fixture.exports.hitList;

export const observedRevivalStates=fixture.exports.revivalViews;
