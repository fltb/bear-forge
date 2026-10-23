import {gainCharge,deployPower,faceTarget,conditional,ordered} from './operations.ts';
import {describeProgram,programText,describeAmount,amountText} from '../../../cards/shared/program-facts.ts';
import {describeAmounts,type DescribedPower} from '../../../cards/shared/programs.ts';
import {inheritPrograms} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {resources} from '../../../../rules/resources.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import type {PowerDefinition} from '../../../../rules/powers.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {lightning} from '../mechanics/lightning.ts';
import {volibearDamageTraining} from '../mechanics/damage-training.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {volibearStormPowers} from '../powers/storm.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,draw,compose,queued} from './programs.ts';
import {cardAmount,type CardAmount} from '../../../cards/shared/programs.ts';

export const volibearStormCards=rules.defineRules({requires:[volibearCardPrograms,stormCharge,volibearStormPowers,volibearEngage,volibearEngagePreparation,volibearDamageTraining,cardEffects],build(){
  const gain=(amount:CardAmount)=>queued(gainCharge(amount));
  const deploy=(power:DescribedPower,amount:CardAmount)=>queued(deployPower(power,amount));
  const face=queued(faceTarget());
  type Discharge={use:CardUse;amount:number};
  const spendThen=(effect:rules.Effect<Discharge,void>)=>{const wrapped=queued(rules.defineEffect<CardUse,void>(b=>{const amount=b.local<number>();return rules.sequence(
    b.assign(amount,rules.call(stormCharge.exports.consume,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),amount:b.read(v=>v.query(stormCharge.exports.current,v.input.battle).amount)})),
    rules.call(effect,{use:b.input,amount}),
  );}));
    inheritPrograms(wrapped,effect as unknown as rules.Effect<CardUse,void>);
    const childText=programText(effect);
    return childText===undefined?wrapped:describeProgram(wrapped,`耗尽蓄雷，并将实际消耗量传给后续效果。${childText}`);
  };
  const burstMultiplier=[3,4] as const,shieldMultiplier=[4,5] as const;
  const burst=rules.defineEffect<Discharge,void>(b=>rules.when(b.read(v=>v.input.amount>0),rules.call(lightning.exports.strike,{battle:b.read(v=>v.input.use.battle),owner:b.read(v=>v.input.use.owner),base:b.read(v=>v.input.amount*burstMultiplier[v.input.use.state.upgraded?1:0]+v.query(volibearDamageTraining.exports.permanentBonus,v.input.use.card)),exclude:null,release:false})));
  const barrageAttack=attack([4,5]);
  const repeatDischarge=(child:rules.Effect<CardUse,void>)=>{
    const repeated=rules.defineEffect<Discharge,void>(b=>rules.forEach(b.read(v=>Array.from({length:v.input.amount},(_,i)=>i)),()=>rules.call(child,b.read(v=>v.input.use))));
    inheritPrograms(repeated as unknown as rules.Effect<CardUse,void>,child);
    const text=programText(child);
    if(text!==undefined)describeProgram(repeated,`按实际消耗量重复：${text}`);
    return repeated;
  };
  const barrage=repeatDischarge(barrageAttack);
  const shield=rules.defineEffect<Discharge,void>(b=>rules.call(cardEffects.exports.gainBlock,{use:b.read(v=>v.input.use),amount:b.read(v=>v.input.amount===0?0:Math.max(0,v.query(attributes.exports.blockAmount,{actor:v.input.use.owner,base:v.input.amount*shieldMultiplier[v.input.use.state.upgraded?1:0]})))}));
  const energy=rules.defineEffect<Discharge,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.use.owner),amount:b.read(v=>v.input.amount)}));
  describeProgram(burst,`若消耗量为正，对全体造成消耗量×${amountText(burstMultiplier)}的雷伤，合为一批且不额外释放蓄雷。`);
  describeProgram(shield,`获得消耗量×${amountText(shieldMultiplier)}的格挡；消耗为0时不应用格挡修正。`);
  describeProgram(energy,'获得等于消耗量的能量。');
  const discount=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),base:(_r,c)=>c.input.card===c.source&&c.value>=0}),
    dependencies:[stormCharge.exports.current],transform:(r,c)=>Math.max(0,c.value-r.query(stormCharge.exports.current,c.input.battle).turnSpent),
  });
  const chargeCost=2,chargeEnergy=[2,3] as const;
  const enoughCharge=describeProgram(rules.defineQuery({input:z.custom<CardUse>(),output:z.boolean(),dependencies:[stormCharge.exports.current],base:(r,use)=>r.query(stormCharge.exports.current,use.battle).amount>=chargeCost}),`至少${chargeCost}蓄雷才能打出。`);
  const chargeReady=describeProgram((v:rules.ReadView<CardUse>)=>v.query(enoughCharge,v.input),programText(enoughCharge)!);
  const consumeCharge=describeProgram(rules.defineEffect<CardUse,void>(b=>rules.sequence(rules.call(stormCharge.exports.consume,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),amount:chargeCost}))),`消耗${chargeCost}蓄雷。`);
  const gainEnergy=describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(chargeEnergy,v))})),[chargeEnergy],n=>`获得${n}能量。`);
  const chargeEnergyUse=conditional(chargeReady,ordered(consumeCharge,gainEnergy));
  return{exports:{
    GatheringClouds:card(cards.C23,compose(block([9,12]),gain(3))),
    Thunderbolt:card(cards.C24,compose(thunder([6,9]),draw(1))),
    LightningSeed:card(cards.C25,compose(gain([2,3]),draw(1))),
    WelcomeThunder:card(cards.U32,compose(deploy(volibearStormPowers.exports.programs.WelcomeThunder,[2,3]),gain(2))),
    Embers:card(cards.U33,deploy(volibearStormPowers.exports.programs.Embers,[1,2])),
    ThunderArmor:card(cards.U34,deploy(volibearStormPowers.exports.programs.ThunderArmor,[3,4])),
    ThunderChallenge:card(cards.U35,compose(block([8,11]),face,thunder([3,5])),{created:describeProgram(registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),'')}),
    GatherCharge:card(cards.U36,queued(chargeEnergyUse),{canUse:enoughCharge}),
    ConvergingStorm:card(cards.U37,compose(gain(describeAmount((v:rules.ReadView<CardUse>)=>v.query(battles.exports.targets,v.input.battle).length,'当前敌人数')),thunder([5,8]))),
    StormRush:card(cards.U38,compose(attack([18,24]),thunder([4,6])),{created:describeProgram(registerCardAbilities(discount),'费用减去本回合累计消耗的蓄雷量，最低0。')}),
    ThunderJudgment:card(cards.R17,compose(attack([14,18]),spendThen(burst))),
    ThunderPool:card(cards.R18,compose(gain([8,11]),draw(2))),
    UnendingStorm:card(cards.R19,compose(deploy(volibearStormPowers.exports.programs.UnendingStorm,1),gain([3,5]))),
    ThunderLance:card(cards.R20,spendThen(barrage)),
    ThunderAvatar:card(cards.R21,compose(spendThen(shield),draw(2))),
    RendSky:card(cards.R23,compose(attack([18,24]),thunder(describeAmount((v:rules.ReadView<CardUse>)=>v.query(stormCharge.exports.current,v.input.battle).spent,'本战累计消耗蓄雷量')))),
    ThunderSurge:card(cards.R24,compose(spendThen(energy),draw([2,3]))),
    StormReborn:card(cards.R25,compose(gain(describeAmount((v:rules.ReadView<CardUse>)=>v.query(stormCharge.exports.current,v.input.battle).turnSpent,'本回合累计消耗蓄雷量')),draw([1,2]))),
  }};
}});
