import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardInstances} from "../../../rules/card-instances.ts";
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {resources,HpLossOrigin} from "../../../rules/resources.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {turns} from "../../../rules/turns.ts";
import {cards} from "../../../cards.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cardEvaluationSchema} from "../../../rules/card-instances.schemas.ts";
import {standardUpgrade,upgradeOnce} from "../shared/lifecycle.ts";
import type {CardUse,CardSetup} from "../../../rules/card-instances.types.ts";
import type {DeckCard} from "../../../rules/permanent-decks.types.ts";

const {defineRules,defineEntity,defineQuery,defineEffect,sequence,call,query,on,enqueue,restrict}=rules;
export const cursePermanentCards=defineRules({requires:[permanentDecks,battles,turns,powers],build(){
  const noop=defineEffect<CardUse,void>(b=>b.return(undefined));
  const fixed=defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>false});
  const self=defineQuery({input:typedValue<rules.ReactionContext<DeckCard>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source});
  const parasite=on(permanentDecks.exports.removing,{condition:self,effect:defineEffect<rules.ReactionContext<DeckCard>,void>(b=>call(resources.exports.loseMaxHp,{entity:b.read(v=>v.input.owner),amount:3}))});
  const regret=defineEffect<CardUse,void>(b=>enqueue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.regretCardCount),selfDamage:true,origin:HpLossOrigin.Direct}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),b.input,
    {queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'}));
  const curse=(id:'NECRONOMICURSE'|'CURSE_OF_THE_BELL')=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use:noop,canTransform:fixed,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  return{exports:{Parasite:defineEntity(cardInstances.exports.kind,{id:'PARASITE',metadata:cards.PARASITE,use:noop,canUpgrade:upgradeOnce(cards.PARASITE),upgrade:standardUpgrade(cards.PARASITE),created:defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>rules.when(b.read(v=>v.input.setup.mode===0),rules.install({ability:parasite,source:b.read(v=>v.input.entity),owner:b.read(v=>{if(v.input.owner===null)throw Error('A permanent Parasite needs an owner');return v.input.owner;}),environment:{},lifetime:b.read(v=>v.input.scope)})))}),
    Regret:defineEntity(cardInstances.exports.kind,{id:'REGRET',metadata:cards.REGRET,use:noop,endTurn:regret,canUpgrade:upgradeOnce(cards.REGRET),upgrade:standardUpgrade(cards.REGRET)}),
    Necronomicurse:curse('NECRONOMICURSE'),
    CurseOfTheBell:curse('CURSE_OF_THE_BELL')}};
}});
