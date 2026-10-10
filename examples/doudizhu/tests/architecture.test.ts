import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {assertSourceBoundaries} from '../../../packages/contracts/tests/support/source-boundaries.ts';
test('game source respects its dependency boundary',()=>{
  assertSourceBoundaries(fileURLToPath(new URL('../src',import.meta.url)),'game');
});
