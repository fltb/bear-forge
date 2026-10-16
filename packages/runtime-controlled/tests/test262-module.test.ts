import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Test262Case} from '../../compiler/tests/test262-cases.ts';
import {runTest262Module} from './test262-module.ts';

async function fixture(source: string, check: (candidate:Test262Case, root:string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'bear-module-fixture-'));
  try {
    await mkdir(join(root, 'test'));
    await writeFile(join(root, 'test/case.js'), source);
    await check({file:'test/case.js',mode:'module',source,harness:[],features:[],flags:['module'],asynchronous:false,negative:null},root);
  } finally {await rm(root,{recursive:true,force:true});}
}

test('module adapter executes real initialization, including failures and relative imports', async () => {
  await fixture('import {value} from "./dependency.js"; if(value!==7)throw new TypeError();export{};', async (candidate,root) => {
    await writeFile(join(root,'test/dependency.js'),'export const value=7;');
    const outcome=await runTest262Module(candidate,root);
    assert.equal(outcome.status,'passed',JSON.stringify(outcome));
    await writeFile(join(root,'test/dependency.js'),'export const value=8;');
    const failed=await runTest262Module(candidate,root);
    assert.equal(failed.status,'failed');
    assert.deepEqual(failed.execution,{kind:'threw',phase:'runtime',constructorName:'TypeError'});
    await writeFile(join(root,'test/dependency.js'),'export const value=fetch("x");');
    const rejected=await runTest262Module(candidate,root);
    assert.equal(rejected.execution.kind,'admission-rejected');
    if(rejected.execution.kind==='admission-rejected')assert.equal(rejected.execution.phase,'compile');
  });
});

test('Script harness retains its actual Realm global with the controlled ESM test', async () => {
  await fixture(`if(fnGlobalObject()!==globalThis||this!==undefined||probe!==1||
    globalThis.process!==undefined||globalThis.require!==undefined||globalThis.module!==undefined||
    globalThis.fetch!==undefined||globalThis.setTimeout!==undefined)throw new TypeError();export{};`, async (candidate,root) => {
    candidate.harness=[
      {file:'probe.js',source:'if(this!==globalThis||globalThis.probe)throw Error();var probe=1;'},
      {file:'fnGlobalObject.js',source:'function fnGlobalObject(){return Function("return this")();}'},
    ];
    assert.equal((await runTest262Module(candidate,root)).status,'passed');
    candidate.harness=[{file:'broken.js',source:'throw new TypeError("harness failure");'}];
    const failed=await runTest262Module(candidate,root);
    assert.equal(failed.execution.kind,'runner-error');
    assert.equal(failed.status,'not-executed');
  });
  await fixture('Function("return this")();export{};',async(candidate,root)=>{
    const rejected=await runTest262Module(candidate,root);
    assert.equal(rejected.execution.kind,'admission-rejected');
    if(rejected.execution.kind==='admission-rejected')assert.equal(rejected.execution.phase,'compile');
  });
  await fixture('try{Date.now()}catch{} export{};',async(candidate,root)=>{
    const rejected=await runTest262Module(candidate,root);
    assert.equal(rejected.execution.kind,'admission-rejected');
    if(rejected.execution.kind==='admission-rejected')assert.equal(rejected.execution.phase,'runtime');
  });
});

test('unsupported test modes and deadlines cannot count as completion',async()=>{
  await fixture('export{};',async(candidate,root)=>{
    for(const changes of [{mode:'strict' as const},{negative:{phase:'parse' as const,type:'SyntaxError'}}]){
      const outcome=await runTest262Module({...candidate,...changes},root);
      assert.equal(outcome.execution.kind,'runner-missing');
      assert.equal(outcome.status,'not-executed');
    }
    const unexpected=await runTest262Module({...candidate,negative:{phase:'runtime',type:'TypeError'}},root);
    assert.equal(unexpected.execution.kind,'completed');
    assert.equal(unexpected.status,'failed');
    await assert.rejects(runTest262Module({...candidate,source:'export const changed=1;'},root),/differs/);
    await assert.rejects(runTest262Module({...candidate,file:'../outside.js'},root),/escapes/);
  });
  await fixture('while(true){};export{};',async(candidate,root)=>{
    const outcome=await runTest262Module(candidate,root,200);
    assert.equal(outcome.execution.kind,'timeout');
    assert.equal(outcome.status,'failed');
  });
});

test('async module adapter requires an actual completion signal after module evaluation',async()=>{
  await fixture('await Promise.resolve(); $DONE(); export{};',async(candidate,root)=>{
    candidate.asynchronous=true;
    candidate.harness=[{file:'doneprintHandle.js',source:
      'function $DONE(error){print(error ? "Test262:AsyncTestFailure:Error: bad" : "Test262:AsyncTestComplete");}'}];
    const completed=await runTest262Module(candidate,root);
    assert.equal(completed.status,'passed',JSON.stringify(completed));
    await writeFile(join(root,'test/case.js'),'await Promise.resolve(); $DONE(new Error()); export{};');
    candidate.source='await Promise.resolve(); $DONE(new Error()); export{};';
    const failure=await runTest262Module(candidate,root);
    assert.equal(failure.execution.kind,'async-failure');
    assert.equal(failure.status,'failed');
    await writeFile(join(root,'test/case.js'),'await Promise.resolve(); export{};');
    candidate.source='await Promise.resolve(); export{};';
    const absent=await runTest262Module(candidate,root);
    assert.equal(absent.execution.kind,'timeout');
    assert.equal(absent.status,'failed');
  });
});

test('runtime-negative modules require the actual thrown constructor and phase',async()=>{
  await fixture('throw new TypeError();export{};',async(candidate,root)=>{
    const outcome=await runTest262Module({...candidate,negative:{phase:'runtime',type:'TypeError'}},root);
    assert.deepEqual(outcome.execution,{kind:'threw',phase:'runtime',constructorName:'TypeError'});
    assert.equal(outcome.status,'passed');
  });
  await fixture('throw new Test262Error();export{};',async(candidate,root)=>{
    candidate.harness=[{file:'sta.js',source:'function Test262Error(){}'}];
    const outcome=await runTest262Module({...candidate,negative:{phase:'runtime',type:'Test262Error'}},root);
    assert.deepEqual(outcome.execution,{kind:'threw',phase:'runtime',constructorName:'Test262Error'});
    assert.equal(outcome.status,'passed');
  });
  await fixture('Function("return this")();export{};',async(candidate,root)=>{
    const outcome=await runTest262Module({...candidate,negative:{phase:'runtime',type:'TypeError'}},root);
    assert.equal(outcome.execution.kind,'admission-rejected');
    assert.equal(outcome.status,'not-executed');
  });
});

test('Script harness observes current COW descriptors, arrays and enumeration without weakening assertions',async()=>{
  const source=`const value={first:1,second:2};delete value.first;value.third=3;
    const array=[];array.push(4,5);probe(value,array);export{};`;
  await fixture(source,async(candidate,root)=>{
    candidate.harness=[{file:'probe.js',source:`function probe(value,array){
      if(array.length!==2||array[0]!==4||array[1]!==5)throw new TypeError('array');
      var names=[];for(var key in value)names.push(key);
      if(names.join(',')!=='second,third')throw new TypeError('keys');
      var descriptor=Object.getOwnPropertyDescriptor(value,'third');
      if(!descriptor||descriptor.value!==3||!descriptor.enumerable)throw new TypeError('descriptor');
      Object.defineProperty(value,'third',{writable:false});value.third=99;
      if(value.third!==3)throw new TypeError('sloppy write');
      var rejected=false;
      try{(function(){'use strict';value.third=99;})();}catch(e){rejected=e instanceof TypeError;}
      if(!rejected)throw new TypeError('strict write');
      delete value.second;
      if('second' in value)throw new TypeError('delete');
    }`}];
    assert.equal((await runTest262Module(candidate,root)).status,'passed');
    const wrong=source.replace('array.push(4,5)','array.push(4,6)');
    await writeFile(join(root,'test/case.js'),wrong);
    const outcome=await runTest262Module({...candidate,source:wrong},root);
    assert.equal(outcome.status,'failed');
    assert.deepEqual(outcome.execution,{kind:'threw',phase:'runtime',constructorName:'TypeError'});
  });
});
