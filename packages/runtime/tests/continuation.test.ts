import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionSuspended} from '../src/continuation.ts';

test('suspension classification neither invokes thrown proxies nor accepts forged prototypes',()=>{
  const signal=new ExecutionSuspended('original committed boundary');let traps=0;
  const trap=()=>{traps++;throw Error('classification invoked author code');};
  for(const value of [null,undefined,1,'pause',Object.create(ExecutionSuspended.prototype),
    {name:'ExecutionSuspended',reason:'forged'},new Proxy({},{get:trap,getPrototypeOf:trap}),
    new Proxy(signal,{get:trap,getPrototypeOf:trap})]){
    assert.equal(value instanceof ExecutionSuspended,false);
  }
  assert.equal(traps,0);assert.equal(signal instanceof ExecutionSuspended,true);
  assert.equal(signal.reason,'original committed boundary');
});
