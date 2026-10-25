import type {Policy} from '../policy.types.ts';

/** Private host composition capability. Search Contexts never enter accepted
 * JSON policy memory or become part of the frozen game/instance protocols. */
export type PolicyWork={save():unknown;restore(saved:unknown):void;prepare?():Promise<void>;close():void};
const work=new WeakMap<Policy,PolicyWork>();
const suspended=new WeakMap<Policy,string>();
export class PolicyWorkSuspended extends Error{
  readonly reason:string;
  constructor(reason:string){super('Search remains incomplete: '+reason);this.reason=reason;}
}
export function registerPolicyWork(policy:Policy,value:PolicyWork){work.set(policy,value);}
export function policyWork(policy:Policy):PolicyWork|undefined{return work.get(policy);}
export function notePolicySuspension(policy:Policy,reason:string|null){if(reason===null)suspended.delete(policy);else suspended.set(policy,reason);}
export function suspendedPolicyWork(policies:Record<string,Policy>):string[]{return Object.values(policies).flatMap(policy=>{const reason=suspended.get(policy);return reason?[reason]:[];});}
export function savePolicyWork(policies:Record<string,Policy>):Record<string,unknown>{
  return Object.fromEntries(Object.entries(policies).flatMap(([player,policy])=>{const state=work.get(policy);return state?[[player,state.save()]]:[];}));
}
export function restorePolicyWork(policies:Record<string,Policy>,saved:Record<string,unknown>){
  for(const [player,value]of Object.entries(saved)){const policy=policies[player],state=policy&&work.get(policy);state!.restore(value);}
}
/** Attach saved Contexts to their live Program before marking new execution.
 * This phase must only restore data; it cannot decide or advance a current. */
export async function preparePolicyWork(policies:Record<string,Policy>):Promise<void>{
  for(const policy of new Set(Object.values(policies)))await work.get(policy)?.prepare?.();
}
export function closePolicyWork(policies:Record<string,Policy>){
  const errors:unknown[]=[];
  for(const policy of new Set(Object.values(policies))){try{work.get(policy)?.close();}catch(error){errors.push(error);}}
  if(errors.length)throw new AggregateError(errors,'Failed to release retained policy work');
}
