import { typedValue } from '../../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardPiles} from "../../../../rules/card-piles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {resources} from "../../../../rules/resources.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {battles} from "../../../../rules/battles.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {cards} from "../../../../cards.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {PileCard} from "../../../../rules/card-piles.types.ts";
import {registerCardAbilities,standardUpgrade,upgradeOnce} from "../../../cards/shared/lifecycle.ts";
const {defineRules,defineQuery,defineEntity,defineEffect,on,call,query,enqueue}=rules;
export const ironcladPileCards=defineRules({requires:[cardPiles,attributes,battles],build(){
  const self=defineQuery({input:typedValue<rules.ReactionContext<PileCard>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source});
  const sentinelExhaust=on(cardPiles.exports.exhausting,{condition:self,order:cardPiles.exports.stages.card,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.query(cardInstances.exports.current,v.input.source).upgraded?3:2)}))});
  const sentinelUse=defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:query(attributes.exports.blockAmount,b.read(v=>({actor:v.input.owner,base:v.input.state.upgraded?8:5})))},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  return{exports:{Sentinel:defineEntity(cardInstances.exports.kind,{id:'SENTINEL',metadata:cards.SENTINEL,use:sentinelUse,canUpgrade:upgradeOnce(cards.SENTINEL),upgrade:standardUpgrade(cards.SENTINEL),created:registerCardAbilities(sentinelExhaust)})}};
}});
