import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSourceBoundaries } from '@bear-forge/contracts/tests/support/source-boundaries';

test('Forge card and contract dependency graphs use only public authoring capabilities', () => {
  assertSourceBoundaries(fileURLToPath(new URL('../src', import.meta.url)), 'game', ['card.ts', 'module.ts']);
});
