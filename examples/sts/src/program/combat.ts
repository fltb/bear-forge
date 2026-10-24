import {publicMonsterName} from '../content/enemies/shared/programs.ts';
import { typedValue } from '../rules/value.schemas.ts';
import {emeraldElites} from "../content/enemies/shared/burning-elite.ts";
import {z} from 'zod';
import {rules} from '../rules/execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {adventures} from "../rules/adventures.ts";
import {encounters,type EncounterDefinition} from "../rules/encounters.ts";
import {enemies} from "../rules/enemies.ts";
import {battles} from "../rules/battles.ts";
import {turns} from "../rules/turns.ts";
import {resources} from "../rules/resources.ts";
import {random} from "../rules/random.ts";
import {powers} from "../rules/powers.ts";
import {cardPiles} from "../rules/card-piles.ts";
import {cardInstances} from "../rules/card-instances.ts";
import {permanentDecks} from "../rules/permanent-decks.ts";
import {zones} from "../rules/zones.ts";
import {combatSessions,battleStreamNames,type CombatSessionSetup} from "../rules/combat-sessions.ts";
import {combatScope,actionQueue} from "../rules/combat-actions.ts";
import {stsPorts,combatSelectionUtils} from "../adapters/ports.ts";
import {battlePublications} from "../adapters/battle-publications.ts";
import {adventureViews} from "../adapters/adventure-views.ts";
import {createCombatPotions} from "../content/potions/combat.ts";
import type {PreparedEnemy} from "../content/enemies/shared/construction.ts";
import type {EncounterEnemy} from "../rules/encounters.schemas.ts";
import {monsterId} from "../combat-identifiers.ts";
import {encounterContent} from "../content/enemies/encounters.ts";
import type {Action} from "../game.schemas.ts";
import {ActionSchema,FrameSchema} from "../game.schemas.ts";

const potionPrograms=createCombatPotions(combatSelectionUtils);
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,whileDo,forEach,call,query,spawnEntity}=rules;
type RosterEntry=Omit<PreparedEnemy,'actor'>&{actor:number|null};
export const combatProgram=defineRules({requires:[emeraldElites,combatSessions,encounters,stsPorts,encounterContent,potionPrograms],build(){
  const battleDefinition=defineEntity(battles.exports.kind,undefined),turnDefinition=defineEntity(turns.exports.kind,undefined),sessionDefinition=defineEntity(combatSessions.exports.kind,undefined),streamDefinition=defineEntity(random.exports.stream,undefined),registryDefinition=defineEntity(powers.exports.registryKind,undefined);
  const actions=defineQuery({input:z.number(),output:z.array(z.number()),dependencies:[combatSessions.exports.current,battles.exports.current,cardPiles.exports.current,zones.exports.members,cardInstances.exports.variant,battles.exports.canQueue,potionPrograms.exports.actions,battles.exports.status,cardPiles.exports.bindings],base(r,session){
    const s=r.query(combatSessions.exports.current,session),b=r.query(battles.exports.status,s.battle),p=r.query(cardPiles.exports.bindings,b.piles),out:number[]=[];
    for(const [index,card] of r.query(zones.exports.members,p.hand).entries()){
      const targets=r.query(cardInstances.exports.variant,card).target?b.enemies:[null];for(const target of targets)if(r.query(battles.exports.canQueue,{battle:s.battle,card,target}))out.push(((target===null?0:s.roster.findIndex(entry=>entry.actor===target))<<16)|index);
    }
    out.push(...r.query(potionPrograms.exports.actions,session));out.push((4<<29)>>>0);return out;
  }});
  const request=defineQuery({input:typedValue<rules.ChoiceRequest<number,number>>(),output:FrameSchema,dependencies:[combatSessions.exports.current,stsPorts.exports.frame],base:(r,i)=>r.query(stsPorts.exports.frame,{run:r.query(combatSessions.exports.current,i.player).run,actions:[...i.candidates],selection:null})});
  const adapter=ruleModules.choicePort({port:'decision',request,reply:ActionSchema,decode:(r,reply:Action)=>({kind:'selected' as const,indices:[r.candidates.indexOf(reply.bits)]})});
  const fight=defineEffect<number,0|1|2>(b=>{const choice=b.local<rules.ChoiceResult<number>>(),bits=b.local<number>(),session=b.local<CombatSessionSetup>();return sequence(
    b.assign(session,query(combatSessions.exports.current,b.input)),
    whileDo(b.read(v=>v.query(battles.exports.status,v.get(session).battle).outcome===0),sequence(
      call(stsPorts.exports.flush,b.read(v=>v.get(session).run)),b.assign(choice,rules.chooseOne({adapter,player:b.input,candidates:query(actions,b.input),allowSkip:false,empty:'error',singleton:'request'})),b.assign(bits,b.read(v=>{const c=v.get(choice);if(c.kind!=='selected')throw Error('Required battle action was skipped');return c.value;})),call(adventures.exports.record,{run:b.read(v=>v.get(session).run),kind:'battle',bits}),
      when(b.read(v=>v.get(bits)>>>29===4),call(turns.exports.endTurn,b.read(v=>v.get(session).controller)),when(b.read(v=>v.get(bits)>>>29===1),call(potionPrograms.exports.drink,{session:b.input,slot:b.read(v=>v.get(bits)&0xffff),target:b.read(v=>(v.get(bits)>>>16)&0x1fff)}),call(battles.exports.queueFromHand,b.read(v=>{const s=v.get(session),board=v.query(battles.exports.status,s.battle),p=v.query(cardPiles.exports.bindings,board.piles),card=v.query(zones.exports.members,p.hand)[v.get(bits)&0xffff];if(card===undefined)throw Error('Missing selected card');const target=v.query(cardInstances.exports.variant,card).target?v.query(combatSessions.exports.current,v.input).roster[(v.get(bits)>>>16)&0x1fff]?.actor??null:null;return{battle:s.battle,card,target};})))),call(turns.exports.settle,b.read(v=>v.get(session).controller)),
    )),b.return(b.read(v=>v.query(battles.exports.status,v.get(session).battle).outcome)),
  );});
  const run=defineEffect<{run:number;encounter:number},0|1|2>(b=>{
    const catalog=b.local<{id:number;definition:EncounterDefinition}[]>(),scope=b.local<number>(),streams=b.local<CombatSessionSetup['streams']>(),stream=b.local<number>(),encounter=b.local<number>(),definitions=b.local<(EncounterEnemy|null)[]>(),prepared=b.local<PreparedEnemy>(),actors=b.local<number[]>(),registry=b.local<number>(),battle=b.local<number>(),controllers=b.local<number[]>(),controller=b.local<number>(),roster=b.local<RosterEntry[]>(),turn=b.local<number>(),session=b.local<number>(),outcome=b.local<0|1|2>();
    return sequence(
      b.assign(catalog,encounterContent.exports.definitions),b.assign(scope,ruleModules.openScope(combatScope,b.read(v=>v.query(adventures.exports.bindings,v.input.run).scope))),b.assign(streams,{} as CombatSessionSetup['streams']),
      forEach(battleStreamNames,key=>sequence(b.assign(stream,spawnEntity({definition:streamDefinition,owner:null,scope,setup:b.read(v=>{const s=v.query(adventures.exports.status,v.input.run);return BigInt.asUintN(64,s.seed+BigInt(s.floor));})})),when(b.read(v=>v.get(key)==='misc'||v.get(key)==='potion'),call(random.exports.copyFrom,{target:stream,source:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams[v.get(key)])})),b.assign(streams,b.read(v=>({...v.get(streams),[v.get(key)]:v.get(stream)}))))),
      b.assign(encounter,spawnEntity({kind:encounters.exports.kind,definition:b.read(v=>{const entry=v.get(catalog).find(e=>e.id===v.input.encounter);if(!entry)throw Error('Encounter content is not implemented: '+v.input.encounter);return entry.definition;}),owner:b.read(v=>v.input.run),scope,setup:{run:b.read(v=>v.input.run),miscRng:b.read(v=>v.get(streams).misc),hpRng:b.read(v=>v.get(streams).monsterHp),scope,ascension:b.read(v=>v.query(adventures.exports.bindings,v.input.run).ascension)}})),b.assign(definitions,query(encounters.exports.current,encounter)),b.assign(actors,[]),b.assign(roster,[]),b.assign(controllers,[]),
      forEach(definitions,definition=>when(b.read(v=>v.get(definition)===null),b.assign(roster,b.read(v=>[...v.get(roster),{actor:null,controller:null,id:monsterId.INVALID,name:'INVALID',miscInfo:0,parameters:[]}])),sequence(
        b.assign(prepared,b.read(v=>{const item=v.get(definition)!;return{...v.query(enemies.exports.metadata,item.definition),actor:item.actor,controller:null,miscInfo:0,parameters:item.parameters};})),b.assign(actors,b.read(v=>[...v.get(actors),v.get(prepared).actor])),b.assign(roster,b.read(v=>[...v.get(roster),v.get(prepared)])),
      ))),
      // The immutable roster names are displayed by the original public view.
      // Declare only that view's identity, never an internal encounter ID, HP
      // draw or intent. Conditioning can reject another roster before shuffle.
      call(random.exports.declare,{name:'combat-roster',value:b.read(v=>JSON.stringify(v.get(roster).map(publicMonsterName)))}),
      b.assign(registry,spawnEntity({definition:registryDefinition,owner:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),scope})),
      b.assign(battle,spawnEntity({definition:battleDefinition,owner:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),scope,setup:{actor:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),registry,enemies:actors,masters:b.read(v=>v.query(permanentDecks.exports.current,v.query(adventures.exports.bindings,v.input.run).deck).cards),bottled:b.read(v=>{const s=v.query(permanentDecks.exports.current,v.query(adventures.exports.bindings,v.input.run).deck);return s.bottles.filter(index=>index>=0).map(index=>s.cards[index]!).filter(id=>id!==undefined);}),shuffleRng:b.read(v=>v.get(streams).shuffle),cardRng:b.read(v=>v.get(streams).cardRandom),drawPerTurn:5}})),
      forEach(b.read(v=>v.get(definitions).map((_,index)=>index)),index=>when(b.read(v=>v.get(definitions)[v.get(index)]!==null),sequence(
        b.assign(controller,spawnEntity({kind:enemies.exports.kind,definition:b.read(v=>v.get(definitions)[v.get(index)]!.definition),owner:b.read(v=>v.get(roster)[v.get(index)]!.actor!),scope,setup:{actor:b.read(v=>v.get(roster)[v.get(index)]!.actor!),battle,slot:index,aiRng:b.read(v=>v.get(streams).ai),hpRng:b.read(v=>v.get(streams).monsterHp),parameters:b.read(v=>v.get(roster)[v.get(index)]!.parameters),ascension:b.read(v=>v.query(adventures.exports.bindings,v.input.run).ascension)}})),b.assign(controllers,b.read(v=>[...v.get(controllers),v.get(controller)])),b.assign(roster,b.read(v=>v.get(roster).map((entry,at)=>at===v.get(index)?{...entry,controller:v.get(controller)}:entry))),
      ))),
      b.assign(turn,spawnEntity({definition:turnDefinition,owner:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),scope,setup:{battle,enemies:controllers,extent:b.read(v=>v.get(roster).length),drawPerTurn:5,energyPerTurn:3}})),b.assign(session,spawnEntity({definition:sessionDefinition,owner:b.read(v=>v.input.run),scope,setup:{run:b.read(v=>v.input.run),battle,controller:turn,seed:b.read(v=>v.query(adventures.exports.bindings,v.input.run).seed),floor:b.read(v=>v.query(adventures.exports.position,v.input.run).floor),ascension:b.read(v=>v.query(adventures.exports.bindings,v.input.run).ascension),encounter:b.read(v=>v.input.encounter),streams,roster}})),
      call(resources.exports.consumeBlock,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount:b.read(v=>v.query(resources.exports.defense,v.query(adventures.exports.bindings,v.input.run).actor).block)}),call(resources.exports.rechargeEnergy,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount:0}),call(adventures.exports.setScene,{run:b.read(v=>v.input.run),screen:'BATTLE',continuation:true}),call(battlePublications.exports.capture,{run:b.read(v=>v.input.run),battle,game:query(adventureViews.exports.privateGame,b.read(v=>v.input.run))}),forEach(controllers,id=>call(enemies.exports.prepare,id)),call(emeraldElites.exports.apply,{run:b.read(v=>v.input.run),battle}),call(battles.exports.start,battle),call(resources.exports.rechargeEnergy,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount:b.read(v=>v.query(resources.exports.stamina,v.query(adventures.exports.bindings,v.input.run).actor).energy+v.query(turns.exports.rechargeAmount,v.get(turn)))}),rules.enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.get(battle)).piles),count:query(turns.exports.drawCount,turn)},{queue:actionQueue,source:battle,lifetime:b.read(v=>v.query(battles.exports.status,v.get(battle)).actionScope),eligible:'captured'}),call(battles.exports.announceOpeningQueued,battle),call(turns.exports.settle,turn),b.assign(outcome,call(fight,session)),
      forEach(battleStreamNames,key=>call(random.exports.copyFrom,{target:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams[v.get(key)]),source:b.read(v=>v.get(streams)[v.get(key)])})),call(adventures.exports.setStolenGold,{run:b.read(v=>v.input.run),amount:query(battles.exports.recoveredGold,battle)}),call(battles.exports.close,battle),call(adventures.exports.notifyCombatFinished,{run:b.read(v=>v.input.run),battle,actor:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),outcome:b.read(v=>{const result=v.get(outcome);if(result===0)throw Error('Battle is not finished');return result;})}),b.return(outcome),
    );
  });
  return{exports:{run,fight}};
}});
