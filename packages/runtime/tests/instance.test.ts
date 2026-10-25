import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callback, Controller } from '../src/index.ts';
import type { RawStop } from '../src/index.ts';
import type { ControllerContinuation } from '../src/instance.ts';
test('execution may mutate and republish a reply without inheriting host ownership certificates', async () => {
  for (const mode of ['cycle', 'accessor'] as const) {
    let getters = 0, raw: RawStop = { kind: 'call', call: { port: 'echo', input: null } };
    const schema = z.any();
    const controller = new Controller({ current: () => raw, async advance(value: any) {
      if (mode === 'cycle') value.self = value;
      else Object.defineProperty(value, 'secret', { get() { getters++; return 1; }, enumerable: true });
      raw = { kind: 'call', call: { port: 'echo', input: value } };
    }, dispose() {} }, { setup: z.null(), result: schema, ports: { echo: { input: schema, output: schema } } }, null);
    const handle = controller.handle();
    await handle.bind({ echo: async () => ({ kind: 'reply', value: { values: [1, 2] } }) });
    const step = await handle.run(); assert.equal(step.ok, true);
    if (!step.ok) throw Error('run failed');
    if (mode === 'cycle') {
      assert.equal(step.value.state.kind, 'call');
      if (step.value.state.kind !== 'call') throw Error('missing republished cycle');
      const input: any = step.value.state.call.input; assert.equal(input.self, input);
    } else assert.equal(step.value.state.kind, 'fault');
    assert.equal(getters, 0);
    const returned = controller.records!.slice().find(record => record.kind === 'returned');
    assert.ok(returned?.kind === 'returned');
    assert.deepEqual(returned.reply.output, { values: [1, 2] });
    await handle.close();
  }
});
test('handler pause/error/invalid reply remain distinct', async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await callback(async () => ({
    kind: 'pause'
  }), signal), {
    pause: 'requested'
  });
  assert.deepEqual(await callback(async () => {
    throw Error('failed');
  }, signal), {
    pause: 'handler_failed'
  });
  assert.deepEqual(await callback(async () => ({
    kind: 'reply',
    value: () => 0
  }), signal), {
    pause: 'invalid_reply'
  });
});

test('cancelled host callbacks never inspect or copy a late reply packet', async () => {
  const controller = new AbortController();
  let settle!: (value: unknown) => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const reply = new Promise<unknown>(resolve => { settle = resolve; });
  const waiting = callback(() => { entered(); return reply; }, controller.signal);
  await ready;
  controller.abort();
  assert.deepEqual(await waiting, { pause: 'cancelled' });
  let inspections = 0;
  settle(new Proxy({ kind: 'reply', value: { count: 1 } }, {
    ownKeys(target) { inspections++; return Reflect.ownKeys(target); },
    getPrototypeOf(target) { inspections++; return Reflect.getPrototypeOf(target); }
  }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(inspections, 0);
});

test('execution faults use structured state rather than exception text or forged properties', async () => {
  for (const mode of ['message', 'forged', 'budget', 'invalid-output', 'unreadable', 'coercion'] as const) {
    let advanced = false;
    let stop: RawStop = { kind: 'call', call: { port: 'step', input: 0 } };
    const controller = new Controller<null, { step: { input: number; output: number } }, number>({
      current() {
        if (advanced && mode === 'unreadable') throw new Error('budget exceeded');
        return stop;
      },
      async advance() {
        advanced = true;
        if (mode === 'coercion') throw {toString(){throw Error('diagnostics executed application code');}};
        if (mode === 'budget' || mode === 'invalid-output') stop = {
          kind: 'fault', error: { kind: 'fault', code: mode === 'budget' ? 'budget_exceeded' : 'invalid_output', message: 'limit reached' }
        };
        throw mode === 'forged'
          ? Object.assign(new Error('ordinary failure'), { name: 'NativeBudgetError', code: 'budget_exceeded' })
          : new Error(mode === 'message' ? 'budget exceeded; timed out' : 'ordinary failure');
      },
      dispose() {}
    }, { setup: z.null(), ports: { step: { input: z.number(), output: z.number() } }, result: z.number() }, null);
    const instance = controller.handle();
    assert.equal((await instance.bind({ step: async () => ({ kind: 'reply', value: 1 }) })).ok, true);
    const result = await instance.run();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('run rejected');
    assert.equal(result.value.accepted, true);
    assert.equal(result.value.state.kind, 'fault');
    if (result.value.state.kind !== 'fault') throw new Error('missing fault');
    assert.equal(result.value.state.error.code, mode === 'budget' ? 'budget_exceeded' : mode === 'invalid-output' ? 'invalid_output' : 'program_failed', mode);
  }
});

test('private Controller publication retries never consume the accepted reply or append its return twice',async()=>{
  type Ports={step:{input:number;output:number}};
  const schemas={setup:z.null(),ports:{step:{input:z.number(),output:z.number()}},result:z.number()};
  let raw:RawStop={kind:'call',call:{port:'step',input:0}},callbacks=0,advances=0;
  let saved!:ControllerContinuation<null,Ports,number>;
  let original!:Controller<null,Ports,number>;
  original=new Controller<null,Ports,number>({current:()=>raw,async advance(value){
    advances++;raw={kind:'done',result:value};saved=original.saveContinuation();
    // The original edge is complete. Only the saved, direct current will be
    // continued below; this obsolete owner exits without executing more code.
    throw Error('Transferred direct current');
  },dispose(){}},schemas,null);
  const handle=original.handle();
  const bound=await handle.bind({step:async()=>{callbacks++;return{kind:'reply',value:9};}});assert.equal(bound.ok,true);
  assert.equal((await handle.run()).ok,true);assert.equal((await handle.close()).ok,true);
  assert.equal(saved.accepted.phase,'advance');
  let resumes=0,publications=0;
  const restored=new Controller<null,Ports,number>({current(){
    publications++;if(publications===1)throw Error('Export pending');return raw;
  },async advance(){throw Error('Consumed replies cannot be advanced again');},async resume(){resumes++;},dispose(){}},schemas,null,saved,saved.recording);
  assert.equal(publications,0,'restoring pending host data does not inspect or publish the execution');
  await assert.rejects(()=>restored.resumeContinuation(),/Export pending/);
  const after=restored.saveContinuation();assert.equal(after.accepted.phase,'publish');
  assert.deepEqual(after.records,saved.records);assert.deepEqual(after.state,saved.state);
  const next=await restored.resumeContinuation();assert.deepEqual(next,{accepted:true,state:{kind:'done',result:9},pause:null});
  assert.equal(resumes,1);assert.equal(publications,2);assert.equal(callbacks,1);assert.equal(advances,1);
  assert.deepEqual(restored.records!.slice().map(row=>row.kind),['started','called','returned','completed']);
  assert.equal((await restored.handle().close()).ok,true);
});
