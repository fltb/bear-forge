import {targetAttack} from '../../../cards/shared/programs.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import { typedValue } from '../../../../rules/value.schemas.ts';
import {PS} from "../../../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardInstances} from "../../../../rules/card-instances.ts";
import {permanentDecks} from "../../../../rules/permanent-decks.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {battles} from "../../../../rules/battles.ts";
import {powers} from "../../../../rules/powers.ts";
import {turns} from "../../../../rules/turns.ts";
import {cards} from "../../../../cards.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {cardEvaluationSchema} from "../../../../rules/card-instances.schemas.ts";
import {standardUpgrade,repeatedUpgrade,upgradeOnce} from "../../../cards/shared/lifecycle.ts";
import {counterPolicies,attachAbilities} from "../../../powers/utils.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {ResourceAmount} from "../../../../rules/resources.types.ts";
const {defineRules,defineEntity,defineQuery,defineEffect,sequence,call,query,on,enqueue,restrict}=rules;
export const permanentCards=defineRules({requires:[cardTargets,cardEffects,permanentDecks,battles,turns,powers],build(){
  const ownsBlock=defineQuery({input:typedValue<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.entity===c.owner&&r.query(powers.exports.enabled,c.source)});
  const BarricadePower=defineEntity(powers.exports.kind,{presentation:{key:PS.BARRICADE,flag:true},...counterPolicies({bits:16,flag:true}),attach:attachAbilities(restrict(turns.exports.beforeBlockReset,{when:ownsBlock,reason:{retained:true}}))});
  const barricade=defineEffect<CardUse,void>(b=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.owner),definition:BarricadePower,amount:1,source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  const searing=targetAttack(v=>{const n=v.input.state.specialData;return Math.trunc(n*(n+7)/2)+12;});
  return{exports:{SearingBlow:defineEntity(cardInstances.exports.kind,{id:'SEARING_BLOW',metadata:cards.SEARING_BLOW,use:searing,canUpgrade:defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>true}),upgrade:repeatedUpgrade(cards.SEARING_BLOW),upgradeCount:defineQuery({input:cardEvaluationSchema,output:z.int32(),base:(_r,c)=>c.state.specialData})}),
    Barricade:defineEntity(cardInstances.exports.kind,{id:'BARRICADE',metadata:cards.BARRICADE,use:barricade,canUpgrade:upgradeOnce(cards.BARRICADE),upgrade:standardUpgrade(cards.BARRICADE)}),
    BarricadePower}};
}});
