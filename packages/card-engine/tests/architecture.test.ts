import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSourceBoundaries } from '../../contracts/tests/support/source-boundaries.ts';

test('kernel depends only on public IO types, with no game or runtime imports', () => {
  assertSourceBoundaries(fileURLToPath(new URL('../src', import.meta.url)), 'sdk');
});
