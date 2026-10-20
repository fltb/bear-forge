import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardProgram,CardMachine,plainCardStorage,linkRules,rules } from '../src/index.ts';
import { openScope,closeScope } from '../src/rules-scopes.ts';
import { portEffect } from '../src/rules-internal.ts';
import type { Effect } from '../src/rules.types.ts';
import type { EntityLifecycle } from '../src/rules-entities.types.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,call,query,spawnEntity,scopeOf}=rules;
const choose=portEffect<number,number>('choose'),lifetime=Object.freeze({label:'combat'});
const schemas={setup:z.number(),result:z.array(z.number()),ports:{choose:{input:z.number(),output:z.number()}}};
function fixture(wait=false){return defineRules({requires:[],build(m){
  const counter=m.own(defineComponent({schema:z.number(),initial:()=>1}));
  const log=m.own(defineComponent({schema:z.array(z.number()),initial:()=>[]}));
  const append=m.atom({input:z.number(),output:z.undefined(),reads:[log],writes:[log],emits:[],run(r,n){return{writes:[{entity:0,component:log,value:[...r.component(0,log),n]}],events:[],result:undefined};}});
  const initialized=defineEffect<EntityLifecycle,void>(b=>sequence(...(wait?[call(choose,b.read(v=>v.input.entity))]:[]),call(append,b.read(v=>v.input.entity*10))));
  const disposed=defineEffect<EntityLifecycle&{reason:unknown},void>(b=>call(append,b.read(v=>v.input.entity*10+1)));
  const kind=m.kind({config:z.object({name:z.string()}),components:[counter],initialize:initialized,dispose:disposed});
  m.lifecycle(lifetime,{initialize:defineEffect(b=>call(append,100)),dispose:defineEffect(b=>call(append,101))});
  const history=defineQuery({input:z.undefined(),output:z.array(z.number()),reads:[log],base:r=>r.component(0,log)});
  return{exports:{kind,history}};
}});}
function run(entry:Effect<number,readonly number[]>,module:ReturnType<typeof fixture>){
  const d=linkRules({id:'entities',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[module],initialEntities:[0]});
  const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(0)));
}

test('scope and entity lifecycle effects execute once, then clean owned entities while preserving the run root',()=>{
  const m=fixture(),entity=defineEntity(m.exports.kind,{name:'cultist'});
  const entry=defineEffect<number,readonly number[]>(b=>{const scope=b.local<number>(),created=b.local<number>(),found=b.local<number>();return sequence(
    b.assign(scope,openScope(lifetime,0)),b.assign(created,spawnEntity({definition:entity,owner:0,scope})),
    b.assign(found,scopeOf(created,lifetime)),closeScope(scope),closeScope(scope),
    b.return(b.read(v=>[...v.get(query(m.exports.history,undefined)),v.get(found)])),
  );});
  const machine=run(entry,m);assert.deepEqual(machine.advance(),{kind:'done',result:[100,10,101,11,1]});
  const state=(machine.root.state as any).$rules;
  assert.deepEqual(Object.keys(state.entities),['0']);assert.equal(state.scopes[1].phase,'closed');assert.equal(state.nextEntity,2);
});

test('entity initialization can wait and restoring the frame never reruns component factories or prior scope hooks',()=>{
  const m=fixture(true),entity=defineEntity(m.exports.kind,{name:'cultist'});
  const entry=defineEffect<number,readonly number[]>(b=>{const scope=b.local<number>();return sequence(b.assign(scope,openScope(lifetime,0)),spawnEntity({definition:entity,owner:0,scope}),b.return(query(m.exports.history,undefined)));});
  const machine=run(entry,m);assert.deepEqual(machine.advance(),{kind:'call',call:{port:'choose',input:1}});
  const child=new CardMachine(machine.program,plainCardStorage(structuredClone(machine.root)));
  assert.deepEqual(machine.advance(8),{kind:'done',result:[100,10]});assert.deepEqual(child.advance(9),{kind:'done',result:[100,10]});
  assert.equal((child.root.state as any).$rules.nextEntity,2);assert.equal((child.root.state as any).$rules.entities[1].phase,'active');
});

test('nested scope teardown closes children before their parent without replaying either lifecycle',()=>{
  const m=fixture();
  const entry=defineEffect<number,readonly number[]>(b=>{const parent=b.local<number>(),child=b.local<number>();return sequence(
    b.assign(parent,openScope(lifetime,0)),b.assign(child,openScope(lifetime,parent)),closeScope(parent),b.return(query(m.exports.history,undefined)),
  );});
  const machine=run(entry,m);assert.deepEqual(machine.advance(),{kind:'done',result:[100,100,101,101]});
  const scopes=(machine.root.state as any).$rules.scopes;assert.equal(scopes[1].phase,'closed');assert.equal(scopes[2].phase,'closed');
});

test('entities cannot spawn into an ended scope and definition configuration is validated',()=>{
  const m=fixture();assert.throws(()=>defineEntity(m.exports.kind,{name:3} as any));
  const entity=defineEntity(m.exports.kind,{name:'cultist'});
  const entry=defineEffect<number,readonly number[]>(b=>{const scope=b.local<number>();return sequence(b.assign(scope,openScope(lifetime,0)),closeScope(scope),spawnEntity({definition:entity,owner:0,scope}),b.return([]));});
  assert.match(JSON.stringify(run(entry,m).advance()),/Invalid entity scope/);
});

test('dynamic setup initializes one static entity definition and configuration reads enforce their kind declaration',()=>{
  const m=defineRules({requires:[],build(m){
    const value=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const set=m.atom({input:z.object({entity:z.number(),value:z.number()}),output:z.undefined(),reads:[],writes:[value],emits:[],run(_r,input){return{writes:[{entity:input.entity,component:value,value:input.value}],events:[],result:undefined};}});
    const initialize=defineEffect<EntityLifecycle<number>,void>(b=>call(set,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}));
    const kind=m.kind({config:z.object({factor:z.number()}),setup:z.number().int().positive(),components:[value],initialize});
    const total=defineQuery({input:z.number(),output:z.number(),reads:[value],kinds:[kind],base:(r,entity)=>r.component(entity,value)*r.configuration(entity,kind).factor});
    return{exports:{kind,total}};
  }});
  const entity=defineEntity(m.exports.kind,{factor:3});
  const entry=defineEffect<number,readonly number[]>(b=>{const id=b.local<number>();return sequence(
    b.assign(id,spawnEntity({definition:entity,owner:null,scope:0,setup:b.input})),b.return([query(m.exports.total,id)]),
  );});
  const definition=linkRules({id:'dynamic-setup',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[m]});
  const program=new CardProgram(definition);
  for(const input of [2,7])assert.deepEqual(new CardMachine(program,plainCardStorage(program.initial(input))).advance(),{kind:'done',result:[input*3]});
  const invalid=new CardMachine(program,plainCardStorage(program.initial(-1)));assert.equal(invalid.advance().kind,'fault');
  assert.equal((invalid.root.state as any).$rules.nextEntity,1,'invalid setup cannot advance the initial identity');
  assert.deepEqual(Object.keys((invalid.root.state as any).$rules.entities),[],'invalid setup cannot allocate an entity');
});
