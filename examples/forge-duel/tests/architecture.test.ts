import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSourceBoundaries } from '../../../packages/contracts/tests/support/source-boundaries.ts';

test('Forge card and contract dependency graphs use only public authoring capabilities', () => {
  assertSourceBoundaries(fileURLToPath(new URL('../src', import.meta.url)), 'game', ['card.ts', 'module.ts']);
});
