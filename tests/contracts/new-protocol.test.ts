import test from 'node:test';
import assert from 'node:assert/strict';
import {InstanceErrorSchema,PauseReasonSchema,CallbackPauseSchema} from '@bear-forge/contracts/instance';
import {GameErrorSchema,RequestIdSchema,InputOptionsSchema,EventDeliveryIdSchema} from '@bear-forge/contracts/game';
import {RecordReadSchema} from '@bear-forge/contracts/capture';
test('failure categories distinguish rejected input and execution fault',()=>{
  assert.ok(InstanceErrorSchema.safeParse({kind:'rejected',code:'records_not_found',message:'x'}).success);
  assert.equal(InstanceErrorSchema.safeParse({kind:'rejected',code:'program_failed',message:'x'}).success,false);
  assert.ok(GameErrorSchema.safeParse({kind:'rejected',code:'request_mismatch',message:'x'}).success);
  assert.equal(GameErrorSchema.safeParse({kind:'conflict',code:'invalid_output',message:'x'}).success,false);
});
test('optional capture has initial and tail cursors with positive page size',()=>{
  assert.ok(RecordReadSchema.safeParse({after:null,limit:10}).success);assert.ok(RecordReadSchema.safeParse({after:0,limit:1}).success);
  for(const x of [{after:-1,limit:1},{after:0.5,limit:1},{after:0,limit:0},{after:0,limit:1.5}])assert.equal(RecordReadSchema.safeParse(x).success,false);
});
test('input options describe action values or game-defined construction data',()=>{
  assert.ok(InputOptionsSchema.safeParse({kind:'exact',values:[{kind:'pass'}]}).success);
  assert.ok(InputOptionsSchema.safeParse({kind:'construct',description:{grammar:'expr'}}).success);
  for(const kind of ['filtered','sample','prefix','enumerate'])assert.equal(InputOptionsSchema.safeParse({kind,values:[]}).success,false);
});
test('one request identity locates instance, call and input endpoint',()=>{
  const instanceId='11111111-1111-4111-8111-111111111111',callId='22222222-2222-4222-8222-222222222222';
  assert.ok(RequestIdSchema.safeParse({instanceId,callId,key:'slot'}).success);
  for(const x of [callId,{instanceId,callId},{callId,key:'slot'}])assert.equal(RequestIdSchema.safeParse(x).success,false);
  assert.ok(EventDeliveryIdSchema.safeParse({instanceId,callId,index:0}).success);
  assert.equal(EventDeliveryIdSchema.safeParse({instanceId,origin:{kind:'done'},index:0}).success,false);
});
test('pause categories contain no input-count limit state',()=>{
  for(const reason of ['requested','unbound','cancelled','handler_failed','invalid_reply'])assert.ok(PauseReasonSchema.safeParse(reason).success);
  for(const reason of ['limit','game_over'])assert.equal(PauseReasonSchema.safeParse(reason).success,false);
  assert.ok(CallbackPauseSchema.safeParse({kind:'pause'}).success);assert.equal(CallbackPauseSchema.safeParse({kind:'pause',value:3}).success,false);
});
