import {relicPowers} from '../../powers/relics.ts';
import {openingRelics} from './opening.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {areaDamage} from '../../shared/area-damage.ts';
import {drawPowers} from "../../powers/draw.ts";
import {shackledPower} from "../../powers/shackled.ts";
import {pileCards} from "../../cards/statuses/definitions.ts";
import {PS} from "../../../combat-identifiers.ts";
import {combatPrivate,observeCounter,type CombatPrivate} from "../../../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {relics,type RelicDefinition} from "../../../rules/relics.ts";
import {battles} from "../../../rules/battles.ts";
import {turns} from "../../../rules/turns.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {combatGeneration} from "../../../program/card-generation.ts";
import type {PermanentCardDefinition} from "../../../rules/permanent-decks.types.ts";
import type {PileCard} from "../../../rules/card-piles.types.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {potions} from "../../../rules/potions.ts";
import {adventures} from "../../../rules/adventures.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {defensePowers} from "../../powers/defense.ts";
import {ironcladPowers} from "../../characters/ironclad/powers/definitions.ts";
import {potionPowers} from "../../potions/powers.ts";
import {counterPolicies,attachAbilities} from "../../powers/utils.ts";
import {registerRelicAbilities} from "../hooks.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {RelicId} from "../../../identifiers.ts";
import type {PowerDefinition,PowerApplication} from "../../../rules/powers.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
import type {ResourceAmount} from "../../../rules/resources.types.ts";
import {discoveryDescription,handManyDescription,type createCombatSelectionUtils} from "../../cards/shared/selection-utils.ts";
type Hook={battle:number;actor:number;source:number};
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query,on,modify,replace,restrict,enqueue,defineComponent,updateLocalComponent,readComponent}=rules;
export function createCombatRelics(selections:ReturnType<typeof createCombatSelectionUtils>){return defineRules({requires:[relicPowers,openingRelics,areaDamage,combatPrivate,relics,battles,turns,adventures,potions,basicPowers,defensePowers,drawPowers,ironcladPowers,potionPowers,shackledPower,pileCards,selections,random,combatGeneration],build(){
  const definitions:Partial<Record<RelicId,RelicDefinition>>={...openingRelics.exports.definitions};
  const texts:Record<string,string>={...openingRelics.exports.texts};
  // Build-time metadata follows the actual native TS program object; it is never
  // interpreted or read by execution, and never enters an Instance Context.
  const descriptions=new WeakMap<object,string>();
  const described=<T extends object>(program:T,text:string):T=>{descriptions.set(program,text);return program;};
  const textOf=(program:object)=>{const text=descriptions.get(program);if(text===undefined)throw Error('Missing combat relic program description');return text;};
  const ownBattle=defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner});
  const ownTurn=defineQuery({input:typedValue<rules.ReactionContext<TurnActor>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner});
  const ownCard=(type?:number)=>described(defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>c.event.owner===c.owner&&(type===undefined||r.query(cardInstances.exports.metadata,c.event.card).type===type)}),`自身打出${type===undefined?'':['攻击','技能','能力','诅咒','状态'][type]}牌`);
  function afterCard(effect:rules.Effect<Hook,void>,type?:number){const condition=ownCard(type);return described(on(battles.exports.used,{condition,order:battles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>call(effect,b.read(v=>({battle:v.input.event.battle,actor:v.input.owner,source:v.input.source}))))}),`${textOf(condition)}后，${textOf(effect)}。`);}
  const register=(id:RelicId,...abilities:rules.Ability[])=>{texts[id]=abilities.map(textOf).join('');return definitions[id]=defineEntity(relics.exports.kind,{id,install:registerRelicAbilities(...abilities)});};
  const start=(effect:rules.Effect<Hook,void>,event=battles.exports.started,priority=0)=>described(on(event,{condition:ownBattle,order:{phase:battles.exports.stages.relic,priority},effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(effect,b.read(v=>({battle:v.input.event,actor:v.input.owner,source:v.input.source}))))}),`开战时，${textOf(effect)}。`);
  const turn=(effect:rules.Effect<Hook,void>,event=turns.exports.playerStartRelics,priority=0)=>described(on(event,{condition:ownTurn,order:{phase:turns.exports.stages.content,priority},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>call(effect,b.read(v=>({battle:v.input.event.battle,actor:v.input.owner,source:v.input.source}))))}),`自身回合${event===turns.exports.playerEndRelics?'结束':'开始'}时，${textOf(effect)}。`);
  const queued=(effect:rules.Effect<Hook,void>,front=false,retained=false)=>described(defineEffect<Hook,void>(b=>enqueue(effect,b.input,{queue:actionQueue,position:front?'front':'back',source:b.read(v=>v.input.source),lifetime:b.read(v=>{const s=v.query(battles.exports.status,v.input.battle);return retained?s.scope:s.actionScope;}),eligible:'captured'})),textOf(effect));
  const combine=(...effects:rules.Effect<Hook,void>[])=>described(defineEffect<Hook,void>(b=>sequence(...effects.map(effect=>call(effect,b.input)))),effects.map(textOf).join('，'));
  const gain=(effect:typeof resources.exports.gainBlock,amount:number)=>described(defineEffect<Hook,void>(b=>call(effect,{entity:b.read(v=>v.input.actor),amount})),`自身获得${amount}${effect===resources.exports.gainBlock?'格挡':'能量'}`);
  const block=(amount:number)=>gain(resources.exports.gainBlock,amount),energy=(amount:number)=>gain(resources.exports.gainEnergy,amount);
  const powerNames=new Map<PowerDefinition,string>([[basicPowers.exports.Strength,'力量'],[basicPowers.exports.Dexterity,'敏捷'],[basicPowers.exports.PlayerArtifact,'人工制品'],[basicPowers.exports.EnemyVulnerable,'易伤'],[basicPowers.exports.EnemyWeak,'虚弱'],[basicPowers.exports.PlayerWeak,'虚弱'],[basicPowers.exports.Frail,'脆弱'],[drawPowers.exports.Confused,'混乱'],[defensePowers.exports.Buffer,'缓冲'],[defensePowers.exports.PlayerIntangible,'无实体'],[potionPowers.exports.Thorns,'荆棘'],[potionPowers.exports.PlatedArmor,'多层护甲'],[ironcladPowers.exports.LoseStrength,'回合末失去力量']]);
  const apply=(definition:PowerDefinition,amount:number,allEnemies=false,debuff=false,skipFirstDecay?:boolean)=>described(defineEffect<Hook,void>(b=>forEach(allEnemies?query(battles.exports.targets,b.read(v=>v.input.battle)):b.read(v=>[v.input.actor]),actor=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition,amount,source:debuff?null:b.read(v=>v.input.actor),debuff,skipFirstDecay,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)}))),`${allEnemies?'全体敌人':'自身'}获得${amount}${powerNames.get(definition)??(()=>{throw Error('Missing power description name');})()}${skipFirstDecay?'（跳过首次衰减）':''}${definition===drawPowers.exports.Confused?'（'+drawPowers.exports.programs.Confused.text+'）':definition===defensePowers.exports.Buffer?'（'+defensePowers.exports.programs.Buffer.text+'）':definition===relicPowers.exports.PenNib?'（'+relicPowers.exports.programs.PenNib.text+'）':''}`);
  const draw=(count:number)=>described(defineEffect<Hook,void>(b=>call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count})),`自身抽${count}张牌`);
  const allDamage=(amount:number)=>described(defineEffect<Hook,void>(b=>call(areaDamage.exports.hit,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),amount})),`对全体敌人造成${amount}伤害`);
  const eliteBattle=(effect:rules.Effect<Hook,void>)=>described(defineEffect<Hook,void>(b=>when(b.read(v=>room(v)==='ELITE'),call(effect,b.input))),`若为精英战，${textOf(effect)}`);
  const room=(v:rules.ReadView<Hook>)=>{const run=v.query(adventures.exports.forActor,v.input.actor);if(run===null)throw Error('Relic needs an adventure');return v.query(adventures.exports.position,run).room;};
  const ownerController=defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[turns.exports.actor],base:(r,c)=>r.query(turns.exports.actor,c.input).actor===c.owner});
  const recharge=(amount:number)=>described(modify(turns.exports.rechargeAmount,{condition:ownerController,transform:(_r,c)=>c.value+amount}),`自身每回合补充能量时额外获得${amount}能量。`);
  const extraEnergy=recharge(1);
  register('BRONZE_SCALES',start(apply(potionPowers.exports.Thorns,3)));register('FOSSILIZED_HELIX',start(apply(defensePowers.exports.Buffer,1)));register('THREAD_AND_NEEDLE',start(apply(potionPowers.exports.PlatedArmor,4)));register('MUTAGENIC_STRENGTH',start(combine(apply(basicPowers.exports.Strength,3),apply(ironcladPowers.exports.LoseStrength,3,false,true))));
  register('PHILOSOPHERS_STONE',extraEnergy,start(apply(basicPowers.exports.Strength,1,true)));
  const drawBonus=(amount:number)=>described(modify(turns.exports.drawCount,{condition:ownerController,transform:(_r,c)=>c.value+amount}),`自身每回合多抽${amount}张牌。`);
  register('SNECKO_EYE',drawBonus(2),start(apply(drawPowers.exports.Confused,1)));
  const eliteRecharge=(amount:number)=>described(modify(turns.exports.rechargeAmount,{condition:ownerController,dependencies:[turns.exports.actor,adventures.exports.forActor,adventures.exports.current,adventures.exports.position],transform:(r,c)=>{const run=r.query(adventures.exports.forActor,c.owner);if(run===null)return c.value;const room=r.query(adventures.exports.position,run).room;return c.value+(room==='ELITE'||room==='BOSS'?amount:0);}}),`精英或Boss战中，自身每回合补充能量时额外获得${amount}能量。`);
  register('SLAVERS_COLLAR',eliteRecharge(1));
  const reduceEnemyHp=(ratio:number)=>described(defineEffect<Hook,void>(b=>forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies),entity=>call(resources.exports.setHealth,{entity,hp:b.read(v=>Math.trunc(v.query(resources.exports.vitality,v.get(entity)).maxHp*ratio)),maxHp:b.read(v=>v.query(resources.exports.vitality,v.get(entity)).maxHp)}))),`将全体敌人的当前生命设为最大生命的${ratio*100}%（向下取整），不改变最大生命`);
  register('PRESERVED_INSECT',start(eliteBattle(reduceEnemyHp(.75))));
  register('BAG_OF_PREPARATION',start(queued(draw(2)),battles.exports.openingQueued));register('CLOCKWORK_SOUVENIR',start(queued(apply(basicPowers.exports.PlayerArtifact,1)),battles.exports.openingQueued));register('BAG_OF_MARBLES',start(queued(apply(basicPowers.exports.EnemyVulnerable,1,true,true)),battles.exports.openingQueued));register('RED_MASK',start(queued(apply(basicPowers.exports.EnemyWeak,1,true,true,true)),battles.exports.openingQueued));register('GREMLIN_VISAGE',start(apply(basicPowers.exports.PlayerWeak,1,false,true),battles.exports.openingQueued));
  const wounds=(count:number)=>described(defineEffect<Hook,void>(b=>forEach(Array.from({length:count},(_,i)=>i),()=>enqueue(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition:pileCards.exports.Wound,upgraded:false,specialData:0,destination:0,shuffle:true,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),`将${count}张未升级伤口洗入自身抽牌堆`);
  register('MARK_OF_PAIN',extraEnergy,start(wounds(2),battles.exports.openingQueued));
  const gamble=(maximum:number)=>described(defineEffect<Hook,void>(b=>call(selections.exports.handMany,{battle:b.read(v=>v.input.battle),discard:true,maximum})),handManyDescription(true,maximum));
  register('GAMBLING_CHIP',start(queued(gamble(10)),battles.exports.openingQueued,100));
  const discover=(category:0|1|2|3|4,copies:number)=>described(defineEffect<Hook,void>(b=>call(selections.exports.discovery,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),category,copies,markDiscovery:false})),`${discoveryDescription(category)}获得所选牌${copies}张`);
  register('TOOLBOX',start(queued(discover(4,1))));
  register('SOZU',extraEnergy,described(modify(potions.exports.allowed,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[potions.exports.current],base:(r,c)=>r.query(potions.exports.current,c.input).actor===c.owner}),transform:()=>false}),'自身不能获得药水。'));
  const limitPlay=(maximum:number)=>described(modify(battles.exports.playAllowed,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.input).actor===c.owner}),dependencies:[battles.exports.current,battles.exports.status],transform:(r,c)=>c.value&&r.query(battles.exports.status,c.input).cardsPlayed<maximum}),`自身每回合最多打出${maximum}张牌。`);
  register('VELVET_CHOKER',extraEnergy,limitPlay(6));
  register('RUNIC_PYRAMID',described(modify(turns.exports.discardRemaining,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[turns.exports.actor],base:(r,c)=>r.query(turns.exports.actor,c.input).actor===c.owner}),transform:()=>false}),'自身回合结束不弃掉剩余手牌。'));
  register('ICE_CREAM',described(modify(turns.exports.retainedEnergy,{condition:ownerController,dependencies:[resources.exports.current,resources.exports.stamina],transform:(r,c)=>r.query(resources.exports.stamina,c.owner).energy}),'自身回合剩余能量保留到下回合。'));
  const retainBlock=(loss:number)=>described(replace(turns.exports.beforeBlockReset,{condition:defineQuery({input:typedValue<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),base:(_r,c)=>c.value.entity===c.owner}),effect:defineEffect<rules.ReplacementContext<ResourceAmount>,rules.ReplacementResult<ResourceAmount>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:Math.min(loss,v.input.value.amount)}))}))}),`自身回合开始清除格挡时，最多失去${loss}格挡。`);
  register('CALIPERS',retainBlock(15));
  const attackSource=described(defineQuery({input:typedValue<rules.ModifierContext<{source:number;target:number;base:number;card:number|null},number>>(),output:z.boolean(),base:(_r,c)=>c.input.source===c.owner}),'自身为攻击伤害来源');
  const attackTarget=described(defineQuery({input:typedValue<rules.ModifierContext<{source:number;target:number;base:number;card:number|null},number>>(),output:z.boolean(),base:(_r,c)=>c.input.target===c.owner}),'自身为攻击伤害目标');
  const strikeBonus=(amount:number)=>described(modify(attributes.exports.playerAttack,{condition:attackSource,order:{phase:attributes.exports.stages.addition,priority:0},dependencies:[cardInstances.exports.metadata],transform:(r,c)=>c.input.card!==null&&r.query(cardInstances.exports.metadata,c.input.card).strike?Math.fround(c.value+amount):c.value}),`自身具有打击标记的牌造成的攻击伤害增加${amount}。`);
  register('STRIKE_DUMMY',strikeBonus(3));
  function factor(query:typeof attributes.exports.vulnerableFactor,condition:typeof attackSource,ratio:number){return described(modify(query,{condition,transform:()=>Math.fround(ratio)}),`${textOf(condition)}时，${query===attributes.exports.vulnerableFactor?'易伤':'虚弱'}伤害倍率固定为${ratio}。`);}
  register('PAPER_PHROG',factor(attributes.exports.vulnerableFactor,attackSource,1.75));register('ODD_MUSHROOM',factor(attributes.exports.vulnerableFactor,attackTarget,1.25));register('PAPER_KRANE',factor(attributes.exports.weakFactor,attackTarget,.6));
  for(const [id,type] of [['BLUE_CANDLE',3],['MEDICAL_KIT',4]] as const){const qualifies=defineQuery({input:typedValue<rules.ModifierContext<CardUse,boolean>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>c.input.owner===c.owner&&r.query(cardInstances.exports.metadata,c.input.card).type===type});const cardName=type===3?'诅咒':'状态';const loss=1;register(id,described(modify(battles.exports.intrinsic,{condition:qualifies,transform:()=>true}),`自身可打出${cardName}牌。`),described(modify(battles.exports.exhaustAfterUse,{condition:qualifies,transform:()=>true}),`打出后消耗该${cardName}牌。`),...(id==='BLUE_CANDLE'?[described(on(battles.exports.used,{condition:ownCard(type),order:battles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>enqueue(defineEffect<{actor:number;battle:number},void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.actor),amount:loss,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),{actor:b.read(v=>v.input.owner),battle:b.read(v=>v.input.event.battle)},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),eligible:'captured'}))}),`自身每打出1张${cardName}牌，失去${loss}生命。`)]:[]));}
  const healOnPower=(amount:number)=>described(on(battles.exports.used,{condition:ownCard(2),order:battles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount}))}),`自身每打出1张能力牌，回复${amount}生命。`);
  register('BIRD_FACED_URN',healOnPower(2));
  const everyCardsInTurn=(type:0|1,limit:number,effect:rules.Effect<Hook,void>)=>described(on(battles.exports.used,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[battles.exports.current,cardInstances.exports.metadata,battles.exports.status],base:(r,c)=>c.event.owner===c.owner&&r.query(cardInstances.exports.metadata,c.event.card).type===type&&(type===0?r.query(battles.exports.status,c.event.battle).attacksPlayed:r.query(battles.exports.status,c.event.battle).skillsPlayed)%limit===0}),order:battles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>call(effect,b.read(v=>({battle:v.input.event.battle,actor:v.input.owner,source:v.input.source}))))}),`自身每回合每打出${limit}张${type===0?'攻击':'技能'}牌，${textOf(effect)}。`);
  register('KUNAI',everyCardsInTurn(0,3,queued(apply(basicPowers.exports.Dexterity,1))));register('SHURIKEN',everyCardsInTurn(0,3,queued(apply(basicPowers.exports.Strength,1))));register('ORNAMENTAL_FAN',everyCardsInTurn(0,3,queued(block(4),false,true)));register('LETTER_OPENER',everyCardsInTurn(1,3,queued(allDamage(5))));
  const immune=(definition:PowerDefinition)=>described(restrict(powers.exports.beforeApply,{when:defineQuery({input:typedValue<rules.ReplacementContext<PowerApplication>>(),output:z.boolean(),base:(r,c)=>c.value.actor===c.owner&&c.value.debuff&&r.sameDefinition(c.value.definition,definition)}),order:powers.exports.stages.immunity,reason:{immune:true}}),`自身免疫${powerNames.get(definition)}。`);
  register('GINGER',immune(basicPowers.exports.PlayerWeak));register('TURNIP',immune(basicPowers.exports.Frail));
  function periodic(id:RelicId,limit:number,effect:rules.Effect<Hook,void>,mode:'turn'|'card'|'attack'){
    const data=defineComponent({schema:z.int32(),initial:()=>0});
    const view=modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[data],transform:(r,c)=>r.component(c.source,data)});
    const tick=(queuedEffect:boolean)=>{const child=queuedEffect?queued(effect):effect;return described(defineEffect<Hook,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.source),data,n=>(n+1)%limit),when(b.read(v=>v.get(readComponent(v.input.source,data))===0),call(child,b.input)))),`触发计数增加1；每累计${limit}次，${textOf(child)}（计数跨战斗保留）`);};
    const field=({HAPPY_FLOWER:'happyFlowerCounter',INCENSE_BURNER:'incenseBurnerCounter',INK_BOTTLE:'inkBottleCounter',NUNCHAKU:'nunchakuCounter'} as Partial<Record<RelicId,keyof CombatPrivate>>)[id];
    const abilities:rules.Ability[]=[described(view,'')];if(field)abilities.push(described(observeCounter(field,data),''));if(mode==='turn')abilities.push(start(tick(false)),turn(tick(true),turns.exports.playerStartRelics,id==='HAPPY_FLOWER'?30:50));else abilities.push(afterCard(tick(true),mode==='attack'?0:undefined));
    definitions[id]=defineEntity(relics.exports.kind,{id,install:registerRelicAbilities(...abilities)},{components:[data]});
    texts[id]=abilities.map(textOf).join('');
  }
  periodic('HAPPY_FLOWER',3,energy(1),'turn');periodic('INCENSE_BURNER',6,apply(defensePowers.exports.PlayerIntangible,1),'turn');periodic('INK_BOTTLE',10,draw(1),'card');periodic('NUNCHAKU',10,energy(1),'attack');
  function lowHealthStrength(amount:number,divisor:number){
  const red=defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[resources.exports.current,resources.exports.vitality],base:(r,c)=>{const hp=r.query(resources.exports.vitality,c.owner);return c.input===c.owner&&hp.hp<=Math.trunc(hp.maxHp/divisor);}});
  register('RED_SKULL',described(modify(attributes.exports.strength,{condition:red,transform:(_r,c)=>c.value+amount}),`自身生命不超过最大生命的1/${divisor}（向下取整）时，获得${amount}力量。`),described(modify(attributes.exports.playerAttack,{condition:defineQuery({input:typedValue<rules.ModifierContext<{source:number;target:number;base:number;card:number|null},number>>(),output:z.boolean(),dependencies:[resources.exports.current,resources.exports.vitality],base:(r,c)=>{const hp=r.query(resources.exports.vitality,c.owner);return c.input.source===c.owner&&hp.hp<=Math.trunc(hp.maxHp/divisor);}}),order:{phase:attributes.exports.stages.addition,priority:100},transform:(_r,c)=>Math.fround(c.value+amount)}),''));
  }
  lowHealthStrength(3,2);
  function penNibProgram(period:number){
    const {definition:PenNib,text:statusText}=relicPowers.exports.programs.PenNib;
    const penCount=defineComponent({schema:z.int32(),initial:()=>0});
    powerNames.set(PenNib,'钢笔尖');
    const penView=described(modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[penCount],transform:(r,c)=>{const n=r.component(c.source,penCount);return n<0?period-1:n;}}),'');
    const pending=described(defineEffect<Hook,void>(b=>updateLocalComponent(b.read(v=>v.input.source),penCount,-1)),'将计数标记为等待下一张攻击');
    const increment=described(defineEffect<Hook,void>(b=>updateLocalComponent(b.read(v=>v.input.source),penCount,n=>n+1)),'攻击计数增加1');
    function atReadyCount(effect:rules.Effect<Hook,void>){return described(defineEffect<Hook,void>(b=>when(b.read(v=>v.get(readComponent(v.input.source,penCount))===period-1),call(effect,b.input))),`若攻击计数达到${period-1}，${textOf(effect)}`);}
    const penStart=start(atReadyCount(combine(apply(PenNib,1),pending)));
    const penTick=afterCard(combine(increment,atReadyCount(combine(queued(apply(PenNib,1)),pending))),0);
    function restorePendingAtExit(){
      const condition=described(defineQuery({input:typedValue<rules.ReactionContext<{battle:number;actor:number;outcome:1|2}>>(),output:z.boolean(),reads:[penCount],base:(r,c)=>c.event.actor===c.owner&&r.component(c.source,penCount)<0}),'自身离开战斗且已准备下一张攻击时，');
      const effect=described(defineEffect<rules.ReactionContext<unknown>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),penCount,period-1)),`计数恢复至${period-1}并保留至下场战斗。`);
      return described(on(battles.exports.exiting,{condition,effect}),textOf(condition)+textOf(effect));
    }
    const abilities=[described(observeCounter('penNibCounter',penCount),''),penView,penStart,penTick,restorePendingAtExit()];
    definitions.PEN_NIB=defineEntity(relics.exports.kind,{id:'PEN_NIB',install:registerRelicAbilities(...abilities)},{components:[penCount]});
    texts.PEN_NIB=abilities.map(textOf).join('');
    return{PenNib,statusText};
  }
  const {PenNib,statusText:penNibText}=penNibProgram(10);
  type Victory={actor:number;outcome:1|2};
  function afterVictory(effect:rules.Effect<rules.ReactionContext<Victory>,void>,underHalf=false,afterSettlement=false){
    const divisor=2;
    const condition=described(defineQuery({input:typedValue<rules.ReactionContext<Victory>>(),output:z.boolean(),dependencies:[resources.exports.current,resources.exports.vitality],base:(r,c)=>{const hp=r.query(resources.exports.vitality,c.owner);return c.event.actor===c.owner&&c.event.outcome===1&&(!underHalf||hp.hp<=Math.trunc(hp.maxHp/divisor));}}),`自身战斗胜利${afterSettlement?'结算':''}后，${underHalf?`若自身生命不超过最大生命的1/${divisor}（向下取整），`:''}`);
    return described(on(adventures.exports.combatFinished,{condition,...(afterSettlement?{order:adventures.exports.combatStages.afterSettlement}:{}),effect}),textOf(condition)+textOf(effect));
  }
  function healVictoryOwner(amount:number){return described(defineEffect<rules.ReactionContext<Victory>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount})),`自身回复${amount}生命。`);}
  function growVictoryOwner(amount:number){return described(defineEffect<rules.ReactionContext<Victory>,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.input.owner),amount})),`自身最大生命增加${amount}并回复${amount}生命。`);}
  register('BLACK_BLOOD',afterVictory(healVictoryOwner(12)));register('MEAT_ON_THE_BONE',afterVictory(healVictoryOwner(12),true));
  register('FACE_OF_CLERIC',afterVictory(growVictoryOwner(1),false,true));
  const handProc=(cost:number)=>described(on(battles.exports.used,{condition:ownCard(2),order:{phase:battles.exports.stages.relic,priority:50},effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>{const cards=b.local<number[]>(),at=b.local<number>();return sequence(b.assign(cards,b.read(v=>{const board=v.query(battles.exports.current,v.input.event.battle),p=v.query(cardPiles.exports.bindings,board.piles);return v.query(zones.exports.members,p.hand).filter(card=>{const c=v.query(cardInstances.exports.current,card);return c.cost>0&&c.costForTurn>0&&!c.freeToPlayOnce&&!board.queue.some(item=>item.kind===0&&item.play.state.uniqueId===c.uniqueId);});})),when(b.read(v=>v.get(cards).length===0),b.return(undefined)),b.assign(at,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.event.battle).piles).cardRng),start:0,end:b.read(v=>v.get(cards).length-1)})),call(cardInstances.exports.setCostForTurn,{entity:b.read(v=>v.get(cards)[v.get(at)]!),amount:cost}));})}),`自身打出能力牌时，随机选取手牌中原始费用和本回合费用均大于0、非一次免费且未入出牌队列的1张牌，将其本回合费用设为${cost}。`);register('MUMMIFIED_HAND',handProc(0));
  const ownPile=defineQuery({input:typedValue<rules.ReactionContext<PileCard>>(),output:z.boolean(),dependencies:[cardPiles.exports.current,cardPiles.exports.bindings],base:(r,c)=>r.query(cardPiles.exports.bindings,c.event.piles).actor===c.owner});
  const onExhaust=(effect:rules.Effect<Hook,void>)=>described(on(cardPiles.exports.exhausting,{condition:ownPile,order:cardPiles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>call(queued(effect,true),b.read(v=>({battle:v.query(cardPiles.exports.bindings,v.input.event.piles).battle,actor:v.input.owner,source:v.input.source}))))}),`自身每消耗1张牌，${textOf(effect)}。`);
  register('CHARONS_ASHES',onExhaust(allDamage(3)));
  register('DEAD_BRANCH',described(on(cardPiles.exports.exhausting,{condition:ownPile,order:{phase:cardPiles.exports.stages.relic,priority:10},effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>{const definition=b.local<PermanentCardDefinition>();return sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).battle),category:3})),enqueue(combatGeneration.exports.create,{battle:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).battle),definition,upgraded:false,zeroCombat:false,zeroTurn:false,destination:1,shuffle:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).actionScope),eligible:'captured'}));})}),'自身每消耗1张牌，随机生成1张非无色牌加入手牌；不升级，不修改费用。'));
  return{exports:{definitions,PenNib,texts:Object.freeze(texts),statusTexts:Object.freeze({PEN_NIB:penNibText})}};
}});}
