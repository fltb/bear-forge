import {z} from 'zod';
import {typedValue} from '../../../rules/value.schemas.ts';
import {rules} from '../../../rules/execution.ts';
import {relics,type RelicDefinition} from '../../../rules/relics.ts';
import {battles} from '../../../rules/battles.ts';
import {turns} from '../../../rules/turns.ts';
import {resources} from '../../../rules/resources.ts';
import {adventures} from '../../../rules/adventures.ts';
import {powers} from '../../../rules/powers.ts';
import {basicPowers} from '../../powers/attributes.ts';
import {areaDamage} from '../../shared/area-damage.ts';
import {actionQueue} from '../../../rules/combat-actions.ts';
import type {TurnActor} from '../../../rules/turns.types.ts';
import type {PowerDefinition} from '../../../rules/powers.types.ts';
import type {RelicId} from '../../../identifiers.ts';
import {registerRelicAbilities} from '../hooks.ts';

type Hook={battle:number;actor:number;source:number};
type Operation={readonly effect:rules.Effect<Hook,void>;readonly text:string};
type Trigger={readonly ability:rules.Ability;readonly text:string};
const {defineRules,defineEffect,defineQuery,defineEntity,call,query,on,sequence,when,forEach,enqueue}=rules;

/** Ordinary TS composition owns both installed programs and their read-only text.
 * No text is interpreted; dynamic callbacks remain ordinary rule callbacks. */
export const openingRelics=defineRules({requires:[relics,battles,turns,resources,adventures,powers,basicPowers,areaDamage],build(){
  const definitions:Partial<Record<RelicId,RelicDefinition>>={};
  const texts:Record<string,string>={};
  function register(id:RelicId,...triggers:Trigger[]){
    definitions[id]=defineEntity(relics.exports.kind,{id,install:registerRelicAbilities(...triggers.map(t=>t.ability))});
    texts[id]=triggers.map(t=>t.text).join('');
  }
  function block(amount:number):Operation{return{effect:defineEffect<Hook,void>(b=>call(resources.exports.gainBlock,{entity:b.read(v=>v.input.actor),amount})),text:`自身获得${amount}格挡`};}
  function energy(amount:number):Operation{return{effect:defineEffect<Hook,void>(b=>call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.actor),amount})),text:`自身获得${amount}能量`};}
  function heal(amount:number):Operation{return{effect:defineEffect<Hook,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.actor),amount})),text:`自身回复${amount}生命`};}
  function power(definition:PowerDefinition,label:string,amount:number,allEnemies=false):Operation{return{
    effect:defineEffect<Hook,void>(b=>forEach(allEnemies?query(battles.exports.targets,b.read(v=>v.input.battle)):b.read(v=>[v.input.actor]),actor=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition,amount,source:b.read(v=>v.input.actor),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)}))),
    text:`${allEnemies?'全体敌人':'自身'}获得${amount}${label}`,
  };}
  const strength=(amount:number,allEnemies=false)=>power(basicPowers.exports.Strength,'力量',amount,allEnemies);
  const dexterity=(amount:number)=>power(basicPowers.exports.Dexterity,'敏捷',amount);
  function allDamage(amount:number):Operation{return{effect:defineEffect<Hook,void>(b=>call(areaDamage.exports.hit,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),amount})),text:`对全体敌人造成${amount}伤害`};}
  function combine(...operations:Operation[]):Operation{return{effect:defineEffect<Hook,void>(b=>sequence(...operations.map(op=>call(op.effect,b.input)))),text:operations.map(op=>op.text).join('，')};}
  function queued(operation:Operation,front=false):Operation{return{
    effect:defineEffect<Hook,void>(b=>enqueue(operation.effect,b.input,{queue:actionQueue,position:front?'front':'back',source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),text:operation.text,
  };}
  function afterRest(operation:Operation):Operation{return{
    effect:defineEffect<Hook,void>(b=>when(b.read(v=>{const run=v.query(adventures.exports.forActor,v.input.actor);return run!==null&&v.query(adventures.exports.position,run).lastRoom==='REST';}),call(operation.effect,b.input))),
    text:`若上一房间为篝火，${operation.text}`,
  };}
  function inRoom(room:'BOSS'|'ELITE',operation:Operation):Operation{return{
    effect:defineEffect<Hook,void>(b=>when(b.read(v=>{const run=v.query(adventures.exports.forActor,v.input.actor);if(run===null)throw Error('Relic needs an adventure');return v.query(adventures.exports.position,run).room===room;}),call(operation.effect,b.input))),
    text:`若为${room==='BOSS'?'Boss':'精英'}战，${operation.text}`,
  };}
  function atTurn(turn:number,operation:Operation):Operation{return{
    effect:defineEffect<Hook,void>(b=>when(b.read(v=>v.query(battles.exports.current,v.input.battle).turn===turn),call(operation.effect,b.input))),
    text:`若为第${turn}回合，${operation.text}`,
  };}
  function withoutBlock(operation:Operation):Operation{return{
    effect:defineEffect<Hook,void>(b=>when(b.read(v=>v.query(resources.exports.current,v.input.actor).block<=0),call(operation.effect,b.input))),
    text:`若自身无格挡，${operation.text}`,
  };}
  function start(operation:Operation,event=battles.exports.started,priority=0):Trigger{return{
    ability:on(event,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner}),order:{phase:battles.exports.stages.relic,priority},effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(operation.effect,b.read(v=>({battle:v.input.event,actor:v.input.owner,source:v.input.source}))))}),
    text:`开战时，${operation.text}。`,
  };}
  function turn(operation:Operation,end=false,priority=0):Trigger{return{
    ability:on(end?turns.exports.playerEndRelics:turns.exports.playerStartRelics,{condition:defineQuery({input:typedValue<rules.ReactionContext<TurnActor>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner}),order:{phase:turns.exports.stages.content,priority},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>call(operation.effect,b.read(v=>({battle:v.input.event.battle,actor:v.input.owner,source:v.input.source}))))}),
    text:`自身回合${end?'结束':'开始'}时，${operation.text}。`,
  };}
  register('VAJRA',start(strength(1)));
  register('ODDLY_SMOOTH_STONE',start(dexterity(1)));
  register('ANCHOR',start(block(10)));
  register('LANTERN',start(energy(1)));
  register('BLOOD_VIAL',start(heal(2)));
  register('ANCIENT_TEA_SET',start(afterRest(energy(2))));
  register('PANTOGRAPH',start(inRoom('BOSS',heal(25))));
  register('SLING_OF_COURAGE',start(inRoom('ELITE',strength(2))));
  const brimstone=combine(strength(2),strength(1,true));
  register('BRIMSTONE',start(brimstone),turn(brimstone,false,10));
  const mercury=queued(allDamage(3));
  register('MERCURY_HOURGLASS',start(mercury,battles.exports.openingQueued,10),turn(mercury,false,80));
  register('HORN_CLEAT',turn(atTurn(2,queued(block(14))),false,40));
  register('CAPTAINS_WHEEL',turn(atTurn(3,queued(block(18))),false,20));
  register('ORICHALCUM',turn(withoutBlock(queued(block(6),true)),true,30));
  register('STONE_CALENDAR',turn(atTurn(7,queued(allDamage(52))),true,40));
  return{exports:{definitions,texts:Object.freeze(texts)}};
}});
