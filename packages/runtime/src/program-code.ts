import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export { programCapabilities } from './program-capabilities.ts';
const require = createRequire(import.meta.url);
const factories = new Map<string, Function>();
/** Load precompiled CommonJS factory code once in the current runtime.
 * The temporary module is removed immediately; no author-source transformation occurs. */
export function loadProgramFactory(code: string): Function {
  const hash = createHash('sha256').update(code).digest('hex');
  const cached = factories.get(hash);
  if (cached) return cached;
  const directory = mkdtempSync(join(tmpdir(), 'bear-module-'));
  const filename = join(directory, 'program.cjs');
  try {
    writeFileSync(filename, code, {
      mode: 0o600
    });
    const factory = require(filename);
    if (typeof factory !== 'function') throw Error('Artifact must export an instance factory');
    if (factories.size >= 4) factories.delete(factories.keys().next().value!);
    factories.set(hash, factory);
    return factory;
  } finally {
    const loaded = require.cache[filename];
    if (loaded?.parent) {
      const index = loaded.parent.children.indexOf(loaded);
      if (index >= 0) loaded.parent.children.splice(index, 1);
    }
    delete require.cache[filename];
    unlinkSync(filename);
    rmdirSync(directory);
  }
}
