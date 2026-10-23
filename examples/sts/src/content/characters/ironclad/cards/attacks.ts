import {attackProgram,describeProgram,describeAmount,amountText} from '../../../cards/shared/program-facts.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import { typedValue } from '../../../../rules/value.schemas.ts';
import {pileCards} from "../../../cards/statuses/definitions.ts";
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {zones} from "../../../../rules/zones.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {resources} from "../../../../rules/resources.ts";
import {damage} from "../../../../rules/damage.ts";
import {powers} from "../../../../rules/powers.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,targetAttack,additiveAmount,cardPower,cardAmount,describeAmounts,type CardAmount} from "../../../cards/shared/programs.ts";
import {registerCardAbilities} from "../../../cards/shared/lifecycle.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {HitRequest} from "../../../../rules/damage.types.ts";
import type {HpLost} from "../../../../rules/resources.types.ts";
const {defineRules,defineEffect,defineQuery,sequence,forEach,when,call,query,enqueue,on,definitionOf}=rules;
export const attackCards=defineRules({requires:[cardTargets,cardEffects,battles,pileCards,basicPowers],build(){
  function hpLoss(amount:number){return describeProgram(defineEffect<CardUse,void>(b=>enqueue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'})),`失去${amount}生命。`);}
  function temporary(definition:typeof pileCards.exports.Wound,destination:0|1|2|3){return describeProgram(defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition,upgraded:false,specialData:0,destination,shuffle:destination===0,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),`将1张${rules.entityConfiguration(cardInstances.exports.kind,definition).metadata.name}加入${['抽牌堆（洗入）','手牌','弃牌堆','消耗堆'][destination]}。`);}
  const addAnger=describeProgram(defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition:definitionOf(cardInstances.exports.kind,b.read(v=>v.input.card)),upgraded:b.read(v=>v.input.state.upgraded),specialData:0,destination:2,shuffle:false,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),`将本牌同升级状态的复制加入弃牌堆。`);
  function area(amount:CardAmount){const act=defineEffect<{use:CardUse;base:number},void>(b=>{const matrix=b.local<HitRequest[]>();return sequence(b.assign(matrix,b.read(v=>v.query(battles.exports.targets,v.input.use.battle).map(target=>({battle:v.input.use.battle,source:v.input.use.owner,target,amount:v.query(attributes.exports.attackAmount,{source:v.input.use.owner,target,base:v.input.base,card:v.input.use.card}),attack:true,selfDamage:false})))),forEach(matrix,hit=>call(damage.exports.hit,hit)),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)));});return describeAmounts(attackProgram(defineEffect<CardUse,void>(b=>enqueue(act,{use:b.input,base:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),amount),[amount],damage=>`对全体敌人造成${damage}伤害。`);}
  const vulnerableAmount=1;
  const allVulnerable=describeProgram(defineEffect<CardUse,void>(b=>forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:target,definition:basicPowers.exports.EnemyVulnerable,amount:vulnerableAmount,source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),`对全体敌人施加${vulnerableAmount}层${basicPowers.exports.programs.EnemyVulnerable.name}（可被人工制品抵消）。${basicPowers.exports.programs.EnemyVulnerable.text}`);
  const clashAllowed=describeProgram(defineQuery({input:typedValue<CardUse>(),output:z.boolean(),dependencies:[battles.exports.current,cardPiles.exports.current,zones.exports.members,cardInstances.exports.metadata,cardPiles.exports.bindings,battles.exports.status],base:(r,use)=>r.query(zones.exports.members,r.query(cardPiles.exports.bindings,r.query(battles.exports.status,use.battle).piles).hand).every(card=>r.query(cardInstances.exports.metadata,card).type===0)}),`仅当手牌全为攻击时能打出。`);
  const costReduction=1;
  const costLoss=describeProgram(on(resources.exports.hpLost,{condition:defineQuery({input:typedValue<rules.ReactionContext<HpLost>>(),output:z.boolean(),dependencies:[battles.exports.forActor,battles.exports.current,cardPiles.exports.current,zones.exports.location,cardPiles.exports.bindings,battles.exports.status],base:(r,c)=>{if(c.event.entity!==c.owner||c.event.amount<=0)return false;const battle=r.query(battles.exports.forActor,c.owner);if(battle===null)return false;const p=r.query(cardPiles.exports.bindings,r.query(battles.exports.status,battle).piles);return[p.hand,p.draw,p.discard].includes(r.query(zones.exports.location,c.source)!);}}),effect:defineEffect<rules.ReactionContext<HpLost>,void>(b=>call(cardInstances.exports.updateCost,{entity:b.read(v=>v.input.source),amount:-costReduction}))}),`本牌在手牌、抽牌堆或弃牌堆时，自身每次失去生命使本牌费用减少${costReduction}。`);
  const heavyMultiplier=[2,4] as const;
  const heavyExtra=describeAmount((v:rules.ReadView<CardUse>)=>cardAmount(heavyMultiplier,v)*v.query(attributes.exports.strength,v.input.owner),`额外${amountText(heavyMultiplier)}倍当前力量`);
  const definitions={Anger:concreteCard('ANGER',composePrograms(targetAttack([6,8]),addAnger)),
    BodySlam:concreteCard('BODY_SLAM',targetAttack(describeAmount(v=>v.query(resources.exports.current,v.input.owner).block,'当前格挡值'))),
    BloodForBlood:concreteCard('BLOOD_FOR_BLOOD',targetAttack([18,22]),{created:registerCardAbilities(costLoss)}),
    Bludgeon:concreteCard('BLUDGEON',targetAttack([32,42])),
    Carnage:concreteCard('CARNAGE',targetAttack([20,28])),
    Clash:concreteCard('CLASH',targetAttack([14,18]),{canUse:clashAllowed}),
    Cleave:concreteCard('CLEAVE',area([8,11])),
    Clothesline:concreteCard('CLOTHESLINE',composePrograms(targetAttack([12,14]),cardPower(basicPowers.exports.programs.EnemyWeak,[2,3],true,true))),
    HeavyBlade:concreteCard('HEAVY_BLADE',targetAttack(additiveAmount(14,heavyExtra))),
    Hemokinesis:concreteCard('HEMOKINESIS',composePrograms(hpLoss(2),targetAttack([15,20]))),
    Immolate:concreteCard('IMMOLATE',composePrograms(area([21,28]),temporary(pileCards.exports.Burn,2))),
    Pummel:concreteCard('PUMMEL',targetAttack(2,[4,5])),
    RecklessCharge:concreteCard('RECKLESS_CHARGE',composePrograms(targetAttack([7,10]),temporary(pileCards.exports.Dazed,0))),
    Thunderclap:concreteCard('THUNDERCLAP',composePrograms(area([4,7]),allVulnerable)),
    TwinStrike:concreteCard('TWIN_STRIKE',targetAttack([5,7],2)),
    Uppercut:concreteCard('UPPERCUT',composePrograms(targetAttack(13),cardPower(basicPowers.exports.programs.EnemyWeak,[1,2],true,true),cardPower(basicPowers.exports.programs.EnemyVulnerable,[1,2],true,true))),
    WildStrike:concreteCard('WILD_STRIKE',composePrograms(targetAttack([12,17]),temporary(pileCards.exports.Wound,0)))};
  return{exports:{...definitions,definitions:Object.values(definitions)}};
}});
