import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

type Call = {port: string; input: unknown};
type Trace = {calls: Call[]; replies: number[]; value: unknown};
let referenceId = 0;
async function reference(source: string, bias: number): Promise<Trace> {
  // Original ESM runs in V8; each import gets fresh module state. No compiler
  // output or controlled scheduler participates in producing the oracle.
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${referenceId++}`);
  const calls: Call[] = [], replies: number[] = [];
  const value = await module.program.run(null, {async call(call: Call) {
    calls.push(structuredClone(call));
    const reply = bias + calls.length * 3;
    replies.push(reply);
    return reply;
  }});
  return {calls, replies, value};
}
function drive(initial: ProgramExecution, expected: Trace, mode: 'run' | 'fork' | 'restore' | 'replay' = 'run') {
  let instance = initial;
  const owned = new Set([initial]);
  try {
    for (let i = 0; i < expected.calls.length; i++) {
      assert.equal(instance.result.status, 0, `call ${i}: ${String(instance.result.value)}`);
      assert.deepEqual(instance.io.callData, expected.calls[i], `call ${i}`);
      if (mode !== 'run') {
        const old = instance;
        if (mode === 'fork') instance = old.fork();
        else {
          instance = old.fresh();
          if (mode === 'replay') instance.start(null);
          else instance.restore(old.snapshot());
        }
        owned.add(instance);
        assert.strictEqual(instance.loaded, old.loaded);
        assert.deepEqual(instance.io.callData, expected.calls[i], `copied call ${i}`);
        instance.resume(expected.replies[i]);
        assert.deepEqual(old.io.callData, expected.calls[i], 'child must not advance its parent');
        old.dispose();owned.delete(old);
      } else instance.resume(expected.replies[i]);
    }
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected.value);
    const done = instance.fresh();
    try {
      done.restore(instance.snapshot());
      assert.equal(done.result.status, 1);
      assert.deepEqual(done.result.value, expected.value);
    } finally { done.dispose(); }
  } finally { for (const current of owned) current.dispose(); }
}

// Finite generated grammar: four templates, four source shapes each, 32 fixed
// seeds. Seeds change literals and branch conditions in the actual source.
// All communication still uses declared-style IO calls with ordinary data.
function generated(kind: number, shape: number, seed: number): string {
  const n = 2 + (seed * 13 + shape * 7) % 3;
  const initial = (seed * 17 + shape) % 29;
  const body = [
    `let value=${initial};const trace=[];
     for(let i=0;i<${n};i++){
       ${shape % 2 ? 'let j=0;while(j<2){value+=i+j++;}' : 'for(let j=0;j<2;j++){value+=i+j;}'}
       ${shape < 2 ? 'if(i%2)value++;else value-=2;' : 'switch(i%2){case 0:value-=2;break;default:value++;}'}
       trace.push(value);value+=await io.call({port:'step',input:[i,value]});
     }return [moduleCount,value,trace];`,
    `let value=${initial};const box={value};box.self=box;const alias=box;
     const add=amount=>{value+=amount;box.value=value;return value;};
     const read=${shape % 2 ? '()=>()=>value' : 'function(){return function(){return value;};}'};
     const readers=[read(),read()];
     for(let i=0;i<${n};i++){add(await io.call({port:'step',input:[i,readers[0](),box===alias]}));}
     ${shape < 2 ? 'alias.value++;' : 'box.self.value++;'}
     return [moduleCount,value,readers[1](),box.value,alias===box,box.self===box];`,
    `const trace=[];
     async function visit(depth,value){
       if(!depth)return value;
       const next=await io.call({port:'step',input:[depth,value]});
       ${shape % 2 ? 'const child=async()=>visit(depth-1,value+next);const answer=await child();' : 'const answer=await visit(depth-1,value+next);'}
       trace.push([depth,answer]);return answer${shape < 2 ? '+depth' : '*2-depth'};
     }return [moduleCount,await visit(${n},${initial}),trace];`,
    `let value=${initial};const trace=[];
     for(let i=0;i<${n};i++){
       try{value+=await io.call({port:'step',input:[i,value]});
         if((i+${seed})%2)throw new Error('branch');trace.push('normal');
       }catch(error){trace.push(error.message);value${shape % 2 ? '+=2' : '-=2'};}
       finally{trace.push('finally');${shape < 2 ? 'value++;' : 'value+=await io.call({port:"cleanup",input:i});'}}
     }return [moduleCount,value,trace];`
  ][kind];
  return `let moduleCount=0;export const program={schemas:{},async run(_,io){moduleCount++;${body}}};`;
}
for (let kind = 0; kind < 4; kind++) for (let shape = 0; shape < 4; shape++) {
  test(`generated ESM template ${kind}, shape ${shape}: 32 seeds, IO copies and independent branches`, async () => {
    for (let seed = 0; seed < 32; seed++) {
      const source = generated(kind, shape, seed);
      const expected = await reference(source, 0), alternate = await reference(source, 100);
      const parent = new ProgramExecution(decode(compileJavaScript(source).content));
      parent.start(null);
      const initializations = parent.loaded.statistics.initializations;
      const sibling = parent.fork(), restored = parent.fresh();
      restored.restore(parent.snapshot());
      // A different reply stream is checked against its own native oracle.
      drive(sibling, alternate, 'fork');
      drive(restored, expected, 'restore');
      assert.equal(parent.loaded.statistics.initializations, initializations);
      const fresh = parent.fresh();fresh.start(null);
      drive(fresh, expected);
      drive(parent, expected);
    }
  });
}

test('differential driver detects state, IO-order, alias, cleanup and replay mutants', async () => {
  const source = `let moduleCount=0;export const program={schemas:{},async run(_,io){
    moduleCount++;let value=1;const box={n:1},alias=box;
    value+=await io.call({port:'first',input:value});
    try{alias.n+=value;value+=await io.call({port:'second',input:box.n});}
    finally{value+=10;}
    return [moduleCount,value,box.n,alias===box];
  }};`;
  const expected = await reference(source, 0);
  const mutations: [string, string][] = [
    ['value+=await', 'value=await'],
    ["port:'first'", "port:'second'"],
    ['alias=box', 'alias={n:1}'],
    ['value+=10', 'value+=0'],
    ['moduleCount++', 'moduleCount+=2'],
  ];
  for (const [before, after] of mutations) {
    assert.ok(source.includes(before));
    const instance = new ProgramExecution(decode(compileJavaScript(source.replace(before, after)).content));
    instance.start(null);
    assert.throws(() => drive(instance, expected), assert.AssertionError, before);
  }
  const swapped = source.replace("port:'first'", "port:'temporary'")
    .replace("port:'second'", "port:'first'").replace("port:'temporary'", "port:'second'");
  const reordered = new ProgramExecution(decode(compileJavaScript(swapped).content));reordered.start(null);
  assert.throws(() => drive(reordered, expected), assert.AssertionError);
  // Deliberately break the ownership invariant in the test, proving that the
  // oracle detects two starts sharing one mutable module environment.
  const first = new ProgramExecution(decode(compileJavaScript(source).content));first.start(null);
  const shared = first.fresh();
  (shared as any).context = (first as any).context;
  shared.start(null);
  try { assert.throws(() => drive(shared, expected), assert.AssertionError); }
  finally { first.dispose(); }
  const replay = new ProgramExecution(decode(compileJavaScript(source).content));replay.start(null);
  assert.throws(() => drive(replay, expected, 'replay'), assert.AssertionError);
});

test('trace assertions preserve ordering, special numbers, holes, aliases and cycles', () => {
  const compare = (actual: unknown, expected: unknown) => assert.deepEqual(actual, expected);
  for (const [actual, expected] of [
    [[2,1],[1,2]], [0,-0], [null,NaN], [{},{value:undefined}],
    [[undefined],new Array(1)], [1n,1]
  ]) assert.throws(() => compare(actual, expected), assert.AssertionError);
  const cyclic: any = {};cyclic.self=cyclic;
  const other: any = {};other.self=other;
  compare(cyclic,other);
  assert.throws(() => compare({self:{}},cyclic), assert.AssertionError);
  // Structural equality alone does not detect alias identity. Author fixtures
  // expose explicit identity observations, which must also be compared.
  assert.throws(() => compare([true],[false]), assert.AssertionError);
});
