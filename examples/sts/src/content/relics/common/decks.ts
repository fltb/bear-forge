import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {permanentDecks} from '../../../rules/permanent-decks.ts';
import {cardInstances} from '../../../rules/card-instances.ts';
import {resources} from '../../../rules/resources.ts';
import {relics} from '../../../rules/relics.ts';
import {registerRelicAbilities} from '../hooks.ts';
import type {DeckObtain,DeckBatch} from '../../../rules/permanent-decks.types.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,replace,on,modify,call,readComponent,updateLocalComponent}=rules;
const attack={type:0,name:'攻击'},skill={type:1,name:'技能'},power={type:2,name:'能力'},curseCard={type:3,name:'诅咒'};
export const deckRelics=defineRules({requires:[permanentDecks,relics],build(){
  const owns=defineQuery({input:typedValue<rules.ReplacementContext<DeckObtain>>(),output:z.boolean(),dependencies:[permanentDecks.exports.current],base:(r,c)=>r.query(permanentDecks.exports.current,c.value.deck).actor===c.owner});
  function egg(cardType:typeof attack){
    const condition=defineQuery({input:typedValue<rules.ReplacementContext<DeckObtain>>(),output:z.boolean(),dependencies:[owns,cardInstances.exports.definitionMetadata],base:(r,c)=>r.query(owns,c)&&r.query(cardInstances.exports.definitionMetadata,c.value.definition).type===cardType.type});
    return{ability:replace(permanentDecks.exports.beforeObtain,{condition,order:permanentDecks.exports.stages.transform,effect:defineEffect<rules.ReplacementContext<DeckObtain>,rules.ReplacementResult<DeckObtain>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,upgrade:true}))}))}),text:`以后自身获得的${cardType.name}牌自动升级。`};
  }
  function preventCurses(limit:number){
    const uses=defineComponent({schema:z.int32(),initial:()=>limit});
    const curse=defineQuery({input:typedValue<rules.ReplacementContext<DeckObtain>>(),output:z.boolean(),dependencies:[owns,cardInstances.exports.definitionMetadata],reads:[uses],base:(r,c)=>r.query(owns,c)&&r.query(cardInstances.exports.definitionMetadata,c.value.definition).type===curseCard.type&&r.component(c.source,uses)>0});
    const prevent=replace(permanentDecks.exports.beforeObtain,{condition:curse,order:permanentDecks.exports.stages.restriction,effect:defineEffect<rules.ReplacementContext<DeckObtain>,rules.ReplacementResult<DeckObtain>>(b=>{const prevented=b.local<number>();return sequence(
      b.assign(prevented,b.read(v=>Math.min(v.input.value.count,v.get(readComponent(v.input.source,uses))))),updateLocalComponent(b.read(v=>v.input.source),uses,b.read(v=>v.get(readComponent(v.input.source,uses))-v.get(prevented))),b.return({kind:'change',value:b.read(v=>({...v.input.value,count:v.input.value.count-v.get(prevented)}))}),
    );})});
    const data=modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[uses],transform:(r,c)=>r.component(c.source,uses)});
    return{definition:defineEntity(relics.exports.kind,{id:'OMAMORI' as const,install:registerRelicAbilities(prevent,data),interact:defineEffect<{entity:number;actor:number},void>(b=>updateLocalComponent(b.read(v=>v.input.entity),uses,n=>n-1))},{components:[uses]}),text:`阻止自身接下来获得的${limit}张${curseCard.name}；按实际阻止的张数消耗次数。`};
  }
  function goldPerCard(amount:number){return{effect:defineEffect<rules.ReactionContext<DeckBatch>,void>(b=>call(resources.exports.gainGold,{entity:b.read(v=>v.input.owner),amount:b.read(v=>amount*v.input.event.count)})),text:`自身获得${amount}金币`};}
  function maxHpPerCard(amount:number){return{effect:defineEffect<rules.ReactionContext<DeckBatch>,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.input.owner),amount:b.read(v=>amount*v.input.event.count)})),text:`自身最大生命增加${amount}并回复${amount}生命`};}
  function onObtain(operation:{effect:rules.Effect<rules.ReactionContext<DeckBatch>,void>;text:string},cardType?:typeof attack){return{
    ability:on(permanentDecks.exports.obtaining,{condition:defineQuery({input:typedValue<rules.ReactionContext<DeckBatch>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>c.event.actor===c.owner&&(cardType===undefined||r.query(cardInstances.exports.metadata,c.event.card).type===cardType.type)}),effect:operation.effect}),
    text:`每实际获得1张${cardType?.name??''}牌，${operation.text}；被阻止的牌不触发。`,
  };}
  const molten=egg(attack),toxic=egg(skill),frozen=egg(power),omamori=preventCurses(2),fish=onObtain(goldPerCard(9)),darkstone=onObtain(maxHpPerCard(6),curseCard);
  return{exports:{DarkstonePeriapt:defineEntity(relics.exports.kind,{id:'DARKSTONE_PERIAPT' as const,install:registerRelicAbilities(darkstone.ability)}),MoltenEgg:defineEntity(relics.exports.kind,{id:'MOLTEN_EGG' as const,install:registerRelicAbilities(molten.ability)}),ToxicEgg:defineEntity(relics.exports.kind,{id:'TOXIC_EGG' as const,install:registerRelicAbilities(toxic.ability)}),FrozenEgg:defineEntity(relics.exports.kind,{id:'FROZEN_EGG' as const,install:registerRelicAbilities(frozen.ability)}),Omamori:omamori.definition,CeramicFish:defineEntity(relics.exports.kind,{id:'CERAMIC_FISH' as const,install:registerRelicAbilities(fish.ability)}),texts:Object.freeze({DARKSTONE_PERIAPT:darkstone.text,MOLTEN_EGG:molten.text,TOXIC_EGG:toxic.text,FROZEN_EGG:frozen.text,OMAMORI:omamori.text,CERAMIC_FISH:fish.text})}};
}});
