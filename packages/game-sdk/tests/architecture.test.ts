import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {assertSourceBoundaries} from '../../contracts/tests/support/source-boundaries.ts';
test('sdk source respects its dependency boundary',()=>{
  assertSourceBoundaries(fileURLToPath(new URL('../src',import.meta.url)),'sdk');
});
