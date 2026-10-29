import test from 'node:test';
import assert from 'node:assert/strict';
import {CardGraph,privateCardGraph} from '../src/graph.ts';
import {CowStore} from '../src/cow-index.ts';

test('array truncation preserves the boundary page, sibling state and detached publications',()=>{
  const parent=privateCardGraph({items:Array.from({length:2049},(_,i)=>i)}),child=parent.fork();
  try{
    const before=child.export(child.root.items);
    child.root.items.length=130;
    assert.deepEqual(child.export(child.root.items),Array.from({length:130},(_,i)=>i));
    assert.equal(parent.root.items.length,2049);assert.equal(parent.root.items[2048],2048);
    assert.equal(before.length,2049);assert.equal(before[2048],2048);
    child.root.items.length=2049;
    for(const index of [130,191,192,2048])assert.equal(Object.hasOwn(child.root.items,index),false);
    child.root.items[2048]=-1;
    assert.equal(child.root.items.pop(),-1);assert.equal(child.root.items.pop(),undefined);
    parent.root.items[129]=-2;assert.equal(child.root.items[129],129);
    const saved=child.snapshot(),restored=new CardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
    try{assert.deepEqual(restored.export(restored.root),child.export(child.root));}
    finally{restored.close();}
  }finally{parent.close();child.close();}
});

test('sparse truncation skips unallocated ranges and clearing retains named properties',()=>{
  const items=Object.assign([] as number[],{label:'retained','01':7,'4294967295':9});
  for(const index of [0,31,63,64,65,2**31,4294967294])items[index]=index;
  const parent=new CardGraph({items}),child=parent.fork();
  try{
    child.root.items.length=64;
    assert.deepEqual(Object.keys(child.root.items),['0','31','63','label','01','4294967295']);
    assert.equal(parent.root.items.length,4294967295);assert.equal(parent.root.items[4294967294],4294967294);
    child.root.items.length=4294967295;
    for(const index of [64,65,2**31,4294967294])assert.equal(Object.hasOwn(child.root.items,index),false);
    child.root.items.length=0;
    assert.deepEqual(Object.keys(child.root.items),['label','01','4294967295']);
    assert.equal(child.root.items.label,'retained');assert.equal(child.root.items['01'],7);assert.equal(child.root.items['4294967295'],9);
    child.root.items.length=65;
    assert.equal(Object.hasOwn(child.root.items,0),false);assert.equal(Object.hasOwn(child.root.items,63),false);
    assert.equal(parent.root.items[0],0);assert.equal(parent.root.items[64],64);
  }finally{parent.close();child.close();}
});

test('removing an array tail does not visit pages in its unrelated retained prefix',()=>{
  // Count actual page traversal rather than asserting machine-dependent time.
  // Both complete and lower-bound traversals contribute to the same work count.
  for(const size of [256,4096,65536]){
    const parent=new CardGraph({items:Array.from({length:size},(_,i)=>i)}),child=parent.fork();
    const each=CowStore.prototype.forEach,cursor=CowStore.prototype.cursor;
    let visited=0;
    CowStore.prototype.forEach=function(visit){return each.call(this,(value,key)=>{visited++;visit(value,key);});};
    CowStore.prototype.cursor=function(minimum=0){
      const result=cursor.call(this,minimum),advance=result.advance;
      result.advance=function(){const present=advance.call(this);if(present)visited++;return present;};
      return result;
    };
    try{
      for(let i=0;i<32;i++)assert.equal(child.root.items.pop(),size-i-1);
      assert.ok(visited<=64,`removing 32 items visited ${visited} pages in an array of ${size}`);
      assert.equal(child.root.items.length,size-32);assert.equal(parent.root.items.length,size);
    }finally{CowStore.prototype.forEach=each;CowStore.prototype.cursor=cursor;parent.close();child.close();}
  }
});
