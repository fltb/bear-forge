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
    const child=parent.fork();
    const old=new WeakRef(parent.get(1,key));
    parent.edit(1,value=>({...value}),key).value=2;
    await setImmediate();globalThis.gc();await setImmediate();
    assert.equal(child.get(1,key).value,1);
    assert.equal(parent.get(1,key).value,2);
    child.clear();await collected([old]);
    assert.equal(parent.get(1,key).value,2);
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
