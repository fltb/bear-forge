import type {CardDefinition} from '@bear-forge/card-engine';
import {withProbabilityTracking} from '../../../../packages/runtime-card/src/probability-tracking.ts';
import type {Ports,Frame} from '../game.schemas.ts';

/** Keep the live resource account and direct Context persistence. Search starts
 * at the actual current; no historical posterior is generated or maintained. */
export function withStsProbabilityTracking<S,Setup>(definition:CardDefinition<S,Setup,Ports,Frame>){
  return withProbabilityTracking(definition,{
    mode:'current',
    isDecision:stop=>stop.call.port==='decision',
  });
}
