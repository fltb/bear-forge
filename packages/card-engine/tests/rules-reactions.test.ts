import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardMachine, CardProgram, plainCardStorage, linkRules, rules } from '../src/index.ts';
import { dispatchQueuedEvents } from '../src/rules-reactions.ts';
import { portEffect } from '../src/rules-internal.ts';
import type { ReactionContext } from '../src/rules-reactions.types.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,query,on,install,uninstall,sequence,call}=rules;
const choose=portEffect<number,number>('choose');
const schemas={setup:z.number(),result:z.array(z.number()),ports:{choose:{input:z.number(),output:z.number()}}};
function fixture(mode:'queued'|'immediate'='queued'){
  return defineRules({requires:[],build(m){
    const heat=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const log=m.own(defineComponent({schema:z.array(z.number()),initial:()=>[]}));
    const changed=m.own(defineEvent({payload:z.number(),dispatch:mode}));
    const temperature=defineQuery({input:z.number(),output:z.number(),reads:[heat],base:r=>r.component(0,heat)});
    const hot=defineQuery({input:z.any(),output:z.boolean(),reads:[heat],base:r=>r.component(0,heat)>=10});
    const history=defineQuery({input:z.number(),output:z.array(z.number()),reads:[log],base:r=>r.component(0,log)});
    const doubled=defineQuery({input:z.number(),output:z.number(),dependencies:[temperature],base:(r,input)=>r.query(temperature,input)*2});
    const add=m.atom({input:z.number(),output:z.number(),reads:[heat],writes:[heat],emits:[changed],run(r,n){
      const next=r.component(0,heat)+n;return{writes:[{entity:0,component:heat,value:next}],events:[{event:changed,payload:next}],result:next};
    }});
    const append=m.atom({input:z.number(),output:z.undefined(),reads:[log],writes:[log],emits:[],run(r,n){return{
      writes:[{entity:0,component:log,value:[...r.component(0,log),n]}],events:[],result:undefined,
    };}});
    return{exports:{add,append,changed:changed.public,temperature,hot,history,doubled}};
  }});
}
function run(entry:ReturnType<typeof defineEffect<number,readonly number[]>>,module:ReturnType<typeof fixture>){
  const d=linkRules({id:'reactions',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[module],initialEntities:[0]});
  const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(0)));
}

test('pure queries can depend on other queries and cannot change source components',()=>{
  const mod=fixture();
  const entry=defineEffect<number,readonly number[]>(b=>sequence(call(mod.exports.add,7),
    b.return([query(mod.exports.temperature,0),query(mod.exports.doubled,0)])));
  assert.deepEqual(run(entry,mod).advance(),{kind:'done',result:[7,14]});
});

test('event conditions see proposed post-commit values and late listeners do not join old events',()=>{
  const mod=fixture();
  const listener=defineEffect<ReactionContext<number,{tag:number}>,void>(b=>call(mod.exports.append,b.read(v=>v.input.event+v.input.environment.tag)));
  const ability=on(mod.exports.changed,{condition:mod.exports.hot,effect:listener});
  const entry=defineEffect<number,readonly number[]>(b=>sequence(
    install({source:0,owner:0,ability,environment:{tag:100},lifetime:0}),
    call(mod.exports.add,5), // Captured while cold: no handler.
    call(mod.exports.add,10), // Captured with proposed temperature 15, not previous 5.
    install({source:0,owner:0,ability,environment:{tag:200},lifetime:0}),
    call(dispatchQueuedEvents,undefined),b.return(query(mod.exports.history,0)),
  ));
  assert.deepEqual(run(entry,mod).advance(),{kind:'done',result:[115]});
});

for(const captured of [false,true])test(`uninstall obeys explicit ${captured?'capture-only':'still-registered'} eligibility`,()=>{
  const mod=fixture();
  const listener=defineEffect<ReactionContext<number>,void>(b=>call(mod.exports.append,b.read(v=>v.input.event)));
  const ability=on(mod.exports.changed,{eligible:captured?'captured':'registered',effect:listener});
  const entry=defineEffect<number,readonly number[]>(b=>{const registration=b.local<number>();return sequence(
    b.assign(registration,install({source:0,owner:0,ability,environment:{},lifetime:0})),
    call(mod.exports.add,12),uninstall(registration),call(dispatchQueuedEvents,undefined),b.return(query(mod.exports.history,0)),
  );});
  assert.deepEqual(run(entry,mod).advance(),{kind:'done',result:captured?[12]:[]});
});

test('ordered listener dispatch can pause repeatedly and resumes from the exact current handler',()=>{
  const mod=fixture();
  const callback=defineEffect<ReactionContext<number,{tag:number}>,void>(b=>{
    const answer=b.local<number>();return sequence(
      b.assign(answer,call(choose,b.read(v=>v.input.environment.tag))),call(mod.exports.append,answer));
  });
  const high=on(mod.exports.changed,{effect:callback,order:20}),low=on(mod.exports.changed,{effect:callback,order:-10});
  const entry=defineEffect<number,readonly number[]>(b=>sequence(
    install({source:0,owner:0,ability:high,environment:{tag:20},lifetime:0}),
    install({source:0,owner:0,ability:low,environment:{tag:-10},lifetime:0}),
    call(mod.exports.add,1),call(dispatchQueuedEvents,undefined),b.return(query(mod.exports.history,0)),
  ));
  const m=run(entry,mod);assert.deepEqual(m.advance(),{kind:'call',call:{port:'choose',input:-10}});
  const restored=new CardMachine(m.program,plainCardStorage(structuredClone(m.root)));
  assert.deepEqual(m.advance(4),{kind:'call',call:{port:'choose',input:20}});
  assert.deepEqual(restored.advance(9),{kind:'call',call:{port:'choose',input:20}});
  assert.deepEqual(m.advance(5),{kind:'done',result:[4,5]});
  assert.deepEqual(restored.advance(10),{kind:'done',result:[9,10]});
});

test('immediate events finish before an atom returns its result',()=>{
  const mod=fixture('immediate');
  const callback=defineEffect<ReactionContext<number>,void>(b=>call(mod.exports.append,b.read(v=>v.input.event)));
  const ability=on(mod.exports.changed,{effect:callback});
  const entry=defineEffect<number,readonly number[]>(b=>sequence(
    install({source:0,owner:0,ability,environment:{},lifetime:0}),call(mod.exports.add,3),b.return(query(mod.exports.history,0)),
  ));
  assert.deepEqual(run(entry,mod).advance(),{kind:'done',result:[3]});
});

test('a failing capture query sees proposed values but leaves the whole committed state unchanged',()=>{
  const mod=defineRules({requires:[],build(m){
    const value=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const event=m.own(defineEvent({payload:z.number()}));
    const condition=defineQuery({input:z.any(),output:z.boolean(),reads:[value],base:r=>{if(r.component(0,value)>0)throw Error('capture failed');return true;}});
    const change=m.atom({input:z.number(),output:z.number(),reads:[],writes:[value],emits:[event],run(_r,n){return{writes:[{entity:0,component:value,value:n}],events:[{event,payload:n}],result:n};}});
    return{exports:{condition,change,event:event.public}};
  }});
  const listener=defineEffect<ReactionContext<number>,void>(b=>b.return(undefined));
  const ability=on(mod.exports.event,{effect:listener,condition:mod.exports.condition});
  const entry=defineEffect<number,readonly number[]>(b=>sequence(
    install({source:0,owner:0,ability,environment:{},lifetime:0}),call(choose,0),call(mod.exports.change,3),b.return([]),
  ));
  const definition=linkRules({id:'capture-atomicity',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[mod],initialEntities:[0]});
  const p=new CardProgram(definition),m=new CardMachine(p,plainCardStorage(p.initial(0)));
  assert.equal(m.advance().kind,'call');const before=structuredClone(m.root.state);
  assert.match(JSON.stringify(m.advance(0)),/capture failed/);assert.deepEqual(m.root.state,before);
});
