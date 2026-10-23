import {concreteCard,cardAmount,describeAmounts} from '../shared/programs.ts';
import {programMetadata,describeProgram} from '../shared/program-facts.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {cardPiles} from "../../../rules/card-piles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {battles} from "../../../rules/battles.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cards} from "../../../cards.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {PileCard} from "../../../rules/card-piles.types.ts";
import {registerCardAbilities,standardUpgrade,upgradeOnce} from "../shared/lifecycle.ts";
const {defineRules,defineQuery,defineEntity,defineEffect,on,call,query,enqueue}=rules;
export const pileCards=defineRules({requires:[cardPiles,attributes,battles],build(){
  const self=defineQuery({input:typedValue<rules.ReactionContext<PileCard>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source});
  const voidEnergy=1;
  const voidDraw=describeProgram(on(cardPiles.exports.drawing,{condition:self,order:cardPiles.exports.stages.card,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>call(resources.exports.useEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.min(voidEnergy,v.query(resources.exports.stamina,v.input.owner).energy))}))}),`抽到本牌时失去至多${voidEnergy}能量。`);
  const noop=describeProgram(defineEffect<CardUse,void>(b=>b.return(undefined)),'');
  const playable=describeProgram(defineQuery({input:typedValue<CardUse>(),output:z.boolean(),base:()=>true}),'');
  const inert=(id:'WOUND'|'DAZED'|'SLIMED')=>concreteCard(id,noop,{canUse:id==='SLIMED'?playable:undefined});
  const burnDamage=[2,4] as const;
  const burn=describeAmounts(defineEffect<CardUse,void>(b=>enqueue(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:null,target:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(burnDamage,v)),attack:false,selfDamage:true},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'})),[burnDamage],amount=>`回合结束时若本牌在手中，自身受到${amount}非攻击伤害。`);
  return{exports:{Wound:inert('WOUND'),Dazed:inert('DAZED'),Slimed:inert('SLIMED'),Burn:concreteCard('BURN',noop,{endTurn:burn}),Void:concreteCard('VOID',noop,{created:registerCardAbilities(voidDraw)})}};
}});
