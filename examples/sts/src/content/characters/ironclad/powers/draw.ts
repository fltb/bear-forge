import { typedValue } from '../../../../rules/value.schemas.ts';
import {PS} from "../../../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardPiles} from "../../../../rules/card-piles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {powers} from "../../../../rules/powers.ts";
import {resources} from "../../../../rules/resources.ts";
import {turns} from "../../../../rules/turns.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import type {PileCard} from "../../../../rules/card-piles.types.ts";
import {counterPolicies,attachAbilities} from "../../../powers/utils.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,modify,on,sequence,call,query,when,enqueue}=rules;

export const ironcladDrawPowers=defineRules({requires:[cardPiles,powers,turns],build(){
  const ownsCard=defineQuery({input:typedValue<rules.ReactionContext<PileCard>>(),output:z.boolean(),dependencies:[cardPiles.exports.current,powers.exports.enabled,cardPiles.exports.bindings],base:(r,c)=>r.query(cardPiles.exports.bindings,c.event.piles).actor===c.owner&&r.query(powers.exports.enabled,c.source)});
  const statusDrawn=defineQuery({input:typedValue<rules.ReactionContext<PileCard>>(),output:z.boolean(),dependencies:[ownsCard,cardInstances.exports.metadata],base:(r,c)=>r.query(ownsCard,c)&&r.query(cardInstances.exports.metadata,c.event.card).type===4});
  function queuedDraw(event:rules.RuleEvent<PileCard>,condition:rules.Query<rules.ReactionContext<PileCard>,boolean>){
    return on(event,{condition,order:cardPiles.exports.stages.power,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.input.event.piles),count:query(powers.exports.level,b.read(v=>v.input.source))},
      {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).actionScope),eligible:'captured'}))});
  }
  const Evolve=defineEntity(powers.exports.kind,{presentation:{key:PS.EVOLVE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(queuedDraw(cardPiles.exports.drawing,statusDrawn))});
  const DarkEmbrace=defineEntity(powers.exports.kind,{presentation:{key:PS.DARK_EMBRACE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(queuedDraw(cardPiles.exports.exhausting,ownsCard))});
  const feel=on(cardPiles.exports.exhausting,{condition:ownsCard,order:{phase:cardPiles.exports.stages.power,priority:10},effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.max(0,v.query(powers.exports.level,v.input.source)))},
    {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).actionScope),eligible:'captured'}))});
  const FeelNoPain=defineEntity(powers.exports.kind,{presentation:{key:PS.FEEL_NO_PAIN,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(feel)});
  return{exports:{Evolve,
    DarkEmbrace,
    FeelNoPain}};
}});
