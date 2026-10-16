import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

// Exercise the production copy/serialization mechanisms with real compiled
// binding closures. Compiler namespace emission is covered separately by the
// module-linking suite; this test does not claim that integration is complete.
test('namespace codecs preserve compiled binding cells and cycles without reading exports', () => {
  const instance=new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){
    let value=1,namespace,reads=0;
    return {read:()=>{reads++;return value;},write:n=>value=n,self:()=>namespace,
      attach:n=>namespace=n,reads:()=>reads};
  }};`).content));
  instance.start(null);assert.equal(instance.result.status,1,String(instance.result.value));
  const runtime=instance as any,effects=runtime.loaded.effects;
  const enter=<T>(action:()=>T):T=>runtime.loaded.enter(runtime.context,action);
  enter(()=>{
    const original=instance.result.value;
    const functions=Object.fromEntries(['read','write','self','attach','reads'].map(key=>[key,effects.operations.get(effects.operations.ref(original,key))]));
    const namespace=effects.operations.moduleNamespace({value:functions.read,self:functions.self});
    functions.attach(namespace);
    const root=Object.assign(runtime.loaded.record(),{namespace,write:functions.write,reads:functions.reads});
    const encoded=effects.S.write(root);
    const direct=effects.prepareCopy(root)(),plan=effects.prepareCopy(root),first=plan(),second=plan(),restored=effects.S.read(encoded);
    assert.equal(functions.reads(),0);
    for(const copy of [direct,first,second,restored]) assert.equal(copy.reads(),0);
    for(const [index,copy] of [root,direct,first,second,restored].entries()){
      copy.write(index+3);
      assert.equal(copy.namespace.self,copy.namespace);
      assert.equal(copy.namespace.value,index+3);
      assert.deepEqual(Object.getOwnPropertyDescriptor(copy.namespace,'value'),{
        value:index+3,writable:true,enumerable:true,configurable:false,
      });
      assert.equal(Reflect.set(copy.namespace,'value',99),false);
    }
    assert.equal(root.namespace.value,3);
  });
});

test('projected program namespace serializes current COW properties and restores Realm identities',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){return null;}};`).content);
  artifact.namespaceKeys=['retained','self'];
  const instance=new ProgramExecution(artifact),runtime=instance as any;
  const {loaded}=instance,effects=loaded.effects;
  loaded.enter(runtime.context,()=>{
    const namespace=runtime.context.initialExports,ops=effects.operations;
    ops.set(ops.ref(namespace,'retained'),7);
    ops.set(ops.ref(namespace,'self'),namespace);
    ops.set(ops.ref(namespace,'unused'),'must not be serialized');
    loaded.namespace(namespace);
    const encoded=effects.S.write(namespace);
    assert.equal(JSON.stringify(encoded).includes('must not be serialized'),false);
    const restored=effects.S.read(encoded);
    assert.equal(loaded.read(restored,'retained'),7);
    assert.strictEqual(loaded.read(restored,'self'),restored);
    assert.strictEqual(loaded.inspection.getPrototypeOf(restored),effects.globals.Object.prototype);
    assert.equal(loaded.inspection.getOwnPropertyDescriptor(restored,'unused'),undefined);
    assert.equal(runtime.context.objects.has(restored),true);
    ops.set(ops.ref(restored,'retained'),9);
    assert.equal(loaded.read(namespace,'retained'),7);
    assert.equal(loaded.read(restored,'retained'),9);
  });
  instance.dispose();
});

test('managed Reflect.set preserves namespace receiver TDZ and read-only exotic semantics',()=>{
  const instance=new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){return null;}};`).content));
  const runtime=instance as any;
  instance.loaded.enter(runtime.context,()=>{
    const effects=instance.loaded.effects,ops=effects.operations;
    let ready=false;
    const namespace=ops.moduleNamespace({value:()=>{if(!ready)throw new ReferenceError('uninitialized');return 7;}});
    const target=instance.loaded.record();
    runtime.context.objects.register(target);
    assert.throws(()=>runtime.context.objects.set(target,'value',8,namespace,Reflect.apply),ReferenceError);
    ready=true;
    assert.equal(runtime.context.objects.set(target,'value',8,namespace,Reflect.apply),false);
    assert.equal(namespace.value,7);
    assert.equal(runtime.context.objects.set(target,'missing',8,namespace,Reflect.apply),false);
  });
  instance.dispose();
});
