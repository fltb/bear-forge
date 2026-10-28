import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {gainCharge} from './operations.ts';
import {nativeThunder} from './s2-operations.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {describeAmount} from '../../../cards/shared/program-facts.ts';
import {damageTermsSchema,damageTermsFor,withDamageTerms,inheritDamageTerms,inheritPrograms,describeProgram,programText} from '../../../cards/shared/program-facts.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {xCost} from '../../../../rules/x-cost.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,thunder,compose} from './programs.ts';

export const volibearXCards=rules.defineRules({requires:[stormCharge,xCost,volibearCardPrograms,resources,battles],build(){
  // Relic/content modifiers target this typed query. Payment stays the captured
  // X value; bonus iterations do not spend extra energy.
  const iterations=xCost.exports.iterations;
  const wave=compose(attack([5,7]),thunder(3));
  const xEffect=(body:rules.Effect<CardUse,void>,bonus:boolean)=>rules.defineEffect<CardUse,void>(b=>{
    const paid=b.local<number>(),use=b.local<CardUse>(),count=b.local<number>();
    return rules.sequence(
      b.assign(paid,b.read(v=>v.input.ignoreEnergyTotal?v.input.energyOnUse:Math.min(v.input.energyOnUse,v.get(rules.query(resources.exports.current,v.input.owner)).energy))),
      rules.call(battles.exports.setEnergyOnUse,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play),value:paid}),
      b.assign(use,b.read(v=>({...v.input,energyOnUse:v.get(paid)}))),
      b.assign(count,b.read(v=>bonus?v.get(paid)+Number(v.input.state.upgraded):v.query(iterations,v.get(use)))),
      rules.when(b.read(v=>!v.input.autoplay&&!v.input.purgeOnUse&&!v.input.freeToPlay&&!v.input.state.freeToPlayOnce&&!v.get(rules.query(battles.exports.waivedPayment,v.input))),
        rules.call(resources.exports.useEnergy,{entity:b.read(v=>v.input.owner),amount:paid})),
      ...(bonus?[rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),amount:count})]:[]),
      rules.forEach(b.read(v=>Array.from({length:v.get(count)},(_,i)=>i)),()=>rules.call(body,use)),
    );
  });
  const trample=xEffect(wave,false);
  const bolt=nativeThunder(6),judgment=xEffect(bolt,true);
  inheritPrograms(judgment,bolt);
  // Charge is granted before these X-dependent hits; a current-state bolt
  // would be misleading as a projection of the whole card.
  inheritDamageTerms(judgment);
  describeProgram(judgment,'支付当前全部能量X，先获得X（X+1）雷势，再造成6雷伤，重复X（X+1）次。重演沿用已支付X。');
  inheritPrograms(trample,wave);
  const waveTerms=damageTermsFor(wave);
  withDamageTerms(trample,rules.defineQuery({input:cardUseSchema,output:damageTermsSchema,dependencies:[iterations,waveTerms],base:(r,use)=>r.query(waveTerms,use).map(term=>({...term,hits:term.hits*r.query(iterations,use)}))}));
  describeProgram(trample,`支付实际X费用，按X结算次数（含修正）重复：${programText(wave)}不重复打出；效果重复沿用已支付X。`);
  return {exports:{iterations,ThunderJudgment:card(cards.R17,judgment),ThunderTrample:card(cards.U31,trample)}};
}});
