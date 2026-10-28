import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {describeProgram,describeAmount} from '../../../cards/shared/program-facts.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {volibearPlayCounts} from '../mechanics/play-counts.ts';
import {volibearAttackDiscount} from '../mechanics/attack-discount.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {volibearS2Powers} from '../powers/s2.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,draw,compose,queued} from './programs.ts';
import {gainCharge,faceTarget,openDomain,conditional,amountFormula} from './operations.ts';
import {nativeThunder,gainEnergy} from './s2-operations.ts';
import {cardAmount} from '../../../cards/shared/programs.ts';

export const volibearStormCards=rules.defineRules({requires:[volibearCardPrograms,stormCharge,volibearPlayCounts,volibearAttackDiscount,volibearS2Powers,volibearEngagePreparation],build(){
  const discount=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),base:(_r,c)=>c.input.card===c.source&&c.value>=0}),
    dependencies:[stormCharge.exports.current],transform:(r,c)=>Math.max(0,c.value-r.query(stormCharge.exports.current,c.input.battle).strikes),
  });
  function refund(threshold:number,amount:number|readonly [number,number]){
    const available=describeProgram((v:rules.ReadView<CardUse>)=>v.query(volibearPlayCounts.exports.before,v.input).lightning>=threshold,`本次出牌前雷伤至少${threshold}次时，`);
    return conditional(available,gainEnergy(amount));
  }
  const coupon=(amount:number|readonly [number,number])=>describeProgram(queued(rules.defineEffect<CardUse,void>(b=>rules.call(volibearAttackDiscount.exports.prepare,{battle:b.read(v=>v.input.battle),amount:b.read(v=>cardAmount(amount,v))}))),`本回合下一张攻击减费${typeof amount==='number'?amount:amount.join('（')+'）'}，同类取最大值。`);
  const prior=describeProgram((v:rules.ReadView<CardUse>)=>v.query(volibearPlayCounts.exports.before,v.input).lightning>0,'本次出牌前造成过雷伤，');
  const strikes=describeAmount((v:rules.ReadView<CardUse>)=>v.query(stormCharge.exports.current,v.input.battle).strikes,'本回合雷伤次数');
  return{exports:{
    Thunderbolt:card(cards.C24,compose(thunder([6,9]),draw(1))),
    LightningSeed:card(cards.C25,compose(queued(gainCharge([1,2])),coupon(1))),
    Grounding:card(cards.C26,refund(1,[2,3])),
    WelcomeThunder:card(cards.U32,compose(queued(openDomain(1)),coupon([1,2]),queued(volibearS2Powers.exports.deployWelcome))),
    ThunderArmor:card(cards.U34,compose(block([4,7]),queued(volibearS2Powers.exports.deployArmor))),
    ThunderChallenge:card(cards.U35,compose(block([8,11]),thunder([3,5]),queued(faceTarget())),{created:describeProgram(registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),'')}),
    GatherCharge:card(cards.U36,compose(gainEnergy([1,2]),conditional(prior,draw(1)))),
    ConvergingStorm:card(cards.U37,compose(thunder([12,16]),queued(openDomain(1)))),
    StormRush:card(cards.U38,attack([18,24]),{created:describeProgram(registerCardAbilities(discount),'本回合每次雷伤使本牌费用减1，最低0。')}),
    ThunderRoad:card(cards.U40,compose(nativeThunder([8,12]),refund(2,2))),
    ThunderPool:card(cards.R18,compose(thunder([6,9]),queued(volibearS2Powers.exports.deployPool))),
    ThunderAvatar:card(cards.R21,compose(block(amountFormula([4,5],(n,v)=>n*v.query(stormCharge.exports.current,v.input.battle).strikes,n=>`本回合雷伤次数×${n}`)),draw(2))),
    RendSky:card(cards.R23,compose(nativeThunder([8,11]),nativeThunder([8,11]),nativeThunder([8,11]))),
    ThunderSurge:card(cards.R24,compose(gainEnergy(strikes),draw([2,3]))),
  }};
}});
