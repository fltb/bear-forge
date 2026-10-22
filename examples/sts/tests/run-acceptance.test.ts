import test from 'node:test';
import {compareRun,cppComparisonEnabled} from './reference/compare.ts';

// A source path alone never enables comparison. Default acceptance requires TS
// only; STS_COMPARE_CPP=1 pairs the same live run with the configured reference.
const compareCpp=cppComparisonEnabled();
for(const seed of ['130','936','2410'])test(`normal Ironclad A20 seed=${seed} controlled BaseGame reaches terminal${compareCpp?' and agrees with C++':''}`,{timeout:600_000},async()=>{
  await compareRun(seed,{compareCpp});
});
