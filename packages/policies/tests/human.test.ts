import test from 'node:test';
import {InstanceIdSchema,CallIdSchema} from '@bear-forge/contracts/instance';
import assert from 'node:assert/strict';
import {createHumanPolicy} from '../src/human.ts';
import type {PolicyRequest} from '../src/policy.types.ts';
const request:PolicyRequest={id:{instanceId:InstanceIdSchema.parse('00000000-0000-0000-0000-000000000000'),callId:CallIdSchema.parse('00000000-0000-4000-8000-000000000001'),key:'decision'},player:'0',type:'action',data:null,observation:{hp:10},options:{kind:'exact',values:[{bits:123}]}};
test('human choice waits and returns the unchanged proposal without touching execution or random state',async()=>{
  let choose!:()=>void;const policy=createHumanPolicy(async r=>{assert.equal(r,request);await new Promise<void>(resolve=>{choose=resolve;});return {bits:123};});
  const random={state:99,position:7},memory={value:1};let ready=false;
  const pending=policy.decide({request,random,memory,visibleHistory:[],signal:new AbortController().signal}).then(p=>{ready=true;return p;});
  await Promise.resolve();assert.equal(ready,false);choose();const result=await pending;
  assert.deepEqual(result.action,{bits:123});assert.equal(result.nextRandom,random);assert.equal(result.nextMemory,memory);assert.equal(result.logProbability,null);
});
test('cancelled human choice cannot become a proposal',async()=>{
  const controller=new AbortController(),policy=createHumanPolicy(async()=>{controller.abort(Error('quit'));return null;});
  await assert.rejects(policy.decide({request,random:{state:0,position:0},memory:null,visibleHistory:[],signal:controller.signal}),/quit/);
});
