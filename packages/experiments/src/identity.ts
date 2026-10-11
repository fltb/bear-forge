import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
/** Frozen business implementation identity, derived from the actual production source. */
export async function implementationIdentity() {
  const root = fileURLToPath(new URL('../../../', import.meta.url)),
    hash = createHash('sha256');
  async function add(directory: string) {
    for (const entry of (await readdir(join(root, directory), {
      withFileTypes: true
    })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = directory + '/' + entry.name;
      if (entry.isDirectory()) await add(path);else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        hash.update(path);
        hash.update(await readFile(join(root, path)));
      }
    }
  }
  for (const directory of ['packages/contracts/src', 'packages/game-sdk/src', 'packages/boundary/src', 'packages/runtime/src', 'packages/runtime-native/src', 'packages/runtime-controlled/src', 'packages/compiler/src', 'vendor/effectful/continuations', 'vendor/effectful/serialization', 'packages/experiments/src', 'packages/game-host/src', 'packages/policies/src', 'examples/forge-duel/src']) await add(directory);
  hash.update(await readFile(join(root, 'package-lock.json')));
  return {
    sourceDigest: hash.digest('hex'),
    rule: 'forge-duel-v1',
    policies: ['first-legal@1', 'last-legal@1', 'random-legal@1', 'forge-rule@1'],
    encoder: 'plain-request@1'
  };
}
