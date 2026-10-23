import {programMetadata,registerAmountBase,describeAmount} from '../../../cards/shared/program-facts.ts';
import {targetAttack,cardPower,cardRuleText,concreteCard} from '../../../cards/shared/programs.ts';
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
import {counterPolicies,attachAbilities,defineDescribedPower,describedAbility} from "../../../powers/utils.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {ResourceAmount} from "../../../../rules/resources.types.ts";
const {defineRules,defineEntity,defineQuery,defineEffect,sequence,call,query,on,enqueue,restrict}=rules;
export const permanentCards=defineRules({requires:[cardTargets,cardEffects,permanentDecks,battles,turns,powers],build(){
  const ownsBlock=defineQuery({input:typedValue<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.entity===c.owner&&r.query(powers.exports.enabled,c.source)});
  const Barricade=defineDescribedPower('壁垒',{presentation:{key:PS.BARRICADE,flag:true},...counterPolicies({bits:16,flag:true})},describedAbility('回合开始时不会清空自身格挡。',restrict(turns.exports.beforeBlockReset,{when:ownsBlock,reason:{retained:true}})));
  const BarricadePower=Barricade.definition;
  const barricade=cardPower(Barricade,1);
  const searingBase=12,searingGrowth=7,searingDivisor=2;
  const searingDamage=(upgrades:number)=>Math.trunc(upgrades*(upgrades+searingGrowth)/searingDivisor)+searingBase;
  const searing=targetAttack(describeAmount(registerAmountBase((v:rules.ReadView<CardUse>)=>searingDamage(v.input.state.specialData),[searingDamage(0),searingDamage(1)]),`${searingDamage(0)}（${searingDamage(1)}；升级n次后为${searingBase}+截断[n×(n+${searingGrowth})/${searingDivisor}]）`));
  return{exports:{SearingBlow:defineEntity(cardInstances.exports.kind,{id:'SEARING_BLOW',metadata:programMetadata(cards.SEARING_BLOW,searing),text:`${cardRuleText(cards.SEARING_BLOW,searing)}可无限次升级。`,use:searing,canUpgrade:defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>true}),upgrade:repeatedUpgrade(cards.SEARING_BLOW),upgradeCount:defineQuery({input:cardEvaluationSchema,output:z.int32(),base:(_r,c)=>c.state.specialData})}),
    Barricade:concreteCard('BARRICADE',barricade),
    BarricadePower,barricadeProgram:Barricade}};
}});
