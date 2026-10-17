import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readdirSync} from 'node:fs';
import {assertSourceBoundaries} from '../../../packages/contracts/tests/support/source-boundaries.ts';
test('game entry and its transitive dependencies exclude host experiment code',()=>{
  const root = fileURLToPath(new URL('../src',import.meta.url));
  // Host-side experiment wiring is separate; every game source remains checked,
  // including any transitive attempt to import that wiring back into the game.
  const entries = readdirSync(root).filter(name => name.endsWith('.ts'));
  assertSourceBoundaries(root,'game',entries);
});
