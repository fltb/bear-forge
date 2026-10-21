import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {resources} from '../src/rules/resources.ts';
import {powers} from '../src/rules/powers.ts';
import {battles} from '../src/rules/battles.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {random} from '../src/rules/random.ts';
import {relics} from '../src/rules/relics.ts';
import {combatScope} from '../src/rules/combat-actions.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
import type {PowerDefinition} from '../src/rules/powers.types.ts';
import type {CardConfig,CardSetup} from '../src/rules/card-instances.types.ts';
import {volibearBasicCards as basic,volibearCommonCards as common,volibearUncommonCards as uncommon,volibearRareCards as rare,volibearHearts,volibearPlayCounts} from '../src/content/characters/volibear/index.ts';
import {volibearGrowthCards as growth,volibearXCards as xCards,volibearLethalCards as lethal} from '../src/content/characters/volibear/index.ts';
import {volibearCopying} from '../src/content/characters/volibear/mechanics/copying.ts';
import {volibearNextAttack} from '../src/content/characters/volibear/mechanics/next-attack.ts';
import {volibearNextPlayDiscount} from '../src/content/characters/volibear/mechanics/next-play-discount.ts';
import {createVolibearSelectionCards} from '../src/content/characters/volibear/index.ts';
import {createCardChoices} from '../src/rules/card-choices.ts';
import type {CardChoicePlayer} from '../src/rules/card-choices.types.ts';
import {volibearEngagePreparation} from '../src/content/characters/volibear/mechanics/engage-preparation.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {card} from '../src/content/characters/volibear/cards/programs.ts';
import {registerCardAbilities} from '../src/content/cards/shared/lifecycle.ts';

const choiceRequestSchema=z.object({screen:z.number(),kind:z.enum(['one','many','order']),cards:z.array(z.string()),minimum:z.number(),maximum:z.number()});
const choiceReplySchema=z.object({indices:z.array(z.number().int().nonnegative())});
const choiceWire=rules.defineRules({requires:[cardInstances],build(){
  const publication=rules.defineQuery({input:z.custom<rules.ChoiceRequest<number,CardChoicePlayer>>(),output:choiceRequestSchema,dependencies:[cardInstances.exports.metadata],base:(r,i)=>({
    screen:i.player.screen,kind:i.kind,cards:i.candidates.map(id=>r.query(cardInstances.exports.metadata,id).name),minimum:i.min,maximum:i.max,
  })});
  return {exports:{adapter:ruleModules.choicePort({port:'decision',request:publication,reply:choiceReplySchema,decode:(_request,reply)=>({kind:'selected' as const,indices:reply.indices})})}};
}});
const choices=createCardChoices(choiceWire.exports.adapter,[choiceWire]);
// These are fixture presentation labels, not production dispatch identifiers.
const selections=createVolibearSelectionCards(choices,{discard:1,discardToTop:2,scry:3,retain:4,copy:5,recover:6,train:7});
// A declaration-only fixture checks the coupon contract; it does not implement
// B04 or claim to exercise an enemy action/optional-engage choice.
const engageProbe=card({
  ...volibearCardDescriptions.B04,id:'fixture/engage-declaration',
  metadata:{...volibearCardDescriptions.B04.metadata,name:'迎战声明探针',variants:[
    {...volibearCardDescriptions.B04.metadata.variants[0],cost:2},
    {...volibearCardDescriptions.B04.metadata.variants[1],cost:2},
  ]},
},rules.defineEffect<import('../src/rules/card-instances.types.ts').CardUse,void>(b=>b.return(undefined)),{
  created:registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),
});

type Definition=rules.EntityDefinition<CardConfig,CardSetup>;
type Scenario={plays:{definition:Definition;upgraded?:boolean;target?:number;reuse?:number;copyOf?:number;generated?:boolean;discounts?:number;attackBonus?:number}[];hp?:number;energy?:number;enemyHp?:readonly [number,number,number];block?:number;dexterity?:number;strength?:number;weak?:boolean;frail?:boolean;heart?:boolean;immortal?:boolean};
const actor=rules.defineEntity(resources.exports.actor,{side:0}),enemy=rules.defineEntity(resources.exports.actor,{side:1});
const registryDefinition=rules.defineEntity(powers.exports.registryKind,undefined),stream=rules.defineEntity(random.exports.stream,undefined),battleDefinition=rules.defineEntity(battles.exports.kind,undefined);
const resultSchema=z.object({hp:z.number(),block:z.number(),energy:z.number(),enemies:z.array(z.number()),hand:z.number()});

/** Fixtures construct explicit combat positions; they are not balance simulations
 * or a replacement for the production rules/queue. Both loaders run those rules.
 */
function fixture(s:Scenario){
  const entry=rules.defineEffect<void,z.infer<typeof resultSchema>>(b=>{
    const player=b.local<number>(),scope=b.local<number>(),registry=b.local<number>(),rng=b.local<number>(),battle=b.local<number>(),made=b.local<number>();
    const opponents=b.local<number[]>(),masters=b.local<number[]>(),selected=b.local<number>(),played=b.local<number[]>();
    const grant=(definition:PowerDefinition,amount:number)=>rules.call(powers.exports.apply,{registry,actor:player,definition,amount,source:player,debuff:false,scope});
    return rules.sequence(
      b.assign(scope,ruleModules.openScope(combatScope,0)),
      b.assign(player,rules.spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:s.hp??80,maxHp:80,energy:s.energy??30,block:s.block??0,gold:0}})),
      rules.call(volibearPlayCounts.exports.trackBattles,{actor:player,scope:0}),
      b.assign(opponents,[]),rules.forEach([0,1,2],at=>rules.sequence(
        b.assign(made,rules.spawnEntity({definition:enemy,owner:null,scope,setup:{hp:b.read(v=>s.enemyHp?.[v.get(at)]??1000),maxHp:1000,energy:0,block:0,gold:0}})),b.assign(opponents,b.read(v=>[...v.get(opponents),v.get(made)])),
      )),
      b.assign(registry,rules.spawnEntity({definition:registryDefinition,owner:player,scope})),
      b.assign(rng,rules.spawnEntity({definition:stream,owner:null,scope,setup:130n})),
      b.assign(masters,[]),
      ...s.plays.filter(p=>p.reuse===undefined&&p.copyOf===undefined&&!p.generated).map(p=>rules.sequence(
        b.assign(made,rules.spawnEntity({definition:p.definition,owner:player,scope:0,setup:{mode:0,master:null,uniqueId:-1,specialData:0,upgraded:p.upgraded??false}})),
        b.assign(masters,b.read(v=>[...v.get(masters),v.get(made)])),
      )),
      b.assign(battle,rules.spawnEntity({definition:battleDefinition,owner:player,scope,setup:{actor:player,registry,enemies:opponents,masters,bottled:[],shuffleRng:rng,cardRng:rng,drawPerTurn:5}})),
      ...(s.strength?[grant(basicPowers.exports.Strength,s.strength)]:[]),
      ...(s.dexterity?[grant(basicPowers.exports.Dexterity,s.dexterity)]:[]),
      ...(s.weak?[grant(basicPowers.exports.PlayerWeak,1)]:[]),
      ...(s.frail?[grant(basicPowers.exports.Frail,1)]:[]),
      ...(s.heart||s.immortal?[rules.call(relics.exports.obtain,{actor:player,definition:volibearHearts.exports.HuntersHeart,scope:0})]:[]),
      ...(s.immortal?[rules.call(relics.exports.obtain,{actor:player,definition:volibearHearts.exports.ImmortalHeart,scope:0})]:[]),
      rules.call(battles.exports.start,battle),
      rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.get(rules.query(battles.exports.current,v.get(battle))).piles),count:s.plays.filter(p=>p.reuse===undefined&&p.copyOf===undefined&&!p.generated).length}),
      b.assign(played,[]),
      ...s.plays.map(p=>rules.sequence(
        b.assign(selected,b.read(v=>{
          if(p.reuse!==undefined||p.copyOf!==undefined){
            const previous=v.get(played)[(p.reuse??p.copyOf)!];
            if(previous===undefined)throw Error('Fixture reuse must reference an earlier play');return previous;
          }
          const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
          const found=v.get(rules.query(zones.exports.members,piles.hand)).find(id=>v.get(rules.query(cardInstances.exports.matchesDefinition,{entity:id,definition:p.definition})));
          if(found===undefined)throw Error('Required fixture card is missing');return found;
        })),
        ...(p.copyOf===undefined?[]:[b.assign(selected,rules.call(volibearCopying.exports.copyToHand,{battle,source:selected}))]),
        // Explicit fixture retrieval preserves the identity of a combat card.
        // The next play still goes through normal legality, payment and queue.
        ...(p.reuse===undefined?[]:[rules.when(b.read(v=>{
          const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
          return v.get(rules.query(zones.exports.location,v.get(selected)))!==piles.hand;
        }),rules.call(cardPiles.exports.moveToHand,{
          piles:b.read(v=>v.get(rules.query(battles.exports.current,v.get(battle))).piles),card:selected,
        }))]),
        b.assign(played,b.read(v=>[...v.get(played),v.get(selected)])),
        ...(p.attackBonus===undefined?[]:[rules.call(volibearNextAttack.exports.prepare,{battle,card:selected,amount:p.attackBonus})]),
        ...Array.from({length:p.discounts??0},()=>rules.call(volibearNextPlayDiscount.exports.grant,{battle,card:selected})),
        rules.call(battles.exports.queueFromHand,{battle,card:selected,target:b.read(v=>v.get(opponents)[p.target??0]!)}),
        rules.call(battles.exports.settle,battle),
      )),
      b.return(b.read(v=>{
        const playerState=v.get(rules.query(resources.exports.current,v.get(player)));
        const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
        return {hp:playerState.hp,block:playerState.block,energy:playerState.energy,enemies:v.get(opponents).map(id=>v.get(rules.query(resources.exports.current,id)).hp),hand:v.get(rules.query(zones.exports.members,piles.hand)).length};
      })),
    );
  });
  return linkRules({id:'sts/volibear-content',schemas:{setup:z.undefined(),result:resultSchema,ports:{decision:{input:choiceRequestSchema,output:choiceReplySchema}}},initialize:()=>({}),entry,definitions:[entry],modules:[basic,common,uncommon,rare,growth,xCards,lethal,volibearHearts,basicPowers,volibearNextPlayDiscount,volibearCopying,volibearNextAttack,selections]});
}
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

const cases:{name:string;scenario:Scenario;block:number;enemies:number[];energy?:number;hp?:number;answers?:string[][];hand?:number}[]=[
  {name:'雷伤不吃力量与虚弱，群雷包含主目标',scenario:{strength:3,weak:true,plays:[{definition:common.exports.LightningClaw}]},block:0,enemies:[990,997,997]},
  {name:'霆爪先攻击后格挡，升级数值独立',scenario:{plays:[{definition:basic.exports.ThunderClaw,upgraded:true}]},block:6,enemies:[991,1000,1000]},
  {name:'厚重皮毛合并正力量、敏捷后统一吃脆弱',scenario:{strength:5,dexterity:2,frail:true,plays:[{definition:common.exports.ThickFur}]},block:11,enemies:[1000,1000,1000]},
  {name:'厚重皮毛不把负力量扣入基础格挡',scenario:{strength:-5,plays:[{definition:common.exports.ThickFur}]},block:8,enemies:[1000,1000,1000]},
  {name:'雷震为两批雷击，三名敌人不把余威变为六次',scenario:{plays:[{definition:uncommon.exports.ThunderAftershock},{definition:common.exports.ThunderShock}]},block:4,enemies:[986,986,986]},
  {name:'猎心允许第二张为原生群攻，遗物格挡不吃敏捷',scenario:{heart:true,dexterity:3,plays:[{definition:basic.exports.ThunderClaw},{definition:common.exports.ThunderSweep}]},block:11,enemies:[981,988,988]},
  {name:'猎心允许更换主目标',scenario:{heart:true,plays:[{definition:basic.exports.Strike,target:0},{definition:basic.exports.Strike,target:1}]},block:4,enemies:[991,991,997]},
  {name:'双爪的两个命中不是第二张攻击',scenario:{heart:true,plays:[{definition:common.exports.TwinClaws}]},block:0,enemies:[990,1000,1000]},
  {name:'全身之力三倍挡不再次吃敏捷脆弱',scenario:{block:12,dexterity:5,frail:true,plays:[{definition:rare.exports.WholeBodyStrength}]},block:36,enemies:[1000,1000,1000]},
  {name:'负力量保持不变，原始力量只翻正力量',scenario:{strength:-3,plays:[{definition:uncommon.exports.PrimalStrength},{definition:basic.exports.Strike}]},block:0,enemies:[997,1000,1000]},
  {name:'蓄力的临时力量参与每段攻击',scenario:{plays:[{definition:common.exports.Charge},{definition:common.exports.TwinClaws}]},block:0,enemies:[982,1000,1000]},
  {name:'升级蓄力和力量归身保留当前力量数值',scenario:{plays:[{definition:common.exports.Charge,upgraded:true},{definition:uncommon.exports.StrengthReclaimed},{definition:basic.exports.Strike}]},block:0,enemies:[986,1000,1000]},
  {name:'稳住阵脚无行动收据时只给基础格挡',scenario:{dexterity:2,frail:true,plays:[{definition:common.exports.HoldGround}]},block:7,enemies:[1000,1000,1000]},
  {name:'愈战愈烈第二张攻击结束后成长，第三张获得加成',scenario:{plays:[{definition:uncommon.exports.GrowingFury},{definition:basic.exports.Strike},{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,enemies:[978,1000,1000]},
  {name:'升级愈战愈烈入场仍为1力量，触发改为2',scenario:{plays:[{definition:uncommon.exports.GrowingFury,upgraded:true},{definition:basic.exports.Strike},{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,enemies:[977,1000,1000]},
  {name:'第二张攻击之后部署愈战愈烈不补发本回合触发',scenario:{plays:[{definition:basic.exports.Strike},{definition:basic.exports.Strike},{definition:uncommon.exports.GrowingFury},{definition:basic.exports.Strike}]},block:0,enemies:[981,1000,1000]},
  {name:'势不可挡不把一次双爪当成两张攻击',scenario:{plays:[{definition:common.exports.TwinClaws},{definition:uncommon.exports.Unstoppable}]},block:0,energy:28,enemies:[980,1000,1000]},
  {name:'势不可挡在此前两张攻击后返还2能量，无需猎心',scenario:{plays:[{definition:common.exports.TwinClaws},{definition:basic.exports.Strike},{definition:uncommon.exports.Unstoppable}]},block:0,energy:29,enemies:[974,1000,1000]},
  {name:'两张淬躯爪击不共享单张牌的格挡成长',scenario:{plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw}]},block:12,enemies:[984,1000,1000]},
  {name:'升级淬躯爪击先给当前基础格挡，再成长',scenario:{dexterity:2,frail:true,plays:[{definition:growth.exports.TemperingClaw,upgraded:true}]},block:7,enemies:[989,1000,1000]},
  {name:'同一张淬躯爪击再次打出使用已增长的基础格挡',scenario:{plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw,reuse:0}]},block:14,enemies:[984,1000,1000]},
  {name:'淬躯成长先并入基础格挡，再统一应用敏捷脆弱',scenario:{dexterity:2,frail:true,plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw,reuse:0}]},block:13,enemies:[984,1000,1000]},
  {name:'重复授予同类下次减费只减少1费',scenario:{plays:[{definition:uncommon.exports.SavageBite,discounts:2}]},block:0,energy:29,enemies:[979,1000,1000]},
  {name:'下次减费覆盖实际付款，回收再次打出恢复原费用',scenario:{plays:[{definition:uncommon.exports.SavageBite,discounts:1},{definition:uncommon.exports.SavageBite,reuse:0}]},block:0,energy:27,enemies:[958,1000,1000]},
  {name:'万钧连踏支付3能量结算3轮，群雷包含主目标',scenario:{energy:3,plays:[{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[976,991,991]},
  {name:'万钧连踏主目标死亡后余下群雷继续',scenario:{energy:3,enemyHp:[10,1000,1000],plays:[{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[0,991,991]},
  {name:'零能量万钧连踏不产生空雷击结算',scenario:{energy:1,plays:[{definition:uncommon.exports.ThunderAftershock},{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[1000,1000,1000]},
  {name:'饮血而战直接击杀治疗4，未击杀不治疗',scenario:{hp:60,enemyHp:[20,1000,1000],plays:[{definition:lethal.exports.BloodBattle},{definition:lethal.exports.BloodBattle,target:1}]},hp:64,block:0,enemies:[0,979,1000]},
  {name:'升级饮血而战击杀治疗6',scenario:{hp:60,enemyHp:[25,1000,1000],plays:[{definition:lethal.exports.BloodBattle,upgraded:true}]},hp:66,block:0,enemies:[0,1000,1000]},
  {name:'饮血而战击杀最后存活敌人先治疗再结束战斗',scenario:{hp:60,enemyHp:[20,0,0],plays:[{definition:lethal.exports.BloodBattle}]},hp:64,block:0,enemies:[0,0,0]},
  {name:'紧咬不放第二次打出使用本牌增长后的伤害',scenario:{plays:[{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[976,1000,1000]},
  {name:'升级紧咬不放初始仍为10，后续每次成长6',scenario:{plays:[{definition:growth.exports.NeverLetGo,upgraded:true},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[974,1000,1000]},
  {name:'复制紧咬继承攻击成长，复制品后续成长不反写源牌',scenario:{plays:[{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,copyOf:0},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[962,1000,1000]},
  {name:'复制淬躯继承格挡成长，复制品后续成长不反写源牌',scenario:{plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw,copyOf:0},{definition:growth.exports.TemperingClaw,reuse:0}]},block:22,enemies:[976,1000,1000]},
  {name:'天人合一的永久加伤作用于双爪每段，力量另行相加',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:common.exports.TwinClaws}]},block:10,enemies:[978,1000,1000]},
  {name:'天人合一不训练挟山的动态伤害，力量仍正常加成',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:uncommon.exports.MountainLift}]},block:10,enemies:[987,1000,1000]},
  {name:'天人合一永久增量与紧咬自身成长分别累加',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,reuse:1}]},block:10,enemies:[964,1000,1000]},
  {name:'雷霆铭身在首张双爪结算前增加每段伤害，第二张不再触发',scenario:{plays:[{definition:rare.exports.ThunderInscription},{definition:common.exports.TwinClaws},{definition:common.exports.TwinClaws}]},block:0,enemies:[968,1000,1000]},
  {name:'雷霆铭身永久增量保留，但同回合再次打出不重复增加',scenario:{plays:[{definition:rare.exports.ThunderInscription},{definition:common.exports.TwinClaws},{definition:common.exports.TwinClaws,reuse:1}]},block:0,enemies:[956,1000,1000]},
  {name:'首张固定攻击已打出后部署铭身，本回合不补发',scenario:{plays:[{definition:basic.exports.Strike},{definition:rare.exports.ThunderInscription},{definition:basic.exports.Strike}]},block:0,enemies:[988,1000,1000]},
  {name:'动态伤害攻击不占用雷霆铭身的首张固定攻击机会',scenario:{block:12,plays:[{definition:uncommon.exports.MountainLift},{definition:rare.exports.ThunderInscription},{definition:basic.exports.Strike}]},block:12,enemies:[976,1000,1000]},
  {name:'追猎准备加成覆盖双爪两段，下一次重新打出不再加成',scenario:{plays:[{definition:common.exports.TwinClaws,attackBonus:3},{definition:common.exports.TwinClaws,reuse:0}]},block:0,enemies:[974,1000,1000]},
  {name:'追猎准备一次性加伤不混入紧咬永久成长',scenario:{plays:[{definition:growth.exports.NeverLetGo,attackBonus:3},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[973,1000,1000]},
  {name:'崩山付款不把自身计入此前攻击，首张仍为3费',scenario:{plays:[{definition:uncommon.exports.MountainCollapse}]},block:0,energy:27,enemies:[972,1000,1000]},
  {name:'双爪多段只给崩山减少1费',scenario:{plays:[{definition:common.exports.TwinClaws},{definition:uncommon.exports.MountainCollapse}]},block:0,energy:27,enemies:[962,1000,1000]},
  {name:'攻击其他目标不减少崩山费用',scenario:{plays:[{definition:basic.exports.Strike,target:0},{definition:uncommon.exports.MountainCollapse,target:1}]},block:0,energy:26,enemies:[994,972,1000]},
  {name:'崩山自身减费最低1',scenario:{plays:[{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:uncommon.exports.MountainCollapse}]},block:0,energy:29,enemies:[957,1000,1000]},
  {name:'崩山达到自身下限后外部减费仍可降至0',scenario:{plays:[{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:uncommon.exports.MountainCollapse,discounts:1}]},block:0,energy:30,enemies:[957,1000,1000]},
  {name:'不休之猎从后续单体攻击开始减费，当前牌不自减',scenario:{plays:[{definition:rare.exports.EndlessHunt},{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,energy:27,enemies:[988,1000,1000]},
  {name:'不休之猎的减费按目标分别累计',scenario:{plays:[{definition:rare.exports.EndlessHunt},{definition:basic.exports.Strike,target:0},{definition:basic.exports.Strike,target:1}]},block:0,energy:26,enemies:[994,994,1000]},
  {name:'不休之猎不追溯部署前的攻击',scenario:{plays:[{definition:basic.exports.Strike},{definition:rare.exports.EndlessHunt},{definition:basic.exports.Strike}]},block:0,energy:26,enemies:[988,1000,1000]},
  {name:'双爪多段只为不休之猎贡献一次后续减费',scenario:{plays:[{definition:rare.exports.EndlessHunt},{definition:common.exports.TwinClaws},{definition:uncommon.exports.SavageBite}]},block:0,energy:26,enemies:[969,1000,1000]},
  {name:'磨砺爪牙经真实选择只强化所选攻击',scenario:{plays:[{definition:selections.exports.HoneClaws},{definition:common.exports.TwinClaws},{definition:basic.exports.Strike}]},answers:[['双爪']],block:0,enemies:[978,1000,1000]},
  {name:'古神技艺只翻倍永久增量，不翻倍力量或印刷伤害',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:selections.exports.AncientCraft},{definition:common.exports.TwinClaws},{definition:basic.exports.Strike}]},answers:[['双爪']],block:10,enemies:[948,1000,1000]},
  {name:'群体回收经过多选为每张牌提供一次减费',scenario:{plays:[{definition:basic.exports.Strike},{definition:common.exports.TwinClaws},{definition:selections.exports.BattleNotOver},{definition:basic.exports.Strike,reuse:0},{definition:common.exports.TwinClaws,reuse:1}]},answers:[['打击','双爪']],block:0,energy:27,enemies:[968,1000,1000]},
  {name:'重整爪牙从弃牌攻击中选择并给予一次减费',scenario:{plays:[{definition:basic.exports.Strike},{definition:common.exports.TwinClaws},{definition:selections.exports.RegroupClaws},{definition:common.exports.TwinClaws,reuse:1}]},answers:[['双爪']],block:0,energy:27,enemies:[974,1000,1000]},
  {name:'将战斗留下实际生成独立攻击并可正常打出',scenario:{plays:[{definition:selections.exports.LeaveBattleBehind},{definition:common.exports.TwinClaws},{definition:basic.exports.Strike},{definition:common.exports.TwinClaws,generated:true}]},answers:[['双爪']],block:0,hand:0,enemies:[974,1000,1000]},
  {name:'迎战准备重复部署不叠加，声明牌之后消耗减费',scenario:{plays:[{definition:uncommon.exports.EngagePreparation},{definition:uncommon.exports.EngagePreparation},{definition:engageProbe},{definition:engageProbe}]},block:10,energy:27,enemies:[1000,1000,1000]},
  {name:'没有迎战声明的防御牌不消耗迎战准备',scenario:{plays:[{definition:uncommon.exports.EngagePreparation},{definition:basic.exports.Defend},{definition:engageProbe}]},block:10,energy:28,enemies:[1000,1000,1000]},
  {name:'升级迎战准备可再次打出但减费仍不叠加',scenario:{plays:[{definition:uncommon.exports.EngagePreparation,upgraded:true},{definition:uncommon.exports.EngagePreparation,reuse:0},{definition:engageProbe}]},block:16,energy:29,enemies:[1000,1000,1000]},
];
for(const c of cases)for(const controlled of [false,true])test(`${c.name}; controlled=${controlled}`,async()=>{
  const loaded=unwrap(await createCardLoader({controlled}).load(fixture(c.scenario))),instance=unwrap(await loaded.core.start(undefined));
  try{
    let stop=unwrap(await instance.inspect()),answerIndex=0;
    while(stop.kind==='call'){
      assert.equal(stop.call.port,'decision');
      const request=choiceRequestSchema.parse(stop.call.input),names=c.answers?.[answerIndex++];
      assert.ok(names,'Unexpected card selection');
      const indices=names.map(name=>{const index=request.cards.indexOf(name);assert.ok(index>=0,`Missing candidate ${name}`);return index;});
      unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{indices}})}));
      unwrap(await instance.run());stop=unwrap(await instance.inspect());
    }
    assert.equal(answerIndex,c.answers?.length??0);
    assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected completed combat fixture');
    assert.equal(stop.result.hp,c.hp??80);assert.equal(stop.result.block,c.block);assert.deepEqual(stop.result.enemies,c.enemies);
    if(c.energy!==undefined)assert.equal(stop.result.energy,c.energy);
    if(c.hand!==undefined)assert.equal(stop.result.hand,c.hand);
  }finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
});
