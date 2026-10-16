import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { compileNativeEntry } from '@bear-forge/compiler';
import { createNativeLoader, nativeProgram, NativeBudgetError, isNativeBudgetError } from '../src/index.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};

test('native schema parse results do not alias author-owned program state', async () => {
  const artifact = await compileNativeEntry(new URL('./schema-facade-fixture.ts', import.meta.url).pathname);
  const program = await nativeProgram(artifact);
  const value = program.schemas.setup.parse({ count: 1 }) as { count: number };
  value.count = 9;
  assert.equal(await program.run({ count: 1 }, { call: async () => { throw Error('Unexpected IO'); } }), 1);
});

test('native declaration projection ignores unknown accessors without invoking them', async () => {
  const artifact = await compileNativeEntry(new URL('./schema-shape-fixture.ts', import.meta.url).pathname);
  const program = await nativeProgram(artifact);
  assert.equal(Object.hasOwn(program.schemas, 'leaked'), false);
  assert.equal(await program.run(null, { call: async () => { throw Error('Unexpected IO'); } }), null);
});

test('native programs cannot read debug stacks or recapture them, but keep explicit stack values',async()=>{
  const artifact=await compileNativeEntry(new URL('./stack-fixture.ts',import.meta.url).pathname);
  const loaded=unwrap(await createNativeLoader().load(await nativeProgram(artifact)));
  for(const mode of ['default','capture','assigned'] as const){
    const instance=unwrap(await loaded.core.start(mode));
    try{
      const state=unwrap(await instance.inspect());
      if(mode==='assigned')assert.deepEqual(state,{kind:'done',result:{owned:true}});
      else {assert.equal(state.kind,'fault');assert.equal(state.error.code,'program_failed');}
    }finally{await instance.close();}
  }
});

test('native loader awaits module initialization and isolates concurrent instance state',async()=>{
  const artifact=await compileNativeEntry(new URL('./top-level-await-fixture.ts',import.meta.url).pathname);
  const loaded=unwrap(await createNativeLoader().load(await nativeProgram(artifact)));
  const instances=await Promise.all([3,5,3].map(async input=>({input,instance:unwrap(await loaded.core.start(input))})));
  try{
    for(const {input,instance} of instances){
      assert.equal(unwrap(await instance.inspect()).kind,'call');
      unwrap(await instance.bind({step:async()=>({kind:'reply',value:2})}));
      assert.deepEqual(unwrap(await instance.run()).state,{kind:'done',result:{count:input+2,trace:['initialized','run']}});
    }
  }finally{for(const {instance} of instances)await instance.close();}
});

test('native faults never coerce thrown values before or after an IO boundary', {timeout:3000}, async () => {
  let coercions=0;
  for(const after of [false,true]) for(const kind of ['object','error','proxy','revoked','forged']) {
    let thrown:object=kind==='error'?new Error('original'):{};
    Object.defineProperty(thrown,'toString',{value(){coercions++;throw Error('secondary');}});
    if(kind==='error')Object.defineProperty(thrown,'message',{get(){coercions++;throw Error('getter');}});
    if(kind==='proxy')thrown=new Proxy(thrown,{getPrototypeOf(){coercions++;throw Error('prototype');},get(){coercions++;throw Error('property');}});
    if(kind==='revoked'){const item=Proxy.revocable(thrown,{});item.revoke();thrown=item.proxy;}
    if(kind==='forged')Object.setPrototypeOf(thrown,NativeBudgetError.prototype);
    const loaded=unwrap(await createNativeLoader().load({
      schemas:{setup:z.null(),ports:{step:{input:z.number(),output:z.number()}},result:z.number()},
      async run(_setup,io){if(after)await io.call({port:'step',input:0});throw thrown;}
    }));
    const instance=unwrap(await loaded.core.start(null));
    if(after){unwrap(await instance.bind({step:async()=>({kind:'reply',value:1})}));unwrap(await instance.run());}
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'fault',error:{kind:'fault',code:'program_failed',message:kind==='error'?'Error':'Thrown object'}});
    await instance.close();
  }
  assert.equal(coercions,0);
  const actual=new NativeBudgetError('limit');Object.setPrototypeOf(actual,null);
  assert.equal(isNativeBudgetError(actual),true);
  assert.equal(isNativeBudgetError(Object.create(NativeBudgetError.prototype)),false);
});
test('native approved bundle retains V8 async execution and isolates mutable module state per instance', async () => {
  const artifact = await compileNativeEntry(new URL('./module-fixture.ts', import.meta.url).pathname);
  assert.ok(!artifact.code.includes('effects.fun'));
  const program = await nativeProgram<number, {}, number>(artifact),
    loaded = unwrap(await createNativeLoader().load(program));
  const a = unwrap(await loaded.core.start(3)),
    b = unwrap(await loaded.core.start(5)),
    c = unwrap(await loaded.core.start(3));
  assert.deepEqual(unwrap(await a.inspect()), {
    kind: 'done',
    result: 3
  });
  assert.deepEqual(unwrap(await b.inspect()), {
    kind: 'done',
    result: 5
  });
  assert.deepEqual(unwrap(await c.inspect()), {
    kind: 'done',
    result: 3
  });
  await a.close();
  await b.close();
  await c.close();
});
test('native computation budget stays faulted even when the author catches its exception', async () => {
  const artifact = await compileNativeEntry(new URL('./budget-fixture.ts', import.meta.url).pathname);
  const loaded = unwrap(await createNativeLoader().load(await nativeProgram(artifact, {
    stepBudget: 100000
  })));
  for (const mode of ['join-coercion-loop', 'join-getter-loop', 'sparse-callback-loop', 'sparse-search-loop', 'sparse-write-loop', 'concat-loop', 'flat-map-nested-loop', 'slice-loop', 'flat-loop', 'splice-delete-loop', 'splice-left-loop', 'splice-right-loop', 'array-callback-loop', 'typed-callback-loop', 'apply-list-loop', 'reflect-apply-list-loop', 'reflect-construct-list-loop', 'typed-from-loop', 'typed-construct-loop', 'typed-from-list-loop', 'typed-construct-list-loop', 'loop', 'spread-loop', 'collection-loop', 'collection-map-loop', 'collection-weak-map-loop', 'collection-weak-set-loop', 'array-from-loop', 'from-entries-loop', 'object-group-loop', 'map-group-loop', 'promise-all-loop', 'promise-settled-loop', 'promise-any-loop', 'promise-race-loop', 'aggregate-construct-loop', 'aggregate-call-loop']) {
    const instance = unwrap(await loaded.core.start(mode));
    const stop = unwrap(await instance.inspect());
    assert.equal(stop.kind, 'fault', mode);
    assert.equal(stop.error.code, 'budget_exceeded', mode);
    await instance.close();
  }
});
test('budget exhausted inside result schema remains budget_exceeded rather than invalid_output', async () => {
  const artifact = await compileNativeEntry(new URL('./schema-budget.ts', import.meta.url).pathname);
  const loaded = unwrap(await createNativeLoader().load(await nativeProgram(artifact, {
    stepBudget: 100000
  })));
  const instance = unwrap(await loaded.core.start(null));
  const stop = unwrap(await instance.inspect());
  assert.equal(stop.kind, 'fault');
  assert.equal(stop.error.code, 'budget_exceeded');
  await instance.close();
});

test('computed entropy access cannot be caught into native success',async()=>{const artifact=await compileNativeEntry(new URL('./entropy.ts',import.meta.url).pathname);const loaded=unwrap(await createNativeLoader().load(await nativeProgram(artifact)));const instance=unwrap(await loaded.core.start(null));const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'fault');assert.equal(stop.error.code,'program_failed');await instance.close();});

test('native compiled classes preserve method kinds, names and actual construction checks', async () => {
  const { program: source } = await import('./class-fixture.ts');
  const expected = await source.run(null, { call: async () => 5 });
  const artifact = await compileNativeEntry(new URL('./class-fixture.ts', import.meta.url).pathname);
  const loaded = unwrap(await createNativeLoader().load(await nativeProgram(artifact)));
  const instance = unwrap(await loaded.core.start(null));
  try {
    assert.equal(unwrap(await instance.inspect()).kind, 'call');
    unwrap(await instance.bind({ step: async () => ({ kind: 'reply', value: 5 }) }));
    assert.deepEqual(unwrap(await instance.run()).state, { kind: 'done', result: expected });
  } finally { await instance.close(); }
});

test('native compiled programs use generator controls without exposing writable host iterator prototypes', async () => {
  const artifact = await compileNativeEntry(new URL('./intrinsic-fixture.ts',import.meta.url).pathname);
  const loaded = unwrap(await createNativeLoader().load(await nativeProgram(artifact)));
  const prototypes = [[][Symbol.iterator](),''[Symbol.iterator](),new Map().entries(),new Set().values(),new Uint8Array().values()]
    .map(value=>Object.getPrototypeOf(value));
  prototypes.push(Object.getPrototypeOf((function*(){}).prototype),Object.getPrototypeOf((async function*(){}).prototype));
  const instance = unwrap(await loaded.core.start(null));
  try {
    assert.deepEqual(unwrap(await instance.inspect()), {kind:'done',result:{
      steps:[{value:1,done:false},{value:4,done:false},{value:3,done:true},
        {value:1,done:false},{value:4,done:false},{value:3,done:true},{value:5,done:true},{value:5,done:true}],
      protected:Array(7).fill(true),owned:7
    }});
    for (const value of prototypes) assert.equal(Object.hasOwn(value,'bearMutationProbe'),false);
  } finally {
    await instance.close();
    for (const value of prototypes) Reflect.deleteProperty(value,'bearMutationProbe');
  }
});

test('native production compiler preserves Promise creation, finally and combinator callbacks', async () => {
  const {program}=await import('./promise-fixture.ts');
  const artifact=await compileNativeEntry(new URL('./promise-fixture.ts',import.meta.url).pathname);
  const loaded=unwrap(await createNativeLoader().load(await nativeProgram(artifact)));
  for(const input of [3,7]){
    const expected=await program.run(input);
    const instance=unwrap(await loaded.core.start(input));
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:expected});
    assert.deepEqual(expected,{values:Array.from({length:10},(_,index)=>input+index),trace:['executor','reject','throw','done']});
    await instance.close();
  }
});

test('native initialization classifies actual budget faults without inspecting exception text', async () => {
  const artifact=await compileNativeEntry(new URL('./module-fixture.ts',import.meta.url).pathname);
  let failure:Error|undefined,budget=100000000;
  const program=await nativeProgram(artifact,{get stepBudget(){if(failure)throw failure;return budget;}});
  const loaded=unwrap(await createNativeLoader().load(program));
  for(const error of [Error('budget exceeded'),Error('timed out'),Object.assign(Error('budget'),{name:'NativeBudgetError',code:'budget_exceeded'})]){
    failure=error;
    const result=await loaded.core.start(0);
    assert.equal(result.ok,false);
    assert.equal(result.error.code,'program_failed');
  }
  failure=undefined;budget=1;
  const exhausted=await loaded.core.start(0);
  assert.equal(exhausted.ok,false);assert.equal(exhausted.error.code,'budget_exceeded');
});
