import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeGraphData,decodeGraphData,copyGraphData,sameGraphData} from '../src/graph-codec.ts';
import zlib,{deflateRawSync} from 'node:zlib';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import { CardGraph, privateCardGraph, unpackGraphImage } from '../src/graph.ts';
import { ownRuleValue, immutableRuleEpoch, inRuleValueContext, isContextRuleValue } from '../../card-engine/src/rules-values.ts';
import { serialize, deserialize } from 'node:v8';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('content chunks preserve every serialized byte and share immutable data across small edits and cold exports',()=>{
  const raw=Buffer.alloc(120000);let value=47;
  for(let i=0;i<raw.length;i++){value^=value<<13;value^=value>>>17;value^=value<<5;raw[i]=value&255;}
  const first=encodeGraphData(raw),shifted=encodeGraphData(Buffer.concat([Buffer.from('a local edit'),raw]));
  assert.ok('chunks' in first&&'chunks' in shifted);
  assert.deepEqual(decodeGraphData(first),raw);
  assert.deepEqual(decodeGraphData(shifted),Buffer.concat([Buffer.from('a local edit'),raw]));
  const shared=new Set(first.chunks);assert.ok(shifted.chunks.filter(chunk=>shared.has(chunk)).length>first.chunks.length/2);
  assert.throws(()=>{(first.chunks[0] as {data:string}).data='corrupt';},TypeError);
  const exported=copyGraphData(first);assert.ok('chunks' in exported);exported.chunks[0]={data:'corrupt'};
  assert.deepEqual(decodeGraphData(first),raw,'replacing an exported array entry cannot mutate the retained encoding');
  const cold=deserialize(serialize([first,shifted]));
  assert.deepEqual(decodeGraphData(cold[0]),raw);
  assert.ok(cold[1].chunks.some((chunk:object)=>cold[0].chunks.includes(chunk)),'the durable container preserves shared chunk identities');
  const detachedBytes=serialize(first).byteLength+serialize(shifted).byteLength;
  assert.ok(serialize([first,shifted]).byteLength<detachedBytes*0.7,'durable sharing must reduce stored bytes, not merely the in-memory cache');
  assert.equal(sameGraphData(first,{bytes:deflateRawSync(raw,{level:1})}),true);
});

test('copying retained chunks avoids repeated hashes but still detaches and rechecks mutable cold data',()=>{
  const raw=Buffer.from(Array.from({length:6000},(_,i)=>'complete Context entry '+i+'\n').join(''));
  const packed=encodeGraphData(raw);assert.ok('chunks' in packed);
  const cold=deserialize(serialize(packed)) as typeof packed,hash=crypto.createHash;let hashes=0;
  crypto.createHash=((...args:Parameters<typeof hash>)=>{hashes++;return hash(...args);}) as typeof hash;syncBuiltinESMExports();
  try{
    const warm=copyGraphData(packed);assert.ok('chunks' in warm);assert.equal(hashes,0);
    assert.notEqual(warm.chunks,packed.chunks);assert.deepEqual(warm.chunks,packed.chunks);
    const first=copyGraphData(cold);assert.ok('chunks' in first);
    assert.equal(hashes,new Set(cold.chunks).size,'each distinct mutable source is copied once');
    const before=hashes,second=copyGraphData(cold);assert.ok('chunks' in second);assert.equal(hashes,before);
    assert.deepEqual(decodeGraphData(first),raw);assert.deepEqual(decodeGraphData(second),raw);
    const original=cold.chunks[0]!.data;
    (cold.chunks[0] as {data:string}).data=deflateRawSync(Buffer.from('changed cold data')).toString('base64');
    const changed=copyGraphData(cold);assert.ok('chunks' in changed);assert.ok(hashes>before);
    assert.equal(changed.chunks[0]!.data,cold.chunks[0]!.data);assert.notEqual(changed.chunks[0],first.chunks[0]);
    assert.equal(first.chunks[0]!.data,original);assert.deepEqual(decodeGraphData(first),raw);
    cold.chunks[0]={data:original};const replaced=copyGraphData(cold);assert.ok('chunks' in replaced);assert.deepEqual(decodeGraphData(replaced),raw);
    second.chunks[0]={data:'not base64'};assert.deepEqual(decodeGraphData(packed),raw);
  }finally{crypto.createHash=hash;syncBuiltinESMExports();}
});

test('legacy and chunked images restore full identities without graph export',()=>{
  const anchor=ownRuleValue({tag:'program'}),boundary=immutableRuleEpoch(),leaf={n:1},cycle:any={};cycle.self=cycle;
  const original=privateCardGraph({anchor,leaf,alias:leaf,cycle,rows:Array.from({length:3000},(_,i)=>({i,text:'retained complete state '+i}))});
  const packed=original.packedSnapshot(boundary),raw=decodeGraphData(packed),legacy={bytes:Uint8Array.from(deflateRawSync(raw,{level:1})),anchors:[...packed.anchors]};
  const snapshot=CardGraph.prototype.snapshot;let first:typeof original|undefined,second:typeof original|undefined;
  try{
    CardGraph.prototype.snapshot=()=>{throw Error('restore must not export or replay the current graph');};
    first=CardGraph.restorePacked<typeof original.root>(legacy,boundary);
    second=CardGraph.restorePacked<typeof original.root>(packed,boundary);
    assert.deepEqual(decodeGraphData(first.packedSnapshot(boundary)),raw);
    assert.equal(first.candidateKey(boundary),second.candidateKey(boundary));
    assert.equal(first.sameCurrent(second,()=>{},undefined,boundary),true);
  }finally{CardGraph.prototype.snapshot=snapshot;}
  try{
    assert.ok(first&&second);legacy.bytes.fill(0);legacy.anchors.length=0;original.close();first.close();
    assert.equal(second.root.anchor,anchor);assert.equal(second.root.cycle.self,second.root.cycle);
    const child=second.fork();try{child.root.leaf.n=7;assert.equal(child.root.alias.n,7);assert.equal(second.root.leaf.n,1);}
    finally{child.close();}
    assert.equal(second.root.rows.length,3000);
  }finally{original.close();first?.close();second?.close();}
});

test('a parked field publication retains aliases, holes and immutable anchors without exposing mutable Context data',()=>{
  const anchor=ownRuleValue({tag:'external'}),boundary=immutableRuleEpoch(),leaf={n:1},record=Object.assign(Object.create(null),{leaf}),cycle:any={};cycle.self=cycle;
  const sparse=Array(4);sparse[2]=leaf;
  const graph=privateCardGraph({field:{anchor,leaf,alias:leaf,record,sparse,cycle},other:leaf});
  const expected=graph.export(graph.root.field),saved=graph.packedSnapshot(boundary);
  try{
    const value=graph.exportRootField('field');assert.equal(graph.isParked,true);assert.deepEqual(value,expected);
    assert.equal(value.anchor,anchor);assert.equal(value.leaf,value.alias);assert.equal(value.record.leaf,value.leaf);assert.equal(value.sparse[2],value.leaf);
    assert.equal(value.cycle.self,value.cycle);assert.equal(Object.getPrototypeOf(value.record),Object.prototype);assert.equal(0 in value.sparse,false);
    value.leaf.n=7;value.sparse[0]={n:8};value.cycle.self=null;
    assert.deepEqual(graph.exportRootField('field'),expected);assert.deepEqual(graph.packedSnapshot(boundary),saved);
    assert.equal(graph.root.other.n,1);assert.equal(graph.root.field.leaf,graph.root.other);
  }finally{graph.close();}
  assert.throws(()=>graph.exportRootField('field'),/Closed card storage/);
});

for(const large of [false,true])test(`cold restore retains bytes without inflating; collisions do not merge distinct currents; large=${large}`,()=>{
  const originalHash=crypto.createHash,originalInflate=zlib.inflateRawSync;
  crypto.createHash=(()=>{const hash={update:()=>hash,digest:()=> 'fixture-collision'};return hash;}) as unknown as typeof crypto.createHash;
  syncBuiltinESMExports();
  const anchor=ownRuleValue({tag:'first'}),other=ownRuleValue({tag:'second'}),boundary=immutableRuleEpoch();
  const original=privateCardGraph({value:1,anchor,rows:Array.from({length:large?3000:2},(_,i)=>({i,text:'full retained Context '+i}))});
  const changed=original.fork();changed.root.value=2;
  const saved=original.packedSnapshot(boundary),different=changed.packedSnapshot(boundary),owners:typeof original[]=[];
  try{
    const cold={...deserialize(serialize(copyGraphData(saved))),anchors:[...saved.anchors],key:'untrusted'};
    zlib.inflateRawSync=()=>{throw Error('restore must not inflate');};syncBuiltinESMExports();
    for(const image of [saved,cold,different,{...cold,anchors:[other]}]){
      const restored=CardGraph.restorePacked<typeof original.root>(image,boundary);owners.push(restored);
      assert.equal(restored.isParked,true);assert.equal(restored.nodeCount,0);
      assert.deepEqual(copyGraphData(restored.packedSnapshot(boundary)),copyGraphData(image));
    }
    zlib.inflateRawSync=originalInflate;syncBuiltinESMExports();
    const [first,second,third,foreign]=owners;
    assert.equal(first!.sameCurrent(second!,()=>{},undefined,boundary),true);
    assert.equal(first!.sameCurrent(third!,()=>{},undefined,boundary),false);
    assert.equal(first!.sameCurrent(foreign!,()=>{},undefined,boundary),false);
    first!.close();assert.equal(second!.root.value,1);assert.equal(second!.root.anchor,anchor);
    assert.equal(third!.root.value,2);assert.equal(foreign!.root.anchor,other);
  }finally{
    crypto.createHash=originalHash;zlib.inflateRawSync=originalInflate;syncBuiltinESMExports();
    original.close();changed.close();for(const owner of owners)owner.close();
  }
});

test('parked private Contexts retain complete aliases, cycles, holes and external identity anchors',()=>{
  const anchor=ownRuleValue({tag:'external'}),leaf={n:3},nil=Object.assign(Object.create(null),{leaf});
  const array=new Array(5);array[2]=leaf;
  const value={left:leaf,right:leaf,nil,array,anchor,self:null as unknown};value.self=value;
  const graph=privateCardGraph(value),old=graph.root,unchanged=graph.fork();
  const count=graph.nodeCount;assert.ok(count>=4);
  try{
    graph.park();assert.equal(graph.isParked,true);assert.equal(graph.nodeCount,0);
    const saved=graph.snapshot(true);assert.equal(graph.nodeCount,0,'saving a parked current must not rehydrate execution indexes');
    const restored=privateCardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
    try{assert.equal(Object.getPrototypeOf(restored.root.nil),null);assert.equal(restored.root.left,restored.root.right);assert.equal(restored.root.array[2],restored.root.left);assert.equal(restored.root.anchor,anchor);}
    finally{restored.close();}
    saved.root.left.n=99;
    assert.throws(()=>old.left,/Released card view/);
    assert.throws(()=>graph.export(old),/Released card view/);
    assert.equal(graph.root.left.n,3,'snapshot mutable data is detached from the parked image');assert.equal(graph.root.left,graph.root.right);assert.equal(graph.root.self,graph.root);
    assert.equal(graph.root.nil.leaf,graph.root.left);assert.equal(graph.root.array[2],graph.root.left);
    assert.equal(Object.getPrototypeOf(graph.root.nil),null);assert.equal(0 in graph.root.array,false);assert.equal(graph.root.array.length,5);
    assert.equal(graph.root.anchor,anchor);assert.equal(graph.sameCurrent(unchanged,()=>{}),true);
    graph.root.left.n=7;assert.equal(unchanged.root.left.n,3);
    graph.park();const child=graph.fork();
    try{child.root.right.n=9;assert.equal(graph.root.left.n,7);assert.equal(child.root.left.n,9);assert.equal(child.root.anchor,anchor);}
    finally{child.close();}
    graph.root.left.n=7; // Exercise encoding failure after a managed write.
    const snapshot=graph.snapshot.bind(graph);graph.snapshot=()=>{throw Error('fixture-compaction-failure');};
    assert.throws(()=>graph.park(),/fixture-compaction-failure/);assert.equal(graph.root.left.n,7);assert.equal(graph.isParked,false);
    graph.snapshot=snapshot;graph.park();assert.equal(graph.nodeCount,0);
  }finally{graph.close();unchanged.close();}
  assert.equal(graph.nodeCount,0);assert.throws(()=>graph.root,/Closed card storage/);
});

test('compressed Context blocks preserve nested external anchors and pre-binding identities without retaining owned blocks',()=>{
  const anchor=ownRuleValue({tag:'external',nested:{n:17}});
  const prior=inRuleValueContext(()=>ownRuleValue({tag:'bound-before-program'})),boundary=immutableRuleEpoch();
  const source:any={rows:Array.from({length:1000},(_,i)=>({index:i,text:'complete original repeated Context payload',anchor:i%2?anchor:anchor.nested})),anchor,prior};source.self=source;
  const owned=inRuleValueContext(()=>ownRuleValue(source));
  const graph=privateCardGraph({owned,alias:owned.rows[0],anchor,nested:anchor.nested,prior,numbers:[NaN,-0,Infinity,-Infinity],references:{placeholder:{}}});
  const live=graph.fork(),raw=serialize(graph.snapshot(true,boundary)).byteLength;
  try{
    graph.park(boundary);assert.ok(graph.parkedBytes>0&&graph.parkedBytes<raw/2,'compress the owned repetitive data, not only execution indexes');
    const saved=graph.snapshot(true,boundary);assert.equal(graph.nodeCount,0);
    assert.notEqual(saved.root.owned,owned,'owned blocks are reconstructed from compressed data');
    assert.equal(saved.root.owned.self,saved.root.owned);assert.equal(saved.root.alias,saved.root.owned.rows[0]);
    assert.equal(saved.root.owned.anchor,anchor);assert.equal(saved.root.owned.rows[1].anchor,anchor);assert.equal(saved.root.owned.rows[0].anchor,anchor.nested);
    assert.equal(saved.root.prior,prior);assert.equal(saved.root.owned.prior,prior);assert.equal(saved.root.nested,anchor.nested);
    assert.ok(isContextRuleValue(saved.root.owned));assert.ok(Object.isFrozen(saved.root.owned.rows[0]));
    assert.deepEqual(saved.root.numbers,[NaN,-0,Infinity,-Infinity]);assert.deepEqual(saved.root.references,{placeholder:{}});
    assert.equal(graph.sameCurrent(live,()=>{},undefined,boundary),true);
    graph.park(boundary);assert.equal(graph.root.owned.anchor,anchor);assert.equal(graph.root.prior,prior);
    assert.equal(graph.root.alias,graph.root.owned.rows[0]);assert.ok(Object.is(graph.root.numbers[1],-0));
  }finally{graph.close();live.close();}
});

test('packed restoration retains the complete graph without re-encoding and isolates source bytes and later writes',()=>{
  const anchor=ownRuleValue({tag:'external'}),boundary=immutableRuleEpoch();
  const owned=inRuleValueContext(()=>ownRuleValue({anchor,rows:[{n:3}]})),leaf={n:7};
  const nulls=Object.create(null);nulls.leaf=leaf;nulls.self=nulls;
  const original=privateCardGraph({owned,alias:owned.rows[0],left:leaf,right:leaf,nulls,list:[,leaf]}),saved=original.packedSnapshot(boundary);
  original.close();const bytes=decodeGraphData(saved),snapshot=CardGraph.prototype.snapshot;
  let restored:CardGraph<any>|undefined;
  try{
    CardGraph.prototype.snapshot=function(){throw Error('packed restoration must not re-encode admitted data');};
    restored=CardGraph.restorePacked<typeof original.root>(saved,boundary);
    assert.equal(restored.isParked,true);assert.equal(restored.nodeCount,0);
    assert.deepEqual(decodeGraphData(restored.packedSnapshot(boundary)),bytes);
  }finally{CardGraph.prototype.snapshot=snapshot;}
  try{
    assert.ok(restored);if('bytes' in saved)saved.bytes.fill(0);else saved.chunks[0]={data:'invalid'};saved.anchors.length=0;
    assert.equal(restored.root.owned.anchor,anchor);assert.equal(isContextRuleValue(restored.root.owned),true);
    assert.equal(Object.getPrototypeOf(restored.root.nulls),null);
    assert.equal(restored.root.nulls.leaf,restored.root.left);assert.equal(restored.root.nulls.self,restored.root.nulls);
    assert.equal(restored.root.alias,restored.root.owned.rows[0]);assert.equal(0 in restored.root.list,false);
    assert.equal(restored.root.left,restored.root.right);assert.equal(restored.root.left.n,7);
    const child=restored.fork();
    try{
      child.root.left.n=19;assert.equal(child.root.right.n,19);assert.equal(restored.root.left.n,7);
      const changed=child.packedSnapshot(boundary),cold=CardGraph.restorePacked<typeof original.root>(changed,boundary);
      try{assert.equal(cold.root.left.n,19);assert.equal(cold.root.owned.anchor,anchor);assert.equal(cold.root.nulls.self,cold.root.nulls);}
      finally{cold.close();}
      assert.deepEqual(decodeGraphData(restored.packedSnapshot(boundary)),bytes);
    }finally{child.close();}
  }finally{restored?.close();}
});

for(const large of [false,true])test(`packed restore, fork and export keep the unchanged encoding; large=${large}`,()=>{
  const original=privateCardGraph({value:1,rows:large?Array.from({length:3000},(_,i)=>'entry-'+i):[]}),saved=original.packedSnapshot();original.close();
  const inflate=zlib.inflateRawSync;let graph:typeof original|undefined,child:typeof original|undefined;
  try{
    zlib.inflateRawSync=()=>{throw Error('unchanged image must not inflate');};syncBuiltinESMExports();
    graph=CardGraph.restorePacked<typeof original.root>(saved,0);child=graph.fork();
    const exported=graph.packedSnapshot();assert.deepEqual(copyGraphData(exported),copyGraphData(saved));
    assert.deepEqual(copyGraphData(child.packedSnapshot()),copyGraphData(saved));
    if('bytes' in exported)exported.bytes.fill(0);else exported.chunks[0]={data:'invalid'};
    assert.deepEqual(copyGraphData(graph.packedSnapshot()),copyGraphData(saved));
    zlib.inflateRawSync=inflate;syncBuiltinESMExports();
    child.root.value=2;assert.equal(unpackGraphImage<typeof original.root>(child.packedSnapshot()).root.value,2);
    assert.equal(graph.root.value,1);
  }finally{zlib.inflateRawSync=inflate;syncBuiltinESMExports();graph?.close();child?.close();}
});

test('packed export reclassifies a changed ownership boundary without reusing the old anchor layout',()=>{
  const external=ownRuleValue({tag:'external'}),boundary=immutableRuleEpoch();
  const owned=inRuleValueContext(()=>ownRuleValue({external,n:3})),graph=privateCardGraph({owned});
  try{
    graph.park(boundary);
    const contextual=graph.packedSnapshot(boundary),reclassified=graph.packedSnapshot(Number.MAX_SAFE_INTEGER);
    assert.ok(contextual.anchors.includes(external));assert.equal(contextual.anchors.includes(owned),false);
    assert.notDeepEqual(decodeGraphData(contextual),decodeGraphData(reclassified));
    const image=unpackGraphImage<{owned:typeof owned}>(reclassified);
    assert.equal(image.root.owned.external,external);assert.equal(image.root.owned.n,3);
    assert.ok(reclassified.anchors.includes(image.root.owned));assert.equal(graph.nodeCount,0);
    assert.deepEqual(decodeGraphData(graph.packedSnapshot(boundary)),decodeGraphData(contextual),'export must not rewrite the retained image under another scope');
  }finally{graph.close();}
});

test('observation, equality, collection and active forks preserve an unchanged packed image',()=>{
  const anchor=ownRuleValue({tag:'external'}),leaf={n:1},root={left:leaf,right:leaf,anchor};
  const graph=privateCardGraph(root);
  try{
    const before=graph.packedSnapshot();
    assert.equal(graph.root.left,graph.root.right);assert.equal(graph.root.left.n,1);
    const child=graph.fork();
    try{
      assert.equal(child.sameCurrent(graph,()=>{}),true);
      graph.export(graph.root);graph.collect();
      const old=graph.root;
      // Any accidental re-export of the unchanged graph is observable here.
      graph.snapshot=()=>{throw Error('unchanged Context must not be re-encoded');};
      graph.park();assert.equal(graph.nodeCount,0);assert.throws(()=>old.left,/Released card view/);
      assert.deepEqual(decodeGraphData(graph.packedSnapshot()),decodeGraphData(before));
      child.park();assert.deepEqual(decodeGraphData(child.packedSnapshot()),decodeGraphData(before));
      graph.close();child.root.left.n=9;child.park();
      const after=unpackGraphImage<typeof root>(child.packedSnapshot());
      assert.equal(after.root.left.n,9);assert.equal(after.root.right,after.root.left);assert.equal(after.root.anchor,anchor);
    }finally{child.close();}
  }finally{graph.close();}
});

const imageMutations:{name:string;change:(root:{leaf:{n:number;drop?:number};list:(number|undefined)[]})=>void}[]=[
  {name:'nested write',change:root=>{root.leaf.n=9;}},
  {name:'property deletion',change:root=>{delete root.leaf.drop;}},
  {name:'array element',change:root=>{root.list[1]=7;}},
  {name:'array deletion',change:root=>{delete root.list[0];}},
  {name:'array shrink',change:root=>{root.list.length=1;}},
  {name:'array extension',change:root=>{root.list.length=8;}},
  {name:'define property',change:root=>{Object.defineProperty(root.leaf,'n',{value:6,writable:true,enumerable:true,configurable:true});}},
  {name:'replace object',change:root=>{root.leaf={n:3,drop:4};}},
];
for(const mutation of imageMutations)test(`a ${mutation.name} invalidates an activated image without changing a sibling`,()=>{
  const source={leaf:{n:1,drop:2},list:[1,2,3]},expected=structuredClone(source),graph=privateCardGraph(source);
  graph.packedSnapshot();
  assert.equal(graph.root.leaf.n,1);const sibling=graph.fork();
  try{
    mutation.change(graph.root);mutation.change(expected);
    const saved=graph.packedSnapshot();
    assert.deepEqual(unpackGraphImage(saved).root,expected);
    assert.deepEqual(sibling.snapshot().root,source);
    assert.deepEqual(unpackGraphImage(sibling.packedSnapshot()).root,source);
  }finally{graph.close();sibling.close();}
});

test('a read-only activation cannot reuse compressed ownership roles under a different boundary',()=>{
  const external=ownRuleValue({tag:'external'}),boundary=immutableRuleEpoch(),owned=inRuleValueContext(()=>ownRuleValue({external,n:3}));
  const graph=privateCardGraph({owned});
  try{
    const before=graph.packedSnapshot(boundary);assert.equal(graph.root.owned.n,3);
    graph.park(Number.MAX_SAFE_INTEGER);const after=graph.packedSnapshot(Number.MAX_SAFE_INTEGER);
    assert.notDeepEqual(decodeGraphData(after),decodeGraphData(before));assert.ok(after.anchors.some(anchor=>(anchor as typeof owned).n===3));
    const restored=unpackGraphImage<{owned:typeof owned}>(after);assert.equal(restored.root.owned.external,external);
  }finally{graph.close();}
});

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

test('sibling search images share frozen blocks while cold storage retains null prototypes and mutable aliases',()=>{
  const block=ownRuleValue({items:Array.from({length:2048},(_,n)=>({n}))});
  const local=Object.assign(Object.create(null),{n:1});
  const graph=privateCardGraph({block,alias:block.items[0],local,aliasLocal:local}),sibling=graph.fork();
  const first=graph.snapshot(true),second=sibling.snapshot(true);
  assert.equal(first.root.block,block);assert.equal(second.root.block,block);
  assert.notEqual(first.root.local,second.root.local);assert.equal(first.root.local,first.root.aliasLocal);
  first.root.local.n=9;assert.equal(graph.root.local.n,1);
  assert.throws(()=>{first.root.block.items[0]!.n=7;},TypeError);
  const saved=deserialize(serialize([first,second]));
  assert.equal(saved[0].root.block,saved[1].root.block,'one file retains physical sharing across sibling images');
  const restored=saved.map((row:typeof first)=>privateCardGraph(row.root,row.immutable,row.nullPrototypes));
  try{
    assert.equal(restored[0]!.root.block,restored[1]!.root.block);
    for(const current of restored){
      assert.equal(Object.getPrototypeOf(current.root.local),null);
      assert.equal(current.root.local,current.root.aliasLocal);
      assert.equal(current.root.block.items[0],current.root.alias);
      assert.ok(current.nodeCount<5,'restoring cannot expand immutable payloads into mutable graph nodes');
    }
    restored[0]!.root.local.n=12;assert.equal(restored[1]!.root.local.n,1);
  }finally{graph.close();sibling.close();for(const current of restored)current.close();}
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


test('complete current equality preserves shared descendants, aliases, property order, holes and prototypes',()=>{
  const leaf={n:1},root:{a:{n:number};b:{n:number};items:(number|undefined)[];record:Record<string,number>;self?:unknown}={a:leaf,b:leaf,items:[,undefined],record:{x:1,y:2}};root.self=root;
  const graph=new CardGraph(root),identical=graph.fork();let checks=0;
  try{
    assert.equal(graph.sameCurrent(identical,()=>{checks++;}),true);assert.ok(checks>0);
    const allocated=graph.fork();try{const value={n:1};allocated.root.a=value;allocated.root.b=allocated.root.a;assert.equal(graph.sameCurrent(allocated,()=>{}),true);}finally{allocated.close();}
    for(const change of [(g:typeof graph)=>{g.root.a.n=2;},(g:typeof graph)=>{g.root.b={n:1};},(g:typeof graph)=>{g.root.items[0]=undefined;},(g:typeof graph)=>{delete g.root.record.x;g.root.record.x=1;},(g:typeof graph)=>{g.root.record=Object.assign(Object.create(null),{x:1,y:2});}]){
      const child=graph.fork();try{change(child);assert.equal(graph.sameCurrent(child,()=>{}),false);}finally{child.close();}
    }
    assert.throws(()=>graph.sameCurrent(identical,()=>{throw Error('cancelled equality');}),/cancelled equality/);
    assert.equal(graph.root.a.n,1);assert.equal(graph.root.a,graph.root.b);assert.equal(graph.root.self,graph.root);
  }finally{graph.close();identical.close();}
});


test('current equality compares fresh immutable blocks and preserves prior Program identities and cross-block aliases',()=>{
  const make=()=>ownRuleValue({nested:{n:1}}),existing=make(),base=new CardGraph<{whole:ReturnType<typeof make>|null;alias:{n:number}|null}>({whole:null,alias:null});
  const anchor=immutableRuleEpoch(),left=base.fork(),same=base.fork(),different=base.fork(),mutable=base.fork(),prior=base.fork();
  try{
    const first=make();left.root.whole=first;left.root.alias=first.nested;
    const next=make();same.root.whole=next;same.root.alias=next.nested;
    assert.equal(left.sameCurrent(same,()=>{},anchor),true);
    assert.equal(left.sameCurrent(same,()=>{}),false,'a later comparison must conservatively anchor pre-existing blocks');
    different.root.whole=make();different.root.alias=make().nested;assert.equal(left.sameCurrent(different,()=>{},anchor),false);
    mutable.root.whole=make();mutable.root.alias={n:1};assert.equal(left.sameCurrent(mutable,()=>{},anchor),false);
    prior.root.whole=existing;prior.root.alias=existing.nested;assert.equal(left.sameCurrent(prior,()=>{},anchor),false,'Program-held identity must not be renamed');
    assert.equal(left.root.whole.nested,left.root.alias);
  }finally{base.close();left.close();same.close();different.close();mutable.close();prior.close();}
});


test('incremental collection keeps up with sustained wide frames without a full collection or idle drain',()=>{
  const graph=new CardGraph<{keep:{n:number};frames:Record<string,number>[]}>({keep:{n:7},frames:[]}),sibling=graph.fork();
  let peak=0;
  try{
    for(let turn=0;turn<200;turn++){
      graph.root.frames=Array.from({length:100},(_,i)=>Object.fromEntries(Array.from({length:64},(_,j)=>['slot'+j,turn+i+j])));
      graph.boundary();peak=Math.max(peak,graph.nodeCount);
      assert.equal(graph.root.frames[99]!.slot63,turn+162);
      assert.equal(graph.root.keep.n,7);assert.equal(sibling.root.frames.length,0);
    }
    assert.ok(peak<4000,`unreachable wide frames accumulated to ${peak} rows`);
  }finally{graph.close();sibling.close();}
});

test('Context-owned immutable identities survive cold images without renaming Program anchors',()=>{
  const anchor=ownRuleValue({n:1}),prior=inRuleValueContext(()=>ownRuleValue({n:2})),boundary=immutableRuleEpoch();
  const make=()=>inRuleValueContext(()=>{const child=ownRuleValue({n:3});return ownRuleValue({child,alias:child,anchor,prior});});
  const left=privateCardGraph({value:make()}),right=privateCardGraph({value:make()});
  const equal=(a:typeof left,b:typeof left)=>a.sameCurrent(b,()=>{},undefined,boundary);
  const saved=deserialize(serialize(left.snapshot(true,boundary)));
  const restored=privateCardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
  try{
    assert.equal(equal(left,right),true);
    assert.equal(isContextRuleValue(restored.root.value),true);
    assert.equal(isContextRuleValue(restored.root.value.anchor),false);
    assert.equal(isContextRuleValue(restored.root.value.prior),false,'a value available before Program binding remains an anchor');
    assert.equal(restored.root.value.child,restored.root.value.alias);
    assert.equal(equal(left,restored),false,'a copied external anchor cannot be equated to the Program-held object');
    const dataOnly=privateCardGraph({value:inRuleValueContext(()=>ownRuleValue({child:{n:3}}))});
    const image=deserialize(serialize(dataOnly.snapshot(true,boundary)));
    const cold=privateCardGraph(image.root,image.immutable,image.nullPrototypes,image.contextValues);
    try{assert.equal(dataOnly.sameCurrent(cold,()=>{},undefined,boundary),true);}
    finally{dataOnly.close();cold.close();}
  }finally{left.close();right.close();restored.close();}
});

test('identical lossless parked bytes prove complete equality without activation; anchors and ownership boundaries remain material',()=>{
  const anchor=ownRuleValue({n:7}),boundary=immutableRuleEpoch();
  const make=(external=anchor)=>privateCardGraph({value:inRuleValueContext(()=>{const child=ownRuleValue({n:3});return ownRuleValue({external,child,alias:child});})});
  const left=make(),right=make(),foreign=make(ownRuleValue({n:7}));
  try{
    left.park(boundary);right.park(boundary);foreign.park(boundary);
    assert.equal(left.candidateKey(boundary),right.candidateKey(boundary));
    assert.equal(left.sameCurrent(right,()=>{},undefined,boundary),true);assert.equal(left.isParked,true);assert.equal(right.isParked,true);
    assert.throws(()=>left.sameCurrent(right,()=>{throw Error('cancelled packed equality');},undefined,boundary),/cancelled packed equality/);
    assert.equal(left.sameCurrent(foreign,()=>{},undefined,boundary),false,'equal anchor data cannot replace physical identity');assert.equal(left.isParked,true);assert.equal(foreign.isParked,true);
    assert.equal(left.sameCurrent(right,()=>{},undefined,Number.MAX_SAFE_INTEGER),false,'a boundary above decoded allocation clocks cannot reuse the earlier byte proof');
  }finally{left.close();right.close();foreign.close();}
});

test('forking a packed Context shares only its immutable representation and activates branches independently',()=>{
  const root=privateCardGraph({value:{n:1},list:Array.from({length:100},(_,n)=>({n}))});root.park();
  const a=root.fork(),b=root.fork();
  try{
    assert.equal(root.nodeCount,0);assert.equal(a.nodeCount,0);assert.equal(b.nodeCount,0);
    assert.equal(root.isParked,true);assert.equal(a.isParked,true);assert.equal(b.isParked,true);
    a.root.value.n=7;a.root.list[0]!.n=9;
    assert.equal(root.nodeCount,0);assert.equal(b.nodeCount,0);
    assert.equal(b.root.value.n,1);assert.equal(b.root.list[0]!.n,0);b.close();
    assert.equal(root.root.value.n,1);assert.equal(root.root.list[0]!.n,0);assert.equal(a.root.value.n,7);
  }finally{root.close();a.close();b.close();}
});

test('identical complete images share storage while retaining independent owners',()=>{
  const anchor=ownRuleValue({tag:'external'}),boundary=immutableRuleEpoch();
  const make=()=>privateCardGraph({mutable:{n:1},owned:inRuleValueContext(()=>ownRuleValue({anchor,n:2}))});
  const left=make(),right=make();
  try{
    left.park(boundary);right.park(boundary);left.packedSnapshot(boundary);
    assert.equal(left.sameCurrent(right,()=>{},undefined,boundary),true);
    const exported=right.packedSnapshot(boundary);assert.deepEqual(decodeGraphData(exported),decodeGraphData(left.packedSnapshot(boundary)));
    if('bytes' in exported)exported.bytes.fill(0);else exported.chunks[0]={data:'invalid'};exported.anchors.length=0;
    const sibling=right.fork();left.close();
    try{
      right.root.mutable.n=9;
      assert.equal(sibling.root.mutable.n,1);assert.equal(sibling.root.owned.anchor,anchor);
      sibling.close();assert.equal(right.root.mutable.n,9);assert.equal(right.root.owned.n,2);
    }finally{sibling.close();}
  }finally{left.close();right.close();}
});

test('Context ownership scope unwinds after a failed operation',()=>{
  assert.throws(()=>inRuleValueContext(()=>{assert.equal(isContextRuleValue(ownRuleValue({n:1})),true);throw Error('original failure');}),/original failure/);
  assert.equal(isContextRuleValue(ownRuleValue({n:1})),false);
});

test('a new process restores relative Context ownership independently of allocation clocks',async()=>{
  for(let i=0;i<1000;i++)ownRuleValue({i});
  const prior=inRuleValueContext(()=>ownRuleValue({n:1})),boundary=immutableRuleEpoch();
  const value=inRuleValueContext(()=>{const child=ownRuleValue({n:2});return ownRuleValue({child,alias:child,prior});});
  const graph=privateCardGraph({value});
  const image=serialize(graph.snapshot(true,boundary)).toString('base64');graph.close();
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {deserialize} from 'node:v8';
    import {privateCardGraph} from ${JSON.stringify(new URL('../src/graph.ts',import.meta.url).href)};
    import {ownRuleValue,immutableRuleEpoch,inRuleValueContext,isContextRuleValue} from ${JSON.stringify(new URL('../../card-engine/src/rules-values.ts',import.meta.url).href)};
    const boundary=immutableRuleEpoch(),saved=deserialize(Buffer.from(process.argv[1],'base64'));
    const cold=privateCardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
    const make=prior=>inRuleValueContext(()=>{const child=ownRuleValue({n:2});return ownRuleValue({child,alias:child,prior});});
    const equal=privateCardGraph({value:make(cold.root.value.prior)});
    const differentAnchor=privateCardGraph({value:make(ownRuleValue({n:1}))});
    try{
      assert.equal(isContextRuleValue(cold.root.value),true);
      assert.equal(isContextRuleValue(cold.root.value.child),true);
      assert.equal(isContextRuleValue(cold.root.value.prior),false);
      assert.equal(cold.root.value.child,cold.root.value.alias);
      assert.equal(cold.sameCurrent(equal,()=>{},undefined,boundary),true);
      assert.equal(cold.sameCurrent(differentAnchor,()=>{},undefined,boundary),false);
      process.stdout.write('relative ownership verified');
    }finally{cold.close();equal.close();differentAnchor.close();}
  `,image]);
  assert.equal(stdout,'relative ownership verified');
});
