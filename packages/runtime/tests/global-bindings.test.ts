import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

test('strict module globals use the active Instance and retain references across a suspended RHS', () => {
  const first: Record<string,unknown>={value:1}, second: Record<string,unknown>={value:7};
  let active: object=first;
  const operations=createOperations({global:()=>active});
  assert.equal(operations.globalRead('value'),1);
  assert.equal(operations.globalTypeof(operations.globalReference('missing')),'undefined');
  assert.throws(()=>operations.globalGet(operations.globalReference('missing')),ReferenceError);
  assert.throws(()=>operations.globalSet(operations.globalReference('missing'),2),ReferenceError);
  const reference=operations.globalReference('value');
  active=second;
  assert.equal(operations.globalRead('value'),7);
  assert.equal(operations.globalSet(reference,3),3);
  assert.equal(first.value,3);
  assert.equal(second.value,7);
  assert.equal(operations.globalSet(operations.globalReference('value'),9),9);
  assert.equal(second.value,9);
});

test('missing globals charge deep inherited absence checks',()=>{
  let prototype={};
  for(let index=0;index<4096;index++)prototype=Object.create(prototype);
  const globals=Object.create(prototype),marker=Error('budget');
  for(const run of [
    (operations:ReturnType<typeof createOperations>)=>operations.globalRead('absent'),
    (operations:ReturnType<typeof createOperations>)=>operations.globalGet(operations.globalReference('absent')),
    (operations:ReturnType<typeof createOperations>)=>operations.globalSet(operations.globalReference('absent'),1),
    (operations:ReturnType<typeof createOperations>)=>operations.globalTypeof(operations.globalReference('absent')),
  ]){
    let ticks=0;
    const operations=createOperations({global:()=>globals,tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>run(operations),error=>error===marker);
    assert.equal(ticks,100);
  }
});

test('typeof a present global performs one membership check and one read',()=>{
  const trace:string[]=[];
  const prototype=new Proxy({inherited:7},{
    has(target,key){if(key==='inherited')trace.push('has');return Reflect.has(target,key);},
    get(target,key,receiver){if(key==='inherited')trace.push('get');return Reflect.get(target,key,receiver);},
  });
  const globals=Object.create(prototype);
  const operations=createOperations({global:()=>globals});
  assert.equal(operations.globalTypeof(operations.globalReference('inherited')),'number');
  assert.deepEqual(trace,['has','get']);
});
