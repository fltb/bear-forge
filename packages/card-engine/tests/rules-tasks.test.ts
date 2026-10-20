import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,ruleModules,linkRules,CardMachine,CardProgram,plainCardStorage} from '../src/index.ts';
import {portEffect} from '../src/rules-internal.ts';
import type {Effect} from '../src/rules.types.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,sequence,call,query,enqueue,schedule,cancelScheduled,emit}=rules;
const {drainQueue,openScope,closeScope}=ruleModules;
const queue=Object.freeze({label:'actions'}),scopeKind=Object.freeze({label:'turn'}),choose=portEffect<number,number>('choose');
function fixture(){return defineRules({requires:[],build(m){
  const log=m.own(defineComponent({schema:z.array(z.number()),initial:()=>[]}));
  const tick=m.own(defineEvent({payload:z.number(),publicEmit:true}));
  const append=m.atom({input:z.number(),output:z.undefined(),reads:[log],writes:[log],emits:[],run(r,n){return{writes:[{entity:0,component:log,value:[...r.component(0,log),n]}],events:[],result:undefined};}});
  const history=defineQuery({input:z.undefined(),output:z.array(z.number()),reads:[log],base:r=>r.component(0,log)});
  const matches=defineQuery({input:z.any(),output:z.boolean(),base:(_r,input)=>input.event===input.input});
  m.lifecycle(scopeKind,{});
  const kind=m.kind({config:z.undefined(),components:[]});
  return{exports:{append,history,tick:tick.public,matches,kind}};
}});}
const schemas={setup:z.number(),result:z.array(z.number()),ports:{choose:{input:z.number(),output:z.number()}}};
function run(entry:Effect<number,readonly number[]>,module:ReturnType<typeof fixture>){const d=linkRules({id:'tasks',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[module],initialEntities:[0]});const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(0)));}

test('queued calls keep front/back order and cancellation removes exactly one pending task',()=>{
  const m=fixture();const entry=defineEffect<number,readonly number[]>(b=>{const cancelled=b.local<number>();return sequence(
    enqueue(m.exports.append,1,{queue,lifetime:0}),enqueue(m.exports.append,2,{queue,position:'front',lifetime:0}),
    b.assign(cancelled,enqueue(m.exports.append,3,{queue,lifetime:0})),cancelScheduled(cancelled),
    call(m.exports.append,9),drainQueue(queue),b.return(query(m.exports.history,undefined)),
  );});
  const machine=run(entry,m);assert.deepEqual(machine.advance(),{kind:'done',result:[9,2,1]});assert.deepEqual((machine.root.state as any).$rules.tasks,{});
});

test('a task may wait and restore without restarting the dequeued effect or losing subsequent work',()=>{
  const m=fixture(),task=defineEffect<number,void>(b=>{const answer=b.local<number>();return sequence(b.assign(answer,call(choose,b.input)),call(m.exports.append,answer));});
  const entry=defineEffect<number,readonly number[]>(b=>sequence(enqueue(task,7,{queue,lifetime:0}),enqueue(m.exports.append,10,{queue,lifetime:0}),drainQueue(queue),b.return(query(m.exports.history,undefined))));
  const parent=run(entry,m);assert.deepEqual(parent.advance(),{kind:'call',call:{port:'choose',input:7}});
  const restored=new CardMachine(parent.program,plainCardStorage(structuredClone(parent.root)));
  assert.deepEqual(parent.advance(3),{kind:'done',result:[3,10]});assert.deepEqual(restored.advance(8),{kind:'done',result:[8,10]});
});

test('a delayed task activates on its next matching event exactly once',()=>{
  const m=fixture();const entry=defineEffect<number,readonly number[]>(b=>sequence(
    schedule(m.exports.append,4,{queue,lifetime:0,at:{event:m.exports.tick,condition:m.exports.matches}}),
    emit(m.exports.tick,2),drainQueue(queue),emit(m.exports.tick,4),emit(m.exports.tick,4),drainQueue(queue),
    emit(m.exports.tick,4),drainQueue(queue),b.return(query(m.exports.history,undefined)),
  ));assert.deepEqual(run(entry,m).advance(),{kind:'done',result:[4]});
});

test('scope expiry removes pending and delayed tasks before a later event can activate them',()=>{
  const m=fixture();const entry=defineEffect<number,readonly number[]>(b=>{const scope=b.local<number>();return sequence(
    b.assign(scope,openScope(scopeKind,0)),enqueue(m.exports.append,1,{queue,lifetime:scope}),schedule(m.exports.append,2,{queue,lifetime:scope,at:{event:m.exports.tick}}),closeScope(scope),emit(m.exports.tick,2),drainQueue(queue),b.return(query(m.exports.history,undefined)),
  );});const machine=run(entry,m);assert.deepEqual(machine.advance(),{kind:'done',result:[]});assert.deepEqual((machine.root.state as any).$rules.tasks,{});
});

test('source departure cancels pending and delayed work that requires it, while explicitly captured static work survives',()=>{
  const m=fixture(),definition=rules.defineEntity(m.exports.kind,undefined);
  const entry=defineEffect<number,readonly number[]>(b=>{const source=b.local<number>();return sequence(
    b.assign(source,rules.spawnEntity({definition,owner:null,scope:0})),
    enqueue(m.exports.append,1,{queue,lifetime:0,source}),enqueue(m.exports.append,2,{queue,lifetime:0,source,eligible:'captured'}),
    schedule(m.exports.append,3,{queue,lifetime:0,source,at:{event:m.exports.tick}}),schedule(m.exports.append,4,{queue,lifetime:0,source,eligible:'captured',at:{event:m.exports.tick}}),
    rules.despawnEntity({entity:source,reason:'gone'}),emit(m.exports.tick,0),drainQueue(queue),b.return(query(m.exports.history,undefined)),
  );});
  const machine=run(entry,m);assert.deepEqual(machine.advance(),{kind:'done',result:[2,4]});assert.deepEqual((machine.root.state as any).$rules.tasks,{});
});

test('scheduler queue size counts pending entries and excludes delayed, canceled and running calls',()=>{
  const m=fixture(),size=()=>ruleModules.queueSize(queue);
  const running=defineEffect<void,void>(()=>call(m.exports.append,size()));
  const entry=defineEffect<number,readonly number[]>(b=>{const canceled=b.local<number>();return sequence(
    call(m.exports.append,size()),schedule(m.exports.append,99,{queue,lifetime:0,at:{event:m.exports.tick}}),
    enqueue(running,undefined,{queue,lifetime:0}),b.assign(canceled,enqueue(m.exports.append,88,{queue,lifetime:0})),
    call(m.exports.append,size()),cancelScheduled(canceled),call(m.exports.append,size()),drainQueue(queue),call(m.exports.append,size()),b.return(query(m.exports.history,undefined)),
  );});
  assert.deepEqual(run(entry,m).advance(),{kind:'done',result:[0,2,1,0,0]});
});

test('single-task scheduling returns control between tasks and reports an empty queue without executing again',()=>{
  const m=fixture();const entry=defineEffect<number,readonly number[]>(b=>{const ran=b.local<boolean>();return sequence(
    enqueue(m.exports.append,1,{queue,lifetime:0}),enqueue(m.exports.append,2,{queue,lifetime:0}),
    b.assign(ran,ruleModules.drainOne(queue)),call(m.exports.append,ruleModules.queueSize(queue)),call(m.exports.append,b.read(v=>v.get(ran)?9:8)),
    ruleModules.drainOne(queue),call(m.exports.append,ruleModules.queueSize(queue)),b.assign(ran,ruleModules.drainOne(queue)),call(m.exports.append,b.read(v=>Number(v.get(ran)))),b.return(query(m.exports.history,undefined)),
  );});assert.deepEqual(run(entry,m).advance(),{kind:'done',result:[1,1,9,2,0,0]});
});
