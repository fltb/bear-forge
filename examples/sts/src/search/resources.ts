import {SearchBudget,type SearchLimits} from '@bear-forge/policies';
import {withCurrentSource} from '../../../../packages/game-host/src/current.ts';
import {acquireProbabilitySearch} from '../../../../packages/runtime-card/src/probability-tracking.ts';

/** One live instance account includes preparation, every search proposal and
 * subsequent probability maintenance. This capability reads costs only. */
export async function openStsSearchBudget(source:object,limits:SearchLimits,signal:AbortSignal,priorMilliseconds:number,started=performance.now()){
  const lease=await withCurrentSource(source,instance=>acquireProbabilitySearch(instance,priorMilliseconds));
  let budget:SearchBudget|undefined;
  try{
    const remaining=Math.max(0,60_000-lease.account.milliseconds-(performance.now()-started));
    budget=new SearchBudget(limits,signal,undefined,undefined,Math.max(Number.EPSILON,remaining));
    budget.includePreparation({milliseconds:lease.window.milliseconds+performance.now()-started,nodes:lease.window.nodes});
    return{budget,remaining,accountMilliseconds:lease.account.milliseconds,close(){
      const cost=budget!.cost();
      return lease.close({milliseconds:performance.now()-started,nodes:Math.max(0,budget!.nodes-lease.window.nodes),advances:cost.phases.advance?.calls??0}).milliseconds;
    }};
  }catch(error){lease.close({milliseconds:performance.now()-started,nodes:0,advances:0});throw error;}
}
