import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardProgram,CardMachine,plainCardStorage,linkRules,rules } from '../src/index.ts';
import { portEffect } from '../src/rules-internal.ts';
import type { Effect } from '../src/rules.types.ts';
import type { ReplacementContext,ReplacementResult } from '../src/rules-checkpoints.types.ts';
const {defineRules,defineComponent,defineQuery,defineCheckpoint,defineEffect,sequence,when,call,replace,restrict,install}=rules;
const choose=portEffect<number,number>('choose');
const schemas={setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}};
function fixture(){return defineRules({requires:[],build(m){
  const amount=m.own(defineComponent({schema:z.number(),initial:()=>0}));
  const checkpoint=m.own(defineCheckpoint({input:z.number(),output:z.number()}));
  const positive=defineQuery({input:z.any(),output:z.boolean(),base:(_r,input)=>input.value>=10});
  const current=defineQuery({input:z.undefined(),output:z.number(),reads:[amount],base:r=>r.component(0,amount)});
  const commit=m.atom({input:z.number(),output:z.number(),reads:[],writes:[amount],emits:[],run(_r,value){return{writes:[{entity:0,component:amount,value}],events:[],result:value};}});
  const guarded=defineEffect<number,number>(b=>{
    const checked=b.local<ReplacementResult<number>>(),result=b.local<number>();
    return sequence(b.assign(checked,m.resolve(checkpoint,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(-1),sequence(
      b.assign(result,call(commit,b.read(v=>{const r=v.get(checked);if(r.kind==='cancel')throw Error('unreachable');return r.value;}))),b.return(result),
    )));
  });return{exports:{guarded,checkpoint:checkpoint.public,positive,current}};
}});}
function run(entry:Effect<number,number>,module:ReturnType<typeof fixture>,input=1){
  const d=linkRules({id:'checkpoints',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[module],initialEntities:[0]});
  const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(input)));
}
function returnGuarded(b:any,module:ReturnType<typeof fixture>){const r=b.local();return sequence(b.assign(r,call(module.exports.guarded,b.input)),b.return(r));}

test('two sources with the same replacement definition both apply once, in registration order',()=>{
  const m=fixture();const double=defineEffect<ReplacementContext<number>,ReplacementResult<number>>(b=>b.return({kind:'change',value:b.read(v=>v.input.value*2)}));
  const ability=replace(m.exports.checkpoint,{effect:double});
  const entry=defineEffect<number,number>(b=>sequence(
    install({source:0,owner:0,ability,environment:{},lifetime:0}),install({source:0,owner:0,ability,environment:{},lifetime:0}),returnGuarded(b,m),
  ));
  assert.deepEqual(run(entry,m,3).advance(),{kind:'done',result:12});
});

test('a restriction can cancel after an earlier replacement without committing the target action',()=>{
  const m=fixture();
  const double=defineEffect<ReplacementContext<number>,ReplacementResult<number>>(b=>b.return({kind:'change',value:b.read(v=>v.input.value*2)}));
  const first=replace(m.exports.checkpoint,{effect:double,order:0});
  const second=restrict(m.exports.checkpoint,{when:m.exports.positive,reason:'too-hot',order:1});
  const entry=defineEffect<number,number>(b=>sequence(
    install({source:0,owner:0,ability:first,environment:{},lifetime:0}),install({source:0,owner:0,ability:second,environment:{},lifetime:0}),returnGuarded(b,m),
  ));
  const machine=run(entry,m,6);assert.deepEqual(machine.advance(),{kind:'done',result:-1});
  assert.equal((machine.root.state as any).$rules.entities[0].components[0],0);
});

test('a replacement may wait and resumes without selecting or applying it twice',()=>{
  const m=fixture();
  const effect=defineEffect<ReplacementContext<number>,ReplacementResult<number>>(b=>{
    const answer=b.local<number>();return sequence(b.assign(answer,call(choose,b.read(v=>v.input.value))),b.return({kind:'change',value:answer}));
  });
  const ability=replace(m.exports.checkpoint,{effect});
  const entry=defineEffect<number,number>(b=>sequence(install({source:0,owner:0,ability,environment:{},lifetime:0}),returnGuarded(b,m)));
  const parent=run(entry,m,7);assert.deepEqual(parent.advance(),{kind:'call',call:{port:'choose',input:7}});
  const restored=new CardMachine(parent.program,plainCardStorage(structuredClone(parent.root)));
  assert.deepEqual(parent.advance(8),{kind:'done',result:8});assert.deepEqual(restored.advance(11),{kind:'done',result:11});
});

test('keep cannot silently mutate a checkpoint value',()=>{
  const m=fixture();const invalid=defineEffect<ReplacementContext<number>,ReplacementResult<number>>(b=>b.return({kind:'keep',value:99}));
  const ability=replace(m.exports.checkpoint,{effect:invalid});
  const entry=defineEffect<number,number>(b=>sequence(install({source:0,owner:0,ability,environment:{},lifetime:0}),returnGuarded(b,m)));
  const machine=run(entry,m,3);assert.match(JSON.stringify(machine.advance()),/Keep result cannot change/);
  assert.equal((machine.root.state as any).$rules.entities[0].components[0],0);
});

test('a module cannot execute another module checkpoint with a fabricated authority',()=>{
  const a=fixture();
  const b=defineRules({requires:[a],build(m){const intrude=defineEffect<number,ReplacementResult<number>>(b=>{const x=b.local<ReplacementResult<number>>();return sequence(b.assign(x,m.resolve({public:a.exports.checkpoint} as any,b.input)),b.return(x));});return{exports:{intrude}};}});
  const entry=defineEffect<number,number>(x=>sequence(call(b.exports.intrude,x.input),x.return(0)));
  assert.throws(()=>linkRules({id:'bad-checkpoint',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[b],initialEntities:[0]}),/Unauthorized rule checkpoint execution/);
});

for(const eligible of ['registered','captured'] as const)test(`replacement eligibility is rechecked after a suspended callback unregisters itself; eligible=${eligible}`,()=>{
  const m=fixture();
  const effect=defineEffect<ReplacementContext<number>,ReplacementResult<number>>(b=>{const answer=b.local<number>();return sequence(
    b.assign(answer,call(choose,b.read(v=>v.input.value))),rules.uninstall(b.read(v=>v.input.registration)),b.return({kind:'change',value:answer}),
  );});
  const ability=replace(m.exports.checkpoint,{effect,eligible});
  const entry=defineEffect<number,number>(b=>sequence(install({source:0,owner:0,ability,environment:{},lifetime:0}),returnGuarded(b,m)));
  const parent=run(entry,m,3);assert.equal(parent.advance().kind,'call');
  const restored=new CardMachine(parent.program,plainCardStorage(structuredClone(parent.root)));
  assert.deepEqual(parent.advance(9),{kind:'done',result:eligible==='registered'?3:9});
  assert.deepEqual(restored.advance(11),{kind:'done',result:eligible==='registered'?3:11});
});
