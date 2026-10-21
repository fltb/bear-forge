import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSourceBoundaries } from '../../contracts/tests/support/source-boundaries.ts';

test('kernel depends only on public IO types, with no game or runtime imports', () => {
  assertSourceBoundaries(fileURLToPath(new URL('../src', import.meta.url)), 'sdk',['card.ts','resolution.ts']);
});

test('rule services may use schema support but cannot import game, runtime or host capabilities',()=>{
  assertSourceBoundaries(fileURLToPath(new URL('../src', import.meta.url)), 'rules');
});
