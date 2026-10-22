import test from 'node:test';
import {requireDifftest} from './reference/client.ts';
import {compareRun} from './reference/compare.ts';

// Explicit diagnostics only; never imported by routine acceptance.
const {seed}=requireDifftest();
test(`explicit live controlled BaseGame/C++ difftest seed=${seed}`,{timeout:600_000},async()=>{
  await compareRun(seed,{differential:true});
});
