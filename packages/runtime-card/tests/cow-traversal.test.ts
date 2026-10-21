import test from 'node:test';
import assert from 'node:assert/strict';
import {CowStore} from '../src/cow-index.ts';
import {CowProperties} from '../src/cow-properties.ts';
import {CardTraceRecords} from '../src/trace.ts';
import type {TracePosition} from '../../card-engine/src/card-trace.ts';

test('complete COW traversal retains sparse numeric order, deletion and fork independence',()=>{
  const store=new CowStore<string>();
  for(const key of [2**45,1024,0,32,31,2**30])store.set(key,String(key));
  const branch=store.fork(),seen:number[]=[];
  branch.forEach((value,key)=>{assert.equal(value,String(key));seen.push(key);branch.delete(key);});
  assert.deepEqual(seen,[0,31,32,1024,2**30,2**45]);assert.equal(branch.size,0);assert.equal(store.size,6);
  const kept:number[]=[];store.forEach((_value,key)=>kept.push(key));assert.deepEqual(kept,seen);
});

test('property traversal retains insertion order after branch-local deletion and reinsertion',()=>{
  const store=new CowProperties<number>();store.set('a',1);store.set('b',2);
  const branch=store.fork();branch.delete('a');branch.set('c',3);branch.set('a',4);
  const keys:string[]=[],values:number[]=[];branch.forEach((value,key)=>{keys.push(key);values.push(value);});
  assert.deepEqual(keys,['b','c','a']);assert.deepEqual(values,[2,3,4]);assert.deepEqual([...store.entries()],[['a',1],['b',2]]);
});

test('resumable cursors honor sparse lower bounds and deletion without per-entry result objects',()=>{
  const store=new CowStore<string>(),keys=[0,31,32,1024,2**30,2**45,Number.MAX_SAFE_INTEGER];
  for(const key of keys)store.set(key,String(key));
  const branch=store.fork(),cursor=branch.cursor(32),visited:number[]=[];
  while(cursor.advance()){visited.push(cursor.key);assert.equal(cursor.value,String(cursor.key));branch.delete(cursor.key);}
  assert.deepEqual(visited,keys.slice(2));assert.equal(branch.size,2);assert.equal(store.size,keys.length);
  assert.equal(cursor.advance(),false);
  const property=new CowProperties<number>();property.set('a',1);property.set('b',2);
  property.delete('a');property.set('a',3);
  const values=property.valueCursor(),actual:number[]=[];while(values.advance())actual.push(values.value);
  assert.deepEqual(actual.sort(),[2,3]);
});

test('compact trace snapshots restore the same public trace and reject malformed positions',()=>{
  const positions:TracePosition[]=[{effect:'root',block:0,index:0,kind:'operation'},{effect:'root',block:0,index:1,kind:'return'}];
  const layout={positions,offsets:[0]},trace=new CardTraceRecords(layout);
  trace.push(positions[0]!,1);trace.push(positions[1]!,2);
  const snapshot=trace.snapshot(),restored=new CardTraceRecords(layout);restored.restore(snapshot);
  assert.deepEqual(restored.slice(),trace.slice());
  snapshot.positions[0]=1;snapshot.depths[0]=9;
  assert.deepEqual(restored.slice(),trace.slice());
  for(const bad of [null,[],{positions:[0],depths:[]},{positions:[2],depths:[1]},{positions:[-1],depths:[1]},{positions:[0],depths:[0]},{positions:[0.5],depths:[1]},{positions:[0],depths:[NaN]}]){
    assert.throws(()=>restored.restore(bad),/Invalid saved Core trace/);
    assert.deepEqual(restored.slice(),trace.slice(),'invalid restore must not publish a partial log');
  }
  const child=trace.fork();child.push(positions[0]!,3);assert.equal(trace.slice().length,2);assert.equal(child.slice().length,3);
});
