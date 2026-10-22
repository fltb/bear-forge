import test from 'node:test';
import {compareRun} from './reference/compare.ts';

// Routine acceptance compares terminal results only. No replay, native baseline,
// intermediate capture, checkpoint loop or diagnostic state inspection.
for(const seed of ['130','936','2410'])test(`normal Ironclad A20 seed=${seed} controlled BaseGame and C++ agree at terminal`,{timeout:600_000},async()=>{
  await compareRun(seed);
});
