import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/index.ts';
import {bindModules,bindEntityLayouts,createModuleState,staticDefinitions} from '../src/rules-module-internal.ts';
import {addRegistration,removeRegistration,insertIndex,removeIndex,indexIds,type RuleIndex} from '../src/rules-indexes.ts';
import {captureEvent} from '../src/rules-reactions.ts';

test('identity indexes preserve numeric order, idempotence and arbitrary removals beyond array-index IDs',()=>{
  const buckets:Record<number,RuleIndex>={};
  const ids=[4294967298,7,0,Number.MAX_SAFE_INTEGER,4294967295,63,64];
  for(const id of ids)insertIndex(buckets,5,id);
  for(const id of ids)insertIndex(buckets,5,id);
  assert.deepEqual(indexIds(buckets,5),[...ids].sort((a,b)=>a-b));assert.equal(buckets[5]!.size,ids.length);
  for(const id of [64,0,Number.MAX_SAFE_INTEGER,7,4294967298,63,4294967295]){
    removeIndex(buckets,5,id);removeIndex(buckets,5,id);
    assert.equal(indexIds(buckets,5).includes(id),false);
  }
  assert.deepEqual(buckets,{});
});

test('component factories retain caller order while initial indexes sort numerically',()=>{
  let created=0;
  const module=rules.defineRules({requires:[],build(m){
    const component=m.own(rules.defineComponent({schema:z.number(),initial:()=>++created}));
    return{exports:{component:component.public}};
  }});
  const {bindings}=bindModules([module]);bindEntityLayouts(bindings);
  const state=createModuleState(bindings,[4294967298,7,0]);
  const component=bindings.indices.get(module.exports.component)!;
  assert.deepEqual(indexIds(state.indexes.entitiesByComponent,component),[0,7,4294967298]);
  assert.deepEqual([4294967298,7,0].map(id=>state.entities[id]!.components[component]),[1,2,3]);
});

test('removing all identities touches a linear number of links without shifting retained members',()=>{
  for(const size of [32,1024,8192]){
    const buckets:Record<number,RuleIndex>={};for(let id=0;id<size;id++)insertIndex(buckets,0,id);
    let touches=0;const proxies=new WeakMap<object,object>();
    const watch=<T extends object>(value:T):T=>{
      const known=proxies.get(value);if(known)return known as T;
      const proxy=new Proxy(value,{
        get(target,key,receiver){touches++;const child=Reflect.get(target,key,receiver);return child&&typeof child==='object'?watch(child):child;},
        set(target,key,value){touches++;return Reflect.set(target,key,value);},
        deleteProperty(target,key){touches++;return Reflect.deleteProperty(target,key);},
      });proxies.set(value,proxy);return proxy;
    };
    const indexed=watch(buckets);for(let id=0;id<size;id++)removeIndex(indexed,0,id);
    assert.ok(touches<size*32,`${size} removals touched ${touches} fields`);assert.deepEqual(buckets,{});
  }
});

test('priority buckets retain arrival ties and captured handlers after head, middle and tail removal',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const event=m.own(rules.defineEvent({payload:z.number()}));
    const effect=rules.defineEffect<rules.ReactionContext<number>,void>(b=>b.return(undefined));
    return{exports:{event:event.public,abilities:[3,-2,3,1].map(order=>rules.on(event.public,{effect,order}))}};
  }});
  const linked=bindModules([module]),bindings={...linked.bindings,indices:new Map(linked.bindings.indices)};
  for(const ability of module.exports.abilities){
    const index=bindings.definitions.length,metadata=staticDefinitions.get(ability)!;
    if(metadata.kind!=='ability'||metadata.abilityKind==='modifier')throw Error('Invalid test ability');
    bindings.indices.set(ability,index);bindings.definitions.push(ability);bindings.reactions.set(index,{metadata,effect:'capture-only'});
  }
  const state=createModuleState(bindings,[0]),event=bindings.indices.get(module.exports.event)!;
  for(let i=0;i<4;i++)addRegistration(state,bindings,{id:i+1,sequence:i+1,definition:bindings.indices.get(module.exports.abilities[i]!)!,source:0,owner:0,environment:{tag:i+1},lifetime:0});
  const captured=captureEvent(event,1,{$rules:state},bindings);
  assert.deepEqual(captured.handlers.map(row=>row.registration.id),[2,4,1,3]);
  assert.deepEqual(indexIds(state.indexes.registrationsByTargetArrival,event),[1,2,3,4]);
  for(const id of [2,1,3])removeRegistration(state,bindings,id);
  assert.deepEqual(indexIds(state.indexes.registrationsByTarget,event),[4]);
  assert.deepEqual(captured.handlers.map(row=>row.registration.id),[2,4,1,3]);
  for(const row of captured.handlers)assert.equal(Object.isFrozen(row.registration),true);
  removeRegistration(state,bindings,4);
  for(const buckets of [state.indexes.registrationsByTarget,state.indexes.registrationsByTargetArrival,state.indexes.registrationsBySource,state.indexes.registrationsByScope])assert.deepEqual(buckets,{});
});
