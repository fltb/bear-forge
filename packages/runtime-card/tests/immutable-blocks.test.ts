import test from 'node:test';
import assert from 'node:assert/strict';
import { CardGraph, privateCardGraph } from '../src/graph.ts';
import { ownRuleValue } from '../../card-engine/src/rules-values.ts';
import { serialize, deserialize } from 'node:v8';

test('owned immutable rule graphs remain blocks and mutable exports preserve their aliases and cycles', () => {
  const child = { n: 1 }, value: { a: typeof child; b: typeof child; self?: unknown } = { a: child, b: child };
  value.self = value;
  const block = ownRuleValue(value), graph = new CardGraph({ block, changing: { n: 2 } });
  assert.equal(graph.nodeCount, 2);
  const sibling = graph.fork(); sibling.root.changing.n = 3;
  assert.equal(sibling.root.block, block); assert.equal(graph.root.changing.n, 2);
  for (const source of [graph, sibling]) {
    const exported = source.export(source.root);
    assert.equal(exported.block.a, exported.block.b); assert.equal(exported.block.self, exported.block);
    exported.block.a.n = 9; assert.equal(source.root.block.a.n, 1);
  }
  graph.close(); assert.equal(sibling.root.changing.n, 3); sibling.close();
});

test('private block publications preserve aliases across separate block roots', () => {
  const block = ownRuleValue({ nested: { n: 1 } });
  const graph = privateCardGraph({ whole: block, nested: block.nested });
  const value = graph.export(graph.root);
  assert.equal(value.whole.nested, value.nested);
  assert.equal(value.whole, block); assert.equal(value.nested, block.nested);
  assert.equal(graph.export(block), block);
  graph.root.whole = ownRuleValue({ nested: { n: 2 } });
  assert.equal(value.whole.nested.n, 1); assert.equal(graph.export(graph.root).whole.nested.n, 2);
  graph.close();
});

test('private publications share cyclic blocks while actual mutable delivery detaches them', async () => {
  const {copyOwned,isOwnedTree} = await import('../../boundary/src/values.ts');
  const source: {n:number;self?:unknown} = {n:1}; source.self = source;
  const block = ownRuleValue(source), graph = privateCardGraph({a:block,b:block});
  const published = graph.export(graph.root);
  assert.equal(published.a, block); assert.equal(published.a, published.b); assert.equal(published.a.self, block);
  assert.equal(isOwnedTree(published), false);
  const delivered = copyOwned(published);
  assert.notEqual(delivered.a, block); assert.equal(delivered.a, delivered.b); assert.equal(delivered.a.self, delivered.a);
  delivered.a.n = 3; assert.equal(graph.root.a.n,1); graph.close();
});

test('incremental collection retains edges inserted after marking and isolates live forks', () => {
  const graph = new CardGraph<{ nodes: { n: number }[]; keep: { n: number } | null }>({ nodes: [], keep: null });
  for (let index = 0; index < 4000; index++) graph.root.nodes.push({ n: index });
  const fork = graph.fork();
  graph.boundary(); graph.root.keep = graph.root.nodes[3999]!; graph.root.nodes = [];
  for (let index = 0; index < 100; index++) graph.boundary();
  graph.collect();
  assert.equal(graph.root.keep!.n, 3999); assert.equal(fork.root.nodes.length, 4000);
  assert.ok(graph.nodeCount < 10); graph.close(); fork.close();
});

test('serialized blocks retain frozen behavior and cross-root aliases without initialization', () => {
  const block=ownRuleValue({items:[{n:1}]});
  const graph=new CardGraph({block,alias:block.items[0],changing:{n:2}});
  const saved=deserialize(serialize(graph.snapshot()));
  const restored=new CardGraph<typeof graph.root>(saved.root,saved.immutable);
  assert.equal(restored.nodeCount,2);assert.equal(restored.root.block.items[0],restored.root.alias);
  assert.throws(()=>{restored.root.block.items[0]!.n=9;},TypeError);
  restored.root.changing.n=4;assert.equal(graph.root.changing.n,2);
  const exported=restored.export(restored.root);exported.block.items[0]!.n=7;
  assert.equal(restored.root.alias!.n,1);graph.close();restored.close();
});

test('fork and first numeric-table edit separate bounded pages with unrelated worlds',()=>{
  for(const size of [32,4096,32768]){
    const table:Record<number,{n:number}>={};for(let n=0;n<size;n++)table[n]={n};
    const graph=new CardGraph({table});let copiedFields=0;
    const assign=Object.assign;
    Object.assign=((target:object,...sources:object[])=>{for(const source of sources)copiedFields+=Object.keys(source).length;return assign(target,...sources);}) as typeof Object.assign;
    let child:typeof graph|undefined;
    try{
      child=graph.fork();assert.equal(copiedFields,0,'fork cannot enumerate world fields');
      child.root.table[size]={n:size};child.root.table[0]!.n=-1;
      assert.ok(copiedFields<256,`first write copied ${copiedFields} fields in ${size}-entity world`);
      assert.equal(graph.root.table[0]!.n,0);assert.equal(graph.root.table[size],undefined);
      assert.equal(child.root.table[size]!.n,size);
    }finally{Object.assign=assign;graph.close();child?.close();}
  }
});

test('large string dictionaries keep branch insertion order and bounded first writes',()=>{
  for(const size of [32,4096,32768]){
    const table:Record<string,number>={};for(let n=0;n<size;n++)table['key'+n]=n;
    const graph=new CardGraph({table}),child=graph.fork();
    graph.root.table.parent=1;child.root.table.child=2;child.root.table.parent=3;
    delete child.root.table.key0;child.root.table.key0=-1;
    assert.deepEqual(Object.keys(child.root.table).slice(-3),['child','parent','key0']);
    assert.deepEqual(Object.keys(graph.root.table).slice(-2),['key'+(size-1),'parent']);
    assert.equal(graph.root.table.key0,0);assert.equal(graph.root.table.child,undefined);
    const saved=graph.snapshot(),restored=new CardGraph<typeof graph.root>(saved.root,saved.immutable);
    assert.deepEqual(Object.keys(restored.root.table),Object.keys(graph.root.table));
    graph.close();child.close();restored.close();
  }
});
