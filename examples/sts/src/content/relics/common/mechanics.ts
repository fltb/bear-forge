import {relicPowers} from '../../powers/relics.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {combatPrivate,observeCounter} from "../../../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {relics,type RelicDefinition} from "../../../rules/relics.ts";
import {battles} from "../../../rules/battles.ts";
import {turns} from "../../../rules/turns.ts";
import {resources} from "../../../rules/resources.ts";
import {damage} from "../../../rules/damage.ts";
import {powers} from "../../../rules/powers.ts";
import {attributes} from "../../../rules/attributes.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {random} from "../../../rules/random.ts";
import {adventures} from "../../../rules/adventures.ts";
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {combatGeneration} from "../../../program/card-generation.ts";
import {registerRelicAbilities} from "../hooks.ts";
import {counterPolicies,attachAbilities} from "../../powers/utils.ts";
import {ownsTurn} from "../../powers/turn-hooks.ts";
import {CardScreen} from "../../../adapters/selection-presentations.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {PS} from "../../../combat-identifiers.ts";
import type {RelicId} from "../../../identifiers.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
import type {HpLost} from "../../../rules/resources.types.ts";
import type {PowerApplication} from "../../../rules/powers.types.ts";
import type {PermanentCardDefinition} from "../../../rules/permanent-decks.types.ts";
import type {CardDestination} from "../../../rules/battles.types.ts";
import {discoveryDescription,type createCombatSelectionUtils} from "../../cards/shared/selection-utils.ts";
const {defineRules,defineEffect,defineQuery,defineEntity,defineComponent,sequence,when,forEach,call,query,on,modify,replace,enqueue,readComponent,updateLocalComponent}=rules;
type Hook={battle:number;actor:number;source:number};
export function createRelicMechanics(selections:ReturnType<typeof createCombatSelectionUtils>){return defineRules({requires:[relicPowers,combatPrivate,relics,battles,turns,resources,damage,powers,attributes,cardInstances,cardPiles,zones,random,adventures,permanentDecks,basicPowers,combatGeneration,selections],build(){
  const definitions:Partial<Record<RelicId,RelicDefinition>>={};
  const texts:Record<string,string>={};
  const descriptions=new WeakMap<object,string>();
  const described=<T extends object>(program:T,text:string):T=>{descriptions.set(program,text);return program;};
  const textOf=(program:object)=>{const text=descriptions.get(program);if(text===undefined)throw Error('Missing mechanic program description');return text;};
  const register=(id:RelicId,abilities:rules.Ability[],components:rules.Component<any>[]=[])=>{texts[id]=abilities.length?abilities.map(textOf).join(''):'当前实现不提供额外效果。';return definitions[id]=defineEntity(relics.exports.kind,{id,install:registerRelicAbilities(...abilities)},{components});};
  const ownBattle=defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner});
  const ownTurn=defineQuery({input:typedValue<rules.ReactionContext<TurnActor>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner});
  const turn=(event:rules.RuleEvent<TurnActor>,effect:rules.Effect<Hook,void>,priority=0)=>described(on(event,{condition:ownTurn,order:{phase:turns.exports.stages.content,priority},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>call(effect,b.read(v=>({battle:v.input.event.battle,actor:v.input.owner,source:v.input.source}))))}),textOf(effect)?`${event===turns.exports.idle?'自身可行动时':event===turns.exports.playerPostDrawRelics?'自身每回合抽牌后':event===turns.exports.playerEndRelics?'自身回合结束时':'自身回合开始时'}，${textOf(effect)}。`:'');
  const start=(effect:rules.Effect<Hook,void>,event=battles.exports.started)=>described(on(event,{condition:ownBattle,order:battles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(effect,b.read(v=>({battle:v.input.event,actor:v.input.owner,source:v.input.source}))))}),textOf(effect)?`开战时，${textOf(effect)}。`:'');
  const queued=(effect:rules.Effect<Hook,void>,front=false)=>described(defineEffect<Hook,void>(b=>enqueue(effect,b.input,{queue:actionQueue,position:front?'front':'back',source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),textOf(effect));
  const draw=(count:number)=>described(defineEffect<Hook,void>(b=>call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count})),`自身抽${count}张牌`);
  const gainEnergy=(amount:number)=>described(defineEffect<Hook,void>(b=>call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.actor),amount})),`自身获得${amount}能量`);
  const energy=gainEnergy(1);
  const hpLost=defineQuery({input:typedValue<rules.ReactionContext<HpLost>>(),output:z.boolean(),dependencies:[battles.exports.presentForActor],base:(r,c)=>c.event.entity===c.owner&&c.event.amount>0&&r.query(battles.exports.presentForActor,c.owner)!==null});
  const card=(type?:number)=>defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>c.event.owner===c.owner&&(type===undefined||r.query(cardInstances.exports.metadata,c.event.card).type===type)});
  const hpHook=(effect:rules.Effect<Hook,void>)=>described(on(resources.exports.hpLost,{condition:hpLost,effect:defineEffect<rules.ReactionContext<HpLost>,void>(b=>call(effect,b.read(v=>{const battle=v.query(battles.exports.presentForActor,v.input.owner);if(battle===null)throw Error('HP reaction requires battle');return{battle,actor:v.input.owner,source:v.input.source};})))}),`战斗中自身每次失去大于0的生命后，${textOf(effect)}。`);

  const only=(predicate:(v:rules.ReadView<Hook>)=>boolean,effect:rules.Effect<Hook,void>,condition:string)=>described(defineEffect<Hook,void>(b=>when(b.read(predicate),call(effect,b.input))),`${condition}，${textOf(effect)}`);
  const puzzleUsed=defineComponent({schema:z.boolean(),initial:()=>false});
  function firstLoss(effect:rules.Effect<Hook,void>){return [start(described(defineEffect<Hook,void>(b=>updateLocalComponent(b.read(v=>v.input.source),puzzleUsed,false)),'')),hpHook(described(defineEffect<Hook,void>(b=>when(b.read(v=>!v.get(readComponent(v.input.source,puzzleUsed))),sequence(updateLocalComponent(b.read(v=>v.input.source),puzzleUsed,true),call(effect,b.input)))),`若是本场战斗首次失去生命，${textOf(effect)}`))];}
  register('CENTENNIAL_PUZZLE',firstLoss(queued(draw(3),true)),[puzzleUsed]);
  register('RUNIC_CUBE',[hpHook(queued(draw(1),true))]);
  const {NextTurnBlock,nextBlockText}=relicPowers.exports;
  const applyNextBlock=(amount:number)=>described(defineEffect<Hook,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.actor),definition:NextTurnBlock,amount,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),nextBlockText(amount));
  register('SELF_FORMING_CLAY',[hpHook(applyNextBlock(3))]);
  // The pinned acquisition path initializes Lizard Tail data to zero.
  function lizardTail(initiallyAvailable:boolean){
  const tail=defineComponent({schema:z.boolean(),initial:()=>initiallyAvailable});
  register('LIZARD_TAIL',[described(modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[tail],transform:(r,c)=>Number(r.component(c.source,tail))}),''),described(on(resources.exports.wouldDie,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),reads:[tail],dependencies:[resources.exports.current,adventures.exports.forActor,adventures.exports.hasRelic,battles.exports.presentForActor,resources.exports.vitality],base:(r,c)=>{const run=r.query(adventures.exports.forActor,c.owner);return c.event.entity===c.owner&&r.component(c.source,tail)&&r.query(resources.exports.vitality,c.owner).hp===0&&run!==null&&!r.query(adventures.exports.hasRelic,{run,id:'MARK_OF_THE_BLOOM'});}}),order:100,effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.source),tail,false),when(b.read(v=>v.query(battles.exports.presentForActor,v.input.owner)===null),call(resources.exports.setHealth,{entity:b.read(v=>v.input.owner),hp:b.read(v=>Math.max(1,Math.trunc(v.query(resources.exports.vitality,v.input.owner).maxHp/2))),maxHp:b.read(v=>v.query(resources.exports.vitality,v.input.owner).maxHp)}),call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.trunc(v.query(resources.exports.vitality,v.input.owner).maxHp/2))}))))}),initiallyAvailable?'致死时若没有绽放印记，消耗此遗物并恢复一半最大生命。':'当前实现的蜥蜴尾巴初始不可用，不提供复活效果。')],[tail]);
  }
  lizardTail(false);
  register('ART_OF_WAR',[turn(turns.exports.playerStartRelics,only(v=>v.query(battles.exports.status,v.input.battle).attacksPlayed===0,queued(energy),'若上一回合未打出攻击牌'),0)]);
  const fewCards=(maximum:number,effect:rules.Effect<Hook,void>)=>only(v=>v.query(battles.exports.status,v.input.battle).cardsPlayed<=maximum,effect,`若上一回合打出至多${maximum}张牌`);
  register('POCKETWATCH',[turn(turns.exports.playerPostDrawRelics,fewCards(3,queued(draw(3))))]);
  register('UNCEASING_TOP',[turn(turns.exports.idle,only(v=>{const piles=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles);return v.query(zones.exports.members,piles.hand).length===0;},draw(1),'若手牌为空'))]);
  // The pinned source stores Du-Vu Doll data as zero and does not update it on deck changes.
  register('DU_VU_DOLL',[]);
  const {Vigor,vigorText}=relicPowers.exports;
  const applyVigor=(amount:number)=>described(defineEffect<Hook,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.actor),definition:Vigor,amount,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),vigorText(amount));
  register('AKABEKO',[start(applyVigor(8))]);
  function repeatFirstCostlyAttack(threshold:number){
  const necroUsed=defineComponent({schema:z.boolean(),initial:()=>false});
  const resetNecro=described(defineEffect<Hook,void>(b=>updateLocalComponent(b.read(v=>v.input.source),necroUsed,false)),'');
  register('NECRONOMICON',[described(observeCounter('haveUsedNecronomiconThisTurn',necroUsed),''),start(resetNecro),turn(turns.exports.playerStartRelics,resetNecro,90),described(on(battles.exports.used,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[necroUsed],dependencies:[cardInstances.exports.metadata],base:(r,c)=>c.event.owner===c.owner&&!r.component(c.source,necroUsed)&&!c.event.freeToPlay&&!c.event.purgeOnUse&&r.query(cardInstances.exports.metadata,c.event.card).type===0&&(c.event.state.costForTurn>=threshold||c.event.state.cost===-1&&c.event.energyOnUse>=threshold)}),order:{phase:battles.exports.stages.relic,priority:30},effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.source),necroUsed,true),call(battles.exports.queueCard,{battle:b.read(v=>v.input.event.battle),card:b.read(v=>v.input.event.card),target:b.read(v=>v.input.event.target),state:b.read(v=>v.input.event.state),energyOnUse:b.read(v=>v.input.event.energyOnUse),afterFirst:true,options:{autoplay:true,purgeOnUse:true,freeToPlay:true,ignoreEnergyTotal:true}})))}),`每回合自身首次打出费用至少${threshold}的非免费攻击牌（X费按实际投入能量判断）时，对同一目标免费重放1次；自动重放的牌不再触发。`)],[necroUsed]);
  }
  repeatFirstCostlyAttack(2);
  const pelletTypes=['攻击','技能','能力'] as const;
  const pellets=defineComponent({schema:z.int32(),initial:()=>0});
  const cleansePlayer=described(defineEffect<Hook,void>(b=>forEach(b.read(v=>v.query(powers.exports.entries,v.query(battles.exports.status,v.input.battle).registry).filter(p=>v.query(powers.exports.current,p.entity).actor===v.input.actor&&v.query(powers.exports.polarity,p.entity)<0).map(p=>p.entity)),entity=>call(powers.exports.set,{entity,next:{level:0,active:false,justApplied:false}}))),'清除自身所有负面效果');
  register('ORANGE_PELLETS',[described(observeCounter('orangePelletsCardTypesPlayed',pellets),''),start(described(defineEffect<Hook,void>(b=>updateLocalComponent(b.read(v=>v.input.source),pellets,0)),'')),turn(turns.exports.playerStartRelics,described(defineEffect<Hook,void>(b=>updateLocalComponent(b.read(v=>v.input.source),pellets,0)),''),100),described(on(battles.exports.used,{condition:card(),order:{phase:battles.exports.stages.relic,priority:20},effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>sequence(when(b.read(v=>v.query(cardInstances.exports.metadata,v.input.event.card).type<pelletTypes.length),updateLocalComponent(b.read(v=>v.input.source),pellets,b.read(v=>v.get(readComponent(v.input.source,pellets))|(1<<v.query(cardInstances.exports.metadata,v.input.event.card).type)))),when(b.read(v=>v.get(readComponent(v.input.source,pellets))===(1<<pelletTypes.length)-1),sequence(updateLocalComponent(b.read(v=>v.input.source),pellets,0),call(queued(cleansePlayer),b.read(v=>({battle:v.input.event.battle,actor:v.input.owner,source:v.input.source})))))))}),`同一回合中，每集齐${pelletTypes.join('、')}牌各1张，${textOf(cleansePlayer)}；触发后重新计数。`)],[pellets]);
  register('STRANGE_SPOON',[described(replace(battles.exports.disposing,{condition:defineQuery({input:typedValue<rules.ReplacementContext<CardDestination>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>c.value.destination===1&&r.query(battles.exports.status,c.value.battle).actor===c.owner}),effect:defineEffect<rules.ReplacementContext<CardDestination>,rules.ReplacementResult<CardDestination>>(b=>{const coin=b.local<boolean>();return sequence(b.assign(coin,call(random.exports.boolean,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.value.battle).piles).cardRng)})),b.return(b.read(v=>v.get(coin)?{kind:'change',value:{...v.input.value,destination:0 as const}}:{kind:'keep',value:v.input.value})));})}),'自身打出的牌即将被消耗时，掷公平硬币；正面改为弃置，反面仍消耗。')]);
  const handBlock=(perCard:number)=>described(defineEffect<Hook,void>(b=>call(resources.exports.gainBlock,{entity:b.read(v=>v.input.actor),amount:b.read(v=>perCard*v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand).length)})),`自身每张剩余手牌提供${perCard}格挡`);
  register('CLOAK_CLASP',[turn(turns.exports.playerEndRelics,queued(handBlock(1)),0)]);
  const codex=(category:0|1|2|3|4,copies:number)=>described(defineEffect<Hook,void>(b=>call(selections.exports.discovery,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),category,copies,screen:CardScreen.Codex,skipIndex:3,zeroTurn:false,destination:0,shuffle:true})),`${discoveryDescription(category,false)}可跳过；将所选牌${copies}张洗入抽牌堆`);
  register('NILRYS_CODEX',[turn(turns.exports.playerEndRelics,queued(codex(3,1)),20)]);
  const upgradeRandom=described(defineEffect<Hook,void>(b=>{const candidates=b.local<number[]>(),shuffled=b.local<readonly number[]>();return sequence(b.assign(candidates,b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand).filter(card=>v.query(cardInstances.exports.canUpgrade,card)))),when(b.read(v=>v.get(candidates).length===0),b.return(undefined)),b.assign(shuffled,random.exports.shuffle({stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).shuffleRng),items:candidates})),call(cardInstances.exports.upgrade,b.read(v=>v.get(shuffled)[0]!)));}),'随机升级自身手牌中1张可升级牌');
  register('WARPED_TONGS',[start(queued(upgradeRandom),battles.exports.openingQueued),turn(turns.exports.playerPostDrawRelics,queued(upgradeRandom),10)]);
  const randomPower=described(defineEffect<Hook,void>(b=>{const definition=b.local<PermanentCardDefinition>();return sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.input.battle),category:2})),enqueue(combatGeneration.exports.create,{battle:b.read(v=>v.input.battle),definition,upgraded:false,zeroCombat:false,zeroTurn:true,destination:1,shuffle:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}),'随机生成1张未升级能力牌加入手牌，本回合免费');
  register('ENCHIRIDION',[start(randomPower)]);
  const onEnemyDeath=(energyAmount:number,drawCount:number)=>{const energy=gainEnergy(energyAmount),cards=draw(drawCount);return described(on(resources.exports.wouldDie,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),dependencies:[battles.exports.presentForActor,battles.exports.current,battles.exports.expectedOutcome,battles.exports.status],base:(r,c)=>{const id=r.query(battles.exports.presentForActor,c.owner);return id!==null&&r.query(battles.exports.status,id).enemies.includes(c.event.entity)&&r.query(battles.exports.expectedOutcome,id)===0;}}),effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>call(defineEffect<Hook,void>(b=>sequence(call(queued(energy),b.input),call(queued(cards),b.input))),b.read(v=>{const battle=v.query(battles.exports.presentForActor,v.input.owner);if(battle===null)throw Error('Gremlin Horn requires battle');return{battle,actor:v.input.owner,source:v.input.source};})))}),`敌人死亡且战斗尚未结束时，${textOf(energy)}，${textOf(cards)}。`);};
  register('GREMLIN_HORN',[onEnemyDeath(1,1)]);
  const breakBlock=(amount:number)=>described(on(damage.exports.resolved,{condition:defineQuery({input:typedValue<rules.ReactionContext<import('../../../rules/damage.types.ts').HitResult>>(),output:z.boolean(),dependencies:[resources.exports.current,resources.exports.side,resources.exports.defense],base:(r,c)=>c.event.blocked>0&&r.query(resources.exports.defense,c.event.blockTarget).block===0&&r.query(resources.exports.side,c.event.blockTarget)===1&&c.event.source===c.owner}),effect:defineEffect<rules.ReactionContext<import('../../../rules/damage.types.ts').HitResult>,void>(b=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.event.battle).registry),actor:b.read(v=>v.input.event.blockTarget),definition:basicPowers.exports.EnemyVulnerable,amount,source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope)},{queue:actionQueue,position:'front',source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}))}),`自身造成的伤害实际消耗格挡且使敌人格挡归零时，对该敌人施加${amount}易伤。`);
  register('HAND_DRILL',[breakBlock(2)]);
  const vulnerableWeak=(amount:number)=>described(on(powers.exports.applied,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number;application:PowerApplication}>>(),output:z.boolean(),dependencies:[powers.exports.find,battles.exports.forRegistry,battles.exports.current,battles.exports.status],base:(r,c)=>{const battle=r.query(battles.exports.forRegistry,c.event.application.registry);return battle!==null&&r.query(battles.exports.status,battle).actor===c.owner&&r.query(powers.exports.find,{registry:c.event.application.registry,actor:c.event.application.actor,definition:basicPowers.exports.EnemyVulnerable})===c.event.entity;}}),effect:defineEffect<rules.ReactionContext<{entity:number;application:PowerApplication}>,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.input.event.application.registry),actor:b.read(v=>v.input.event.application.actor),definition:basicPowers.exports.EnemyWeak,amount,source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.input.event.application.scope)}))}),`自身战斗中的敌人获得易伤时，再对该敌人施加${amount}虚弱。`);
  register('CHAMPION_BELT',[vulnerableWeak(1)]);
  return{exports:{definitions,Vigor,NextTurnBlock,texts:Object.freeze(texts),statusTexts:Object.freeze({VIGOR:relicPowers.exports.programs.Vigor.text,NEXT_TURN_BLOCK:relicPowers.exports.programs.NextTurnBlock.text}),programs:Object.freeze({Vigor:relicPowers.exports.programs.Vigor,NextTurnBlock:relicPowers.exports.programs.NextTurnBlock})}};
}});}
