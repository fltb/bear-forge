import {createLayeredPolicy} from './layered-policy.ts';
import type {Policy,SearchCost} from '@bear-forge/policies';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {GameHandle} from '@bear-forge/contracts/loading';
import type {StsTypes} from '../contract.ts';

export type StsSearchResult={action:JsonValue|null;evidence:JsonValue;cost:SearchCost};
export type StsSearchOptions={
  character:'ironclad'|'volibear';
  /** A scheduling slice only; unfinished current graphs are retained. */
  schedulingMilliseconds?:number;
  forkCurrent?:()=>Promise<GameHandle<StsTypes>>;
  account?:{milliseconds:number};
  onEvidence?:(result:StsSearchResult)=>void;
};
export function createSearchPolicy(options:StsSearchOptions):Policy{
  return createLayeredPolicy(options);
}
