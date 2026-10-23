import {rules} from '../../../rules/execution.ts';
import type {NeowPresentationState} from './descriptions.ts';
import {adventures,emptyAdventureRewards} from '../../../rules/adventures.ts';
import {permanentDecks} from '../../../rules/permanent-decks.ts';
import {resources} from '../../../rules/resources.ts';
import {relics,type RelicDefinition} from '../../../rules/relics.ts';
import {adventureDraws} from '../../rewards/draws.ts';
import type {AdventureChoiceExports} from '../../../rules/adventure-choices.ts';
import type {CardPreview,AdventureRewards,RelicTier} from '../../../rules/adventures.types.ts';
import type {NeowOption} from '../../../neow.types.ts';
import type {createAdventureAcquisition} from '../../relics/acquisition.ts';

const {defineRules,defineEffect,sequence,when,forEach,call,query,despawnEntity}=rules;
type Choice={run:number;option:NeowOption};
/** Concrete effects and their presentation are authored together, at Program assembly. */
export function createNeowChoices(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>){return defineRules({requires:[ui,acquisition,adventureDraws],build(){
  const bindings=(v:rules.ReadView<Choice>)=>v.query(adventures.exports.bindings,v.input.run);
  const obtain=defineEffect<{run:number;card:CardPreview},void>(b=>call(permanentDecks.exports.obtain,{
    deck:b.read(v=>v.query(adventures.exports.bindings,v.input.run).deck),definition:b.read(v=>v.input.card.definition),upgraded:b.read(v=>v.input.card.upgraded),specialData:b.read(v=>v.input.card.misc),count:1,upgrade:false,
  }));
  const curse=defineEffect<number,void>(b=>{const card=b.local<CardPreview>();return sequence(b.assign(card,call(adventureDraws.exports.curse,b.input)),call(obtain,{run:b.input,card}));});
  const toMap=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:false}));
  const none=defineEffect<Choice,void>(()=>sequence());
  const drawbackProgram=(id:number,effect:rules.Effect<Choice,void>,text:(state:NeowPresentationState)=>string,delayed:rules.Effect<Choice,void>|null=null)=>Object.freeze({id,effect,text,delayed});
  // These operands belong to the effects below; no description module computes execution costs.
  const maxHpAfterLoss=(maxHp:number)=>Math.trunc(Math.fround(Math.fround(.9)*Math.fround(maxHp)));
  const hpLimit=(hp:number)=>Math.trunc(hp/10)*7;
  const drawbacks=Object.freeze([
    drawbackProgram(0,none,()=> '无代价'),
    drawbackProgram(1,none,()=> '无代价'),
    drawbackProgram(2,defineEffect<Choice,void>(b=>call(resources.exports.loseMaxHp,b.read(v=>{const entity=bindings(v).actor,p=v.query(resources.exports.vitality,entity);return{entity,amount:p.maxHp-maxHpAfterLoss(p.maxHp)};}))),state=>{const maxHp=maxHpAfterLoss(state.maxHp);return `失去${state.maxHp-maxHp}最大生命（${state.maxHp}→${maxHp}）${state.hp>maxHp?`，当前生命${state.hp}→${maxHp}`:''}`;}),
    drawbackProgram(3,defineEffect<Choice,void>(b=>call(resources.exports.spendGold,b.read(v=>{const entity=bindings(v).actor;return{entity,amount:v.query(resources.exports.wealth,entity).gold};}))),state=>`失去全部${state.gold}金币`),
    drawbackProgram(4,none,()=> '获得随机诅咒',defineEffect<Choice,void>(b=>sequence(call(curse,b.read(v=>v.input.run)),call(adventures.exports.setScene,{run:b.read(v=>v.input.run),screen:'MAP_SCREEN',continuation:true})))),
    drawbackProgram(5,defineEffect<Choice,void>(b=>call(resources.exports.limitHp,b.read(v=>{const entity=bindings(v).actor;return{entity,amount:hpLimit(v.query(resources.exports.vitality,entity).hp)};}))),state=>{const hp=hpLimit(state.hp);return `失去${state.hp-hp}生命（${state.hp}→${hp}）`;}),
    drawbackProgram(6,defineEffect<Choice,void>(b=>{const starter=b.local<number|null>();return when(b.read(v=>v.query(adventures.exports.catalog,v.input.run).catalog.starterRelic!==null),sequence(b.assign(starter,query(relics.exports.find,{actor:b.read(v=>bindings(v).actor),definition:b.read(v=>v.query(adventures.exports.catalog,v.input.run).catalog.starterRelic!)})),when(b.read(v=>v.get(starter)!==null),despawnEntity({entity:b.read(v=>v.get(starter)!),reason:{replaced:true}}))));}),()=> '失去起始遗物'),
  ]);
  const drawback=defineEffect<Choice,void>(b=>sequence(...drawbacks.map(p=>when(b.read(v=>v.input.option.drawback===p.id),call(p.effect,b.input)))));
  const resume=defineEffect<Choice,void>(b=>sequence(
    ...drawbacks.filter(p=>p.delayed!==null).map(p=>when(b.read(v=>v.input.option.drawback===p.id),sequence(call(p.delayed!,b.input),b.return(undefined)))),
    call(toMap,b.read(v=>v.input.run)),
  ));
  const bonusProgram=(id:number,effect:rules.Effect<Choice,void>,text:string)=>Object.freeze({id,effect,text});
  const selection=(type:number,count:number)=>({
    input:(b:rules.Builder<Choice,void>)=>({run:b.read(v=>v.input.run),type,count,provided:null,stream:b.read(v=>v.query(adventures.exports.selection,v.input.run).selection.transformStream)}),
    text:acquisition.exports.selections.exports.describe(type,count),
  });
  const cardOffer=(id:number,rare:boolean,colorless:boolean)=>bonusProgram(id,defineEffect<Choice,void>(b=>{const cards=b.local<CardPreview[]>();return sequence(
    call(resume,b.input),call(adventures.exports.setScene,{run:b.read(v=>v.input.run),screen:'MAP_SCREEN',continuation:true}),
    b.assign(cards,call(adventureDraws.exports.neowProgram.effect,{run:b.read(v=>v.input.run),rare,colorless})),
    call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:{gold:[],cards:[cards],relics:[],potions:[],emeraldKey:false,sapphireKey:false}}),call(acquisition.exports.rewards,b.read(v=>v.input.run)),call(toMap,b.read(v=>v.input.run)),
  );}),`${adventureDraws.exports.neowProgram.text(rare,colorless)}，选择获得一张`);
  const removeCards=(id:number,count:number)=>{const mode=selection(4,count);return bonusProgram(id,defineEffect<Choice,void>(b=>sequence(call(acquisition.exports.selections.exports.select,mode.input(b)),call(resume,b.input))),mode.text);};
  const relicReward=(id:number,tier:RelicTier)=>bonusProgram(id,defineEffect<Choice,void>(b=>{const relic=b.local<RelicDefinition>();return sequence(b.assign(relic,call(acquisition.exports.draw,{run:b.read(v=>v.input.run),tier,shop:false,front:true,screenless:false})),call(acquisition.exports.give,{run:b.read(v=>v.input.run),definition:relic}),call(resume,b.input));}),`获得随机${{common:'普通',uncommon:'罕见',rare:'稀有',shop:'商店',boss:'Boss'}[tier]}遗物`);
  const maxHpReward=(id:number,fraction:number)=>bonusProgram(id,defineEffect<Choice,void>(b=>sequence(call(resources.exports.increaseMaxHp,b.read(v=>{const entity=bindings(v).actor,p=v.query(resources.exports.vitality,entity);return{entity,amount:Math.trunc(Math.fround(Math.fround(p.maxHp)*Math.fround(fraction)))};})),call(resume,b.input))),`增加当前最大生命的${fraction*100}%最大生命（单精度运算后向零取整）`);
  const goldReward=(id:number,amount:number)=>bonusProgram(id,defineEffect<Choice,void>(b=>sequence(call(resources.exports.gainGold,{entity:b.read(v=>bindings(v).actor),amount}),call(resume,b.input))),`获得${amount}金币`);
  const potionCount=3,upgrade=selection(3,1),transform=selection(1,1),doubleTransform=selection(1,2),lament='NEOWS_LAMENT' as const;
  const bonuses=Object.freeze([
    cardOffer(0,false,false),
    bonusProgram(1,defineEffect<Choice,void>(b=>{const card=b.local<CardPreview>();return sequence(b.assign(card,call(adventureDraws.exports.classCard,{run:b.read(v=>v.input.run),stream:b.read(v=>bindings(v).streams.neow),rarity:2})),call(obtain,{run:b.read(v=>v.input.run),card}),call(resume,b.input));}),'获得随机稀有职业牌'),
    removeCards(2,1),
    bonusProgram(3,defineEffect<Choice,void>(b=>sequence(call(acquisition.exports.selections.exports.select,upgrade.input(b)),call(resume,b.input))),upgrade.text),
    bonusProgram(4,defineEffect<Choice,void>(b=>sequence(call(adventures.exports.setTransformStream,{run:b.read(v=>v.input.run),stream:b.read(v=>bindings(v).streams.neow)}),call(acquisition.exports.selections.exports.select,transform.input(b)),call(resume,b.input))),transform.text),
    cardOffer(5,false,true),
    bonusProgram(6,defineEffect<Choice,void>(b=>{const reward=b.local<AdventureRewards>(),potion=b.local<number>();return sequence(
      call(adventureDraws.exports.reward,{run:b.read(v=>v.input.run),room:'EVENT'}),b.assign(reward,emptyAdventureRewards()),
      forEach(Array.from({length:potionCount},(_,i)=>i),()=>sequence(b.assign(potion,call(adventureDraws.exports.potion,b.read(v=>bindings(v).streams.potion))),b.assign(reward,b.read(v=>({...v.get(reward),potions:[...v.get(reward).potions,v.get(potion)]}))))),
      call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:reward}),call(acquisition.exports.rewards,b.read(v=>v.input.run)),call(resume,b.input),
    );}),`领取${potionCount}瓶药水`),
    relicReward(7,'common'),maxHpReward(8,.1),
    bonusProgram(9,defineEffect<Choice,void>(b=>sequence(call(acquisition.exports.give,{run:b.read(v=>v.input.run),definition:query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:lament})}),call(resume,b.input))),`获得${lament}`),
    goldReward(10,100),cardOffer(11,true,true),removeCards(12,2),relicReward(13,'rare'),cardOffer(14,true,false),goldReward(15,250),
    // Preserve the unusual original order: prepare selection, unconditionally add
    // a curse, then finish selection. This branch intentionally does not resume().
    bonusProgram(16,defineEffect<Choice,void>(b=>sequence(
      call(adventures.exports.setTransformStream,{run:b.read(v=>v.input.run),stream:b.read(v=>bindings(v).streams.neow)}),call(acquisition.exports.selections.exports.prepare,doubleTransform.input(b)),call(curse,b.read(v=>v.input.run)),call(acquisition.exports.selections.exports.finish,{run:b.read(v=>v.input.run)}),call(toMap,b.read(v=>v.input.run)),
    )),`${doubleTransform.text}；建立候选后、选择卡牌前先获得随机诅咒，再选择并变换（当前执行）`),
    maxHpReward(17,.2),relicReward(18,'boss'),
  ]);
  const describeBonus=(bonus:number)=>{const program=bonuses.find(p=>p.id===bonus);if(!program)throw Error('Unknown Neow bonus '+bonus);return program.text;};
  const describeDrawback=(id:number,state:NeowPresentationState)=>{const program=drawbacks.find(p=>p.id===id);if(!program)throw Error('Unknown Neow drawback '+id);return program.text(state);};
  const choose=defineEffect<number,void>(b=>{const index=b.local<number>(),option=b.local<NeowOption>();return sequence(
    b.assign(index,call(ui.exports.choose,{run:b.input,actions:[0,1,2,3],details:b.read(v=>Object.fromEntries(v.query(adventures.exports.bindings,v.input).neow.map((option,index)=>[String(index),describeBonus(option.bonus)])))})),b.assign(option,b.read(v=>{const o=v.query(adventures.exports.bindings,v.input).neow[v.get(index)&255];if(!o)throw Error('Invalid Neow option');return o;})),
    call(drawback,{run:b.input,option}),call(adventures.exports.setScene,{run:b.input,screen:'EVENT_SCREEN',continuation:true}),
    ...bonuses.map(program=>when(b.read(v=>v.get(option).bonus===program.id),sequence(call(program.effect,{run:b.input,option}),b.return(undefined)))),
    b.return(b.read(()=>{throw Error('Invalid Neow bonus');})),
  );});
  return{exports:{choose,bonuses,drawbacks,describeBonus,describeDrawback}};
}});}
