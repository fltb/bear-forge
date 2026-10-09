import test from 'node:test';
import assert from 'node:assert/strict';
import { InstanceErrorSchema, GameErrorSchema, RecordReadSchema, InputOptionsSchema } from '@bear-forge/contracts';

test('fixed failure categories distinguish a rejected submission from execution failure',()=>{
  assert.ok(InstanceErrorSchema.safeParse({kind:'rejected',code:'call_mismatch',message:'x'}).success);
  assert.equal(InstanceErrorSchema.safeParse({kind:'rejected',code:'program_failed',message:'x'}).success,false);
  assert.ok(GameErrorSchema.safeParse({kind:'rejected',code:'decision_mismatch',message:'x'}).success);
  assert.equal(GameErrorSchema.safeParse({kind:'conflict',code:'invalid_output',message:'x'}).success,false);
});
test('capture cursor permits initial and tail reads, not negative or fractional positions',()=>{
  assert.ok(RecordReadSchema.safeParse({after:null,limit:10}).success);
  assert.ok(RecordReadSchema.safeParse({after:0,limit:1}).success);
  for(const x of [{after:-1,limit:1},{after:0.5,limit:1},{after:0,limit:0},{after:0,limit:1.5}])assert.equal(RecordReadSchema.safeParse(x).success,false);
});
test('input options retain exact payload lists and opaque JSON construction descriptions',()=>{
  assert.ok(InputOptionsSchema.safeParse({kind:'exact',values:[{kind:'pass'}]}).success);
  assert.ok(InputOptionsSchema.safeParse({kind:'construct',description:{grammar:'expr'}}).success);
  for(const kind of ['filtered','sample','prefix','enumerate'])assert.equal(InputOptionsSchema.safeParse({kind,values:[]}).success,false);
});

test('decision credentials explicitly bind an Instance and its suspended call',async()=>{
  const {DecisionIdSchema}=await import('@bear-forge/contracts');
  const instanceId='11111111-1111-4111-8111-111111111111';
  const callId='22222222-2222-4222-8222-222222222222';
  assert.ok(DecisionIdSchema.safeParse({instanceId,callId}).success);
  assert.equal(DecisionIdSchema.safeParse(callId).success,false);
  assert.equal(DecisionIdSchema.safeParse({callId}).success,false);
});

test('control schemas close pause categories and require finite nonnegative run limits',async()=>{
  const {PauseReasonSchema,InstanceRunLimitsSchema,GameRunLimitsSchema,CallbackPauseSchema,EventDeliveryIdSchema}=await import('@bear-forge/contracts');
  for(const reason of ['requested','unbound','limit','cancelled','handler_failed','invalid_reply'])assert.ok(PauseReasonSchema.safeParse(reason).success);
  assert.equal(PauseReasonSchema.safeParse('game_over').success,false);
  assert.ok(CallbackPauseSchema.safeParse({kind:'pause'}).success);
  assert.equal(CallbackPauseSchema.safeParse({kind:'pause',value:3}).success,false);
  for(const [schema,key] of [[InstanceRunLimitsSchema,'maxReplies'],[GameRunLimitsSchema,'maxInputs']] as const){
    assert.ok(schema.safeParse({}).success);assert.ok(schema.safeParse({[key]:0}).success);
    for(const value of [-1,0.5,Infinity])assert.equal(schema.safeParse({[key]:value}).success,false);
  }
  const instanceId='11111111-1111-4111-8111-111111111111',callId='22222222-2222-4222-8222-222222222222';
  assert.ok(EventDeliveryIdSchema.safeParse({instanceId,origin:{kind:'call',callId},index:0}).success);
  assert.ok(EventDeliveryIdSchema.safeParse({instanceId,origin:{kind:'done'},index:0}).success);
  assert.equal(EventDeliveryIdSchema.safeParse({instanceId,origin:{kind:'call'},index:0}).success,false);
});
