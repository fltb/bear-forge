import {eventBranches,type EventBranch} from './options.ts';
import {rules} from '../../rules/execution.ts';
import {adventures,emptyAdventureRewards} from "../../rules/adventures.ts";
import {resources} from "../../rules/resources.ts";
import {random} from "../../rules/random.ts";
import type {RelicDefinition} from "../../rules/relics.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {potions} from "../../rules/potions.ts";
import {adventureDraws,libraryCardCount} from "../rewards/draws.ts";
import {adventureEventUtils,sourceFraction} from "./utils.ts";
import {eventId as e,type RelicId} from "../../identifiers.ts";
import type {CardPreview,RelicTier} from "../../rules/adventures.types.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {createAdventureLoot} from "../rewards/loot.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query}=rules;
export function createRepeatedAdventureEvents(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>,loot:ReturnType<typeof createAdventureLoot>){return defineRules({requires:[ui,acquisition,loot,adventureDraws,adventureEventUtils],build(){
  const programs:Partial<Record<number,rules.Effect<number,void>>>={};
  const run=(v:rules.ReadView<number>)=>v.query(adventures.exports.bindings,v.input);
  const hp=(v:rules.ReadView<number>)=>v.query(resources.exports.current,run(v).actor);
  const leave=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:b.read(v=>v.query(adventures.exports.position,v.input).hasContinuation)}));
  const hurt=(amount:number|((v:rules.ReadView<number>)=>number),direct=true)=>defineEffect<number,void>(b=>call(adventureEventUtils.exports.hurt,{run:b.input,amount:typeof amount==='number'?amount:b.read(amount),direct}));
  const give=(id:RelicId)=>defineEffect<number,void>(b=>call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id})}));
  const selectionCount=1;
  const selection=(type:number)=>defineEffect<number,void>(b=>call(acquisition.exports.selections.exports.select,{run:b.input,type,count:selectionCount,provided:null,stream:b.read(v=>run(v).streams.misc)}));
  const randomRelic=defineEffect<number,RelicDefinition>(b=>{const tier=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(b.assign(tier,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier,shop:false,front:true,screenless:true})),b.return(relic));});
  programs[e.CURSED_TOME]=defineEffect<number,void>(b=>{
    const book=b.local<number>(),done=b.local<boolean>(),books=b.local<RelicDefinition[]>();
    const bookCost=(v:rules.ReadView<number>)=>run(v).ascension>=15?15:10,exitCost=3,pool=['NECRONOMICON','ENCHIRIDION','NILRYS_CODEX'] as const;
    const phase=(v:rules.ReadView<number>)=>v.query(adventures.exports.position,v.input).eventData;
    const readingCosts=[1,2,3],lastPhase=readingCosts.length+1;
    return sequence(call(adventures.exports.setEventData,{run:b.input,data:0}),b.assign(done,false),whileDo(b.read(v=>!v.get(done)&&hp(v).hp>0),eventBranches(b,ui,[
      {id:0,allowed:v=>phase(v)===0,text:'开始阅读',execute:call(adventures.exports.setEventData,{run:b.input,data:1})},
      {id:1,allowed:v=>phase(v)===0,text:'离开',execute:sequence(call(leave,b.input),b.assign(done,true))},
      ...readingCosts.map((cost,index)=>({id:index+2,allowed:(v:rules.ReadView<number>)=>phase(v)===index+1,text:`继续阅读，失去${cost}生命`,execute:sequence(call(hurt(cost),b.input),call(adventures.exports.setEventData,{run:b.input,data:b.read(v=>phase(v)+1)}))})),
      {id:5,allowed:v=>phase(v)>=lastPhase,text:v=>`失去${bookCost(v)}生命，随机获得${pool.join('、')}之一`,execute:sequence(
        call(hurt(bookCost),b.input),b.assign(book,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:pool.length-1})),b.assign(books,b.read(v=>pool.map(id=>v.query(adventures.exports.relic,{run:v.input,id})))),
        call(adventures.exports.setRewards,{run:b.input,rewards:{...emptyAdventureRewards(),relics:b.read(v=>[v.get(books)[v.get(book)]!])}}),when(b.read(v=>hp(v).hp>0),call(acquisition.exports.rewards,b.input)),call(leave,b.input),b.assign(done,true),
      )},
      {id:6,allowed:v=>phase(v)>=lastPhase,text:`失去${exitCost}生命并离开`,execute:sequence(call(hurt(exitCost),b.input),call(leave,b.input),b.assign(done,true))},
    ])));
  });
  programs[e.SCRAP_OOZE]=defineEffect<number,void>(b=>{
    const damage=(v:rules.ReadView<number>)=>run(v).ascension>=15?5:3,rollMax=99,chanceStep=10;
    const threshold=(v:rules.ReadView<number>)=>v.query(adventures.exports.position,v.input).eventData*chanceStep+25;
    const success=(roll:number,v:rules.ReadView<number>)=>roll>=rollMax-threshold(v);
    const roll=b.local<number>(),relic=b.local<RelicDefinition>(),done=b.local<boolean>();
    return sequence(b.assign(done,false),whileDo(b.read(v=>!v.get(done)&&hp(v).hp>0),eventBranches(b,ui,[
      {id:0,text:v=>`受到${damage(v)}伤害；${Array.from({length:rollMax+1},(_,roll)=>roll).filter(roll=>success(roll,v)).length/(rollMax+1)*100}%概率获得遗物；失败后概率增加${chanceStep}个百分点（上限100%）`,execute:sequence(
        call(hurt(damage,false),b.input),b.assign(roll,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:rollMax})),
        when(b.read(v=>success(v.get(roll),v)),sequence(b.assign(relic,call(randomRelic,b.input)),call(acquisition.exports.give,{run:b.input,definition:relic}),call(leave,b.input),b.assign(done,true)),call(adventures.exports.setEventData,{run:b.input,data:b.read(v=>v.query(adventures.exports.position,v.input).eventData+1)})),
      )},
      {id:1,text:'离开',execute:sequence(call(leave,b.input),b.assign(done,true))},
    ])));
  });
  programs[e.KNOWING_SKULL]=defineEffect<number,void>(b=>{
    const initialCost=6,costStep=1,goldReward=90;
    const costs=b.local<number[]>(),card=b.local<CardPreview>(),potion=b.local<number>(),done=b.local<boolean>();
    const rewards=[
      {text:`${goldReward}金币`,execute:call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:goldReward})},
      {text:'随机无色牌',execute:sequence(b.assign(card,call(adventureDraws.exports.shuffledColorless,{run:b.input,rarity:1})),call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:b.read(v=>v.get(card).definition),upgraded:false,specialData:0,count:1,upgrade:false}))},
      {text:'随机药水',execute:sequence(b.assign(potion,call(adventureDraws.exports.potion,b.read(v=>run(v).streams.potion))),call(potions.exports.obtain,{inventory:b.read(v=>run(v).potions),potion}))},
    ];
    return sequence(b.assign(costs,rewards.map(()=>initialCost)),b.assign(done,false),whileDo(b.read(v=>!v.get(done)&&hp(v).hp>0),eventBranches(b,ui,[
      ...rewards.map((reward,id)=>({id,text:(v:rules.ReadView<number>)=>`失去${v.get(costs)[id]}生命，获得${reward.text}；该选项每次增加${costStep}生命代价`,execute:sequence(call(adventureEventUtils.exports.hurt,{run:b.input,amount:b.read(v=>v.get(costs)[id]!),direct:true}),b.assign(costs,b.read(v=>v.get(costs).map((n,i)=>i===id?n+costStep:n))),reward.execute)})),
      {id:rewards.length,text:`失去${initialCost}生命并离开`,execute:sequence(call(hurt(initialCost),b.input),call(leave,b.input),b.assign(done,true))},
    ])));
  });
  programs[e.GOLDEN_IDOL]=defineEffect<number,void>(b=>{
    const loss=b.local<number[]>(),idol='GOLDEN_IDOL' as const,injury='INJURY' as const;
    const costBranches:EventBranch[]=[
      {id:2,text:`获得${injury}`,execute:call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:query(adventures.exports.card,{run:b.input,id:injury}),count:1,upgraded:false,specialData:0,upgrade:false})},
      {id:3,text:v=>`受到${v.get(loss)[0]}伤害`,execute:call(adventureEventUtils.exports.hurt,{run:b.input,amount:b.read(v=>v.get(loss)[0]!),direct:false})},
      {id:4,text:v=>`失去${v.get(loss)[1]}最大生命`,execute:call(resources.exports.loseMaxHp,{entity:b.read(v=>run(v).actor),amount:b.read(v=>v.get(loss)[1]!)})},
    ];
    const costs=eventBranches(b,ui,costBranches);
    return sequence(b.assign(loss,b.read(v=>[sourceFraction(hp(v).maxHp,run(v).ascension>=15?.35:.25),sourceFraction(hp(v).maxHp,run(v).ascension>=15?.1:.08)])),when(b.read(v=>v.query(adventures.exports.hasRelic,{run:v.input,id:idol})),costs,eventBranches(b,ui,[
      {id:0,text:v=>`拿走${idol}，随后必须选择一项代价：${costBranches.map(cost=>typeof cost.text==='string'?cost.text:cost.text(v)).join('；或')}`,execute:sequence(call(give(idol),b.input),costs)},
      {id:1,text:'离开',execute:sequence()},
    ])),call(leave,b.input));
  });
  programs[e.FACE_TRADER]=defineEffect<number,void>(b=>{
    const reward=(v:rules.ReadView<number>)=>run(v).ascension>=15?50:75,damage=(v:rules.ReadView<number>)=>Math.max(1,sourceFraction(hp(v).maxHp,.1));
    const faces=b.local<RelicId[]>(),order=b.local<readonly RelicId[]>(),pool=['CULTIST_HEADPIECE','FACE_OF_CLERIC','GREMLIN_VISAGE','NLOTHS_HUNGRY_FACE','SSSERPENT_HEAD'] as const,fallback='CIRCLET' as const;
    return sequence(eventBranches(b,ui,[
      {id:0,text:v=>`获得${reward(v)}金币；受到${damage(v)}伤害`,execute:sequence(call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:b.read(reward)}),call(hurt(damage,false),b.input))},
      {id:1,text:`从${pool.join('、')}中随机获得一张尚未拥有的面具；全部拥有时获得${fallback}`,execute:sequence(b.assign(faces,b.read(v=>pool.filter(id=>!v.query(adventures.exports.hasRelic,{run:v.input,id})))),when(b.read(v=>v.get(faces).length===0),b.assign(faces,[fallback])),b.assign(order,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:faces})),call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id:b.read(v=>v.get(order)[0]!)})}))},
      {id:2,text:'离开',execute:sequence()},
    ]),call(leave,b.input));
  });
  programs[e.BONFIRE_SPIRITS]=defineEffect<number,void>(b=>sequence(call(selection(8),b.input),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true})));
  programs[e.WHEEL_OF_CHANGE]=defineEffect<number,void>(b=>{
    const gold=(v:rules.ReadView<number>)=>v.query(adventures.exports.position,v.input).act*100,damage=(v:rules.ReadView<number>)=>sourceFraction(hp(v).maxHp,run(v).ascension>=15?.15:.1),curse='DECAY' as const;
    const result=b.local<number>(),relic=b.local<RelicDefinition>();
    const outcomes:Omit<EventBranch,'id'>[]=[
      {text:v=>`获得${gold(v)}金币`,execute:call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:b.read(gold)})},
      {text:'获得随机遗物',execute:sequence(b.assign(relic,call(randomRelic,b.input)),call(adventures.exports.setRewards,{run:b.input,rewards:{...emptyAdventureRewards(),relics:b.read(v=>[v.get(relic)])}}),call(acquisition.exports.rewards,b.input))},
      {text:'回复全部生命',execute:call(resources.exports.heal,{entity:b.read(v=>run(v).actor),amount:b.read(v=>hp(v).maxHp)})},
      {text:`获得${curse}`,execute:call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:query(adventures.exports.card,{run:b.input,id:curse}),count:1,upgraded:false,specialData:0,upgrade:false})},
      {text:`移除${selectionCount}张牌`,execute:call(selection(4),b.input)},
      {text:v=>`失去${damage(v)}生命`,execute:call(hurt(damage),b.input)},
    ];
    return sequence(eventBranches(b,ui,[{id:0,text:v=>'转动转盘：等概率'+outcomes.map(o=>typeof o.text==='string'?o.text:o.text(v)).join('、'),execute:sequence(b.assign(result,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:outcomes.length-1})),...outcomes.map((o,id)=>when(b.read(v=>v.get(result)===id),o.execute)))}]),call(leave,b.input));
  });
  programs[e.THE_LIBRARY]=defineEffect<number,void>(b=>{
    const cards=b.local<CardPreview[]>(),heal=b.local<number>(),pickCount=1;
    return sequence(b.assign(heal,b.read(v=>sourceFraction(hp(v).maxHp,run(v).ascension>=15?.2:.33,'round'))),eventBranches(b,ui,[
      {id:0,text:`从${libraryCardCount}张图书馆候选牌中选择${pickCount}张`,execute:sequence(b.assign(cards,call(adventureDraws.exports.library,b.input)),call(acquisition.exports.selections.exports.select,{run:b.input,type:6,count:pickCount,provided:b.read(v=>v.get(cards).map(card=>({card,deckIndex:-1}))),stream:b.read(v=>run(v).streams.card)}))},
      {id:1,text:v=>`回复${v.get(heal)}生命`,execute:call(resources.exports.heal,{entity:b.read(v=>run(v).actor),amount:heal})},
    ]),call(leave,b.input));
  });
  programs[e.SENSORY_STONE]=defineEffect<number,void>(b=>{
    const groups=[1,2,3],damageStep=5,cards=b.local<CardPreview[][]>(),reward=b.local<CardPreview[]>();
    return sequence(eventBranches(b,ui,groups.map((count,id)=>({id,text:`${id>0?'失去'+id*damageStep+'生命；':''}获得${count}组无色牌奖励`,execute:sequence(
      id>0?call(adventureEventUtils.exports.hurt,{run:b.input,amount:id*damageStep,direct:true}):sequence(),b.assign(cards,[]),
      forEach(Array.from({length:count},(_,i)=>i),()=>sequence(b.assign(reward,call(adventureDraws.exports.colorlessReward,b.input)),b.assign(cards,b.read(v=>[...v.get(cards),v.get(reward)])))),
    )}))),call(adventures.exports.setRewards,{run:b.input,rewards:{...emptyAdventureRewards(),cards}}),when(b.read(v=>hp(v).hp>0),call(acquisition.exports.rewards,b.input)),call(leave,b.input));
  });
  programs[e.DESIGNER_IN_SPIRE]=defineEffect<number,void>(b=>{
    const prices=(v:rules.ReadView<number>)=>run(v).ascension>=15?[50,75,110]:[40,60,90],damage=(v:rules.ReadView<number>)=>run(v).ascension>=15?5:3,randomUpgrades=2,fallthroughUpgrades=1;
    const upgradeOne=b.local<boolean>(),removeOne=b.local<boolean>();
    const deck=(v:rules.ReadView<number>)=>v.query(permanentDecks.exports.current,run(v).deck);
    const spend=(index:number)=>call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>prices(v)[index]!)});
    const fallthrough=sequence(spend(2),call(hurt(damage),b.input),call(permanentDecks.exports.upgradeRandom,{deck:b.read(v=>run(v).deck),stream:b.read(v=>run(v).streams.misc),count:fallthroughUpgrades}),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:false}));
    return sequence(b.assign(upgradeOne,call(random.exports.boolean,{stream:b.read(v=>run(v).streams.misc)})),b.assign(removeOne,call(random.exports.boolean,{stream:b.read(v=>run(v).streams.misc)})),eventBranches(b,ui,[
      {id:0,allowed:v=>v.get(upgradeOne)&&hp(v).gold>=prices(v)[0]!&&deck(v).upgradeable>0,text:v=>`支付${prices(v)[0]}金币，选择升级${selectionCount}张牌`,execute:sequence(spend(0),call(selection(3),b.input))},
      {id:1,allowed:v=>!v.get(upgradeOne)&&hp(v).gold>=prices(v)[0]!&&deck(v).upgradeable>0,text:`随机升级${randomUpgrades}张牌（当前实现不扣款）`,execute:call(permanentDecks.exports.upgradeRandom,{deck:b.read(v=>run(v).deck),stream:b.read(v=>run(v).streams.misc),count:randomUpgrades})},
      {id:2,allowed:v=>v.get(removeOne)&&hp(v).gold>=prices(v)[1]!&&deck(v).transformable>=1,text:v=>`支付${prices(v)[1]}金币，移除${selectionCount}张牌`,execute:sequence(spend(1),call(selection(4),b.input))},
      {id:3,allowed:v=>!v.get(removeOne)&&hp(v).gold>=prices(v)[1]!&&deck(v).transformable>=2,text:v=>`依次扣除${prices(v)[1]}和${prices(v)[2]}金币（每次至多扣除当前余额，不会扣为负数）；失去${damage(v)}生命；随机升级${fallthroughUpgrades}张牌`,execute:sequence(spend(1),fallthrough)},
      {id:4,allowed:v=>hp(v).gold>=prices(v)[2]!&&deck(v).transformable>=1,text:v=>`支付${prices(v)[2]}金币；失去${damage(v)}生命；随机升级${fallthroughUpgrades}张牌`,execute:fallthrough},
      {id:5,text:v=>`失去${damage(v)}生命并离开`,execute:call(hurt(damage),b.input)},
    ]),call(leave,b.input));
  });

  return{exports:{programs}};
}});}
