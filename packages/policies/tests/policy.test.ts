import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScript, PolicyRouter, randomInt } from '../src/index.ts';
import type { PolicyRequest } from '../src/index.ts';
import {registerPolicyWork,savePolicyWork,restorePolicyWork,closePolicyWork,PolicyWorkSuspended,suspendedPolicyWork} from '../src/search/work.ts';
const request = {
  id: {
    instanceId: 'i',
    callId: 'c',
    key: 'k'
  },
  player: '0',
  type: 'move',
  data: {},
  observation: {},
  options: {
    kind: 'exact',
    values: [{
      x: 1
    }, {
      x: 2
    }, {
      x: 3
    }]
  }
} as unknown as PolicyRequest;
const signal = new AbortController().signal;
test('unfinished policy work pauses without proposing an action and restores outside accepted memory',async()=>{
  let executed=0;
  function policy(){
    let cursor=0n;
    const result={...createScript('first'),async decide(input:Parameters<ReturnType<typeof createScript>['decide']>[0]){
      if(cursor===0n){cursor=1n;executed++;throw new PolicyWorkSuspended('scheduling-yield');}
      return createScript('first').decide(input);
    }};
    registerPolicyWork(result,{save:()=>({cursor}),restore:value=>{cursor=(value as {cursor:bigint}).cursor;},close(){}});return result;
  }
  const first={'0':policy()},router=new PolicyRouter(first,1),before=router.snapshot();
  assert.deepEqual(await router.binding('0').onRequest(request,{signal}),{kind:'pause'});
  assert.deepEqual(router.snapshot(),before);assert.equal(router.prepare(null).candidate,null);
  assert.deepEqual(suspendedPolicyWork(first),['scheduling-yield']);
  const saved=structuredClone(savePolicyWork(first));closePolicyWork(first);
  const next={'0':policy()};restorePolicyWork(next,saved);const resumed=new PolicyRouter(next,1,before);
  const response=await resumed.binding('0').onRequest(request,{signal});assert.equal(response.kind,'reply');
  assert.equal(executed,1);assert.deepEqual(suspendedPolicyWork(next),[]);closePolicyWork(next);
});
test('a policy without retained work cannot disguise an exception as a resumable pause',async()=>{
  const policy={...createScript('first'),async decide(){throw new PolicyWorkSuspended('missing-frontier');}};
  await assert.rejects(new PolicyRouter({'0':policy},1).binding('0').onRequest(request,{signal}),/missing-frontier/);
});
test('a pending proposal and event cursor restore without deciding again or advancing committed memory',async()=>{
  let decisions=0,reductions=0;
  const policy={...createScript('first'),event(memory:any){reductions++;return{...memory,events:(memory.events??0)+1};},
    async decide(input:Parameters<ReturnType<typeof createScript>['decide']>[0]){decisions++;return createScript('first').decide(input);}};
  let router=new PolicyRouter({'0':policy},7);
  const before={id:{instanceId:'i',callId:'before',index:0},event:{kind:'before'}};
  const after={id:{instanceId:'i',callId:'after',index:0},event:{kind:'after'}};
  await router.binding('0').onEvent(before,{signal});const reply=await router.binding('0').onRequest(request,{signal});
  await router.binding('0').onEvent(after,{signal});
  assert.deepEqual({decisions,reductions},{decisions:1,reductions:1});
  const state=router.snapshot(),pending=router.savePending();
  assert.deepEqual(state.actors['0']!.memory,{});assert.equal(state.actors['0']!.random.position,0);
  // The old transaction is discarded after its data is saved; only the new
  // router will commit the already-produced proposal.
  router.begin();router=new PolicyRouter({'0':policy},7,state);router.restorePending(pending);
  assert.deepEqual({decisions,reductions},{decisions:1,reductions:1});
  const prepared=router.prepare({kind:'action',player:'0',reply:{requestId:request.id,type:request.type,action:reply.value}});
  assert.deepEqual(prepared.state.actors['0']!.memory,{events:2,decisions:1});
  assert.deepEqual(prepared.state.actors['0']!.history,[before,after]);
  assert.deepEqual({decisions,reductions},{decisions:1,reductions:2});
  assert.equal(prepared.packets.length,3);router.commit('pending:0',prepared.state);
  assert.deepEqual(router.savePending(),{version:1,candidates:[],events:[],packets:[],retainedRequests:[]});
});


test('a cancelled losing callback cannot block the winner commit or overwrite the next transaction',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),base=createScript('first');
  const loser={...base,async decide(input:Parameters<typeof base.decide>[0]){await gate;return base.decide(input);}};
  const router=new PolicyRouter({'0':base,'1':loser},1),cancel=new AbortController();
  const winner=await router.binding('0').onRequest(request,{signal});
  const lost=router.binding('1').onRequest({...request,player:'1',id:{...request.id,key:'loser'}},{signal:cancel.signal});
  try{
    cancel.abort();
    const accepted={kind:'action',player:'0',reply:{requestId:request.id,type:request.type,action:winner.value}};
    const prepared=router.prepare(accepted);assert.equal(router.commit('race:0',prepared.state),true);
    assert.deepEqual(router.snapshot().actors['0']!.memory,{decisions:1});assert.deepEqual(router.snapshot().actors['1']!.memory,{});
    const next={...request,id:{...request.id,callId:'next'}} as PolicyRequest;
    await router.binding('0').onRequest(next,{signal});
    release();assert.deepEqual(await lost,{kind:'pause'});
    const pending=router.savePending();assert.equal(pending.candidates.length,1);assert.equal(pending.candidates[0]!.request.id.callId,'next');
    assert.deepEqual(pending.candidates[0]!.proposal.nextMemory,{decisions:2});
  }finally{release();await lost;}
});
test('delivery identity uses only protocol fields, without payload keys or delimiter collisions', async () => {
  const policy = { ...createScript('first'), event: (m: any) => ({ count: (m.count ?? 0) + 1 }) };
  const router = new PolicyRouter({ '0': policy }, 1);
  const binding = router.binding('0');
  const events = [
    { id: { instanceId: 'a/b', callId: 'c', index: 0 }, event: { key: 'damage', amount: 1 } },
    { id: { instanceId: 'a', callId: 'b/c', index: 0 }, event: { key: 'damage', amount: 2 } },
    { id: { instanceId: 'a', callId: 'other', index: 0 }, event: { key: 'damage', amount: 3 } },
  ];
  for (const event of [...events, events[0]]) await binding.onEvent(event, { signal });
  const prepared = router.prepare(null);
  assert.equal(prepared.state.actors['0']!.history.length, 3);
  assert.deepEqual(prepared.state.actors['0']!.memory, { count: 3 });
  router.commit('task:0', prepared.state);
  await binding.onEvent(events[0], { signal });
  assert.deepEqual(router.prepare(null).state, router.snapshot());
});
test('all scripts consume canonical actions and explicit random state', async () => {
  const input = {
    request,
    visibleHistory: [],
    memory: {},
    random: {
      state: 1,
      position: 0
    },
    signal
  };
  assert.deepEqual((await createScript('first').decide(input)).action, {
    x: 1
  });
  assert.deepEqual((await createScript('last').decide(input)).action, {
    x: 3
  });
  assert.deepEqual((await createScript('rule', {
    score: a => (a as any).x
  }).decide(input)).action, {
    x: 3
  });
  const a = await createScript('random').decide(input),
    b = await createScript('random').decide(input);
  assert.deepEqual(a, b);
  assert.equal(a.logProbability, -Math.log(3));
  assert.equal(input.random.position, 0);
  assert.ok(a.nextRandom.position > 0);
});
test('staged and failed replies do not advance committed memory or random cursors', async () => {
  const router = new PolicyRouter({
      '0': createScript('random')
    }, 3),
    before = router.snapshot(),
    binding = router.binding('0');
  router.begin();
  const reply = await binding.onRequest(request, {
    signal
  });
  assert.deepEqual(router.snapshot(), before);
  assert.deepEqual(router.prepare(null).state, before);
  const prepared = router.prepare({
    kind: 'action',
    player: '0',
    reply: {
      requestId: request.id,
      type: 'move',
      action: reply.value
    }
  });
  assert.equal(router.commit('task:0', prepared.state), true);
  assert.equal(router.commit('task:0', prepared.state), false);
  assert.equal((router.snapshot().actors['0']!.memory as any).decisions, 1);
});

test('event memory is applied in temporal order, deduplicated, and isolated by game and actor', async () => {
  const policy = {
    ...createScript('first'),
    event: (m: any) => ({
      ...m,
      events: (m.events ?? 0) + 1
    })
  };
  const router = new PolicyRouter({
      '0': policy,
      '1': policy
    }, 1),
    binding = router.binding('0');
  router.begin();
  const event = {
    id: {
      instanceId: 'i',
      callId: 'e',
      index: 0
    },
    event: {
      kind: 'draw'
    }
  };
  await binding.onEvent(event, {
    signal
  });
  const reply = await binding.onRequest(request, {
    signal
  });
  await binding.onEvent(event, {
    signal
  });
  await binding.onEvent({
    ...event,
    id: {
      ...event.id,
      index: 1
    }
  }, {
    signal
  });
  const p = router.prepare({
    kind: 'action',
    player: '0',
    reply: {
      requestId: request.id,
      type: 'move',
      action: reply.value
    }
  });
  router.commit('task:1', p.state);
  assert.deepEqual(router.snapshot().actors['0']!.memory, {
    events: 2,
    decisions: 1
  });
  assert.deepEqual(router.snapshot().actors['1']!.memory, {});
  assert.deepEqual(new PolicyRouter({
    '0': policy
  }, 1).snapshot().actors['0']!.memory, {});
});
test('policy decisions receive each visible delivery once across retries and commits', async () => {
  const histories: unknown[][] = [];
  const first = createScript('first');
  const router = new PolicyRouter({ '0': {
    ...first,
    async decide(input) {
      histories.push(input.visibleHistory);
      return first.decide(input);
    }
  } }, 1);
  const binding = router.binding('0');
  const event = { id: { instanceId: 'i', callId: 'e', index: 0 }, event: { kind: 'draw' } };
  await binding.onEvent(event, { signal });
  await binding.onEvent(event, { signal });
  await binding.onRequest(request, { signal });
  assert.deepEqual(histories[0], [event]);
  const prepared = router.prepare(null);
  router.commit('task:0', prepared.state);
  await binding.onEvent(event, { signal });
  const next = { ...event, id: { ...event.id, index: 1 } };
  await binding.onEvent(next, { signal });
  await binding.onEvent(next, { signal });
  await binding.onRequest(request, { signal });
  assert.deepEqual(histories[1], [event, next]);
});
test('bounded random draws remain deterministic', () => {
  assert.deepEqual(randomInt({
    state: 7,
    position: 8
  }, 5), randomInt({
    state: 7,
    position: 8
  }, 5));
});

test('resumable scheduling records one waiting request and never accepts an aborted proposal',async()=>{
  let calls=0;
  const control=new AbortController(),base=createScript('first');
  const policy={...base,async decide(input:Parameters<typeof base.decide>[0]){
    if(++calls<4)throw new PolicyWorkSuspended('scheduling-yield');
    const proposal=await base.decide(input);control.abort();return proposal;
  }};
  registerPolicyWork(policy,{save:()=>({calls}),restore(){},close(){}});
  const router=new PolicyRouter({'0':policy},1),before=router.snapshot(),binding=router.binding('0');
  for(let i=0;i<4;i++)assert.deepEqual(await binding.onRequest(request,{signal:control.signal}),{kind:'pause'});
  assert.deepEqual(router.snapshot(),before);assert.equal(router.prepare(null).candidate,null);
  assert.equal(router.prepare(null).packets.filter(packet=>packet.kind==='request').length,1);
  assert.deepEqual(suspendedPolicyWork({'0':policy}),['cancelled']);
  closePolicyWork({'0':policy});
});

test('a failing work cleanup still releases every other owner exactly once',()=>{
  const a=createScript('first'),b=createScript('first');let first=0,second=0;
  registerPolicyWork(a,{save(){},restore(){},close(){first++;throw Error('cleanup');}});
  registerPolicyWork(b,{save(){},restore(){},close(){second++;}});
  assert.throws(()=>closePolicyWork({a,alias:a,b}),AggregateError);
  assert.deepEqual([first,second],[1,1]);
});
