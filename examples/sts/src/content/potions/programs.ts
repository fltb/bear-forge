import {rules} from '../../rules/execution.ts';
import type {ConsumableUse} from '../../rules/consumables.ts';
import type {PowerDefinition} from '../../rules/powers.types.ts';
import {discoveryDescription,discardToHandDescription,type createCombatSelectionUtils} from '../cards/shared/selection-utils.ts';
import {areaDamage} from '../shared/area-damage.ts';
import {combatSessions} from '../../rules/combat-sessions.ts';
import {battles} from '../../rules/battles.ts';
import {cardPiles} from '../../rules/card-piles.ts';
import {cardInstances} from '../../rules/card-instances.ts';
import {zones} from '../../rules/zones.ts';
import {powers} from '../../rules/powers.ts';
import {potions} from '../../rules/potions.ts';
import {resources} from '../../rules/resources.ts';
import {random} from '../../rules/random.ts';
import {basicPowers} from '../powers/attributes.ts';
import {defensePowers} from '../powers/defense.ts';
import {ironcladPowers,loseStrengthPotionPowerLabel} from '../characters/ironclad/powers/definitions.ts';
import {combatPowers} from '../characters/ironclad/powers/combat.ts';
import {potionPowers,ritualPotionPowerLabel,loseDexterityPotionPowerLabel,duplicationPotionPowerLabel} from './powers.ts';
import {combatGeneration} from '../../program/card-generation.ts';
import {adventureDraws} from '../rewards/draws.ts';
import {CardScreen} from '../../adapters/selection-presentations.ts';
import {actionQueue} from '../../rules/combat-actions.ts';
import {potionVitality,bloodPotionText,fruitJuiceText,fairyPotionText} from './vitality.ts';
const {defineEffect,sequence,when,forEach,call,enqueue}=rules;
type Selections=ReturnType<typeof createCombatSelectionUtils>;
type Use=rules.Effect<ConsumableUse,void>;
export interface PotionProgram {
  readonly targeted:boolean;
  readonly active:boolean;
  readonly text:string;
  readonly build:(selections:Selections)=>Use;
}
/** A TS composition, not effect data interpreted by another executor. */
function program(text:string,build:PotionProgram['build'],targeted=false,active=true):PotionProgram {
  return Object.freeze({text,build,targeted,active});
}
function queued(effect:Use,retained=false):Use {
  return defineEffect<ConsumableUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.battle),lifetime:b.read(v=>{
    const s=v.query(battles.exports.status,v.input.battle);return retained?s.scope:s.actionScope;
  }),eligible:'captured'}));
}
function combine(...parts:readonly PotionProgram[]):PotionProgram {
  return program(parts.map(p=>p.text).join(''),selections=>{
    const effects=parts.map(p=>p.build(selections));
    return defineEffect<ConsumableUse,void>(b=>sequence(...effects.map(effect=>call(effect,b.input))));
  },parts.some(p=>p.targeted),parts.every(p=>p.active));
}
// The same recipient chooses execution's actor and the legal/presentation target.
function power(definition:()=>PowerDefinition,label:string,amount:number,recipient:'self'|'enemy'='self',debuff=false):PotionProgram {
  return program(`${recipient==='enemy'?'目标':''}获得${amount}${label}。`,()=>queued(defineEffect<ConsumableUse,void>(b=>call(powers.exports.apply,{
    registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>recipient==='enemy'?v.input.target!:v.input.actor),definition:definition(),amount:b.read(v=>amount*v.input.multiplier),source:b.read(v=>v.input.actor),debuff,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),
  }))),recipient==='enemy');
}
function temporaryPower(gain:()=>PowerDefinition,label:string,loss:()=>PowerDefinition,lossLabel:string,amount:number):PotionProgram {
  return combine(power(gain,label,amount),power(loss,lossLabel,amount,'self',true));
}
function draw(amount:number):PotionProgram {
  return program(`抽${amount}张牌。`,()=>queued(defineEffect<ConsumableUse,void>(b=>call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:b.read(v=>amount*v.input.multiplier)}))));
}
function discovery(category:0|1|2|4):PotionProgram {
  return program(discoveryDescription(category),selections=>queued(defineEffect<ConsumableUse,void>(b=>call(selections.exports.discovery,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),category,copies:b.read(v=>v.input.multiplier)}))));
}
function gain(resource:'block'|'energy',amount:number):PotionProgram {
  return program(`获得${amount}${resource==='block'?'格挡':'能量'}。`,()=>queued(defineEffect<ConsumableUse,void>(b=>call(resource==='block'?resources.exports.gainBlock:resources.exports.gainEnergy,{entity:b.read(v=>v.input.actor),amount:b.read(v=>amount*v.input.multiplier)}))));
}
function hit(amount:number,recipient:'enemy'|'all'):PotionProgram {
  return program(`${recipient==='enemy'?'目标受到':'对全体造成'}${amount}伤害。`,()=>queued(defineEffect<ConsumableUse,void>(b=>recipient==='enemy'
    ?call(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.actor),target:b.read(v=>v.input.target!),amount:b.read(v=>amount*v.input.multiplier),attack:false,selfDamage:false})
    :call(areaDamage.exports.hit,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),amount:b.read(v=>amount*v.input.multiplier)}))),recipient==='enemy');
}
function handMany(discard:boolean,maximum:number):PotionProgram {
  return program(`${discard?'弃置':'消耗'}任意张手牌（至多${maximum}张）${discard?'，抽同样数量':''}。`,selections=>queued(defineEffect<ConsumableUse,void>(b=>call(selections.exports.handMany,{battle:b.read(v=>v.input.battle),discard,maximum}))));
}
function chaos(count:number):PotionProgram {
  return program(`打出抽牌堆顶${count}张牌。`,()=>defineEffect<ConsumableUse,void>(b=>{const target=b.local<number|null>();return forEach(b.read(v=>Array.from({length:count*v.input.multiplier},(_,index)=>index)),()=>sequence(b.assign(target,call(combatGeneration.exports.randomTarget,b.read(v=>v.input.battle))),enqueue(combatGeneration.exports.playTop,{battle:b.read(v=>v.input.battle),target,exhaust:false},{queue:actionQueue,source:b.read(v=>v.input.battle),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));}));
}
function randomizeHand(start:number,end:number):PotionProgram {
  return program(`将手牌费用随机为${start}–${end}，持续本战。`,()=>queued(defineEffect<ConsumableUse,void>(b=>{const cost=b.local<number>();return forEach(b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand)),card=>when(b.read(v=>v.query(cardInstances.exports.current,v.get(card)).cost>=0),sequence(b.assign(cost,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start,end})),call(cardInstances.exports.setCostForCombat,{entity:card,amount:cost}),call(cardInstances.exports.overrideTurnCost,{entity:card,amount:cost}))));})));
}
const inert=(text:string,active=true)=>program(text,()=>defineEffect<ConsumableUse,void>(b=>b.return(undefined)),false,active);
const upgradeHand=program('升级全部手牌，持续本战。',()=>queued(defineEffect<ConsumableUse,void>(b=>forEach(b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand)),card=>call(cardInstances.exports.upgradeDetailed,{entity:card,force:true})))));
const blood=program(bloodPotionText,()=>queued(defineEffect<ConsumableUse,void>(b=>call(potionVitality.exports.blood,b.input)),true));
const fruit=program(fruitJuiceText,()=>defineEffect<ConsumableUse,void>(b=>call(potionVitality.exports.fruit,b.input)));
const entropic=program('填满空药水槽。',()=>defineEffect<ConsumableUse,void>(b=>{const inventory=b.local<number>(),session=b.local<number>(),potion=b.local<number>();return sequence(b.assign(inventory,b.read(v=>{const inventory=v.query(potions.exports.forActor,v.input.actor);if(inventory===null)throw Error('Missing potion inventory');return inventory;})),b.assign(session,b.read(v=>{const session=v.query(combatSessions.exports.forBattle,v.input.battle);if(session===null)throw Error('Missing combat session');return session;})),forEach(b.read(v=>Array.from({length:v.query(potions.exports.current,v.get(inventory)).capacity},(_,index)=>index)),()=>sequence(b.assign(potion,call(adventureDraws.exports.limitedRewardPotion,b.read(v=>v.query(combatSessions.exports.current,v.get(session)).streams.potion))),call(potions.exports.obtain,{inventory,potion}))));}));
function recall(zeroTurn:boolean):PotionProgram {
  return program(discardToHandDescription(zeroTurn),selections=>queued(defineEffect<ConsumableUse,void>(b=>call(selections.exports.discardToHand,{battle:b.read(v=>v.input.battle),zeroTurn,screen:CardScreen.LiquidMemories}))));
}
const memories=recall(true);

/** Each entry is the actual executable composition and its read-only projection. */
export const potionPrograms=Object.freeze({
  ANCIENT_POTION:power(()=>basicPowers.exports.PlayerArtifact,'人工制品',1),
  ATTACK_POTION:discovery(0), BLESSING_OF_THE_FORGE:upgradeHand,
  BLOCK_POTION:gain('block',12), BLOOD_POTION:blood, COLORLESS_POTION:discovery(4),
  CULTIST_POTION:power(()=>potionPowers.exports.Ritual,ritualPotionPowerLabel,1),
  DEXTERITY_POTION:power(()=>basicPowers.exports.Dexterity,'敏捷',2),
  DISTILLED_CHAOS:chaos(3), DUPLICATION_POTION:power(()=>potionPowers.exports.Duplication,duplicationPotionPowerLabel,1),
  ELIXIR_POTION:handMany(false,10), ENERGY_POTION:gain('energy',2), ENTROPIC_BREW:entropic,
  ESSENCE_OF_STEEL:power(()=>potionPowers.exports.PlatedArmor,'金属化护甲',4),
  EXPLOSIVE_POTION:hit(10,'all'), FAIRY_POTION:inert(fairyPotionText,false),
  FEAR_POTION:power(()=>basicPowers.exports.EnemyVulnerable,'易伤',3,'enemy',true), FIRE_POTION:hit(20,'enemy'),
  FLEX_POTION:temporaryPower(()=>basicPowers.exports.Strength,'力量',()=>ironcladPowers.exports.LoseStrength,loseStrengthPotionPowerLabel,5),
  FOCUS_POTION:power(()=>basicPowers.exports.Focus,'集中',2), FRUIT_JUICE:fruit,
  GAMBLERS_BREW:handMany(true,10), GHOST_IN_A_JAR:power(()=>defensePowers.exports.PlayerIntangible,'无实体',1),
  HEART_OF_IRON:power(()=>combatPowers.exports.Metallicize,'金属化',6), LIQUID_BRONZE:power(()=>potionPowers.exports.Thorns,'荆棘',3),
  LIQUID_MEMORIES:memories, POWER_POTION:discovery(2), REGEN_POTION:power(()=>potionPowers.exports.Regeneration,'再生',5), SKILL_POTION:discovery(1),
  // The existing implementation consumes Smoke Bomb without implementing escape.
  SMOKE_BOMB:inert('当前实现：消耗药水，无逃跑效果。'), SNECKO_OIL:combine(draw(5),randomizeHand(0,3)),
  SPEED_POTION:temporaryPower(()=>basicPowers.exports.Dexterity,'敏捷',()=>potionPowers.exports.LoseDexterity,loseDexterityPotionPowerLabel,5),
  STRENGTH_POTION:power(()=>basicPowers.exports.Strength,'力量',2), SWIFT_POTION:draw(3),
  WEAK_POTION:power(()=>basicPowers.exports.EnemyWeak,'虚弱',3,'enemy',true),
});
