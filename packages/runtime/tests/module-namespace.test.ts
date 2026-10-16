import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNamespaceRegistry } from '../src/module-namespace.ts';

const original = await import('data:text/javascript,' + encodeURIComponent(`
  export let value=1;
  export function change(next){value=next;}
  const x=2,y=10;export {x as 'b',y as 'a'};
`));
function inspect(namespace: any) {
  const d=Object.getOwnPropertyDescriptor(namespace,'value')!;
  return [Reflect.ownKeys(namespace).map(String),Object.getPrototypeOf(namespace),Object.isExtensible(namespace),
    Object.isSealed(namespace),Object.isFrozen(namespace),Object.prototype.toString.call(namespace),d];
}
test('module namespace registry matches native reflection and live export writes', () => {
  const registry=createNamespaceRegistry(), cell={value:1};
  const namespace=registry.create({'value':()=>cell.value,'change':()=>original.change,'b':()=>2,'a':()=>10});
  original.change(1);
  assert.deepEqual(inspect(namespace),inspect(original));
  for(const value of [2,NaN,-0,undefined]) {
    cell.value=value as number;original.change(value);
    assert.deepEqual(inspect(namespace),inspect(original));
    for(const descriptor of [{},{value},{value:9},{writable:true},{writable:false},{enumerable:false},
      {configurable:true},{get:()=>1}]) {
      assert.equal(Reflect.defineProperty(namespace,'value',descriptor),Reflect.defineProperty(original,'value',descriptor));
    }
    assert.equal(Reflect.set(namespace,'value',9),false);
    assert.equal(Reflect.deleteProperty(namespace,'value'),false);
    assert.equal(Reflect.set(namespace,'absent',9),false);
    assert.equal(Reflect.deleteProperty(namespace,'absent'),true);
  }
  assert.equal(Reflect.setPrototypeOf(namespace,null),true);
  assert.equal(Reflect.setPrototypeOf(namespace,{}),false);
  assert.equal(Reflect.preventExtensions(namespace),true);
  assert.throws(()=>Object.freeze(namespace),TypeError);
  assert.equal(Object.seal(namespace),namespace);
  assert.equal(Reflect.defineProperty(namespace,Symbol.toStringTag,{value:'Module'}),true);
  assert.equal(Reflect.defineProperty(namespace,Symbol.toStringTag,{value:'Other'}),false);
});

test('namespace allocation and record capture never read uninitialized bindings', () => {
  const registry=createNamespaceRegistry();let reads=0;
  const namespace=registry.create({value:()=>{reads++;throw new ReferenceError('TDZ');}});
  assert.deepEqual(Reflect.ownKeys(namespace),['value',Symbol.toStringTag]);
  assert.equal('value' in namespace,true);
  assert.equal(Reflect.deleteProperty(namespace,'value'),false);
  assert.equal(Reflect.set(namespace,'value',1),false);
  const record=registry.record(namespace)!;
  const copy=registry.allocate(record.names);registry.install(copy,record.readers);
  assert.equal(reads,0);
  assert.throws(()=>Reflect.get(copy,'value'),ReferenceError);
  assert.throws(()=>Object.getOwnPropertyDescriptor(namespace,'value'),ReferenceError);
  assert.throws(()=>Reflect.defineProperty(namespace,'value',{configurable:true}),ReferenceError);
  assert.equal(reads,3);
});

test('namespace records can be installed with independent binding environments and cyclic identity', () => {
  const registry=createNamespaceRegistry(),parent=registry.allocate(['self','value']),child=registry.allocate(['self','value']);
  const first={value:1},second={value:1};
  registry.install(parent,[()=>parent,()=>first.value]);registry.install(child,[()=>child,()=>second.value]);
  first.value=2;second.value=3;
  assert.equal(Reflect.get(parent,'self'),parent);assert.equal(Reflect.get(child,'self'),child);
  assert.equal(Reflect.get(parent,'value'),2);assert.equal(Reflect.get(child,'value'),3);
});

test('namespace export key order matches native V8 including numeric-looking names', async () => {
  const names=['2','10','01','4294967294','4294967295','a','A',''];
  const source=names.map((name,index)=>`const v${index}=${index};export {v${index} as ${JSON.stringify(name)}};`).join('');
  const native=await import('data:text/javascript,'+encodeURIComponent(source));
  const namespace=createNamespaceRegistry().create(Object.fromEntries(names.map((name,index)=>[name,()=>index])));
  assert.deepEqual(Reflect.ownKeys(namespace),Reflect.ownKeys(native));
  assert.deepEqual(Object.keys(namespace),Object.keys(native));
});
