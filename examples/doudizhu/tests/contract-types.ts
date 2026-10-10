import type {GameContract} from '@bear-forge/contracts/authoring';
import type {DouDizhuTypes} from '../src/types.ts';
export function mismatchedContract(contract:GameContract<DouDizhuTypes>){
  const wrong:GameContract<DouDizhuTypes>={...contract,ports:{...contract.ports,
    // @ts-expect-error a declared request cannot be interpreted as an event outside
    decision:{kind:'event',receive:()=>({events:[],output:{kind:'clock',at:0}})},
  }};
  void wrong;
}
