import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {CowIdentityStore} from '../src/cow-identities.ts';

test('identity records share roots and copy only a written version',()=>{
  const key={},parent=new CowIdentityStore<{value:number;self:object}>();
  parent.register(0,key);parent.set(0,{value:1,self:key},key);
  const child=parent.fork(),sibling=parent.fork();
  assert.strictEqual(parent.root,child.root);
  assert.strictEqual(parent.get(0,key),child.get(0,key));
  child.edit(0,value=>({...value}),key).value=2;
  assert.equal(parent.get(0,key)!.value,1);
  assert.equal(sibling.get(0,key)!.value,1);
  assert.equal(child.get(0,key)!.value,2);
  assert.strictEqual(child.get(0,key)!.self,key);
  assert.throws(()=>parent.edit(0,()=>{throw Error('clone failed');},key),/clone failed/);
  assert.equal(parent.get(0,key)!.value,1);
  const other={};child.register(1,other);child.set(1,{value:3,self:other},other);
  assert.equal(parent.has(1,other),false);
  assert.equal(parent.get(1,other),undefined);
  assert.throws(()=>child.register(0,other),/another index/);
});

test('native GC reclaims identity cycles and retired branch versions without scanning on fork',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {setImmediate} from 'node:timers/promises';
    import {CowIdentityStore} from './src/cow-identities.ts';
    const parent=new CowIdentityStore();
    function abandoned(){
      const key={},payload={key,bytes:new Uint8Array(1000000)};
      parent.register(0,key);parent.set(0,payload,key);
      return [new WeakRef(key),new WeakRef(payload)];
    }
    async function collected(references){
      for(let i=0;i<40;i++){
        await setImmediate();globalThis.gc();await setImmediate();
        if(references.every(reference=>reference.deref()===undefined))return;
      }
      assert.fail('Unreachable identities or version payloads remained alive');
    }
    const dead=abandoned();await collected(dead);
    for(let i=0;i<20&&parent.size;i++){await setImmediate();globalThis.gc();await setImmediate();}
    assert.equal(parent.size,0,'GC must also remove dead numeric index entries');
    const key={};parent.register(1,key);parent.set(1,{value:1,key},key);
    const neighbor={};parent.register(2,neighbor);parent.set(2,{value:9,key:neighbor},neighbor);
    const child=parent.fork();
    const old=new WeakRef(parent.get(1,key));
    parent.edit(1,value=>({...value}),key).value=2;
    await setImmediate();globalThis.gc();await setImmediate();
    assert.equal(child.get(1,key).value,1);
    assert.equal(parent.get(1,key).value,2);
    child.clear();await collected([old]);
    assert.equal(parent.get(1,key).value,2);
    assert.equal(parent.get(2,neighbor).value,9,'live neighbors must not retain retired payload versions');
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('cleared branches immediately leave the GC registry and can be reused',()=>{
  const key={},parent=new CowIdentityStore<number>();parent.register(0,key);parent.set(0,1,key);
  const registry=(parent as any).registry;
  for(let index=0;index<1000;index++){
    const branch=parent.fork();assert.equal(registry.stores.size,2);
    branch.clear();assert.equal(registry.stores.size,1);
  }
  const child=parent.fork();child.clear();child.set(0,2,key);
  assert.equal(registry.stores.size,2);assert.equal(child.get(0,key),2);assert.equal(parent.get(0,key),1);
  child.clear();parent.clear();assert.equal(registry.stores.size,0);
});


test('identity versions isolate adjacent and distant payloads, including undefined and slot 31',()=>{
  const parent=new CowIdentityStore<{value:number}|undefined>();
  const keys=Array.from({length:100},()=>({}));
  for(let id=0;id<keys.length;id++){parent.register(id,keys[id]!);parent.set(id,id===31?undefined:{value:id},keys[id]!);}
  const child=parent.fork(),sibling=parent.fork();
  assert.equal(child.has(31,keys[31]!),true);
  assert.equal(child.get(31,keys[31]!),undefined);
  let copies=0;
  for(const id of [0,1,30,31,32,63,64,99]) {
    const clone=(value:{value:number}|undefined)=>{copies++;return {value:(value?.value??0)+100};};
    const first=child.edit(id,clone,keys[id]!);
    assert.strictEqual(child.edit(id,clone,keys[id]!),first);
    assert.equal(parent.get(id,keys[id]!)?.value,id===31?undefined:id);
    assert.strictEqual(parent.get(id,keys[id]!),sibling.get(id,keys[id]!));
  }
  assert.equal(copies,8,'only modified payloads detach, once per owned version');
  const grandchild=child.fork();
  child.edit(31,value=>({...value!}),keys[31]!)!.value=500;
  assert.equal(grandchild.get(31,keys[31]!)!.value,100);
  assert.equal(parent.size,100);assert.equal(child.size,100);
  child.clear();assert.equal(grandchild.get(0,keys[0]!)!.value,100);
});

test('identity-managed slots share registration across forks and isolate new branch identities',()=>{
  const parent=new CowIdentityStore<{n:number}>(), first={}, explicit={}, added={};
  parent.setIdentity(first,{n:1});
  parent.register(100,explicit);parent.set(100,{n:100},explicit);
  const child=parent.fork();
  child.editIdentity(first,value=>({...value})).n=2;
  child.setIdentity(added,{n:3});
  assert.equal(parent.getIdentity(first)!.n,1);
  assert.equal(child.getIdentity(first)!.n,2);
  assert.equal(parent.getIdentity(added),undefined);
  assert.throws(()=>parent.editIdentity(added,value=>({...value})),TypeError);
  assert.equal(child.getIdentity(explicit)!.n,100);
  parent.setIdentity(explicit,{n:101});
  assert.equal(parent.get(100,explicit)!.n,101);
  assert.equal(child.get(100,explicit)!.n,100);
  child.clear();child.setIdentity(first,{n:4});
  assert.equal(child.size,1);assert.equal(parent.size,2);
  assert.equal(parent.getIdentity(first)!.n,1);
});

test('direct scalar writes reuse owned versions and detach both writers after every fork',()=>{
  const parent=new CowIdentityStore<number|undefined>(),identity={};
  parent.setIdentity(identity,undefined);
  const first=parent.fork();
  parent.writeIdentity(identity,1);parent.writeIdentity(identity,2);
  assert.equal(first.getIdentity(identity),undefined);
  const second=parent.fork();
  second.writeIdentity(identity,3);second.writeIdentity(identity,4);
  parent.writeIdentity(identity,5);
  assert.equal(parent.getIdentity(identity),5);
  assert.equal(second.getIdentity(identity),4);
  assert.equal(first.getIdentity(identity),undefined);
  first.writeIdentity(identity,6);
  assert.equal(parent.getIdentity(identity),5);
  second.clear();parent.writeIdentity(identity,undefined);
  assert.equal(parent.getIdentity(identity),undefined);
  assert.equal(first.getIdentity(identity),6);
});
