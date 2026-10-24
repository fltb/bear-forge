import {rules} from '../src/rules/execution.ts';
import {probabilityTrackingFor} from '../../../packages/runtime-card/src/probability-tracking.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {CardProgram, CardMachine} from '@bear-forge/card-engine';
import {PolicyRouter, defaultSearchLimits, type PolicyRequest, type SearchCurrent} from '@bear-forge/policies';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {cardDefinition} from '../src/card.ts';
import {contract, observe, type StsTypes} from '../src/contract.ts';
import {createExperimentRunner, type Registration} from '@bear-forge/experiments';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {position,baseline} from '../src/search/evaluation.ts';
import {potionRewardCapacityFixture} from './adventure-case-fixture.ts';
import {createStsContinuation} from '../src/search/current.ts';
import {createSearchPolicy} from '../src/search/policy.ts';
import {publicDecision, publicEvents, publicKey} from '../src/search/information.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {battles} from '../src/rules/battles.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {encounterId, potionId, type RelicId} from '../src/identifiers.ts';
import {describeAction} from '../src/presentation.ts';
import {moveId} from '../src/combat-identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';

const unwrap = <T>(r: {ok: true; value: T} | {ok: false; error: unknown}): T => {
  if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value;
};
const limits = {...defaultSearchLimits, mode: 'work' as const, worlds: 1, attempts: 1, simulations: 4, decisions: 2};
const signal = new AbortController().signal;
const cursor = {state: 76, position: 0};
const fixtureSeed = '284563';
test('public fallback leaves a full-belt reward instead of repeatedly claiming a legal no-op',()=>{
  const definition=potionRewardCapacityFixture([],[potionId.LIQUID_BRONZE,potionId.SWIFT_POTION],[potionId.ENERGY_POTION]);
  const program=new CardProgram(definition),graph=privateCardGraph(program.initial({seed:'130'},100_000_000)),machine=new CardMachine(program,graph);
  const collect=(initial:ReturnType<typeof machine.advance>)=>{
    let stop=initial;while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original reward window');
    return stop.call.input;
  };
  try{
    const full=collect(machine.advance());
    const choice=Number(baseline(position({observation:observe(full),actions:full.actions,events:[]})));
    assert.equal(describeAction(observe(full),choice).kind,'leave');
    // Exercise the unchanged original discard path once, then the fallback
    // should claim the now-available reward from that current state.
    const freed=collect(machine.advance({bits:0xc0000000}));
    const take=Number(baseline(position({observation:observe(freed),actions:freed.actions,events:[]})));
    assert.equal(describeAction(observe(freed),take).kind,'take-potion');
    const claimed=collect(machine.advance({bits:take}));
    assert.deepEqual(claimed.game.rewards!.potions,[]);
  }finally{graph.close();}
});
async function realGame(character: 'ironclad' | 'volibear') {
  const loaded = unwrap(await createCardLoader({controlled: true, recordCore: false}).load(cardDefinition));
  const instance = unwrap(await loaded.core.start({seed: fixtureSeed, character, detailedEvents: true}));
  const game = unwrap(await createGameBinder().bind({instance, contract, persistence: loaded.persistence!}));
  const events: StsEvent[] = [];
  unwrap(await game.bind({player: '0', onRequest: async () => ({kind: 'pause'}), onEvent: async e => {events.push(e.event); return {kind: 'reply', value: null};}}));
  unwrap(await game.run());
  async function request() {const state = unwrap(await game.inspect()); assert.equal(state.kind, 'request'); if (state.kind !== 'request') throw Error('Expected request'); return state.requests[0]!;}
  const deliveries = () => events.map((event, index) => ({id: {instanceId: 'real', callId: 'event', index}, event}));
  async function act(bits: number) {
    unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:{bits}}),onEvent:async e=>{events.push(e.event);return {kind:'reply',value:null};}}));
    const next=unwrap(await game.run());assert.ok(next.accepted);
  }
  return {game, loaded, request, deliveries, act, async close() {await game.close(); await loaded.capture?.release(instance.id);}};
}

// Actual-current continuation checks. Root Contexts are allowed; weighted
// expansion of unrevealed futures is a separate integration obligation.
for(const character of ['ironclad','volibear'] as const)test(`${character}: next(current) forks the waiting Context without initialization or historical inputs`,async()=>{
  const real=await realGame(character),adapter=createStsContinuation(signal);
  const owned:SearchCurrent[]=[];
  const initialize=CardProgram.prototype.initial;
  let iterator:ReturnType<typeof adapter.next>|undefined;
  try{
    const before=structuredClone(await real.request());
    CardProgram.prototype.initial=function(){throw Error('Search must not initialize a program');};
    const root=await adapter.take(unwrap(await real.game.fork!()),real.deliveries().map(e=>e.event));owned.push(root);
    const parent=structuredClone(root.position);
    iterator=adapter.next(root);
    const first=await iterator.next();assert.equal(first.done,false);if(first.done)throw Error('Expected first child');owned.push(first.value.outcomes[0]!.current);
    assert.equal(first.value.action,parent.actions[0]!.key);
    assert.deepEqual(root.position,parent);assert.deepEqual(await real.request(),before);
    // Disposing the lazy enumerator must leave yielded continuations alive.
    await iterator.return();
    const nested=adapter.next(first.value.outcomes[0]!.current);
    try{
      const child=await nested.next();
      if(!child.done){
        owned.push(child.value.outcomes[0]!.current);
        const from=JSON.parse(first.value.outcomes[0]!.current.position.information),to=JSON.parse(child.value.outcomes[0]!.current.position.information);
        assert.equal(to.observation.history.length,from.observation.history.length+1,'one current input per successor');
      }
    }finally{await nested.return();}
    assert.deepEqual(await real.request(),before);
    await assert.rejects(adapter.next(root).next(),/already expanded/);
  }finally{
    CardProgram.prototype.initial=initialize;
    await iterator?.return();
    for(const current of owned.reverse())await current.close();
    await real.close();
  }
});

test('R1/R2 without an actual host current fail explicitly',async()=>{
  const real=await realGame('ironclad');
  try{
    const request=await real.request(),input={request,visibleHistory:real.deliveries(),memory:{},random:cursor,signal};
    for(const algorithm of ['r1','r2'] as const){
      const policy=createSearchPolicy({character:'ironclad',algorithm,limits});
      await assert.rejects(policy.decide(input),/actual current Context/);
      assert.deepEqual(await real.request(),request);
    }
  }finally{await real.close();}
});

test('real PolicyRouter commits evidence only for accepted actions and restores the current Context directly', async () => {
  const real = await realGame('ironclad');
  try {
    const policy = createSearchPolicy({character: 'ironclad', algorithm: 'r0', limits});
    const router = new PolicyRouter({'0': policy}, 913);
    const initial = router.snapshot();
    const binding = router.binding('0'), request = await real.request();
    await binding.onRequest(request, {signal});
    assert.deepEqual(router.snapshot(), initial);
    assert.deepEqual(router.prepare(null).state, initial, 'discarded proposals do not commit');
    router.begin();
    unwrap(await real.game.bind(binding));
    const next = unwrap(await real.game.run()), prepared = router.prepare(next.accepted);
    assert.ok(prepared.candidate);
    router.commit('search-test:0', prepared.state);
    const saved = unwrap(await real.game.save!());
    const recovered = new PolicyRouter({'0': createSearchPolicy({character: 'ironclad', algorithm: 'r0', limits})}, 0, router.snapshot());
    assert.deepEqual(recovered.snapshot(), router.snapshot());
    assert.ok(saved.snapshotId);
    const memory = router.snapshot().actors['0']!.memory as {version:string;prefix?:unknown};
    assert.equal(memory.version,'sts-belief-search@1');
    assert.equal(memory.prefix,undefined,'accepted memory must not contain an executable prefix');
    const instance = unwrap(await real.loaded.persistence!.restore(saved));
    const restored = unwrap(await createGameBinder().bind({instance, contract, persistence:real.loaded.persistence!}));
    try {
      unwrap(await restored.bind(recovered.binding('0')));
      router.begin(); recovered.begin();
      const actual = unwrap(await real.game.run()), resumed = unwrap(await restored.run());
      const a = router.prepare(actual.accepted), b = recovered.prepare(resumed.accepted);
      assert.deepEqual(a.candidate?.proposal,b.candidate?.proposal);
      assert.deepEqual(unwrap(await real.game.observe({player:'0'})),unwrap(await restored.observe({player:'0'})));
    } finally {await restored.close(); await real.loaded.persistence!.release(saved);}
  } finally {await real.close();}
});

test('exhausted host accounting cannot disguise a missing R2 host current as R0',async()=>{
  const real=await realGame('ironclad');
  try{
    const request=await real.request();
    for(const mode of ['work','wall'] as const){
      const account={milliseconds:60_000};
      const policy=createSearchPolicy({character:'ironclad',algorithm:'r2',limits:{...limits,mode},account});
      await assert.rejects(policy.decide({request,visibleHistory:real.deliveries(),memory:{},random:cursor,signal}),/actual current Context/);
      assert.equal(account.milliseconds,60_000);
    }
  }finally{await real.close();}
});

test('external request and event identities cannot influence information keys or search random state', async () => {
  const real = await realGame('ironclad');
  try {
    const request = await real.request(), history = real.deliveries();
    const renamed = {...request, id: {...request.id, key: 'hidden-seed-123', instanceId: 'other' as typeof request.id.instanceId}};
    assert.deepEqual(publicDecision(request, history), publicDecision(renamed, history.map(h => ({...h,id: {noise: 'different'}}))));
    const first = createSearchPolicy({character: 'ironclad', algorithm: 'r0', limits});
    const second = createSearchPolicy({character: 'ironclad', algorithm: 'r0', limits});
    const input = {visibleHistory: history, memory: {}, random: {state: 91, position: 0}, signal};
    assert.deepEqual(await first.decide({...input,request}), await second.decide({...input,request: renamed}));
    assert.throws(() => publicDecision({...request,observation: {...request.observation,seed: '123'}},history));
  } finally {await real.close();}
});

test('detail entity handles preserve aliasing without numeric hidden-allocation information', () => {
  const a: StsEvent[] = [{kind: 'detail', type: 'damage', data: {source: 18,target: 31,lost: 4}}, {kind: 'detail',type:'heal',data:{entity:31,amount:2}}];
  const b: StsEvent[] = [{kind: 'detail', type: 'damage', data: {source: 3,target: 999,lost: 4}}, {kind: 'detail',type:'heal',data:{entity:999,amount:2}}];
  assert.deepEqual(publicEvents(a), publicEvents(b));
  assert.equal(publicEvents(a)[1]!.kind, 'detail');
});

function hiddenFixture(relics: RelicId[], potion: number | null = null) {
  const program = new CardProgram(combatContentDefinition), storage = privateCardGraph(program.initial({seed: '130',encounter:encounterId.CULTIST,relics,potion,durable:false,elite:false},100_000_000));
  const machine = new CardMachine(program, storage);
  let stop = machine.advance(); while (stop.kind === 'call' && stop.call.port === 'event') stop = machine.advance(null);
  if (stop.kind !== 'call' || stop.call.port !== 'decision') throw Error('Expected combat root');
  const original = stop.call.input;
  const query = <I,O>(q: Parameters<typeof inspectRuleQuery<I,O>>[2], input: I) => inspectRuleQuery(combatContentDefinition,machine.root.state,q,input);
  const run = query(adventures.exports.instances,undefined)[0]!, session = query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!);
  const draw = query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles).draw;
  function reorderDraw() {
    const order = query(zones.exports.members,draw);
    assert.ok(order.length > 1);
    const components = stateOf(machine.root.state).entities[draw]!.components;
    const entry = Object.entries(components).find(([,value]) => Array.isArray(value) && publicKey(value) === publicKey(order));
    assert.ok(entry); components[Number(entry[0])] = storage.own([...order].reverse());
    assert.deepEqual(query(zones.exports.members,draw), [...order].reverse());
  }
  const frame = () => query(stsPorts.exports.frame,{run,actions: original.actions.map(a => a.bits),selection:null});
  return {machine, storage, original, frame, reorderDraw};
}

test('actual hidden draw order, intent, future relic pools and RNG changes leave the public R0 identical under Runic Dome', async () => {
  const f = hiddenFixture(['RUNIC_DOME']);
  try {
    const before = observe(f.frame()); f.reorderDraw();
    let rngs = 0, intents = 0, pools = 0;
    for (const entity of Object.values(stateOf(f.machine.root.state).entities)) for (const [index,value] of Object.entries(entity.components)) {
      if (!value || typeof value !== 'object') continue;
      if (typeof value.seed0 === 'bigint') {entity.components[Number(index)] = f.storage.own({...value,seed0:value.seed0 ^ 9n,seed1:value.seed1 ^ 17n}); rngs++;}
      if ('aiRng' in value && Array.isArray(value.history)) {entity.components[Number(index)] = f.storage.own({...value,history:[moveId.CULTIST_DARK_STRIKE,value.history[1]]}); intents++;}
      if (value.relicPools?.common?.length > 1) {entity.components[Number(index)] = f.storage.own({...value,relicPools:{...value.relicPools,common:[...value.relicPools.common].reverse()}}); pools++;}
    }
    assert.ok(rngs > 0 && intents > 0 && pools > 0);
    const after = observe(f.frame()); assert.deepEqual(after,before);
    const request = (observation: typeof before): PolicyRequest => ({id: {instanceId:'fixture',callId:'decision',key:'0'} as PolicyRequest['id'], player:'0',type:'action',data:{screen:observation.game.screen},observation,options:{kind:'exact',values:f.original.actions}});
    const input = {visibleHistory: [], memory: {},random: cursor,signal};
    const p = () => createSearchPolicy({character:'ironclad',algorithm:'r0',limits});
    assert.deepEqual(await p().decide({...input,request:request(before)}),await p().decide({...input,request:request(after)}));
    // A public-only caller cannot replace the required host capability.
    for(const algorithm of ['r1','r2'] as const)for(const observation of [before,after]){
      await assert.rejects(createSearchPolicy({character:'ironclad',algorithm,limits}).decide({...input,request:request(observation)}),/actual current Context/);
    }
  } finally {f.storage.close();}
});

test('Frozen Eye makes a reordered draw pile observable', () => {
  const f = hiddenFixture(['FROZEN_EYE']);
  try {const before = observe(f.frame()); assert.ok(before.battle?.draw); f.reorderDraw(); assert.notDeepEqual(observe(f.frame()).battle?.draw,before.battle.draw);}
  finally {f.storage.close();}
});

test('equal public roots can have different concrete futures, requiring weighted successor handling', () => {
  // Two independent current fixtures, one current action each. There is no
  // accepted-action prefix or reconstruction of an earlier decision here.
  const left=hiddenFixture([],potionId.SWIFT_POTION),right=hiddenFixture([],potionId.SWIFT_POTION);
  try {
    right.reorderDraw();
    const beforeLeft=observe(left.frame()),beforeRight=observe(right.frame());
    assert.deepEqual(beforeLeft,beforeRight);
    assert.deepEqual(left.original.actions,right.original.actions);
    assert.equal(beforeLeft.battle?.draw,undefined,'the draw order must actually be hidden');
    const action=left.original.actions.find(action=>describeAction(beforeLeft,action.bits).kind==='drink-potion');
    assert.ok(action,'the public root has a legal draw-potion action');
    const forward=(fixture:ReturnType<typeof hiddenFixture>)=>{
      let stop=fixture.machine.advance(action);
      while(stop.kind==='call'&&stop.call.port==='event')stop=fixture.machine.advance(null);
      assert.equal(stop.kind,'call');
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected next player decision');
      return observe(stop.call.input);
    };
    const afterLeft=forward(left),afterRight=forward(right);
    assert.notDeepEqual(afterLeft.battle?.hand,afterRight.battle?.hand,
      'next on a real hidden Context exposes the actual draw order despite an equal public root');
    assert.equal(afterLeft.history.length,beforeLeft.history.length+1);
    assert.equal(afterRight.history.length,beforeRight.history.length+1);
  } finally {left.storage.close();right.storage.close();}
});

test('cancelled next(current) allocates no successor and preserves its parent',async()=>{
  const real=await realGame('ironclad'),controller=new AbortController();
  const adapter=createStsContinuation(controller.signal);
  const game=unwrap(await real.game.fork!());
  let forks=0;
  const fork=game.fork!;game.fork=async()=>{forks++;return fork();};
  const root=await adapter.take(game,real.deliveries().map(e=>e.event));
  try{
    const before=structuredClone(await real.request());controller.abort();
    await assert.rejects(adapter.next(root).next(),/cancelled/);
    assert.equal(forks,0);assert.deepEqual(await real.request(),before);
  }finally{await root.close();await real.close();}
});


for (const character of ['ironclad','volibear'] as const) test(`${character}: runner supplies the actual waiting Context inside a policy callback`, async () => {
  const directory = await mkdtemp(join(tmpdir(),'sts-current-host-'));
  const initial = CardProgram.prototype.initial;
  let starts = 0, decisions = 0;
  let policyFailure: unknown;
  let expected: SearchCurrent['position'] | undefined;
  CardProgram.prototype.initial = function(...args) {
    if (++starts > 1) throw Error('Forking the current Context must not initialize the program');
    return initial.apply(this,args);
  };
  const runner = createExperimentRunner<StsTypes,{id:string;seed:number},Registration,{id:string;status:string;error:string|null;decisions:number}>({
    contract,
    execution:{identity:{kind:'current-host-test'},load:()=>createCardLoader({controlled:true,recordCore:false}).load(cardDefinition)},
    parseRegistration: value => value as Registration,
    tasks:()=>[{id:'current',seed:76}], setup:()=>({seed:fixtureSeed,character,detailedEvents:true}),
    requiresCurrent:()=>true,
    policies:(_task,_resources,forkCurrent)=>({'0':{version:'actual-current-test',encoderVersion:'public-test',async decide(input) {
      try {
      const decision = publicDecision(input.request,input.visibleHistory);
      if (expected) assert.equal(position(decision).information,expected.information,
        'the real action must reach the predicted direct successor with its unfinished control state');
      const adapter = createStsContinuation(input.signal);
      const branch = await forkCurrent();
      assert.notEqual(branch.id,input.request.id.instanceId);
      const current = await adapter.take(branch,decision.events);
      let child: SearchCurrent | undefined;
      const iterator = adapter.next(current);
      try {
        assert.deepEqual(current.position,position(decision));
        const next = await iterator.next();
        assert.equal(next.done,false); if (next.done) throw Error('Expected successor');
        assert.equal(next.value.outcomes.length,1);
        child = next.value.outcomes[0]!.current;
        expected = structuredClone(child.position);
        // A fresh fork after the search branch advanced still sees the root.
        const unchanged = await adapter.take(await forkCurrent(),decision.events);
        try {assert.deepEqual(unchanged.position,current.position);} finally {await unchanged.close();}
        decisions++;
        return {action:current.position.actions.find(a=>a.key===next.value.action)!.action,
          nextMemory:{},nextRandom:input.random,policyVersion:'actual-current-test',encoderVersion:'public-test',logProbability:null};
      } finally {await iterator.return(); await child?.close(); await current.close();}
      } catch (error) {policyFailure = error; throw error;}
    }}}),
    facts:()=>[],summarize:row=>({id:row.id,status:row.status,error:row.error??null,decisions:row.decisions.length}),identity:async()=>({test:'current-host'})
  });
  try {
    const result = await runner.runExperiment(directory,{id:'current-host',engine:'controlled',maxAttempts:1,maxSteps:2,
      concurrency:1,batchMilliseconds:60_000,memoryBudgetMB:1024,stopOnFault:true});
    if (policyFailure) throw policyFailure;
    assert.equal(result.results.length,1,JSON.stringify(result));
    assert.equal(result.results[0]!.status,'truncated',JSON.stringify(result.results[0]));
    assert.equal(result.results[0]!.decisions,2);
    assert.equal(decisions,2); assert.equal(starts,1);
  } finally {CardProgram.prototype.initial = initial; await rm(directory,{recursive:true,force:true});}
});


test('current-only search canonicalizes the full public event history without inspecting the entity registry',()=>{
  const spec=probabilityTrackingFor(cardDefinition);assert.ok(spec);assert.equal(spec.mode,'current');
  assert.equal('anchor' in spec,false);assert.equal('observe' in spec,false);assert.equal('respond' in spec,false);
  const event=(entity:number)=>({kind:'detail' as const,type:'draw',data:{entity,id:'STRIKE_R'}});
  const left=[event(100),event(1),event(777)],right=[event(200),event(2),event(888)];
  assert.deepEqual(publicEvents([...left,event(777)]),publicEvents([...right,event(888)]));
  assert.notDeepEqual(publicEvents([...left,event(1)]),publicEvents([...left,event(777)]),'previously observed identities retain their distinct associations');
  assert.equal(left[2]!.data.entity,777,'canonicalization does not rewrite the original current history');
});


test('end-turn detail publication never discloses hidden draw order through card-change callbacks',()=>{
  for(const eye of [false,true]){
    const program=new CardProgram(combatContentDefinition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.BOOK_OF_STABBING,relics:eye?['FROZEN_EYE']:[],potion:null,durable:true,elite:true,detailedEvents:true})));
    try{
      let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original player turn');
      const end=stop.call.input.actions.find(action=>action.bits>>>29===4);assert.ok(end);
      const query=<I,O>(q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,machine.root.state,q,input);
      const run=query(adventures.exports.instances,undefined)[0]!,session=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!),piles=query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles);
      let hiddenChanges=0,visibleChanges=0;
      stop=machine.advance(end);
      while(stop.kind==='call'&&stop.call.port==='event'){
        for(const event of stop.call.input)if(event.kind==='detail'&&event.type==='card-change'){
          if(query(zones.exports.location,Number(event.data.entity))===piles.draw)hiddenChanges++;else visibleChanges++;
        }
        stop=machine.advance(null);
      }
      assert.equal(stop.kind,'call');assert.ok(visibleChanges>0,'visible card changes retain their original publication');
      if(eye)assert.ok(hiddenChanges>0,'Frozen Eye uses its original draw visibility rule');else assert.equal(hiddenChanges,0);
    }finally{machine.storage.close?.();}
  }
});
