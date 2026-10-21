import test from 'node:test';
import assert from 'node:assert/strict';
import {publishNativeStop} from '../src/publication.ts';
import {ownRuleValue} from '../../card-engine/src/rules-values.ts';
import {copyOwned,isOwned,isOwnedTree,isDenseTree} from '../../boundary/src/values.ts';
import {CardGraph} from '../src/graph.ts';

test('native publications detach mutable containers and borrow immutable versions with cross-root aliases',()=>{
  const block=ownRuleValue({nested:{n:1}}),source={block,nested:block.nested,mutable:{n:2}};
  const published=publishNativeStop(source,structuredClone);
  assert.notEqual(published,source);assert.equal(published.block,block);assert.equal(published.nested,block.nested);
  assert.notEqual(published.mutable,source.mutable);source.mutable.n=3;assert.equal(published.mutable.n,2);
  assert.equal(isOwned(published),true);assert.equal(isOwnedTree(published),false);
  const output=copyOwned(published);assert.notEqual(output.block,block);assert.equal(output.nested,output.block.nested);
  output.nested.n=8;assert.equal(block.nested.n,1);
  const tree=publishNativeStop({block},structuredClone);assert.equal(isDenseTree(tree),true);
});

test('native publication preserves structured-clone getter and exotic semantics without duplicate callback execution',()=>{
  let calls=0;
  const source={plain:{n:1},get value(){calls++;return {n:2};}};
  const published=publishNativeStop(source,structuredClone);assert.equal(calls,1);assert.deepEqual(published,{plain:{n:1},value:{n:2}});
  const date=publishNativeStop({value:new Date(0)},structuredClone);assert.equal(date.value.getTime(),0);assert.equal(isOwned(date),false);
  let traps=0;const proxy=new Proxy({}, {getPrototypeOf(){traps++;return Object.prototype;}});
  const capture=(run:()=>unknown)=>{try{return{value:run()};}catch(error){return{error:error instanceof Error?error.name:String(error)};}};
  const expected=capture(()=>structuredClone({proxy})),nativeTraps=traps;traps=0;
  assert.deepEqual(capture(()=>publishNativeStop({proxy},structuredClone)),expected);
  assert.equal(traps,nativeTraps,'publication must add no proxy traps before the original cloner');
});

test('numeric property classification preserves canonical keys and array length',()=>{
  const source:Record<string,number>={};
  const keys=['','0','00','01','1','1.0','1e2','-0','-1',' 1','4294967294','4294967295','99999999999','NaN','Infinity','a'];
  for(const [index,key]of keys.entries())source[key]=index;
  const graph=new CardGraph({table:source,items:[] as number[]});
  assert.deepEqual(graph.export(graph.root.table),source);assert.deepEqual(Object.keys(graph.root.table),Object.keys(source));
  graph.root.items[4294967294]=1;assert.equal(graph.root.items.length,4294967295);
  (graph.root.items as unknown as Record<string,number>)['4294967295']=2;assert.equal(graph.root.items.length,4294967295);
  graph.root.items.length=0;assert.equal((graph.root.items as unknown as Record<string,number>)['4294967295'],2);
  graph.close();
});
