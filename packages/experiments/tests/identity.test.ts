import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { implementationIdentity } from '../src/identity.ts';

test('frozen implementation identity detects changes in the dedicated card engine and provider', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(root, 'identity-fixture-'));
  try {
    // Run the real implementation against a tiny isolated workspace, so this
    // check cannot change production sources or concurrent experiment hashes.
    for (const group of ['packages', 'vendor/effectful']) {
      for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
        if (entry.isDirectory()) await mkdir(join(directory, group, entry.name, 'src'), { recursive: true });
      }
    }
    await mkdir(join(directory, 'game'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'package-lock.json'), '{}');
    const implementation = join(directory, 'packages/experiments/src/identity.ts');
    await copyFile(fileURLToPath(new URL('../src/identity.ts', import.meta.url)), implementation);
    const { implementationIdentity: identify } = await import(implementation);
    const engine = join(directory, 'packages/card-engine/src/card.ts');
    const provider = join(directory, 'packages/runtime-card/src/loader.ts');
    await writeFile(engine, 'export const instruction = 1;');
    await writeFile(provider, 'export const provider = 1;');
    const first = (await identify(['game'], {})).sourceDigest;
    await writeFile(engine, 'export const instruction = 2;');
    const second = (await identify(['game'], {})).sourceDigest;
    assert.notEqual(second, first, 'changed card instructions must invalidate frozen experiments');
    await writeFile(provider, 'export const provider = 2;');
    assert.notEqual((await identify(['game'], {})).sourceDigest, second, 'changed card state management must invalidate frozen experiments');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('frozen implementation identity includes admitted JSON, MTS and package metadata', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(root, 'identity-fixture-'));
  const source = join(directory, 'src');
  try {
    await mkdir(source);
    const manifest = join(directory, 'package.json');
    const json = join(source, 'rules.json');
    const mts = join(source, 'program.mts');
    await writeFile(manifest, '{"type":"module","exports":"./src/program.mts"}');
    await writeFile(json, '{"damage":1}');
    await writeFile(mts, 'export const damage = 1;');
    const identity = () => implementationIdentity([relative(root, source)], {});
    const first = (await identity()).sourceDigest;
    await writeFile(json, '{"damage":2}');
    const second = (await identity()).sourceDigest;
    assert.notEqual(second, first, 'JSON data modules change game behavior');
    await writeFile(mts, 'export const damage = 2;');
    const third = (await identity()).sourceDigest;
    assert.notEqual(third, second, 'admitted MTS source must be frozen');
    await writeFile(manifest, '{"type":"module","exports":"./src/other.mts"}');
    assert.notEqual((await identity()).sourceDigest, third, 'package resolution metadata must be frozen');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('frozen implementation identity follows local imports outside declared source directories', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(root, 'identity-fixture-'));
  const source = join(directory, 'src');
  const assets = join(directory, 'assets');
  try {
    await mkdir(source);
    await mkdir(assets);
    await writeFile(join(source, 'program.mts'), `export { default } from '../assets/rules.mts'; export const load = () => import('../assets/late.mts'); export const optional = () => import('../assets/optional.mts');`);
    await writeFile(join(assets, 'rules.mts'), `import rules from './rules.json' with { type: 'json' }; export default rules;`);
    const late = join(assets, 'late.mts');
    await writeFile(late, `export default 1;`);
    const rules = join(assets, 'rules.json');
    await writeFile(rules, '{"damage":1}');
    const identity = () => implementationIdentity([relative(root, source)], {});
    const first = (await identity()).sourceDigest;
    await writeFile(rules, '{"damage":2}');
    const second = (await identity()).sourceDigest;
    assert.notEqual(second, first, 'imported rule data outside src changes behavior');
    await writeFile(late, `export default 2;`);
    const third = (await identity()).sourceDigest;
    assert.notEqual(third, second, 'literal dynamic import must be tracked');
    await writeFile(join(assets, 'optional.mts'), `export default 3;`);
    assert.notEqual((await identity()).sourceDigest, third, 'a previously absent dynamic dependency must change identity when added');
    await writeFile(join(assets, 'rules.mts'), `export { default } from './missing.json' with { type: 'json' };`);
    await assert.rejects(identity(), /Unresolved local implementation dependency/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('frozen implementation identity rejects computed module requests it cannot enumerate', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(root, 'identity-fixture-'));
  const source = join(directory, 'src');
  try {
    await mkdir(source);
    const program = join(source, 'program.mts');
    const identity = () => implementationIdentity([relative(root, source)], {});
    await writeFile(program, `export const load = (path: string) => import(path);`);
    await assert.rejects(identity(), /Computed module dependency cannot be frozen/);
    await writeFile(program, `export const load = (path: string) => require(path);`);
    await assert.rejects(identity(), /Computed module dependency cannot be frozen/);
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'bridge.mts'), `export const load = (path: string) => import(path);`);
    await writeFile(program, `export { load } from '../assets/bridge.mts';`);
    await assert.rejects(identity(), /Computed module dependency cannot be frozen/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
