import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {cardAmount,describeAmounts,type CardAmount,type DescribedPower} from '../../../cards/shared/programs.ts';
import {describeProgram,describeAmount,amountText,programText,inheritPrograms,inheritDamageTerms,opensDomain} from '../../../cards/shared/program-facts.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {volibearDomain} from '../mechanics/domain.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearCardPrograms} from './programs.ts';

/** Ordinary composition, without compose's battle-outcome guard or an extra queue. */
export function ordered(...children:rules.Effect<CardUse,void>[]){
  return inheritPrograms(rules.defineEffect<CardUse,void>(b=>rules.sequence(...children.map(child=>rules.call(child,b.input)))),...children);
}
export function conditional(condition:(view:rules.ReadView<CardUse>)=>boolean,yes:rules.Effect<CardUse,void>,no?:rules.Effect<CardUse,void>,before?:rules.Effect<CardUse,void>){
  const effect=rules.defineEffect<CardUse,void>(b=>{
    const result=b.local<boolean>();
    return rules.sequence(b.assign(result,b.read(condition)),...(before?[rules.call(before,b.input)]:[]),no?rules.when(result,rules.call(yes,b.input),rules.call(no,b.input)):rules.when(result,rules.call(yes,b.input)));
  });
  // The predicate is an opaque author callback, not evaluated for its description.
  // Include it in completeness as well as the branches actually called above.
  inheritPrograms(effect,...[...(before?[before]:[]),yes,...(no?[no]:[]),condition as unknown as rules.Effect<CardUse,void>]);
  inheritDamageTerms(effect,...(before?[before]:[]));
  const conditionText=programText(condition),yesText=programText(yes),noText=no?programText(no):'',beforeText=before?programText(before):'';
  if(conditionText!==undefined&&yesText!==undefined&&noText!==undefined&&beforeText!==undefined)
    describeProgram(effect,`${before?'效果开始时判断条件。'+beforeText:''}若${conditionText}则${yesText}${no?'否则'+noText:''}`);
  return effect;
}
/** These are ordinary effect constructors; callers retain their existing queue boundaries. */
export function gainCharge(amount:CardAmount){
  return describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))})),[amount],n=>`获得${n}雷势。`);
}
export function openDomain(turns:CardAmount|null){
  const effect=rules.defineEffect<CardUse,void>(b=>rules.call(volibearDomain.exports.open,{battle:b.read(v=>v.input.battle),turns:turns===null?null:b.read(v=>cardAmount(turns,v))}));
  return opensDomain(turns===null?describeProgram(effect,volibearDomain.exports.describe(null)):describeAmounts(effect,[turns],n=>volibearDomain.exports.describe(n)));
}
export function deployPower(power:DescribedPower&{complete?:boolean},amount:CardAmount){
  const effect=rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    definition:power.definition,registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,amount:b.read(v=>cardAmount(amount,v)),
  }));
  return power.complete===false?effect:describeAmounts(effect,[amount],n=>`获得${n}层${power.name}。${power.text}`);
}
export function faceTarget(){
  return describeProgram(rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>rules.call(volibearEngage.exports.execute,{use:b.input,target}))),'迎战目标。'+volibearEngage.exports.text);
}
export function amountFormula(base:CardAmount,calculate:(base:number,v:rules.ReadView<CardUse>)=>number,render:(base:string)=>string):CardAmount{
  const callback=(v:rules.ReadView<CardUse>)=>calculate(cardAmount(base,v),v),text=amountText(base);
  return text===undefined?callback:describeAmount(callback,render(text));
}
