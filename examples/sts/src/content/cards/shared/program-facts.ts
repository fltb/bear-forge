import {describeProgram,programText} from '../../../rules/program-descriptions.ts';
export {describeProgram,programText} from '../../../rules/program-descriptions.ts';
import {rules} from '../../../rules/execution.ts';
import {z} from 'zod';
import {cardUseSchema} from '../../../rules/card-instances.schemas.ts';
import type {CardIdentity,CardMetadata,CardUse} from '../../../rules/card-instances.types.ts';
import type {CardAmount} from './programs.ts';

/** Assembly-only projections attached to the actual effect definition. These are
 * never interpreted to execute a card and never become mutable Context state. */
type Attack = Readonly<{amount:CardAmount;fixed:boolean}>;
const nativeLightning=new WeakSet<object>();
export function thunderProgram<T extends rules.Effect<CardUse,void>>(effect:T):T{nativeLightning.add(effect);return effect;}
export function hasNativeLightning(effect:rules.Effect<CardUse,void>):boolean{return nativeLightning.has(effect);}
const attacks = new WeakMap<rules.Effect<CardUse,void>,readonly Attack[]>();
const amountBases=new WeakMap<Extract<CardAmount,Function>,CardAmount>();
const amountTexts=new WeakMap<object,string>();

/** Read-only, current-state damage operands provided by the real constructors.
 * No effect execution, RNG, hidden piles, damage checkpoints or future state. */
export const damageTermsSchema=z.array(z.object({label:z.string(),target:z.number().nullable(),amount:z.number(),hits:z.number()}));
export type DamageTerms=z.infer<typeof damageTermsSchema>;
const damageTerms=new WeakMap<object,rules.Query<CardUse,DamageTerms>>();
const domainOpeners=new WeakSet<object>();
export function opensDomain<T extends object>(effect:T):T{domainOpeners.add(effect);return effect;}
export function programOpensDomain(effect:object){return domainOpeners.has(effect);}
const noDamageTerms=rules.defineQuery({input:cardUseSchema,output:damageTermsSchema,base:()=>[]});
export function damageTermsFor(effect:object){return damageTerms.get(effect)??noDamageTerms;}
export function withDamageTerms<T extends object>(effect:T,projection:rules.Query<CardUse,DamageTerms>):T{damageTerms.set(effect,projection);return effect;}
export function inheritDamageTerms<T extends object>(effect:T,...children:object[]):T{
  if(children.some(programOpensDomain))domainOpeners.add(effect);else domainOpeners.delete(effect);
  const queries=children.map(damageTermsFor).filter(q=>q!==noDamageTerms);
  if(!queries.length){damageTerms.delete(effect);return effect;}
  return withDamageTerms(effect,rules.defineQuery({input:cardUseSchema,output:damageTermsSchema,dependencies:queries,base:(r,use)=>queries.flatMap(q=>r.query(q,use))}));
}

/** Opaque callback descriptions belong to the constructor that implements them. */
export function describeAmount<T extends CardAmount>(amount:T,text:string):T{
  if(typeof amount!=='number')amountTexts.set(amount,text);
  return amount;
}
export function amountText(amount:CardAmount):string|undefined{
  if(typeof amount==='number')return String(amount);
  const text=amountTexts.get(amount);
  if(text!==undefined)return text;
  if(typeof amount==='function')return undefined;
  return amount[0]===amount[1]?String(amount[0]):`${amount[0]}（${amount[1]}）`;
}

/** An amount combinator records the base it actually uses, not a second number. */
export function registerAmountBase<T extends Extract<CardAmount,Function>>(amount:T,base:CardAmount):T{
  amountBases.set(amount,base);
  return amount;
}
function amountBase(amount:CardAmount):CardAmount{
  if(typeof amount!=='function')return amount;
  const base=amountBases.get(amount);
  return base===undefined?amount:amountBase(base);
}

/** The attack constructor supplies the very same amount used by its hit program. */
export function attackProgram(effect:rules.Effect<CardUse,void>,amount:CardAmount,fixed=false):rules.Effect<CardUse,void>{
  attacks.set(effect,[{amount,fixed}]);
  return effect;
}

/** Combinators preserve capabilities without inspecting opaque TS callbacks. */
export function inheritPrograms(effect:rules.Effect<CardUse,void>,...children:rules.Effect<CardUse,void>[]):rules.Effect<CardUse,void>{
  inheritDamageTerms(effect,...children);
  if(children.some(child=>nativeLightning.has(child)))nativeLightning.add(effect);
  attacks.set(effect,children.flatMap(child=>attacks.get(child)??[]));
  const descriptions=children.map(programText);
  describeProgram(effect,descriptions.every(text=>text!==undefined)?descriptions.filter(Boolean).join(''):undefined);
  return effect;
}

export function hasFixedAttack(effect:rules.Effect<CardUse,void>):boolean{
  return (attacks.get(effect)??[]).some(attack=>attack.fixed);
}

export function programMetadata(identity:CardIdentity,effect:rules.Effect<CardUse,void>):CardMetadata{
  const attack=attacks.get(effect)?.[0];
  const amount=attack===undefined?undefined:amountBase(attack.amount);
  // The existing public field is base damage, not a simulation of a dynamic use.
  // Dynamic attacks retain the existing zero sentinel; non-attacks use -1.
  const damage=(index:0|1)=>amount===undefined?-1:typeof amount==='number'?amount:typeof amount==='function'?0:amount[index];
  const metadata:CardMetadata={...identity,variants:[{...identity.variants[0],damage:damage(0)},{...identity.variants[1],damage:damage(1)}]};
  return metadata;
}
