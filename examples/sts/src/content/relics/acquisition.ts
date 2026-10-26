import {mapRelics} from './common/map.ts';
import {xCostRelics} from './common/x-cost.ts';
import { typedValue } from '../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {adventures,emptyAdventureRewards} from "../../rules/adventures.ts";
import {cardInstances} from "../../rules/card-instances.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {powers} from "../../rules/powers.ts";
import {basicPowers} from "../powers/attributes.ts";
import {resources} from "../../rules/resources.ts";
import {potions} from "../../rules/potions.ts";
import {random} from "../../rules/random.ts";
import {relics,type RelicDefinition,type RelicConfig} from "../../rules/relics.ts";
import {battles} from "../../rules/battles.ts";
import {turns} from "../../rules/turns.ts";
import {shops} from "../../rules/shops.ts";
import {resourceRelics} from "./common/resources.ts";
import {deckRelics} from "./common/decks.ts";
import {pileRelics} from "./common/piles.ts";
import {damageRelics} from "./common/damage.ts";
import {createRelicMechanics} from "./common/mechanics.ts";
import {createCombatRelics} from "./common/combat.ts";
import type {createCombatSelectionUtils} from "../cards/shared/selection-utils.ts";
import {startingRelics} from "../characters/ironclad/relics/burning-blood.ts";
import {adventureDraws} from "../rewards/draws.ts";
import {createPermanentSelections} from "../../program/permanent-selections.ts";
import {registerRelicAbilities} from "./hooks.ts";
import {relicId,type RelicId} from "../../identifiers.ts";
import * as pools from "../../pools.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {CardPreview,AdventureRewards,AdventureSelected,RelicTier} from "../../rules/adventures.types.ts";
type Acquire={run:number;entity:number};
type Spawn={run:number;shop:boolean};
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,whileDo,forEach,call,query,entityEffect,despawnEntity,definitionOf,on,modify,install}=rules;
export function createAdventureAcquisition(ui:rules.RuleModule<AdventureChoiceExports>,combatSelections:ReturnType<typeof createCombatSelectionUtils>){const selections=createPermanentSelections(ui),combatRelics=createCombatRelics(combatSelections),relicMechanics=createRelicMechanics(combatSelections);return defineRules({requires:[mapRelics,xCostRelics,ui,selections,resourceRelics,deckRelics,pileRelics,damageRelics,startingRelics,adventureDraws,shops,combatRelics,relicMechanics],build(m){
  const texts:Record<string,string>={...mapRelics.exports.texts,...xCostRelics.exports.texts,...resourceRelics.exports.texts,...deckRelics.exports.texts,...pileRelics.exports.texts,...damageRelics.exports.texts,...combatRelics.exports.texts,...relicMechanics.exports.texts};
  const descriptions=new WeakMap<object,string>();
  const described=<T extends object>(program:T,text:string):T=>{descriptions.set(program,text);return program;};
  const textOf=(program:object)=>{const text=descriptions.get(program);if(text===undefined)throw Error('Missing acquisition program description');return text;};
  const empty=defineEffect<rules.EntityLifecycle,void>(b=>b.return(undefined)),noAcquire=defineEffect<Acquire,void>(b=>b.return(undefined));
  const runOf=defineQuery({input:z.number(),output:z.number(),dependencies:[adventures.exports.forActor],base:(r,actor)=>{const run=r.query(adventures.exports.forActor,actor);if(run===null)throw Error('Relic acquisition requires an adventure');return run;}});
  const unported=described(registerRelicAbilities(on(battles.exports.started,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>b.return(b.read(v=>{throw Error('Relic combat program is not implemented: '+v.query(relics.exports.view,v.input.source).id);})))})),'当前未实现该遗物战斗能力；战斗开始时会抛出错误。');
  const extraRecharge=(amount:number)=>described(registerRelicAbilities(modify(turns.exports.rechargeAmount,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[turns.exports.actor],base:(r,c)=>r.query(turns.exports.actor,c.input).actor===c.owner}),transform:(_r,c)=>c.value+amount})),`自身每回合补充能量时额外获得${amount}能量。`);
  const energy=extraRecharge(1);
  const energyRelics=new Set<RelicId>(['ECTOPLASM','RUNIC_DOME','SOZU','VELVET_CHOKER','BUSTED_CROWN','COFFEE_DRIPPER','CURSED_KEY','FUSION_HAMMER','MARK_OF_PAIN','PHILOSOPHERS_STONE']);
  const acquireOnly=new Set<RelicId>(['ASTROLABE','PANDORAS_BOX','EMPTY_CAGE','CALLING_BELL','TINY_HOUSE','CAULDRON','WHETSTONE','WAR_PAINT','MANGO','PEAR','STRAWBERRY','LEES_WAFFLE','POTION_BELT','BOTTLED_FLAME','BOTTLED_LIGHTNING','BOTTLED_TORNADO']);
  const known:Partial<Record<RelicId,RelicDefinition>>={CHEMICAL_X:xCostRelics.exports.ChemicalX,BURNING_BLOOD:startingRelics.exports.BurningBlood,MAGIC_FLOWER:resourceRelics.exports.MagicFlower,MARK_OF_THE_BLOOM:resourceRelics.exports.MarkOfTheBloom,ECTOPLASM:resourceRelics.exports.Ectoplasm,BLOODY_IDOL:resourceRelics.exports.BloodyIdol,TUNGSTEN_ROD:resourceRelics.exports.TungstenRod,MOLTEN_EGG:deckRelics.exports.MoltenEgg,TOXIC_EGG:deckRelics.exports.ToxicEgg,FROZEN_EGG:deckRelics.exports.FrozenEgg,OMAMORI:deckRelics.exports.Omamori,CERAMIC_FISH:deckRelics.exports.CeramicFish,DARKSTONE_PERIAPT:deckRelics.exports.DarkstonePeriapt,WING_BOOTS:mapRelics.exports.WingBoots,THE_ABACUS:pileRelics.exports.TheAbacus,SUNDIAL:pileRelics.exports.Sundial,TORII:damageRelics.exports.Torii,THE_BOOT:damageRelics.exports.TheBoot};
  Object.assign(known,combatRelics.exports.definitions,relicMechanics.exports.definitions);
  // These identities are consumed by acquisition, adventure, potion or merchant
  // policies rather than installing a combat hook on the relic entity.
  // PRISMATIC_SHARD is intentionally obtainable through normal draws and direct
  // acquisition; only its cross-color card reward effect is disabled by product policy.
  for(const id of ['MEAL_TICKET','REGAL_PILLOW','SMILING_MASK','TOY_ORNITHOPTER','JUZU_BRACELET','DREAM_CATCHER','SINGING_BOWL','THE_COURIER','QUESTION_CARD','WHITE_BEAST_STATUE','OLD_COIN','SHOVEL','PRAYER_WHEEL','PEACE_PIPE','BLACK_STAR','SACRED_BARK','ORRERY','DOLLYS_MIRROR','PRISMATIC_SHARD','FROZEN_EYE','MEMBERSHIP_CARD','GOLDEN_IDOL','SPIRIT_POOP','CULTIST_HEADPIECE','NLOTHS_GIFT','CIRCLET','RED_CIRCLET'] as const)known[id]=defineEntity(relics.exports.kind,{id,install:empty});
  function restDeckHealing(cardsPerGroup:number,amount:number){
  known.ETERNAL_FEATHER=defineEntity(relics.exports.kind,{id:'ETERNAL_FEATHER',install:registerRelicAbilities(on(adventures.exports.entered,{condition:defineQuery({input:typedValue<rules.ReactionContext<{run:number;actor:number;room:string}>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner&&c.event.room==='REST'}),effect:defineEffect<rules.ReactionContext<{run:number;actor:number;room:string}>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.trunc(v.query(permanentDecks.exports.current,v.query(adventures.exports.bindings,v.input.event.run).deck).cards.length/cardsPerGroup)*amount)}))}))});
  texts.ETERNAL_FEATHER=`进入休息处时，永久牌组每满${cardsPerGroup}张牌回复${amount}生命。`;
  }
  restDeckHealing(5,3);
  function eventGold(amount:number){
  known.SSSERPENT_HEAD=defineEntity(relics.exports.kind,{id:'SSSERPENT_HEAD',install:registerRelicAbilities(on(adventures.exports.entered,{condition:defineQuery({input:typedValue<rules.ReactionContext<{run:number;actor:number;room:string}>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner&&c.event.room==='EVENT'}),effect:defineEffect<rules.ReactionContext<unknown>,void>(b=>call(resources.exports.gainGold,{entity:b.read(v=>v.input.owner),amount}))}))});
  texts.SSSERPENT_HEAD=`进入事件房间时，自身获得${amount}金币。`;
  }
  eventGold(50);
  function counter(value:number){const data=rules.defineComponent({schema:z.int32(),initial:()=>value});const contribution=modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[data],transform:(r,c)=>r.component(c.source,data)});return{data,contribution,initial:value};}
  const bank=counter(1),girya=counter(0),tinyChest=counter(0),matryoshka=counter(0),hungryFace=counter(1);
  function limitedEnemyHealth(battlesCount:number,health:number){
  const lament=counter(battlesCount);
  const lamentStart=on(battles.exports.started,{order:battles.exports.stages.relic,condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),reads:[lament.data],dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner&&r.component(c.source,lament.data)>0}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>forEach(b.read(v=>v.query(battles.exports.status,v.input.event).enemies),entity=>call(resources.exports.limitHp,{entity,amount:health})))});
  const lamentExit=on(battles.exports.exiting,{condition:defineQuery({input:typedValue<rules.ReactionContext<{battle:number;actor:number;outcome:1|2}>>(),output:z.boolean(),reads:[lament.data],base:(r,c)=>c.event.actor===c.owner&&r.component(c.source,lament.data)>0}),effect:defineEffect<rules.ReactionContext<unknown>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),lament.data,n=>n-1))});
  known.NEOWS_LAMENT=defineEntity(relics.exports.kind,{id:'NEOWS_LAMENT',install:registerRelicAbilities(lament.contribution,lamentStart,lamentExit)},{components:[lament.data]});
  texts.NEOWS_LAMENT=`前${battlesCount}场战斗开战时，将全体敌人的当前生命限制为最多${health}。离开战斗后消耗1次。`;
  }
  limitedEnemyHealth(3,1);
  function bankProgram(amount:number){
  const bankEnter=on(adventures.exports.entered,{condition:defineQuery({input:typedValue<rules.ReactionContext<{run:number;actor:number;room:unknown}>>(),output:z.boolean(),reads:[bank.data],base:(r,c)=>c.event.actor===c.owner&&r.component(c.source,bank.data)!==0}),effect:defineEffect<rules.ReactionContext<unknown>,void>(b=>call(resources.exports.gainGold,{entity:b.read(v=>v.input.owner),amount}))});
  const bankSpend=on(shops.exports.spent,{condition:defineQuery({input:typedValue<rules.ReactionContext<{run:number;amount:number}>>(),output:z.boolean(),dependencies:[adventures.exports.current,adventures.exports.bindings],base:(r,c)=>r.query(adventures.exports.bindings,c.event.run).actor===c.owner}),effect:defineEffect<rules.ReactionContext<unknown>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),bank.data,0))});
  known.MAW_BANK=defineEntity(relics.exports.kind,{id:'MAW_BANK',install:registerRelicAbilities(bank.contribution,bankEnter,bankSpend)},{components:[bank.data]});
  texts.MAW_BANK=`每进入1个房间获得${amount}金币；在商店消费后永久停用。`;
  }
  bankProgram(12);
  const counterInteraction=(component:rules.Component<number>,change:(n:number)=>number)=>defineEffect<{entity:number;actor:number},void>(b=>rules.updateLocalComponent(b.read(v=>v.input.entity),component,change));
  function giryaProgram(maximum:number,increment:number){
  known.GIRYA=defineEntity(relics.exports.kind,{id:'GIRYA',install:registerRelicAbilities(girya.contribution,on(battles.exports.started,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.event).actor===c.owner}),order:battles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.event).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:rules.readComponent(b.read(v=>v.input.source),girya.data),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.event).scope)}))})),interact:counterInteraction(girya.data,n=>Math.min(maximum,n+increment))},{components:[girya.data]});
  return{maximum,increment,text:`每次举重增加${increment}点记录，最多${maximum}点；每场战斗开始获得记录值对应的力量。`};
  }
  const giryaProgramValue=giryaProgram(3,1);
  function chestProgram(period:number){
  known.TINY_CHEST=defineEntity(relics.exports.kind,{id:'TINY_CHEST',install:registerRelicAbilities(tinyChest.contribution),interact:counterInteraction(tinyChest.data,n=>(n+1)%period)},{components:[tinyChest.data]});
  return{period,triggerAt:period-1};
  }
  const tinyChestProgram=chestProgram(4);
  known.MATRYOSHKA=defineEntity(relics.exports.kind,{id:'MATRYOSHKA',install:registerRelicAbilities(matryoshka.contribution),interact:counterInteraction(matryoshka.data,n=>Math.max(0,n-1))},{components:[matryoshka.data]});
  known.NLOTHS_HUNGRY_FACE=defineEntity(relics.exports.kind,{id:'NLOTHS_HUNGRY_FACE',install:registerRelicAbilities(hungryFace.contribution),interact:counterInteraction(hungryFace.data,n=>Math.max(0,n-1))},{components:[hungryFace.data]});
  const counterPrograms=Object.freeze({GIRYA:giryaProgramValue,TINY_CHEST:tinyChestProgram,MATRYOSHKA:{initial:matryoshka.initial},NLOTHS_HUNGRY_FACE:{initial:hungryFace.initial}});
  for(const id of ['SPIRIT_POOP','CULTIST_HEADPIECE','CIRCLET','RED_CIRCLET'] as const)texts[id]='当前实现不提供额外效果。';
  texts.PRISMATIC_SHARD='可正常生成、购买和获取；当前实现禁用跨颜色卡牌奖励效果。';
  const definitions=(Object.keys(relicId) as RelicId[]).filter(id=>id!=='INVALID').map(id=>({id,definition:known[id]??defineEntity(relics.exports.kind,{id,install:energyRelics.has(id)?energy:acquireOnly.has(id)?empty:unported})}));
  for(const {id} of definitions)if(!known[id]){if(energyRelics.has(id))texts[id]=textOf(energy);else if(!acquireOnly.has(id))texts[id]=textOf(unported);}
  const owns=defineQuery({input:z.object({run:z.number(),id:typedValue<RelicId>()}),output:z.boolean(),dependencies:[adventures.exports.hasRelic],base:(r,i)=>r.query(adventures.exports.hasRelic,i)});
  const spawnPolicies:Partial<Record<string,rules.Query<Spawn,boolean>>>={};
  const always=defineQuery({input:typedValue<Spawn>(),output:z.boolean(),base:()=>true});
  const below=(floor:number,shop=true)=>defineQuery({input:typedValue<Spawn>(),output:z.boolean(),dependencies:[adventures.exports.current,adventures.exports.position],base:(r,i)=>r.query(adventures.exports.position,i.run).floor<=floor&&(shop||!i.shop)});
  for(const id of ['TINY_CHEST'] as const)spawnPolicies[id]=below(35);for(const id of ['WING_BOOTS','MATRYOSHKA'] as const)spawnPolicies[id]=below(40);
  for(const id of ['MAW_BANK','OLD_COIN','SMILING_MASK'] as const)spawnPolicies[id]=below(48,false);
  for(const id of ['ANCIENT_TEA_SET','CERAMIC_FISH','DARKSTONE_PERIAPT','DREAM_CATCHER','FROZEN_EGG','JUZU_BRACELET','MEAL_TICKET','MEAT_ON_THE_BONE','MOLTEN_EGG','OMAMORI','POTION_BELT','PRAYER_WHEEL','QUESTION_CARD','REGAL_PILLOW','SINGING_BOWL','THE_COURIER','TOXIC_EGG'] as const)spawnPolicies[id]=below(48);
  spawnPolicies.PRESERVED_INSECT=below(52);
  for(const id of ['GIRYA','PEACE_PIPE','SHOVEL'] as const)spawnPolicies[id]=defineQuery({input:typedValue<Spawn>(),output:z.boolean(),dependencies:[adventures.exports.current,owns,adventures.exports.position],base:(r,i)=>r.query(adventures.exports.position,i.run).floor<48&&(['GIRYA','PEACE_PIPE','SHOVEL'] as const).filter(id=>r.query(owns,{run:i.run,id})).length<2});
  for(const [id,required] of [['BLACK_BLOOD','BURNING_BLOOD'],['BURNING_BLOOD','BURNING_BLOOD'],['FROZEN_CORE','CRACKED_CORE'],['RING_OF_THE_SERPENT','RING_OF_THE_SNAKE'],['HOLY_WATER','PURE_WATER']] as const)spawnPolicies[id]=defineQuery({input:typedValue<Spawn>(),output:z.boolean(),dependencies:[owns],base:(r,i)=>r.query(owns,{run:i.run,id:required})});
  for(const [id,type] of [['BOTTLED_FLAME',0],['BOTTLED_LIGHTNING',1],['BOTTLED_TORNADO',2]] as const)spawnPolicies[id]=defineQuery({input:typedValue<Spawn>(),output:z.boolean(),dependencies:[adventures.exports.current,permanentDecks.exports.current,cardInstances.exports.metadata,adventures.exports.bindings],base:(r,i)=>r.query(permanentDecks.exports.current,r.query(adventures.exports.bindings,i.run).deck).cards.some(card=>{const m=r.query(cardInstances.exports.metadata,card);return m.type===type&&(type===2||m.rarity!==3);})});
  const spawnSelection={kind:relics.exports.kind,select:(c:rules.Borrowed<RelicConfig>)=>spawnPolicies[c.id]??always};
  const spawnable=defineQuery({input:typedValue<{run:number;definition:RelicDefinition;shop:boolean}>(),output:z.boolean(),selections:[spawnSelection],dependencies:[adventures.exports.bindings,relics.exports.canObtain],base:(r,i)=>r.query(relics.exports.canObtain,{actor:r.query(adventures.exports.bindings,i.run).actor,definition:i.definition})&&r.selectedDefinition(spawnSelection,i.definition,{run:i.run,shop:i.shop})});
  const screenAllowed=defineQuery({input:typedValue<{run:number;definition:RelicDefinition;screenless:boolean}>(),output:z.boolean(),dependencies:[adventures.exports.relic,relics.exports.sameDefinition],base:(r,i)=>!i.screenless||!(['BOTTLED_FLAME','BOTTLED_LIGHTNING','BOTTLED_TORNADO','WHETSTONE'] as const).some(id=>r.query(relics.exports.sameDefinition,[r.query(adventures.exports.relic,{run:i.run,id}),i.definition]))});
  const draw=defineEffect<{run:number;tier:RelicTier;shop:boolean;front:boolean;screenless:boolean;publication?:string},RelicDefinition>(b=>{const picked=b.local<RelicDefinition>(),front=b.local<boolean>(),tier=b.local<RelicTier>();return sequence(
    b.assign(front,b.read(v=>v.input.front)),b.assign(tier,b.read(v=>v.input.tier)),whileDo(true,sequence(
      whileDo(b.read(v=>v.query(adventures.exports.pools,v.input.run).relicPools[v.get(tier)].length===0),sequence(
        when(b.read(v=>v.get(tier)==='rare'||v.get(tier)==='boss'),sequence(when(b.read(v=>v.input.publication!==undefined),call(random.exports.declare,{name:b.read(v=>v.input.publication!),value:b.read(v=>v.get(tier)==='boss'?'RED_CIRCLET':'CIRCLET')})),b.return(query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:b.read(v=>v.get(tier)==='boss'?'RED_CIRCLET':'CIRCLET')})))),
        b.assign(tier,b.read(v=>v.get(tier)==='common'||v.get(tier)==='shop'?'uncommon':'rare')),
      )),
      b.assign(picked,call(adventures.exports.takeRelic,b.read(v=>({run:v.input.run,tier:v.get(tier),front:v.get(front),...(v.input.publication?{publication:{name:v.input.publication,accepted:v.query(adventures.exports.pools,v.input.run).relicPools[v.get(tier)].filter(definition=>v.query(spawnable,{run:v.input.run,definition,shop:v.input.shop})&&v.query(screenAllowed,{run:v.input.run,definition,screenless:v.input.screenless})).map(definition=>v.query(relics.exports.definitionId,definition))}}:{})})))),
      when(query(spawnable,{run:b.read(v=>v.input.run),definition:picked,shop:b.read(v=>v.input.shop)}),
        when(query(screenAllowed,{run:b.read(v=>v.input.run),definition:picked,screenless:b.read(v=>v.input.screenless)}),b.return(picked),b.assign(front,b.read(v=>v.input.front))),
        b.assign(front,false),
      ),
    )),
  );});
  const acquisitions:Partial<Record<string,rules.Effect<Acquire,void>>>={};
  const screenPolicies:Partial<Record<string,rules.Query<Acquire,boolean>>>={};
  const noScreen=defineQuery({input:typedValue<Acquire>(),output:z.boolean(),base:()=>false}),hasScreen=defineQuery({input:typedValue<Acquire>(),output:z.boolean(),base:()=>true});
  const screenSelection={kind:relics.exports.kind,select:(config:rules.Borrowed<RelicConfig>)=>screenPolicies[config.id]??noScreen};
  const opensScreen=defineQuery({input:typedValue<Acquire>(),output:z.boolean(),selections:[screenSelection],base:(r,input)=>r.selected(screenSelection,input.entity,input)});
  for(const id of ['EMPTY_CAGE','CAULDRON','CALLING_BELL','TINY_HOUSE','ORRERY'])screenPolicies[id]=hasScreen;
  screenPolicies.DOLLYS_MIRROR=defineQuery({input:typedValue<Acquire>(),output:z.boolean(),dependencies:[adventures.exports.bindings,permanentDecks.exports.current],base:(r,i)=>r.query(permanentDecks.exports.current,r.query(adventures.exports.bindings,i.run).deck).cards.length>0});
  screenPolicies.ASTROLABE=defineQuery({input:typedValue<Acquire>(),output:z.boolean(),dependencies:[adventures.exports.current,permanentDecks.exports.current,cardInstances.exports.canTransform,adventures.exports.bindings],base:(r,input)=>r.query(permanentDecks.exports.current,r.query(adventures.exports.bindings,input.run).deck).cards.some(card=>r.query(cardInstances.exports.canTransform,card))});
  for(const [id,type] of [['BOTTLED_FLAME',0],['BOTTLED_LIGHTNING',1],['BOTTLED_TORNADO',2]] as const)screenPolicies[id]=defineQuery({input:typedValue<Acquire>(),output:z.boolean(),dependencies:[adventures.exports.current,permanentDecks.exports.current,cardInstances.exports.metadata,adventures.exports.bindings],base:(r,input)=>r.query(permanentDecks.exports.current,r.query(adventures.exports.bindings,input.run).deck).cards.some(card=>r.query(cardInstances.exports.metadata,card).type===type)});
  const give=defineEffect<{run:number;definition:RelicDefinition},boolean>(b=>{const made=b.local<number|null>(),opened=b.local<boolean>();return sequence(
    b.assign(made,call(relics.exports.obtain,{actor:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),definition:b.read(v=>v.input.definition),scope:b.read(v=>v.query(adventures.exports.bindings,v.input.run).scope)})),when(b.read(v=>v.get(made)===null),b.return(false)),
    b.assign(opened,query(opensScreen,{run:b.read(v=>v.input.run),entity:b.read(v=>v.get(made)!)})),call(entityEffect(relics.exports.kind,b.read(v=>v.get(made)!),c=>acquisitions[c.id]??noAcquire),{run:b.read(v=>v.input.run),entity:b.read(v=>v.get(made)!)}),b.return(opened),
  );});
  const claimSetup=z.object({run:z.number(),index:z.int32().nonnegative()});
  const claimState=rules.defineComponent({schema:claimSetup.extend({done:z.boolean()}).nullable(),initial:()=>null});
  const currentClaim=defineQuery({input:z.number(),output:claimSetup.extend({done:z.boolean()}),reads:[claimState],base:(r,id)=>{const state=r.component(id,claimState);if(state===null)throw Error('Uninitialized reward receipt');return state;}});
  const settleClaimOwned=defineEffect<number,void>(b=>{const pending=b.local<z.infer<typeof claimSetup>&{done:boolean}>();return sequence(
    b.assign(pending,query(currentClaim,b.input)),when(b.read(v=>v.get(pending).done),b.return(undefined)),
    when(b.read(v=>v.get(pending).index===v.query(adventures.exports.rewards,v.get(pending).run).rewards.relics.length-1),call(adventures.exports.setRewards,{run:b.read(v=>v.get(pending).run),rewards:b.read(v=>({...v.query(adventures.exports.rewards,v.get(pending).run).rewards,sapphireKey:false}))})),
    call(adventures.exports.removeReward,{run:b.read(v=>v.get(pending).run),kind:'relics',index:b.read(v=>v.get(pending).index)}),
    rules.updateLocalComponent(b.input,claimState,b.read(v=>({...v.get(pending),done:true}))),
  );});
  const settleClaim:rules.Effect<number,void>=defineEffect<number,void>(b=>call(entityEffect(claimKind,b.input,()=>settleClaimOwned),b.input));
  const settleBeforeChoice=on(adventures.exports.requesting,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[currentClaim],base:(r,c)=>c.event===c.owner&&!r.query(currentClaim,c.source).done}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(settleClaim,b.read(v=>v.input.source)))});
  const claimKind:rules.EntityKind<undefined,z.infer<typeof claimSetup>>=m.kind({config:z.undefined(),setup:claimSetup,components:[],initialize:defineEffect<rules.EntityLifecycle<z.infer<typeof claimSetup>>,void>(b=>sequence(rules.updateLocalComponent(b.read(v=>v.input.entity),claimState,b.read(v=>({...v.input.setup,done:false}))),install({ability:settleBeforeChoice,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.run),environment:{},lifetime:b.read(v=>v.input.scope)})))});
  const claimDefinition=defineEntity(claimKind,undefined,{components:[claimState]});
  const claimKey=defineEffect<number,void>(b=>sequence(
    call(adventures.exports.setKeys,b.read(v=>{const s=v.query(adventures.exports.rewardScene,v.input);return{run:v.input,keys:{...s.keys,...(s.rewards.sapphireKey?{blue:true}:{green:true})}};})),
    call(adventures.exports.setRewards,b.read(v=>{const r=v.query(adventures.exports.rewards,v.input).rewards;return{run:v.input,rewards:r.sapphireKey?{...r,sapphireKey:false,relics:r.relics.slice(0,-1)}:{...r,emeraldKey:false}};})),
  ));
  const bowlMaxHp=2;
  texts.SINGING_BOWL=`放弃1组卡牌奖励时，可改为最大生命增加${bowlMaxHp}并回复${bowlMaxHp}生命。`;
  const rewards=defineEffect<number,void>(b=>{const bits=b.local<number>(),type=b.local<number>(),index=b.local<number>(),index2=b.local<number>(),item=b.local<CardPreview>(),receipt=b.local<number>(),selectedRelic=b.local<RelicDefinition>(),opened=b.local<boolean>(),potionTaken=b.local<boolean>();return whileDo(true,sequence(
    b.assign(bits,call(ui.exports.choose,{run:b.input,actions:b.read(v=>{const r=v.query(adventures.exports.rewards,v.input).rewards,out:number[]=[];r.gold.forEach((_,i)=>out.push((1<<27)|i));r.cards.forEach((cs,i)=>cs.forEach((_,j)=>out.push((j<<8)|i)));r.relics.forEach((_,i)=>out.push((4<<27)|i));if(r.emeraldKey||r.sapphireKey)out.push(2<<27);r.potions.forEach((_,i)=>out.push((3<<27)|i));out.push(6<<27);r.cards.forEach((_,i)=>out.push((5<<8)|i));return out;})})),b.assign(type,b.read(v=>(v.get(bits)>>>27)&7)),b.assign(index,b.read(v=>v.get(bits)&255)),b.assign(index2,b.read(v=>(v.get(bits)>>>8)&255)),when(b.read(v=>v.get(type)===6),b.return(undefined)),
    when(b.read(v=>v.get(type)===0),sequence(when(b.read(v=>v.get(index2)===5),when(query(adventures.exports.hasRelic,{run:b.input,id:'SINGING_BOWL'}),call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:bowlMaxHp})),sequence(b.assign(item,b.read(v=>v.query(adventures.exports.rewards,v.input).rewards.cards[v.get(index)]![v.get(index2)]!)),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input).deck),definition:b.read(v=>v.get(item).definition),count:1,upgraded:b.read(v=>v.get(item).upgraded),specialData:b.read(v=>v.get(item).misc),upgrade:false}))),call(adventures.exports.removeReward,{run:b.input,kind:'cards',index})),
      when(b.read(v=>v.get(type)===1),sequence(call(resources.exports.gainGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:b.read(v=>v.query(adventures.exports.rewards,v.input).rewards.gold[v.get(index)]!)}),call(adventures.exports.removeReward,{run:b.input,kind:'gold',index})),
        when(b.read(v=>v.get(type)===3),sequence(b.assign(potionTaken,call(potions.exports.obtain,{inventory:b.read(v=>v.query(adventures.exports.bindings,v.input).potions),potion:b.read(v=>v.query(adventures.exports.rewards,v.input).rewards.potions[v.get(index)]!)})),when(b.read(v=>v.get(potionTaken)),call(adventures.exports.removeReward,{run:b.input,kind:'potions',index}))),
          when(b.read(v=>v.get(type)===4),sequence(b.assign(selectedRelic,b.read(v=>v.query(adventures.exports.rewards,v.input).rewards.relics[v.get(index)]!)),b.assign(receipt,rules.spawnEntity({definition:claimDefinition,owner:b.input,scope:b.read(v=>v.query(adventures.exports.bindings,v.input).scope),setup:{run:b.input,index}})),call(settleClaim,receipt),b.assign(opened,call(give,{run:b.input,definition:selectedRelic})),despawnEntity({entity:receipt,reason:{rewardClaimed:true}}),when(opened,when(b.read(v=>v.query(adventures.exports.position,v.input).screen==='CARD_SELECT'),call(adventures.exports.setScene,{run:b.input,screen:'REWARDS',continuation:true}),b.return(undefined)))),when(b.read(v=>v.get(type)===2),call(claimKey,b.input),b.return(b.read(()=>{throw Error('Invalid reward action');})))))),
    ),
  ));});
  function openingSelection(type:number,count:number){return described(defineEffect<Acquire,void>(b=>call(selections.exports.select,{run:b.read(v=>v.input.run),type,count,provided:null,stream:b.read(v=>v.query(adventures.exports.selection,v.input.run).selection.transformStream)})),selections.exports.describe(type,count));}
  acquisitions.EMPTY_CAGE=openingSelection(4,2);
  const mirrorSelection=openingSelection(5,1);
  acquisitions.DOLLYS_MIRROR=described(defineEffect<Acquire,void>(b=>when(query(opensScreen,b.input),call(mirrorSelection,b.input))),`若牌组非空，${textOf(mirrorSelection)}`);
  const acquireGold=(amount:number)=>described(defineEffect<Acquire,void>(b=>call(resources.exports.gainGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount})),`获得${amount}金币`);
  acquisitions.OLD_COIN=acquireGold(300);
  const cardRewards=(count:number)=>described(defineEffect<Acquire,void>(b=>{const reward=b.local<AdventureRewards>(),cards=b.local<CardPreview[]>();return sequence(b.assign(reward,b.read(v=>v.query(adventures.exports.position,v.input.run).screen==='REWARDS'?v.query(adventures.exports.rewards,v.input.run).rewards:emptyAdventureRewards())),forEach(Array.from({length:count},(_,i)=>i),()=>sequence(b.assign(cards,call(adventureDraws.exports.reward,{publish:true,run:b.read(v=>v.input.run),room:b.read(v=>v.query(adventures.exports.position,v.input.run).room)})),b.assign(reward,b.read(v=>({...v.get(reward),cards:[...v.get(reward).cards,v.get(cards)]}))))),call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:reward}),call(rewards,b.read(v=>v.input.run)));}),`获得${count}组卡牌奖励`);
  acquisitions.ORRERY=cardRewards(5);
  const transformUpgrade=(maximum:number)=>described(defineEffect<Acquire,void>(b=>{const provided=b.local<AdventureSelected[]>();return sequence(b.assign(provided,b.read(v=>{const s=v.query(adventures.exports.bindings,v.input.run);return v.query(permanentDecks.exports.current,s.deck).cards.flatMap((card,deckIndex)=>{if(!v.query(cardInstances.exports.canTransform,card))return[];const c=v.query(cardInstances.exports.current,card);return[{card:{definition:v.get(definitionOf(cardInstances.exports.kind,card)),upgraded:c.upgraded,misc:c.specialData},deckIndex}];});})),when(b.read(v=>v.get(provided).length>0),call(selections.exports.select,{run:b.read(v=>v.input.run),type:2,count:b.read(v=>Math.min(maximum,v.get(provided).length)),provided,stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.misc)})));}),selections.exports.describe(2,maximum)+'（不足时按可变化牌数量选择）');
  acquisitions.ASTROLABE=transformUpgrade(3);
  for(const [id,type] of [['BOTTLED_FLAME',0],['BOTTLED_LIGHTNING',1],['BOTTLED_TORNADO',2]] as const)acquisitions[id]=described(defineEffect<Acquire,void>(b=>{const provided=b.local<AdventureSelected[]>();return sequence(b.assign(provided,b.read(v=>{const s=v.query(adventures.exports.bindings,v.input.run);return v.query(permanentDecks.exports.current,s.deck).cards.flatMap((card,deckIndex)=>{if(v.query(cardInstances.exports.metadata,card).type!==type)return[];const c=v.query(cardInstances.exports.current,card);return[{card:{definition:v.get(definitionOf(cardInstances.exports.kind,card)),upgraded:c.upgraded,misc:c.specialData},deckIndex}];});})),when(b.read(v=>v.get(provided).length>0),call(selections.exports.select,{run:b.read(v=>v.input.run),type:7,count:1,provided,stream:b.read(v=>v.query(adventures.exports.selection,v.input.run).selection.transformStream)})));}),`从牌组中的${['攻击','技能','能力'][type]}牌中，${selections.exports.describe(7,1)}`);
  acquisitions.BLACK_BLOOD=described(defineEffect<Acquire,void>(b=>{const found=b.local<number|null>();return sequence(b.assign(found,query(relics.exports.find,{actor:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),definition:query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:'BURNING_BLOOD'})})),when(b.read(v=>v.get(found)!==null),despawnEntity({entity:b.read(v=>v.get(found)!),reason:{replaced:true}})));}),'移除自身燃烧之血');
  const raiseMaxHp=(amount:number)=>described(defineEffect<Acquire,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount})),`最大生命增加${amount}并回复${amount}生命`);
  for(const [id,amount] of [['MANGO',14],['PEAR',10],['STRAWBERRY',7]] as const)acquisitions[id]=raiseMaxHp(amount);
  const healFull=described(defineEffect<Acquire,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount:b.read(v=>v.query(resources.exports.vitality,v.query(adventures.exports.bindings,v.input.run).actor).maxHp)})),'回复至满生命');
  const combine=(...effects:rules.Effect<Acquire,void>[])=>described(defineEffect<Acquire,void>(b=>sequence(...effects.map(effect=>call(effect,b.input)))),effects.map(textOf).join('，'));
  acquisitions.LEES_WAFFLE=combine(raiseMaxHp(7),healFull);
  const potionSlots=(amount:number)=>described(defineEffect<Acquire,void>(b=>call(potions.exports.expand,{inventory:b.read(v=>v.query(adventures.exports.bindings,v.input.run).potions),amount})),`增加${amount}个药水栏位`);
  acquisitions.POTION_BELT=potionSlots(2);
  acquisitions.PANDORAS_BOX=described(defineEffect<Acquire,void>(b=>{const count=b.local<number>(),drawn=b.local<CardPreview[]>(),roll=b.local<number>();return sequence(b.assign(count,0),forEach(b.read(v=>[...v.query(permanentDecks.exports.current,v.query(adventures.exports.bindings,v.input.run).deck).cards].reverse()),card=>when(b.read(v=>{const id=v.query(cardInstances.exports.permanentView,v.get(card)).id;return v.query(adventures.exports.cardPools,v.input.run).startingBasics.includes(id);}),sequence(call(permanentDecks.exports.remove,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input.run).deck),card}),b.assign(count,b.read(v=>v.get(count)+1))))),b.assign(drawn,[]),forEach(b.read(v=>Array.from({length:v.get(count)},(_,i)=>i)),()=>sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.cardRandom),start:0,end:b.read(v=>v.query(adventures.exports.cardPools,v.input.run).random.length-1)})),b.assign(drawn,b.read(v=>[...v.get(drawn),{definition:v.query(adventures.exports.card,{run:v.input.run,id:v.query(adventures.exports.cardPools,v.input.run).random[v.get(roll)]!}),upgraded:false,misc:0}])))),forEach(b.read(v=>[...v.get(drawn)].reverse()),card=>call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input.run).deck),definition:b.read(v=>v.get(card).definition),count:1,upgraded:false,specialData:0,upgrade:false})));}),'移除牌组中所有本角色初始基础牌，替换为等量随机未升级角色牌');
  const upgradeRandom=(type:0|1,count:number)=>described(defineEffect<Acquire,void>(b=>{const order=b.local<readonly number[]>();return sequence(b.assign(order,random.exports.shuffle({stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.misc),items:b.read(v=>v.query(permanentDecks.exports.current,v.query(adventures.exports.bindings,v.input.run).deck).cards.filter(card=>v.query(cardInstances.exports.metadata,card).type===type&&v.query(cardInstances.exports.canUpgrade,card)))})),forEach(b.read(v=>v.get(order).slice(0,count)),card=>call(permanentDecks.exports.upgrade,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input.run).deck),card})));}),`随机升级牌组中至多${count}张可升级${type===0?'攻击':'技能'}牌`);
  for(const [id,type] of [['WAR_PAINT',1],['WHETSTONE',0]] as const)acquisitions[id]=upgradeRandom(type,2);
  const potionRewards=(count:number)=>described(defineEffect<Acquire,void>(b=>{const reward=b.local<AdventureRewards>(),potion=b.local<number>();return sequence(b.assign(reward,emptyAdventureRewards()),forEach(Array.from({length:count},(_,i)=>i),()=>sequence(b.assign(potion,call(adventureDraws.exports.potion,b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.potion))),b.assign(reward,b.read(v=>({...v.get(reward),potions:[...v.get(reward).potions,v.get(potion)]}))))),call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:reward}),call(rewards,b.read(v=>v.input.run)));}),`获得${count}瓶随机药水奖励`);
  acquisitions.CAULDRON=potionRewards(5);
  const callingBell=(tiers:readonly RelicTier[])=>described(defineEffect<Acquire,void>(b=>{const reward=b.local<AdventureRewards>(),relic=b.local<RelicDefinition>();return sequence(call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input.run).deck),definition:query(adventures.exports.card,{run:b.read(v=>v.input.run),id:'CURSE_OF_THE_BELL'}),count:1,upgraded:false,specialData:0,upgrade:false}),b.assign(reward,emptyAdventureRewards()),forEach(tiers,tier=>sequence(b.assign(relic,call(draw,{run:b.read(v=>v.input.run),tier,shop:false,front:true,screenless:true})),b.assign(reward,b.read(v=>({...v.get(reward),relics:[...v.get(reward).relics,v.get(relic)]}))))),call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:reward}),call(rewards,b.read(v=>v.input.run)));}),`获得1张铃铛的诅咒和${tiers.map(tier=>({common:'普通',uncommon:'罕见',rare:'稀有',boss:'Boss',shop:'商店',starter:'初始',special:'特殊'}[tier]??tier)+'遗物各1件').join('、')}`);
  acquisitions.CALLING_BELL=callingBell(['common','uncommon','rare']);
  const tinyHouse=(maxHp:number,gold:number)=>described(defineEffect<Acquire,void>(b=>{const order=b.local<readonly number[]>(),potion=b.local<number>(),cards=b.local<CardPreview[]>();return sequence(b.assign(order,random.exports.shuffle({stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.misc),items:b.read(v=>v.query(permanentDecks.exports.current,v.query(adventures.exports.bindings,v.input.run).deck).cards.filter(card=>v.query(cardInstances.exports.canUpgrade,card))),counted:false})),when(b.read(v=>v.get(order).length>0),call(permanentDecks.exports.upgrade,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input.run).deck),card:b.read(v=>v.get(order)[0]!)})),call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),amount:maxHp}),b.assign(potion,call(adventureDraws.exports.potion,b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.misc))),b.assign(cards,call(adventureDraws.exports.reward,{publish:true,run:b.read(v=>v.input.run),room:b.read(v=>v.query(adventures.exports.position,v.input.run).room)})),call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:{gold:[gold],cards:[cards],potions:[potion],relics:[],emeraldKey:false,sapphireKey:false}}),call(rewards,b.read(v=>v.input.run)));}),`随机升级牌组中1张可升级牌，最大生命增加${maxHp}并回复${maxHp}生命，获得${gold}金币、1瓶随机药水及1组卡牌奖励`);
  acquisitions.TINY_HOUSE=tinyHouse(5,50);
  for(const [id,effect] of Object.entries(acquisitions))texts[id]=(texts[id]??'')+`获得时，${textOf(effect!)}。`;
  Object.freeze(acquisitions);Object.freeze(spawnPolicies);
  return{exports:{definitions,give,draw,rewards,selections,counterPrograms,texts:Object.freeze(texts),statusTexts:Object.freeze({...combatRelics.exports.statusTexts,...relicMechanics.exports.statusTexts}),programs:relicMechanics.exports.programs}};
}});}
