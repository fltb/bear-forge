import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {resources} from "../../../rules/resources.ts";
import {relics} from "../../../rules/relics.ts";
import {registerRelicAbilities} from "../hooks.ts";
import type {DeckObtain,DeckBatch} from "../../../rules/permanent-decks.types.ts";
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,replace,on,modify,call,query,readComponent,updateLocalComponent}=rules;
const omamoriUses=defineComponent({schema:z.int32(),initial:()=>2});
export const deckRelics=defineRules({requires:[permanentDecks,relics],build(){
  const owns=defineQuery({input:z.custom<rules.ReplacementContext<DeckObtain>>(),output:z.boolean(),dependencies:[permanentDecks.exports.current],base:(r,c)=>r.query(permanentDecks.exports.current,c.value.deck).actor===c.owner});
  function egg(type:number){const condition=defineQuery({input:z.custom<rules.ReplacementContext<DeckObtain>>(),output:z.boolean(),dependencies:[owns,cardInstances.exports.definitionMetadata],base:(r,c)=>r.query(owns,c)&&r.query(cardInstances.exports.definitionMetadata,c.value.definition).type===type});
    return replace(permanentDecks.exports.beforeObtain,{condition,order:permanentDecks.exports.stages.transform,effect:defineEffect<rules.ReplacementContext<DeckObtain>,rules.ReplacementResult<DeckObtain>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,upgrade:true}))}))});
  }
  const curse=defineQuery({input:z.custom<rules.ReplacementContext<DeckObtain>>(),output:z.boolean(),dependencies:[owns,cardInstances.exports.definitionMetadata],reads:[omamoriUses],base:(r,c)=>r.query(owns,c)&&r.query(cardInstances.exports.definitionMetadata,c.value.definition).type===3&&r.component(c.source,omamoriUses)>0});
  const prevent=replace(permanentDecks.exports.beforeObtain,{condition:curse,order:permanentDecks.exports.stages.restriction,effect:defineEffect<rules.ReplacementContext<DeckObtain>,rules.ReplacementResult<DeckObtain>>(b=>{const prevented=b.local<number>();return sequence(
    b.assign(prevented,b.read(v=>Math.min(v.input.value.count,v.get(readComponent(v.input.source,omamoriUses))))),updateLocalComponent(b.read(v=>v.input.source),omamoriUses,b.read(v=>v.get(readComponent(v.input.source,omamoriUses))-v.get(prevented))),b.return({kind:'change',value:b.read(v=>({...v.input.value,count:v.input.value.count-v.get(prevented)}))}),
  );})});
  const data=modify(relics.exports.data,{condition:defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[omamoriUses],transform:(r,c)=>r.component(c.source,omamoriUses)});
  const fish=on(permanentDecks.exports.obtaining,{condition:defineQuery({input:z.custom<rules.ReactionContext<DeckBatch>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner}),effect:defineEffect<rules.ReactionContext<DeckBatch>,void>(b=>call(resources.exports.gainGold,{entity:b.read(v=>v.input.owner),amount:b.read(v=>9*v.input.event.count)}))});
  return{exports:{MoltenEgg:defineEntity(relics.exports.kind,{id:'MOLTEN_EGG' as const,install:registerRelicAbilities(egg(0))}),ToxicEgg:defineEntity(relics.exports.kind,{id:'TOXIC_EGG' as const,install:registerRelicAbilities(egg(1))}),FrozenEgg:defineEntity(relics.exports.kind,{id:'FROZEN_EGG' as const,install:registerRelicAbilities(egg(2))}),
    Omamori:defineEntity(relics.exports.kind,{id:'OMAMORI' as const,install:registerRelicAbilities(prevent,data),interact:defineEffect<{entity:number;actor:number},void>(b=>updateLocalComponent(b.read(v=>v.input.entity),omamoriUses,n=>n-1))},{components:[omamoriUses]}),CeramicFish:defineEntity(relics.exports.kind,{id:'CERAMIC_FISH' as const,install:registerRelicAbilities(fish)})}};
}});
