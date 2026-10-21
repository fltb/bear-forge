import { typedValue } from '../../../rules/value.schemas.ts';
import {areaDamage} from '../../shared/area-damage.ts';
import {combatPrivate,observeCounter} from "../../../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {powers} from "../../../rules/powers.ts";
import {battles} from "../../../rules/battles.ts";
import {turns} from "../../../rules/turns.ts";
import {resources} from "../../../rules/resources.ts";
import {combatGeneration} from "../../../program/card-generation.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {counterPolicies,attachAbilities} from "../../powers/utils.ts";
import {ownsTurn} from "../../powers/turn-hooks.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {PS} from "../../../combat-identifiers.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {PowerApplication,PowerMerged,PowerLifecycle} from "../../../rules/powers.types.ts";
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query,enqueue,on,modify,updateLocalComponent,readComponent}=rules;
export const colorlessAdditionalPowers=defineRules({requires:[areaDamage,combatPrivate,powers,battles,turns,combatGeneration,basicPowers],build(){
  const damageAll=areaDamage.exports.hit;
  const bombCountdown=defineComponent({schema:z.tuple([z.int32(),z.int32(),z.int32()]),initial:()=>[0,0,0] as [number,number,number]});
  const bombTick=on(turns.exports.playerEndPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:-1},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>{const amount=b.local<number>();return sequence(b.assign(amount,b.read(v=>v.get(readComponent(v.input.source,bombCountdown))[0])),updateLocalComponent(b.read(v=>v.input.source),bombCountdown,n=>[n[1],n[2],0] as [number,number,number]),when(b.read(v=>v.get(amount)!==0),enqueue(damageAll,{battle:b.read(v=>v.input.event.battle),actor:b.read(v=>v.input.owner),amount},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'})));})});
  const TheBomb=defineEntity(powers.exports.kind,{...counterPolicies({bits:16,zeroIsNoop:true}),attach:defineEffect<PowerLifecycle,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.entity),bombCountdown,b.read(v=>[0,0,(v.input.setup.amount<<24)>>24] as [number,number,number])),call(attachAbilities(bombTick,observeCounter('bombs',bombCountdown),modify(battles.exports.canContinue,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),reads:[bombCountdown],dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.input).actor===c.owner&&r.component(c.source,bombCountdown).some(n=>n!==0)}),transform:()=>true})),b.input))),merged:defineEffect<PowerMerged,void>(b=>updateLocalComponent(b.read(v=>v.input.entity),bombCountdown,b.read(v=>{const old=v.get(readComponent(v.input.entity,bombCountdown));return[old[0],old[1],((old[2]+v.input.change.amount)<<24)>>24] as [number,number,number];})))},{components:[bombCountdown]});
  const panacheCount=defineComponent({schema:z.int32(),initial:()=>0});
  const panache=on(battles.exports.used,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.owner===c.owner&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.source),panacheCount,n=>n-1),when(b.read(v=>v.get(readComponent(v.input.source,panacheCount))<=0),enqueue(damageAll,{battle:b.read(v=>v.input.event.battle),actor:b.read(v=>v.input.owner),amount:query(powers.exports.level,b.read(v=>v.input.source))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}))))});
  const resetPanache=on(turns.exports.playerPostDrawPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.PANACHE},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),panacheCount,5))});
  const Panache=defineEntity(powers.exports.kind,{presentation:{key:PS.PANACHE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(panache,resetPanache,observeCounter('panacheCounter',panacheCount))},{components:[panacheCount]});
  const mayhem=on(turns.exports.playerStartPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.MAYHEM},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>{const target=b.local<number|null>();return forEach(b.read(v=>Array.from({length:v.query(powers.exports.level,v.input.source)},(_,index)=>index)),()=>sequence(b.assign(target,call(combatGeneration.exports.randomTarget,b.read(v=>v.input.event.battle))),enqueue(combatGeneration.exports.playTop,{battle:b.read(v=>v.input.event.battle),target,exhaust:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'})));})});
  const Mayhem=defineEntity(powers.exports.kind,{presentation:{key:PS.MAYHEM,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(mayhem)});
  const Magnetism=defineEntity(powers.exports.kind,{presentation:{key:PS.MAGNETISM,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities()});
  const sadistic=on(powers.exports.applied,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number;application:PowerApplication}>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,resources.exports.side],base:(r,c)=>c.event.application.registry===r.query(powers.exports.current,c.source).registry&&c.event.application.debuff&&r.query(resources.exports.side,c.event.application.actor)===1&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<{entity:number;application:PowerApplication}>,void>(b=>enqueue(battles.exports.hit,{battle:b.read(v=>{const id=v.query(battles.exports.forRegistry,v.input.event.application.registry);if(id===null)throw Error('Sadistic Nature needs a battle');return id;}),source:b.read(v=>v.input.owner),target:b.read(v=>v.input.event.application.actor),amount:query(powers.exports.level,b.read(v=>v.input.source)),attack:false,selfDamage:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>{const id=v.query(battles.exports.forRegistry,v.input.event.application.registry);if(id===null)throw Error('Sadistic Nature needs a battle');return v.query(battles.exports.status,id).actionScope;}),eligible:'captured'}))});
  const SadisticNature=defineEntity(powers.exports.kind,{presentation:{key:PS.SADISTIC,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(sadistic)});
  return{exports:{TheBomb,
    Panache,
    Mayhem,
    Magnetism,
    SadisticNature}};
}});
