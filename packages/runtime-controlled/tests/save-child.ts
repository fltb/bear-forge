import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/@babel|typescript|esbuild|bear-forge\/compiler/.test(specifier)) throw Error('Compiler must not load');
    return next(specifier, context);
  }
});
const {
  createControlledLoader,
  programDigest,
  fileSnapshotStore
} = await import('../src/index.ts');
const [file, directory] = process.argv.slice(2);
const content = new Uint8Array(await readFile(file!));
const unwrap = (x: any) => {
  if (!x.ok) throw Error(JSON.stringify(x.error));
  return x.value;
};
const loaded = unwrap(await createControlledLoader({
  trustedDigests: new Set([programDigest(content)]),
  snapshots: fileSnapshotStore(directory!)
}).load({
  content
} as never));
const instance = unwrap(await loaded.core.start({
  mode: 'closure',
  seed: 1,
  size: 4
}));
const saved = unwrap(await loaded.persistence.save(instance));
unwrap(await instance.close());
process.stdout.write(saved.snapshotId);
