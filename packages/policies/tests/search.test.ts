import {searchEntropyWord} from '../src/search/entropy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {search, SearchBudget, defaultSearchLimits,randomInt} from '../src/index.ts';
import type {SearchDomain, SearchPosition, SearchCurrent, SearchLimits} from '../src/index.ts';

const cursor = {state: 41, position: 0};
const budget = (limits: Partial<SearchLimits> = {}, signal = new AbortController().signal) =>
  new SearchBudget({...defaultSearchLimits, mode: 'work', simulations: 32, ...limits}, signal);
const action = (key: string) => ({key, action: key});
const root: SearchPosition = {information: 'root', actions: ['safe', 'risk'].map(action), value: 0, terminal: false, round: 0};

/** At the second decision the hidden bit is unobservable. A full-state tree
 * would incorrectly select the matching guess in each world and value risk at 1. */
function guessingDomain(fault = false, weights = [.5, .5], observe = (_secret: number) => 'same-public-guess', safe = .7) {
  let active = 0, forks = 0;
  const stateOf=new WeakMap<SearchCurrent,{secret:number;state:string}>();
  const expanded=new WeakSet<SearchCurrent>();
  const edges=new Set<string>();
  const current = (secret: number, state = 'root'): SearchCurrent => {
    active++;
    let closed = false;
    const position:SearchPosition=state==='root'?root:state==='risk'?
      {information:observe(secret),actions:['zero','one'].map(action),value:0,terminal:false,round:0}:
      {information:state,actions:[],value:Number(state),terminal:true,round:0};
    const result:SearchCurrent={position,async close(){if(!closed){closed=true;active--;}}};
    stateOf.set(result,{secret,state});return result;
  };
  const domain:SearchDomain={root,baseline:p=>p.actions[0]!.key,
    async current(random,b){b.accepted+=weights.length;return{particles:weights.map((weight,secret)=>({current:current(secret),weight})),representation:'exact',random,reason:null,method:'test-current-hidden-bit'};},
    async *next(parent){
      assert.ok(!expanded.has(parent),'a retained current may only be expanded once');expanded.add(parent);
      const {secret,state}=stateOf.get(parent)!;
      for(const action of parent.position.actions){
        if(fault)throw Error('production-rule-fault');
        const edge=JSON.stringify([secret,state,action.key]);
        assert.ok(!edges.has(edge),'an execution edge must not be run again');edges.add(edge);
        const after=state==='root'?action.key==='safe'?String(safe):'risk':String((action.key==='one'?1:0)===secret%2?1:0);
        forks++;yield{action:action.key,outcomes:[{current:current(secret,after),probability:1}],representation:'exact'};
      }
    },
  };
  return{domain,active:()=>active,forks:()=>forks};
}

test('R1 evaluates one public continuation policy on the weighted belief', async () => {
  const game = guessingDomain();
  const result = await search(game.domain, 'r1', cursor, budget({simulations: 8}));
  assert.equal(result.action, 'safe');
  assert.equal(result.evidence.coverageComplete, true);
  assert.deepEqual(result.evidence.actions.map(r => [r.expanded, r.estimate]), [[true,(1-.7)/2],[true,.25]]);
  assert.equal(result.evidence.selectedUpperGap, 0);
  assert.equal(result.evidence.simulations, 3);
  assert.equal(game.active(), 0); assert.equal(game.forks(), 6);
});

test('R2 aggregates indistinguishable worlds instead of choosing with the hidden bit', async () => {
  const game = guessingDomain();
  const result = await search(game.domain, 'r2', cursor, budget({simulations: 512}));
  assert.equal(result.action, 'safe');
  assert.equal(result.evidence.actions[1]!.estimate, .25);
  assert.equal(result.evidence.nodes, 17, '10 retained Contexts and 7 belief nodes');
  assert.equal(game.active(), 0);
});

test('insufficient root coverage keeps the frozen baseline and reports unexplored actions', async () => {
  const game = guessingDomain();
  const result = await search(game.domain, 'r1', cursor, budget({simulations: 1}));
  assert.equal(result.action, 'safe');
  assert.equal(result.evidence.reason, 'expansion-budget');
  assert.equal(result.evidence.actions[1]!.expanded, false);
  assert.equal(game.active(), 0);
});

test('deterministic work repeats statistics and search cursor despite clock noise', async () => {
  const a = guessingDomain(), b = guessingDomain();
  const first = await search(a.domain, 'r2', cursor, budget());
  let time = 0;
  const second = await search(b.domain, 'r2', cursor, new SearchBudget({...defaultSearchLimits, mode: 'work', simulations: 32},
    new AbortController().signal, () => time += 100_000, () => 1));
  assert.deepEqual({action: first.action, random: first.random, evidence: first.evidence},
    {action: second.action, random: second.random, evidence: second.evidence});
});

test('deterministic work still respects the RSS safety cap and reports censoring',async()=>{
  const game=guessingDomain();
  const result=await search(game.domain,'r2',cursor,new SearchBudget({...defaultSearchLimits,mode:'work'},
    new AbortController().signal,()=>0,()=>2**40));
  assert.equal(result.evidence.reason,'memory-budget');
  assert.equal(result.evidence.simulations,0);assert.equal(game.active(),0);
});

test('work mode honors a separate game allowance without putting clock noise in evidence',async()=>{
  const game=guessingDomain();let time=0;
  const supply=game.domain.current;
  game.domain.current=async(...args)=>{const result=await supply(...args);time=61;return result;};
  const result=await search(game.domain,'r2',cursor,new SearchBudget({...defaultSearchLimits,mode:'work'},
    new AbortController().signal,()=>time,()=>1,60));
  assert.equal(result.evidence.reason,'game-search-budget');
  assert.equal(result.evidence.simulations,0);assert.equal(game.active(),0);
});

test('phase costs include failed operations and cleanup after cancellation',async()=>{
  let time=0;const controller=new AbortController();
  const b=new SearchBudget({...defaultSearchLimits,mode:'work'},controller.signal,()=>time,()=>1);
  await b.segment(async()=>{time+=7;},'construction');
  await assert.rejects(b.segment(async()=>{time+=2;throw Error('fixture-fault');},'advance'),/fixture-fault/);
  controller.abort();
  await b.measure(async()=>{time+=3;},'cleanup');
  await assert.rejects(b.segment(async()=>{throw Error('must not run');},'advance'));
  const cost=b.cost();assert.equal(cost.milliseconds,12);assert.equal(cost.longestSegmentMilliseconds,7);
  assert.deepEqual(cost.phases,{construction:{calls:1,milliseconds:7},advance:{calls:1,milliseconds:2},cleanup:{calls:1,milliseconds:3}});
});

test('production faults propagate and release all parents and branches', async () => {
  const game = guessingDomain(true);
  await assert.rejects(search(game.domain, 'r2', cursor, budget()), /production-rule-fault/);
  assert.equal(game.active(), 0);
});

test('abort during successor expansion discards partial estimates and closes retained contexts', async () => {
  const game=guessingDomain(),controller=new AbortController(),next=game.domain.next;
  game.domain.next=async function*(current,expansion){
    for await(const child of next(current,expansion)){controller.abort();yield child;}
  };
  const result=await search(game.domain,'r1',cursor,budget({},controller.signal));
  assert.equal(result.evidence.reason,'cancelled');
  assert.equal(result.evidence.actions[0]!.expanded,false);
  assert.equal(game.active(),0);
});

test('node cap stops expansion but retains legal rollout and complete candidate domain', async () => {
  const game = guessingDomain();
  const result = await search(game.domain, 'r2', cursor, budget({nodes: 3}));
  assert.equal(result.evidence.nodes, 3);
  assert.deepEqual(result.evidence.actions.map(a => a.key), ['safe', 'risk']);
  assert.equal(game.active(), 0);
});

test('R0 never acquires current states', async () => {
  const game = guessingDomain();
  game.domain.current = async () => {throw Error('must not acquire current');};
  const result = await search(game.domain, 'r0', cursor, budget());
  assert.equal(result.action, 'safe'); assert.deepEqual(result.random, cursor);
});

test('wall limit includes current-state acquisition and leaves no speculative sample committed', async () => {
  const game = guessingDomain(); let time = 0;
  const b = new SearchBudget({...defaultSearchLimits, milliseconds: 10}, new AbortController().signal, () => time, () => 1);
  const supply = game.domain.current;
  game.domain.current = async (...args) => {const result = await supply(...args); time = 12; return result;};
  const result = await search(game.domain, 'r1', cursor, b);
  assert.equal(result.evidence.reason, 'wall-budget');
  assert.equal(result.evidence.simulations, 0); assert.equal(game.active(), 0);
});


test('belief search solves the finite model without repeating execution edges',async()=>{
  const game=guessingDomain();
  const result=await search(game.domain,'r2',cursor,budget({simulations:512}));
  assert.equal(result.evidence.simulations,4);
  assert.equal(result.evidence.advances,8);
  assert.equal(game.forks(),8);
  assert.equal(game.active(),0);
});

test('malformed root projection closes every supplied current',async()=>{
  const game=guessingDomain(),supply=game.domain.current;
  game.domain.current=async(...args)=>{
    const samples=await supply(...args);
    samples.particles[0]!.current.position={...root,information:'wrong-root'};
    return samples;
  };
  await assert.rejects(search(game.domain,'r2',cursor,budget()),/does not match public root/);
  assert.equal(game.active(),0);
});

test('empty current source is an explicit error, never a successful baseline search',async()=>{
  const game=guessingDomain();
  game.domain.current=async random=>({particles:[],representation:'exact',random,reason:'missing-current',method:'unsupported'});
  await assert.rejects(search(game.domain,'r1',cursor,budget()),/No current state/);
});

test('invalid yielded child is closed along with all previously retained states',async()=>{
  const game=guessingDomain(),next=game.domain.next;
  game.domain.next=async function*(current,expansion){
    for await(const child of next(current,expansion)){child.outcomes[0]!.current.position={...child.outcomes[0]!.current.position,value:NaN};yield child;}
  };
  await assert.rejects(search(game.domain,'r2',cursor,budget()),/Invalid public evaluation/);
  assert.equal(game.active(),0);
});


test('one close failure does not strand siblings or hide the original execution failure',async()=>{
  const game=guessingDomain(true),supply=game.domain.current;
  game.domain.current=async(...args)=>{
    const samples=await supply(...args),close=samples.particles[0]!.current.close;
    samples.particles[0]!.current.close=async()=>{await close();throw Error('cleanup-fixture');};
    return samples;
  };
  await assert.rejects(search(game.domain,'r2',cursor,budget()),(error:unknown)=>{
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(e=>e.message),['production-rule-fault','cleanup-fixture']);return true;
  });
  assert.equal(game.active(),0);
});

test('unequal probability weights change the action; R1 cannot optimize its fixed continuation', async () => {
  const first = guessingDomain(false, [.1,.9]);
  const r1 = await search(first.domain, 'r1', cursor, budget());
  assert.equal(r1.action, 'safe');
  assert.equal(r1.evidence.actions[1]!.estimate, .45);
  const second = guessingDomain(false, [.1,.9]);
  const r2 = await search(second.domain, 'r2', cursor, budget());
  assert.equal(r2.action, 'risk');
  assert.ok(Math.abs(r2.evidence.actions[1]!.estimate - .05) < 1e-12);
  assert.equal(r2.evidence.representation, 'exact');
  assert.equal(first.active() + second.active(), 0);
});

test('observations permit conditional actions only after the hidden bit becomes public', async () => {
  const game = guessingDomain(false, [.5,.5], secret => `revealed-${secret}`);
  const result = await search(game.domain, 'r2', cursor, budget());
  assert.equal(result.action, 'risk');
  assert.equal(result.evidence.actions[1]!.estimate, 0);
  assert.equal(result.evidence.selectedUpperGap, 0);
  assert.deepEqual(result.evidence.actions[1]!.outcomes, [{probability:.5,particles:1},{probability:.5,particles:1}]);
  assert.equal(game.active(), 0);
});

test('observation grouping normalizes 0.2/0.3 into a 0.4/0.6 posterior and preserves branch mass', async () => {
  const game = guessingDomain(false, [.2,.3,.5], secret => secret < 2 ? 'unrevealed-pair' : 'known-zero', -1);
  const result = await search(game.domain, 'r2', cursor, budget());
  const risk = result.evidence.actions[1]!;
  assert.deepEqual(risk.outcomes, [{probability:.5,particles:2},{probability:.5,particles:1}]);
  // In the pair, choose one: conditional loss .4 * .5, weighted by branch .5.
  // In known-zero choose zero: loss 0. This checks posterior AND outer weights.
  assert.ok(Math.abs(risk.estimate - .1) < 1e-12);
  assert.ok(Math.abs(risk.lower - .1) < 1e-12);
  assert.ok(Math.abs(risk.upper - .1) < 1e-12);
  assert.equal(result.action, 'risk');
  assert.equal(game.active(), 0);
});

test('partial weighted action never publishes a biased posterior or a score', async () => {
  const game = guessingDomain(false, [.1,.9]), controller = new AbortController();
  const next = game.domain.next;
  game.domain.next = async function*(current,expansion) {
    for await (const child of next(current,expansion)) {controller.abort(); yield child;}
  };
  const result = await search(game.domain, 'r2', cursor, budget({}, controller.signal));
  assert.equal(result.evidence.actions[0]!.expanded, false);
  assert.deepEqual(result.evidence.actions[0]!.outcomes, []);
  assert.equal(result.evidence.actions[0]!.lower, 0);
  assert.equal(result.evidence.actions[0]!.upper, 1);
  assert.equal(result.evidence.completed, 0);
  assert.equal(game.active(), 0);
});

test('depth cutoff is the declared public leaf objective, not an assumed win or loss', async () => {
  const game = guessingDomain();
  const result = await search(game.domain, 'r2', cursor, budget({decisions:1}));
  assert.equal(result.evidence.actions[1]!.estimate, .5);
  assert.equal(result.evidence.actions[1]!.lower, .5);
  assert.equal(result.evidence.actions[1]!.upper, .5);
  assert.equal(result.evidence.truncated, 1);
  assert.equal(result.evidence.objective, 'finite-horizon-public-leaf-cost');
  assert.equal(game.forks(), 4);
  assert.equal(game.active(), 0);
});

for (const weights of [[0,1], [-.1,1.1], [.2,.3], [NaN,.5], [Infinity,.5]]) {
  test(`invalid weights ${weights} fail and release all supplied Contexts`, async () => {
    const game = guessingDomain(false, weights);
    await assert.rejects(search(game.domain, 'r2', cursor, budget()), /weight/i);
    assert.equal(game.active(), 0);
  });
}

test('out-of-range heuristics fail instead of invalidating the cost bounds', async () => {
  const game = guessingDomain(), next = game.domain.next;
  game.domain.next = async function*(current,expansion) {
    for await (const child of next(current,expansion)) {child.outcomes[0]!.current.position.value = 2; yield child;}
  };
  await assert.rejects(search(game.domain, 'r2', cursor, budget()), /Invalid public evaluation/);
  assert.equal(game.active(), 0);
});


/** Uncertainty first arises after an action from a single complete current.
 * The root's retained state is never replaced by preconstructed hidden worlds. */
function futureDomain(representation: 'exact' | 'particles' = 'exact') {
  let active = 0, advances = 0;
  const held = new WeakMap<SearchCurrent, {stage: string; secret: number}>();
  const expanded = new WeakSet<SearchCurrent>();
  const create = (stage: string, secret = -1): SearchCurrent => {
    active++;
    let closed = false;
    const position: SearchPosition = stage === 'root' ? root : stage === 'guess' ?
      {information: secret < 2 ? 'unrevealed-pair' : 'known-zero', actions: ['zero','one'].map(action), value: 0, terminal: false, round: 0} :
      {information: stage, actions: [], value: Number(stage), terminal: true, round: 0};
    const current = {position, async close() {if (!closed) {closed = true; active--;}}};
    held.set(current, {stage, secret}); return current;
  };
  const actual = create('root');
  const domain: SearchDomain = {root, baseline: p => p.actions[0]!.key,
    async current(random, b) {
      b.accepted++;
      return {particles:[{current:actual,weight:1}],representation:'exact',random,reason:null,method:'actual-current'};
    },
    async *next(parent) {
      assert.ok(!expanded.has(parent)); expanded.add(parent);
      const {stage, secret} = held.get(parent)!;
      if (stage === 'root') {
        assert.equal(parent, actual, 'next must receive the actual retained root');
        advances++; yield {action:'safe',outcomes:[{current:create('.75'),probability:1}],representation:'exact'};
        advances += 3;
        yield {action:'risk',outcomes:[.2,.3,.5].map((probability, secret) => ({current:create('guess',secret),probability})),representation};
      } else {
        for (const key of ['zero','one']) {
          advances++;
          yield {action:key,outcomes:[{current:create(String((key === 'one' ? 1 : 0) === secret % 2 ? 1 : 0)),probability:1}],representation:'exact'};
        }
      }
    }
  };
  return {domain, active:()=>active, advances:()=>advances};
}

test('one actual root branches into weighted futures and observation posteriors', async () => {
  for (const algorithm of ['r1','r2'] as const) {
    const game = futureDomain();
    const result = await search(game.domain,algorithm,cursor,budget());
    assert.equal(result.evidence.accepted,1);
    assert.deepEqual(result.evidence.actions[1]!.outcomes,[{probability:.5,particles:2},{probability:.5,particles:1}]);
    const risk = result.evidence.actions[1]!;
    if (algorithm === 'r1') {
      // The .15 lower bound already loses to safe (.125); the solver need not
      // finish the other chance branch merely to estimate a dominated action.
      assert.ok(Math.abs(risk.lower-.15)<1e-12);
      assert.ok(risk.upper>=.15);
      assert.equal(result.evidence.selectedUpperGap,0);
    } else assert.ok(Math.abs(risk.estimate-.1)<1e-12);
    assert.equal(result.action,algorithm === 'r1' ? 'safe' : 'risk');
    assert.equal(result.evidence.advances,game.advances());
    assert.equal(game.active(),0);
  }
});

test('a sampled future marks the result approximate even with an exact root', async () => {
  const game = futureDomain('particles');
  const result = await search(game.domain,'r2',cursor,budget());
  assert.equal(result.evidence.representation,'particles');
  assert.equal(game.active(),0);
});

for (const probabilities of [[0,.5,.5],[-.1,.6,.5],[.2,.3,.4],[NaN,.3,.5],[Infinity,.3,.5]]) {
  test(`invalid successor probabilities ${probabilities} close the entire yielded distribution`, async () => {
    const game = futureDomain(), next = game.domain.next;
    game.domain.next = async function*(current,expansion) {
      for await (const edge of next(current,expansion)) {
        if (edge.action === 'risk') edge.outcomes.forEach((o,i) => o.probability = probabilities[i]!);
        yield edge;
      }
    };
    await assert.rejects(search(game.domain,'r2',cursor,budget()),/Successor probabilities/);
    assert.equal(game.active(),0);
  });
}

test('node exhaustion midway through a distribution closes unretained siblings', async () => {
  const game = futureDomain();
  const result = await search(game.domain,'r2',cursor,budget({nodes:6}));
  assert.equal(result.evidence.reason,'node-budget');
  assert.equal(result.evidence.actions[0]!.expanded,true);
  assert.equal(result.evidence.actions[1]!.expanded,false);
  assert.deepEqual(result.evidence.actions[1]!.outcomes,[]);
  assert.equal(game.active(),0);
});

test('posterior world cap discards the whole action without retaining only a favorable outcome', async () => {
  const game = futureDomain();
  const result = await search(game.domain,'r2',cursor,budget({worlds:1}));
  assert.equal(result.evidence.reason,'world-budget');
  assert.equal(result.evidence.actions[1]!.expanded,false);
  assert.deepEqual(result.evidence.actions[1]!.outcomes,[]);
  assert.equal(game.active(),0);
});

test('cancellation after a weighted yield closes all outcomes and publishes none', async () => {
  const game = futureDomain(), next = game.domain.next, controller = new AbortController();
  game.domain.next = async function*(current,expansion) {
    for await (const edge of next(current,expansion)) {if (edge.action === 'risk') controller.abort(); yield edge;}
  };
  const result = await search(game.domain,'r2',cursor,budget({},controller.signal));
  assert.equal(result.evidence.reason,'cancelled');
  assert.equal(result.evidence.actions[0]!.expanded,true);
  assert.equal(result.evidence.actions[1]!.expanded,false);
  assert.equal(game.active(),0);
});


test('successive chance steps multiply conditional probabilities before observation grouping', async () => {
  let active = 0;
  const states = new WeakMap<SearchCurrent,{stage:string;secret:number}>();
  const start: SearchPosition = {...root,actions:[action('go')]};
  const current = (stage: string, secret = 0): SearchCurrent => {
    active++; let closed = false;
    const result = {position:stage === 'root' ? start : stage === 'mid' ?
      {...start,information:'same-mid'} : {information:stage,actions:[],value:Number(stage),terminal:true,round:0},
      async close() {if (!closed) {closed = true; active--;}}};
    states.set(result,{stage,secret}); return result;
  };
  const domain: SearchDomain = {root:start,baseline:()=> 'go',
    async current(random) {return {particles:[{current:current('root'),weight:1}],representation:'exact',random,reason:null,method:'actual'};},
    async *next(parent) {
      const {stage,secret} = states.get(parent)!;
      const outcomes = stage === 'root' ? [.25,.75].map((probability,secret)=>({current:current('mid',secret),probability})) :
        [{current:current('1'),probability:secret === 0 ? .8 : .2},{current:current('-1'),probability:secret === 0 ? .2 : .8}];
      yield {action:'go',outcomes,representation:'exact'};
    }
  };
  const result = await search(domain,'r2',cursor,budget());
  // P(loss) = .25 * .2 + .75 * .8 = .65, not the unweighted .5.
  for (const value of Object.values(result.evidence.score)) assert.ok(Math.abs(value-.65)<1e-12);
  assert.equal(result.evidence.completed,2);
  assert.equal(active,0);
});

test('all suspended next iterators consume one search-owned entropy cursor',async()=>{
  const game=guessingDomain(),next=game.domain.next,words:number[]=[];
  game.domain.next=async function*(current,expansion){
    for await(const edge of next(current,expansion)){words.push(expansion.word());yield edge;}
  };
  const original={...cursor},result=await search(game.domain,'r2',cursor,budget());
  let expected={...cursor};const values:number[]=[];
  for(let i=0;i<game.forks();i++){const draw=searchEntropyWord(expected);expected=draw.random;values.push(draw.value);}
  assert.deepEqual(words,values);assert.deepEqual(result.random,expected);assert.deepEqual(cursor,original);
  assert.ok(result.random.position>cursor.position);assert.equal(game.active(),0);
});

test('search entropy mixes low bits while retaining one exact restorable cursor step per word',()=>{
  let cursor={state:18273,position:0};const bits:number[]=[],saved={...cursor};
  for(let i=0;i<64;i++){const before={...cursor},word=searchEntropyWord(cursor),raw=randomInt(cursor,2**32);assert.deepEqual(cursor,before);assert.deepEqual(word.random,raw.random);assert.ok(Number.isInteger(word.value)&&word.value>=0&&word.value<2**32);bits.push(word.value&1);cursor=word.random;}
  assert.ok(bits.some((bit,i)=>i>0&&bit===bits[i-1]),'small choices must not inherit the LCG alternating low bit');
  assert.ok(bits.includes(0)&&bits.includes(1));assert.equal(cursor.position,64);
  const a=searchEntropyWord(saved),b=searchEntropyWord({...saved});assert.deepEqual(a,b);
});

test('preparation consumes the same decision time and node allowance without changing work-mode semantics',()=>{
  let now=0;
  const wall=new SearchBudget({...defaultSearchLimits,mode:'wall'},new AbortController().signal,()=>now,()=>0);
  wall.includePreparation({milliseconds:1800,nodes:9999});wall.allocateNode();
  assert.equal(wall.nodes,10000);assert.throws(()=>wall.allocateNode(),/node-budget/);
  const time=new SearchBudget({...defaultSearchLimits,mode:'wall'},new AbortController().signal,()=>now,()=>0);
  time.includePreparation({milliseconds:1800,nodes:0});now=200;
  assert.throws(()=>time.check(),/wall-budget/);assert.equal(time.cost().milliseconds,2000);
  const work=new SearchBudget({...defaultSearchLimits,mode:'work'},new AbortController().signal,()=>now,()=>0,1000);
  work.includePreparation({milliseconds:5000,nodes:0});work.check();now+=1000;
  assert.throws(()=>work.check(),/game-search-budget/);
  assert.throws(()=>work.includePreparation({milliseconds:0,nodes:0}),/Invalid search preparation/);
});
