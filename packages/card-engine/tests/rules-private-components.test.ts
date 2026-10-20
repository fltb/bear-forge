import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardProgram,CardMachine,plainCardStorage,linkRules,rules } from '../src/index.ts';
import type { ReactionContext } from '../src/rules-reactions.types.ts';
const {defineRules,defineComponent,defineEvent,defineEffect,defineEntity,sequence,call,spawnEntity,install,on,emit,readComponent,updateLocalComponent}=rules;
const provider=defineRules({requires:[],build(m){
  const protectedValue=m.own(defineComponent({schema:z.number(),initial:()=>5}));
  const event=m.own(defineEvent({payload:z.number(),publicEmit:true,dispatch:'immediate'}));
  const kind=m.kind({config:z.object({name:z.string()}),components:[]});
  return{exports:{event:event.public,kind,protectedValue:protectedValue.public}};
}});
const counter=defineComponent({schema:z.number(),initial:()=>0});
const entity=defineEntity(provider.exports.kind,{name:'counter-relic'},{components:[counter]});
const schemas={setup:z.number(),result:z.number(),ports:{}};
function run(entry:ReturnType<typeof defineEffect<number,number>>){
  const d=linkRules({id:'private-components',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[provider]});
  const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(0)));
}

test('third-layer hooks keep independent counters on their source entities using ordinary utils',()=>{
  const effect=defineEffect<ReactionContext<number>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),counter,n=>n+1));
  const ability=on(provider.exports.event,{effect});
  const entry=defineEffect<number,number>(b=>{const first=b.local<number>(),second=b.local<number>();return sequence(
    b.assign(first,spawnEntity({definition:entity,owner:null,scope:0})),
    b.assign(second,spawnEntity({definition:entity,owner:null,scope:0})),
    install({source:first,owner:first,ability,environment:{},lifetime:0}),
    emit(provider.exports.event,1),
    install({source:second,owner:second,ability,environment:{},lifetime:0}),
    emit(provider.exports.event,2),
    b.return(b.read(v=>v.get(readComponent(first,counter))*10+v.get(readComponent(second,counter)))),
  );});
  const machine=run(entry);assert.deepEqual(machine.advance(),{kind:'done',result:21});assert.deepEqual((machine.root.state as any).$rules.sources,[]);
});

test('a third-layer program cannot update another entity private component by passing its identity',()=>{
  const entry=defineEffect<number,number>(b=>{const created=b.local<number>();return sequence(b.assign(created,spawnEntity({definition:entity,owner:null,scope:0})),updateLocalComponent(created,counter,n=>n+1),b.return(0));});
  const machine=run(entry);assert.match(JSON.stringify(machine.advance()),/requires the active source/);
});

test('protected module components cannot be attached as third-layer private data or updated directly',()=>{
  const bad=defineEntity(provider.exports.kind,{name:'bad'},{components:[provider.exports.protectedValue]});
  const entry=defineEffect<number,number>(b=>sequence(spawnEntity({definition:bad,owner:null,scope:0}),b.return(0)));
  assert.throws(()=>run(entry),/requires an unowned content component/);
  const write=defineEffect<number,number>(b=>sequence(updateLocalComponent(0,provider.exports.protectedValue,n=>n+1),b.return(0)));
  assert.throws(()=>run(write),/require their owner action/);
});

test('owner-only fact events cannot be emitted by a third-layer entity',()=>{
  const facts=defineRules({requires:[],build(m){return{exports:{event:m.own(defineEvent({payload:z.number()})).public}};}});
  const entry=defineEffect<number,number>(b=>sequence(emit(facts.exports.event,1),b.return(0)));
  assert.throws(()=>linkRules({id:'fake-event',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[facts]}),/not publicly publishable/);
});

test('a component declared inside build remains private until explicitly owned',()=>{
  const content=defineRules({requires:[provider],build(){
    const count=defineComponent({schema:z.number(),initial:()=>0});
    const increment=on(provider.exports.event,{effect:defineEffect<ReactionContext<number>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),count,n=>n+1))});
    const entity=defineEntity(provider.exports.kind,{name:'module-private'},{components:[count]});
    const entry=defineEffect<number,number>(b=>{const created=b.local<number>();return sequence(
      b.assign(created,spawnEntity({definition:entity,owner:null,scope:0})),install({source:created,owner:created,ability:increment,environment:{},lifetime:0}),emit(provider.exports.event,0),b.return(readComponent(created,count)),
    );});return{exports:{entry}};
  }});
  const definition=linkRules({id:'module-declared-private',schemas,initialize:()=>({}),entry:content.exports.entry,definitions:[content.exports.entry],modules:[content]});
  const program=new CardProgram(definition),machine=new CardMachine(program,plainCardStorage(program.initial(0)));
  assert.deepEqual(machine.advance(),{kind:'done',result:1});
});
