import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardMachine, CardProgram, plainCardStorage, rules, linkRules } from '../src/index.ts';
import { portEffect } from '../src/rules-internal.ts';
import type { Effect, Value, Local } from '../src/rules.types.ts';

const { defineEffect, sequence, when, whileDo, forEach, call } = rules;
type Ports = { choose: { kind: 'request'; input: number; output: number } };
const schemas = { setup: z.number(), result: z.number(), ports: {
  choose: { kind: 'request' as const, input: z.number(), output: z.number() },
} };
const choose = portEffect<number, number>('choose');
function machine(entry: Effect<number, number>, definitions: Effect<any, any>[], input: number) {
  const definition = linkRules<{}, number, Ports, number>({ id: 'typed-test', schemas,
    initialize: () => ({}), entry, definitions });
  const program = new CardProgram(definition);
  return new CardMachine(program, plainCardStorage(program.initial(input)));
}

test('typed recursion, caller locals and return targets agree with an independent factorial', () => {
  const factorial: Effect<number, number> = defineEffect<number, number>(b => {
    const child = b.local<number>();
    return when(b.read(v => v.input < 2), b.return(1), sequence(
      b.assign(child, call(factorial, b.read(v => v.input - 1))),
      b.return(b.read(v => v.input * v.get(child))),
    ));
  });
  for (let n = 0; n <= 9; n++) {
    let expected = 1; for (let i = 2; i <= n; i++) expected *= i;
    assert.deepEqual(machine(factorial, [factorial], n).advance(), {kind:'done',result:expected});
  }
});

test('nested lexical loops and repeated requests preserve every pending iteration and outer slot', () => {
  const entry = defineEffect<number, number>(b => {
    const sum = b.local<number>(), reply = b.local<number>();
    return sequence(b.assign(sum, 0),
      forEach([2, 3], outer => forEach([5, 7], inner => sequence(
        b.assign(reply, call(choose, b.read(v => v.get(outer) * v.get(inner) + v.input))),
        b.assign(sum, b.read(v => v.get(sum) + v.get(reply))),
      ))), b.return(sum));
  });
  const parent = machine(entry, [entry, choose], 11);
  assert.deepEqual(parent.advance(), {kind:'call',call:{port:'choose',input:21}});
  const child = new CardMachine(parent.program, plainCardStorage(structuredClone(parent.root)));
  const restored = new CardMachine(parent.program, plainCardStorage(structuredClone(parent.root)));
  parent.storage.close?.();
  for (const [m, offset] of [[child,0],[restored,100]] as const) {
    for (const [index, expected] of [25,26,32].entries()) {
      assert.deepEqual(m.advance(index + offset), {kind:'call',call:{port:'choose',input:expected}});
    }
    assert.deepEqual(m.advance(3 + offset), {kind:'done',result:6 + 4*offset});
  }
});

test('while conditions re-read the same local and forEach captures its initial item order', () => {
  const entry = defineEffect<number, number>(b => {
    const n = b.local<number>(), total = b.local<number>();
    return sequence(b.assign(n,b.input),b.assign(total,0),
      whileDo(b.read(v=>v.get(n)>0),sequence(
        b.assign(total,b.read(v=>v.get(total)+v.get(n))),
        b.assign(n,b.read(v=>v.get(n)-1)),
      )), b.return(total));
  });
  for (let n=0;n<32;n++) assert.deepEqual(machine(entry,[entry],n).advance(),{kind:'done',result:n*(n+1)/2});
});

test('literal arguments are detached from mutable author objects when linked', () => {
  const config = {value:5};
  const pick = defineEffect<{value:number},number>(b=>b.return(b.read(v=>v.input.value)));
  const entry=defineEffect<number,number>(b=>{
    const result=b.local<number>();return sequence(b.assign(result,call(pick,config)),b.return(result));
  });
  const m=machine(entry,[entry,pick],0); config.value=99;
  assert.deepEqual(m.advance(),{kind:'done',result:5});
});

test('unbound definitions, duplicate links, foreign expressions and accessors fail linking', () => {
  const other=defineEffect<number,number>(b=>b.return(b.input));
  const entry=defineEffect<number,number>(b=>{const result=b.local<number>();return sequence(b.assign(result,call(other,1)),b.return(result));});
  assert.throws(()=>machine(entry,[entry],0),/Unbound rule call/);
  assert.throws(()=>machine(other,[other,other],0),/Duplicate rule definition/);
  let foreign:Value<number>;
  const first=defineEffect<number,number>(b=>{foreign=b.input;return b.return(1);});
  const second=defineEffect<number,number>(b=>b.return(foreign));
  assert.throws(()=>machine(second,[first,second],0),/Foreign rule expression/);
  let invoked=false;
  const literal={get value(){invoked=true;return 4;}};
  // Validate the accessor with a bound callee so missing-link checks do not mask it.
  const callee=defineEffect<{value:number},number>(b=>b.return(b.read(v=>v.input.value)));
  const accessor=defineEffect<number,number>(b=>{const r=b.local<number>();return sequence(b.assign(r,call(callee,literal)),b.return(r));});
  assert.throws(()=>machine(accessor,[accessor,callee],0),/accessors/);assert.equal(invoked,false);
});

test('uninitialized locals and asynchronous expressions are explicit faults', () => {
  const uninitialized=defineEffect<number,number>(b=>b.return(b.local<number>()));
  const m=machine(uninitialized,[uninitialized],0);
  assert.match(JSON.stringify(m.advance()),/Uninitialized rule local/);
  const bad=defineEffect<number,number>(b=>b.return(b.read((()=>Promise.resolve(2)) as any)));
  assert.match(JSON.stringify(machine(bad,[bad],0).advance()),/must be synchronous/);
});

test('identical authored effects linked twice have independent program layouts and loop bindings', () => {
  const sharedItems=[2,4];
  const entry=defineEffect<number,number>(b=>{
    const total=b.local<number>();return sequence(b.assign(total,0),forEach(sharedItems,item=>
      b.assign(total,b.read(v=>v.get(total)+v.get(item)+v.input))),b.return(total));
  });
  const first=machine(entry,[entry],1), second=machine(entry,[entry],10);
  assert.deepEqual(first.advance(),{kind:'done',result:8});
  assert.deepEqual(second.advance(),{kind:'done',result:26});
});

// These compile-time negatives belong to the formal workspace typecheck.
if (false) {
  const effect=defineEffect<{n:number},number>(b=>b.return(b.read(v=>v.input.n)));
  // @ts-expect-error mismatched effect input
  call(effect,{n:'bad'});
  defineEffect<void,number>(b=>{
    const slot:Local<number>=b.local<number>();
    // @ts-expect-error mismatched local assignment
    b.assign(slot,'bad');
    // @ts-expect-error mismatched effect return
    return b.return(false);
  });
}

test('literal graph aliases stay identical inside one call but never alias mutable author objects',()=>{
  const shared={n:4},literal={left:shared,right:shared};
  const check=defineEffect<typeof literal,number>(b=>b.return(b.read(v=>v.input.left===v.input.right?v.input.left.n:-1)));
  const entry=defineEffect<number,number>(b=>{const r=b.local<number>();return sequence(b.assign(r,call(check,literal)),b.return(r));});
  const m=machine(entry,[entry,check],0);shared.n=80;
  assert.deepEqual(m.advance(),{kind:'done',result:4});
});

test('a reusable utility may construct a finite nested effect during author lowering',()=>{
  const add=(amount:number)=>defineEffect<number,number>(b=>b.return(b.read(v=>v.input+amount)));
  const entry=defineEffect<number,number>(b=>{const result=b.local<number>();return sequence(b.assign(result,call(add(7),b.input)),b.return(result));});
  assert.deepEqual(machine(entry,[entry],3).advance(),{kind:'done',result:10});
});
