import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry, compileJavaScript } from '@bear-forge/compiler';
import { createControlledLoader, programDigest, memorySnapshotStore } from '../src/index.ts';
import { ProgramExecution, decode } from '../src/execution.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('budget and undeclared entropy latch; overlapping or abandoned IO cannot become success; Done snapshots and artifact trust', async () => {
  const artifact = await compileEntry(new URL('./faults-fixture.ts', import.meta.url).pathname);
  assert.equal((await createControlledLoader({
    trustedDigests: new Set()
  }).load(artifact)).ok, false);
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]),
    stepBudget: 100000
  }).load(artifact));
  for (const mode of ['join-coercion-loop', 'join-getter-loop', 'sparse-callback-loop', 'sparse-search-loop', 'sparse-write-loop', 'concat-loop', 'flat-map-nested-loop', 'slice-loop', 'flat-loop', 'splice-delete-loop', 'splice-left-loop', 'splice-right-loop', 'array-callback-loop', 'typed-callback-loop', 'apply-list-loop', 'reflect-apply-list-loop', 'reflect-construct-list-loop', 'typed-from-loop', 'typed-construct-loop', 'typed-from-list-loop', 'typed-construct-list-loop', 'loop', 'catch-loop', 'spread-loop', 'collection-loop', 'collection-map-loop', 'collection-weak-map-loop', 'collection-weak-set-loop', 'array-from-loop', 'from-entries-loop', 'object-group-loop', 'map-group-loop', 'promise-all-loop', 'promise-settled-loop', 'promise-any-loop', 'promise-race-loop', 'aggregate-construct-loop', 'aggregate-call-loop', 'entropy', 'overlap', 'pending', 'schema-budget']) {
    const x = unwrap(await loaded.core.start(mode)),
      stop = unwrap(await x.inspect());
    assert.equal(stop.kind, 'fault', mode + ' ' + JSON.stringify(stop));
    assert.equal(stop.error.code, mode.includes('loop') || mode === 'schema-budget' ? 'budget_exceeded' : 'program_failed');
    assert.equal((await loaded.persistence.save(x)).ok, false);
    await x.close();
  }
  for (const mode of ['throw-object','throw-error','throw-after']) {
    const instance=unwrap(await loaded.core.start(mode));
    if(mode==='throw-after') {
      unwrap(await instance.bind({step:async()=>({kind:'reply',value:1})}));
      unwrap(await instance.run());
    }
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'fault',error:{kind:'fault',code:'program_failed',message:mode==='throw-error'?'Error':'Thrown object'}});
    assert.equal((await loaded.persistence.save(instance)).ok,false);
    await instance.close();
  }
  const setupFailure=await loaded.core.start('setup-budget');
  assert.equal(setupFailure.ok,false);
  assert.equal(setupFailure.error.code,'budget_exceeded');
  const schemaEffect=await loaded.core.start('schema-entropy');
  assert.equal(schemaEffect.ok,false);
  if(!schemaEffect.ok) assert.equal(schemaEffect.error.code,'program_failed');
  const invalidSetup=await loaded.core.start('not-a-mode' as any);
  assert.equal(invalidSetup.ok,false);
  if(!invalidSetup.ok) assert.equal(invalidSetup.error.code,'invalid_input');
  const ended = unwrap(await loaded.core.start('done'));
  assert.deepEqual(unwrap(await ended.inspect()), {
    kind: 'done',
    result: 4
  });
  const snapshot = unwrap(await loaded.persistence.save(ended));
  await ended.close();
  const restored = unwrap(await loaded.persistence.restore(snapshot));
  assert.deepEqual(unwrap(await restored.run()), {
    state: {
      kind: 'done',
      result: 4
    },
    accepted: false,
    pause: null
  });
  unwrap(await loaded.persistence.release(snapshot));
  assert.equal((await loaded.persistence.restore(snapshot)).ok, false);
  unwrap(await loaded.persistence.release(snapshot));
  await restored.close();
});


test('loader rejects an invalid schema before exposing a Core', async () => {
  const artifact = compileJavaScript('export const program={schemas:{},async run(){return 1;}};');
  const result = await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)])
  }).load(artifact);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'invalid_argument');
});

test('controlled execution rejects a run result that is not a managed Promise', () => {
  const artifact = decode(compileJavaScript('export const program={schemas:{},run(){return 42;}};').content);
  const instance = new ProgramExecution(artifact);
  try { assert.throws(() => instance.start(null), /Incompatible intrinsic receiver/); }
  finally { instance.dispose(); }
});

test('an invalid port reply cannot commit game-schema state before a valid retry', async () => {
  const artifact=await compileEntry(new URL('./reply-validation-fixture.ts',import.meta.url).pathname);
  const loaded=unwrap(await createControlledLoader({
    trustedDigests:new Set([programDigest(artifact.content)])
  }).load(artifact));
  const instance=unwrap(await loaded.core.start(null));
  const pending=unwrap(await instance.inspect());
  assert.equal(pending.kind,'call');
  let attempts=0;
  unwrap(await instance.bind({step:async()=>({kind:'reply',value:++attempts===1?-1:4})}));
  const rejected=unwrap(await instance.run());
  assert.equal(rejected.accepted,false);
  assert.equal(rejected.pause,'invalid_reply');
  assert.equal(rejected.state.kind,'call');
  if(pending.kind==='call'&&rejected.state.kind==='call') assert.equal(rejected.state.callId,pending.callId);
  const snapshot=unwrap(await loaded.persistence.save(instance));
  const restored=unwrap(await loaded.persistence.restore(snapshot));
  unwrap(await restored.bind({step:async()=>({kind:'reply',value:4})}));
  const restoredRun=unwrap(await restored.run());
  assert.deepEqual(restoredRun.state,{kind:'done',result:1});
  await restored.close();
  unwrap(await loaded.persistence.release(snapshot));
  const accepted=unwrap(await instance.run());
  assert.equal(accepted.accepted,true);
  assert.deepEqual(accepted.state,{kind:'done',result:1});
  await instance.close();
  const effect=unwrap(await loaded.core.start(null));
  unwrap(await effect.bind({step:async()=>({kind:'reply',value:9})}));
  const effectRun=unwrap(await effect.run());
  assert.equal(effectRun.state.kind,'fault');
  if(effectRun.state.kind==='fault') assert.equal(effectRun.state.error.code,'program_failed');
  await effect.close();
  const cancelled=unwrap(await loaded.core.start(null));
  const aborter=new AbortController();
  unwrap(await cancelled.bind({step:async()=>{
    let abort=()=>aborter.abort();
    for(let index=0;index<3;index++){
      const previous=abort;
      abort=()=>queueMicrotask(previous);
    }
    queueMicrotask(abort);
    return {kind:'reply',value:4};
  }}));
  const cancelledRun=unwrap(await cancelled.run({signal:aborter.signal}));
  assert.equal(cancelledRun.accepted,false);
  assert.equal(cancelledRun.pause,'cancelled');
  assert.equal(cancelledRun.state.kind,'call');
  unwrap(await cancelled.bind({step:async()=>({kind:'reply',value:4})}));
  const afterCancel=unwrap(await cancelled.run());
  assert.deepEqual(afterCancel.state,{kind:'done',result:1});
  await cancelled.close();
});

test('a loaded Program cannot release a different Program snapshot from a shared store', async () => {
  const firstArtifact = await compileEntry(new URL('./module-state.ts', import.meta.url).pathname);
  const alternative = JSON.parse(new TextDecoder().decode(firstArtifact.content));
  alternative.exportName = 'namespaceProgram';
  const secondArtifact = {
    ...firstArtifact,
    content: new TextEncoder().encode(JSON.stringify(alternative))
  };
  const store = memorySnapshotStore();
  const first = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(firstArtifact.content)]), snapshots: store
  }).load(firstArtifact));
  const second = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(secondArtifact.content)]), snapshots: store
  }).load(secondArtifact));
  const instance = unwrap(await first.core.start(null));
  const snapshot = unwrap(await first.persistence.save(instance));
  await instance.close();
  const wrongRelease = await second.persistence.release(snapshot);
  assert.equal(wrongRelease.ok, false);
  const restored = unwrap(await first.persistence.restore(snapshot));
  assert.equal(unwrap(await restored.inspect()).kind, 'call');
  await restored.close();
  unwrap(await first.persistence.release(snapshot));
});

test('controlled declaration inspection ignores unknown accessors without invoking them', async () => {
  const artifact = compileJavaScript(`export const program={
    schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{},
      get leaked(){throw Error('Undeclared schema getter executed');}},
    async run(){return null}
  };`);
  const instance = new ProgramExecution(decode(artifact.content));
  instance.start(null);
  assert.doesNotThrow(() => instance.boundarySchemas());
});

test('controlled ProgramModule fields are checked before invoking author accessors', async () => {
  for (const field of ['run', 'schemas'] as const) {
    const program = field === 'run'
      ? `schemas:{},get run(){throw Error('ProgramModule getter executed');}`
      : `get schemas(){throw Error('ProgramModule getter executed');},async run(){return null}`;
    const artifact = compileJavaScript(`export const program={${program}};`);
    const result = await createControlledLoader({
      trustedDigests: new Set([programDigest(artifact.content)])
    }).load(artifact);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'invalid_argument');
      assert.match(result.error.message ?? '', /Invalid ProgramModule/);
    }
  }
});
