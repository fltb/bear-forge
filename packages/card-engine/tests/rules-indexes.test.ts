import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/index.ts';
import {bindModules,createModuleState,staticDefinitions} from '../src/rules-module-internal.ts';
import {addRegistration,removeRegistration} from '../src/rules-indexes.ts';
import {captureEvent} from '../src/rules-reactions.ts';
import {ownRuleValue} from '../src/rules-values.ts';

test('event capture reads only its indexed candidates in large unrelated worlds',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const event=m.own(rules.defineEvent({payload:z.number()})),other=m.own(rules.defineEvent({payload:z.number()}));
    const effect=rules.defineEffect<rules.ReactionContext<number>,void>(b=>b.return(undefined));
    return{exports:{event:event.public,a:rules.on(event.public,{effect}),b:rules.on(other.public,{effect})}};
  }});
  const linked=bindModules([module]),bindings={...linked.bindings,indices:new Map(linked.bindings.indices)};
  for(const ability of [module.exports.a,module.exports.b]){
    const index=bindings.definitions.length;bindings.indices.set(ability,index);bindings.definitions.push(ability);
    const metadata=staticDefinitions.get(ability)!;
    if(metadata.kind!=='ability'||metadata.abilityKind==='modifier')throw Error('Invalid fixture');
    bindings.reactions.set(bindings.indices.get(ability)!,{metadata,effect:'unused-capture-only'});
  }
  for(const size of [32,4096,32768]){
    const state=createModuleState(bindings,[0]);
    for(let id=1;id<=size+1;id++)addRegistration(state,bindings,{id,sequence:id,definition:bindings.indices.get(id===1?module.exports.a:module.exports.b)!,source:0,owner:0,environment:{},lifetime:0});
    let reads=0;
    state.registrations=new Proxy(state.registrations,{get(target,key,receiver){reads++;return Reflect.get(target,key,receiver);},ownKeys(){throw Error('Capture scanned unrelated registrations');}});
    const envelope=captureEvent(bindings.indices.get(module.exports.event)!,7,{$rules:state},bindings);
    assert.equal(reads,1);assert.deepEqual(envelope.handlers.map(h=>h.registration.id),[1]);
    assert.equal(removeRegistration(state,bindings,1),true);
    reads=0;assert.deepEqual(captureEvent(bindings.indices.get(module.exports.event)!,8,{$rules:state},bindings).handlers,[]);assert.equal(reads,0);
  }
});

test('captured registrations own their record while reusing immutable environment aliases',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const event=m.own(rules.defineEvent({payload:z.number()}));
    const effect=rules.defineEffect<rules.ReactionContext<number>,void>(b=>b.return(undefined));
    return{exports:{event:event.public,ability:rules.on(event.public,{effect,eligible:'captured'})}};
  }});
  const linked=bindModules([module]),bindings={...linked.bindings,indices:new Map(linked.bindings.indices)};
  const definition=bindings.definitions.length,metadata=staticDefinitions.get(module.exports.ability)!;
  if(metadata.kind!=='ability'||metadata.abilityKind==='modifier')throw Error('Invalid fixture');
  bindings.indices.set(module.exports.ability,definition);bindings.definitions.push(module.exports.ability);
  bindings.reactions.set(definition,{metadata,effect:'capture-only'});
  const state=createModuleState(bindings,[0]);
  const shared={rows:Array.from({length:4096},(_,n)=>({n}))};
  const source:{left:typeof shared;right:typeof shared;self?:unknown}={left:shared,right:shared};source.self=source;
  const environment=ownRuleValue(source);
  const registration={id:1,sequence:1,definition,source:0,owner:0,environment,lifetime:0};
  addRegistration(state,bindings,registration);
  const event=bindings.indices.get(module.exports.event)!;
  const first=captureEvent(event,7,{$rules:state},bindings).handlers[0]!.registration;
  const second=captureEvent(event,8,{$rules:state},bindings).handlers[0]!.registration;
  assert.notEqual(first,registration);assert.notEqual(first,second);
  assert.equal(first.environment,environment);assert.equal(second.environment,environment);
  assert.equal(first.environment.left,first.environment.right);assert.equal(first.environment.self,environment);
  assert.equal(Object.isFrozen(first),true);
  // Even an internal change to the live record cannot rewrite an old capture.
  registration.owner=9;assert.equal(first.owner,0);
  assert.equal(removeRegistration(state,bindings,1),true);
  assert.equal(first.environment.left.rows[4095]!.n,4095);
  assert.throws(()=>{first.environment.left.rows[0].n=99;},TypeError);
});
