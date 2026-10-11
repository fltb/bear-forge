import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/@babel|typescript|esbuild|bear-forge\/compiler/.test(specifier)) throw Error('Compiler is forbidden in deployment');
    return next(specifier, context);
  }
});
const {
  createControlledLoader,
  programDigest,
  fileSnapshotStore
} = await import('../src/index.ts');
const {
  readFile
} = await import('node:fs/promises');
const [artifactPath, directory, snapshotId] = process.argv.slice(2);
const content = new Uint8Array(await readFile(artifactPath!));
const result = await createControlledLoader({
  trustedDigests: new Set([programDigest(content)]),
  snapshots: fileSnapshotStore(directory!)
}).load({
  kind: 'controlled-program',
  content
} as never);
if (!result.ok) throw Error(result.error.message);
const restored = await result.value.persistence!.restore({
  snapshotId: snapshotId!
} as never);
if (!restored.ok) throw Error(restored.error.message);
const calls: unknown[] = [];
let ordinal = 0;
await restored.value.bind({
  step: async (request: any) => {
    calls.push(request.input);
    return {
      kind: 'reply',
      value: 7 + ordinal++
    };
  }
} as never);
while (true) {
  const step = await restored.value.run();
  if (!step.ok) throw Error(step.error.message);
  if (step.value.state.kind === 'fault') throw Error(step.value.state.error.message);
  if (step.value.state.kind === 'done') {
    process.stdout.write(JSON.stringify({
      calls,
      result: step.value.state.result
    }));
    break;
  }
}
