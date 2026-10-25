import {deckProfile,upgradePreference,combatTiePreferences} from '../src/search/layered.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deserialize} from 'node:v8';
import {inflateRawSync} from 'node:zlib';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {registerCurrentSource} from '../../../packages/game-host/src/current.ts';
import {PolicyWorkSuspended,policyWork} from '../../../packages/policies/src/search/work.ts';
import {ExactProbabilityUnavailable} from '../../../packages/card-engine/src/probability-cursor.ts';
import {ProbabilityExpansion} from '../../../packages/runtime-card/src/probability-expansion.ts';
import {SearchSession} from '../../../packages/policies/src/search/session.ts';
import type {SearchSessionSnapshot} from '../../../packages/policies/src/search/session.types.ts';
import {contract,type StsTypes} from '../src/contract.ts';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {cardDefinition} from '../src/card.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {createSearchPolicy,type StsSearchResult} from '../src/search/policy.ts';
import {combatValue,combatPriority,combatExclusions,cardPreference,adventureScore,chooseAdventure} from '../src/search/layered.ts';
import {exactCombatPosition} from '../src/search/combat-objective.ts';
import {publicDecision,publicKey,publicData} from '../src/search/information.ts';
import {takeStsSearchCurrent,stsExactDomain,type StsCurrentSnapshot,type StsExpansionSnapshot} from '../src/search/current-session.ts';
import {PS} from '../src/combat-identifiers.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import {describeAction} from '../src/presentation.ts';
import type {StsEvent} from '../src/game.schemas.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const snapshotData=(snapshot:StsCurrentSnapshot)=>({...snapshot,events:typeof snapshot.events==='string'?deserialize(inflateRawSync(Buffer.from(snapshot.events,'base64'))):snapshot.events});
function source(game:GameHandle<StsTypes>){const fork=async()=>unwrap(await game.fork!());registerCurrentSource(fork,game);return fork;}
async function request(game:GameHandle<StsTypes>){const s=unwrap(await game.inspect());if(s.kind!=='request')throw Error(JSON.stringify(s));return s.requests[0]!;}
const random={state:987213,position:0},signal=new AbortController().signal;
for(const [acceptedReference,coldPrevious] of [[false,false],[true,false],[true,true]])test(`production search ${acceptedReference?'adopts':'does not adopt'} retained work ${acceptedReference?'with':'without'} an accepted-action memory reference; cold predecessor=${coldPrevious}`,async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,instructionsPerSlice:4096}).load(combatContentDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true})),contract}));
 const events:StsEvent[]=[];
 const onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
 unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
 const first=await request(game),decision=publicDecision(first,events.map(event=>({event})));
 const action=decision.actions.find(a=>a.bits>>>29===0&&decision.observation.battle!.hand[a.bits&65535]!.id==='DEFEND_RED')
   ??decision.actions.find(a=>a.bits>>>29===0)!;
 assert.ok(action,'starter hand supplies an original deterministic play');
 const key=publicKey({callId:first.id.callId,key:first.id.key,decision});
 const actual=await takeStsSearchCurrent(source(game),events),domain=stsExactDomain(actual.current.machine.program,decision.observation,decision.events.length);
 const session=SearchSession.from(domain,actual);
 type Work={version:number;consumed:number;entries:{key:string;initial:typeof decision.observation;eventOffset:number;decisionStartSteps:bigint;search:SearchSessionSnapshot<StsCurrentSnapshot,StsExpansionSnapshot>}[]};
 let actualForks=0;const actualSource=source(game);
 const makePolicy=()=>createSearchPolicy({character:'ironclad',forkCurrent:async()=>{actualForks++;return actualSource();}});
 let policy=makePolicy();const originalStep=SearchSession.prototype.stepLocal,initialize=CardProgram.prototype.initial;
 try{
  CardProgram.prototype.initial=()=>{throw Error('Existing currents must never initialize');};
  // Prepare only the existing action law, using all legal root actions and the
  // original probability executor. No optimality claim or fabricated score.
  let workSteps=0;
  while(!session.save().beliefs[0]!.edges.find(edge=>edge.action===String(action.bits))!.published){
   assert.equal(session.stepLocal(),true);assert.ok(++workSteps<10000,'a deterministic starter play reaches its next original request');
  }
  const before=session.save();session.close();
  const transfer={version:1,consumed:0,entries:[{key,initial:decision.observation,eventOffset:decision.events.length,search:structuredClone(before)}]};
  policyWork(policy)!.restore(transfer);
  transfer.entries[0]!.search.steps+=999n;
  const pending=policyWork(policy)!.save() as Work;
  assert.deepEqual(pending.entries[0]!.search,before,'work waiting for the actual Program detaches its input without dropping the frontier');
  pending.entries[0]!.search.executions.length=0;
  assert.deepEqual((policyWork(policy)!.save() as Work).entries[0]!.search,before,'saving unopened work returns an independent complete snapshot');
  const restore=SearchSession.restore,advance=CardMachine.prototype.advanceExactProbability;
  try{
   SearchSession.restore=()=>{throw Error('fixture-search-restore');};
   await assert.rejects(policyWork(policy)!.prepare!(),/fixture-search-restore/);
   assert.deepEqual((policyWork(policy)!.save() as Work).entries[0]!.search,before,'failed preparation retains all unopened work');
   SearchSession.restore=restore;
   CardMachine.prototype.advanceExactProbability=()=>{throw Error('Preparing saved work must not execute an edge');};
   await policyWork(policy)!.prepare!();
   SearchSession.restore=()=>{throw Error('Prepared work must not restore again');};
   await policyWork(policy)!.prepare!();
   assert.deepEqual((policyWork(policy)!.save() as Work).entries[0]!.search,before,'preparation restores every existing execution and pending edge');
   assert.deepEqual(await request(game),first,'preparation preserves the actual current');
  }finally{SearchSession.restore=restore;CardMachine.prototype.advanceExactProbability=advance;}
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent}));
  const advanced=unwrap(await game.run());assert.ok(advanced.accepted);
  const next=await request(game),nextDecision=publicDecision(next,events.map(event=>({event})));
  if(acceptedReference){
   const checked=await takeStsSearchCurrent(source(game),events);
   try{
    const edge=before.beliefs[0]!.edges.find(edge=>edge.action===String(action.bits))!;
    const child=before.beliefs[edge.outcomes[0]!.belief]!.worlds[0]!.execution;
    assert.deepEqual(snapshotData(domain.save(checked)),snapshotData(before.executions[child]!.current),'all original Context and event facts agree even when V8 chooses a different event string/reference encoding');
   }finally{domain.close(checked);}
  }
  assert.ok(nextDecision.observation.battle);assert.ok(nextDecision.actions.length>1);
  const nextKey=publicKey({callId:next.id.callId,key:next.id.key,decision:nextDecision});assert.notEqual(nextKey,key);
  if(coldPrevious){
   const parked=policyWork(policy)!.save();policyWork(policy)!.close();policy=makePolicy();policyWork(policy)!.restore(parked);
   const restore=SearchSession.restore;
   try{
    SearchSession.restore=()=>{throw Error('Preparation must not reconstruct the previous real root');};
    await policyWork(policy)!.prepare!();
   }finally{SearchSession.restore=restore;}
   assert.deepEqual((policyWork(policy)!.save() as Work).entries[0]!.search,before,'unopened predecessor work is preserved for a checked forward adoption');
  }
  // Isolate adoption/restore from the rest of this battle's search. The pause
  // occurs before new expansion, not as a substitute action or terminal value.
  SearchSession.prototype.stepLocal=function(){throw new PolicyWorkSuspended('test-after-adoption');};
  const input={request:next,visibleHistory:events.map(event=>({event})),random,signal,
   memory:publicData(acceptedReference?{retainedSearch:{key,action:String(action.bits)}}:{})};
  const stopped=(error:unknown)=>error instanceof PolicyWorkSuspended&&error.reason==='test-after-adoption';
  await assert.rejects(policy.decide(input),stopped);
  const work=policyWork(policy)!.save() as Work,current=work.entries.find(entry=>entry.key===nextKey)!;
  assert.ok(current);assert.equal(work.entries.length,1);assert.ok(work.entries.every(entry=>entry.key!==key),'obsolete roots are released after actual forward progress');
  if(acceptedReference){
   assert.notEqual(current.search.root,0);assert.deepEqual(current.initial,decision.observation);
   assert.equal(current.eventOffset,decision.events.length);
   assert.deepEqual(current.search.executions.slice(0,-1),before.executions,'consumed laws are retained without execution');
   assert.equal(current.search.steps,before.steps);
   assert.equal(current.decisionStartSteps,before.steps,'the next decision must not charge already reported search steps again');
  }else{
   assert.equal(current.search.root,0);assert.equal(current.search.steps,0n);assert.equal(current.decisionStartSteps,0n);
   assert.equal(work.entries.find(entry=>entry.key===key),undefined,'unaccepted predecessor work cannot be selected or retained as a live root');
  }
  const owned=await takeStsSearchCurrent(source(game),events);
  try{
   const root=current.search.beliefs[current.search.root]!.worlds[0]!.execution;
   assert.deepEqual(snapshotData(current.search.executions[root]!.current),snapshotData(domain.save(owned)),'the new root owns the full actual current');
  }finally{domain.close(owned);}
  policyWork(policy)!.close();policy=makePolicy();policyWork(policy)!.restore(work);
  {
   const restore=SearchSession.restore;let restored=0;
   try{
    SearchSession.restore=(...args)=>{restored++;return restore(...args);};
    await policyWork(policy)!.prepare!();
    assert.equal(restored,1,'cold preparation attaches only the actual current entry, leaving historical roots packed');
   }finally{SearchSession.restore=restore;}
  }
  const forksBeforeRetry=actualForks;
  await assert.rejects(policy.decide(input),stopped);
  assert.equal(actualForks,forksBeforeRetry,'an attached current resumes without a validation fork');
  assert.deepEqual((policyWork(policy)!.save() as Work).entries,work.entries,'cold retry resumes the moved entry even with the prior committed reference');
  assert.deepEqual(await request(game),next,'search never advances the real game');
 }finally{SearchSession.prototype.stepLocal=originalStep;CardProgram.prototype.initial=initialize;session.close();policyWork(policy)!.close();unwrap(await game.close());}
});

test('adventure decisions use the host request without acquiring or validating a Context',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(cardDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',detailedEvents:true})),contract}));
 const events:StsEvent[]=[];
 unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
 const current=await request(game),input={request:current,visibleHistory:events.map(event=>({event})),random,signal,memory:{}};
 const policy=createSearchPolicy({character:'ironclad',forkCurrent:async()=>{throw Error('Adventure preference must not acquire a Context');}});
 try{
  const proposal=await policy.decide(input);
  assert.ok(publicDecision(current,input.visibleHistory).actions.some(action=>action.bits===(proposal.action as {bits:number}).bits));
  assert.deepEqual(await request(game),current,'only the host accepts proposals and advances the game');
 }finally{policyWork(policy)!.close();unwrap(await game.close());}
});

test('the host keeps a fatal real sequence final while decision work remains read-only',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,instructionsPerSlice:4096}).load(cardDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',detailedEvents:true})),contract}));
 const events:StsEvent[]=[];
 const onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
 unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
 let openingRandom=random,openingSteps=0;
 while(!publicDecision(await request(game),events.map(event=>({event}))).observation.battle){
  assert.ok(++openingSteps<30,'original opening reaches combat');
  const d=publicDecision(await request(game),events.map(event=>({event}))),chosen=chooseAdventure(d,openingRandom);openingRandom=chosen.random;
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:chosen.action}),onEvent}));
  const advanced=unwrap(await game.run());assert.notEqual(advanced.state.kind,'fault',JSON.stringify(advanced.state));
 }
 const first=await request(game),history=events.map(event=>({event}));
 const policy=createSearchPolicy({character:'ironclad',forkCurrent:source(game)});
 const originalStep=SearchSession.prototype.stepLocal,initialize=CardProgram.prototype.initial;
 try{
  CardProgram.prototype.initial=()=>{throw Error('A fatal real decision must not restart the game');};
  SearchSession.prototype.stepLocal=()=>{throw new PolicyWorkSuspended('test-retain-root');};
  const input={request:first,visibleHistory:history,random,signal,memory:{}};
  await assert.rejects(policy.decide(input),error=>error instanceof PolicyWorkSuspended&&error.reason==='test-retain-root');
  const before=policyWork(policy)!.save();
  // Advance each NEW actual request once through the original game. These
  // intentionally bad choices exercise finality; no saved branch is executed.
  let turns=0;
  while(unwrap(await game.inspect()).kind==='request'){
   const next=await request(game),d=publicDecision(next,events.map(event=>({event})));
   assert.ok(d.observation.battle);assert.ok(++turns<=20,'original enemies must kill an undefended starter');
   const end=d.actions.find(action=>action.bits>>>29===4);assert.ok(end);
   unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:end}),onEvent}));
   const advanced=unwrap(await game.run());assert.notEqual(advanced.state.kind,'fault',JSON.stringify(advanced.state));assert.ok(advanced.accepted);
  }
  const dead=unwrap(await game.inspect());assert.equal(dead.kind,'ended');
  if(dead.kind==='ended')assert.equal(dead.result.outcome,'death');
  assert.deepEqual((policyWork(policy)!.save() as {entries:unknown}).entries,(before as {entries:unknown}).entries,'host progression leaves the retained decision work unchanged');
  assert.deepEqual(unwrap(await game.inspect()),dead,'death stays on the actual worldline');
 }finally{SearchSession.prototype.stepLocal=originalStep;CardProgram.prototype.initial=initialize;policyWork(policy)!.close();await game.close();}
});

test('production selects one locally favorable action while the complete combat frontier remains open',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,instructionsPerSlice:4096}).load(combatContentDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true})),contract}));
 const events:StsEvent[]=[],onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
 unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
 const policy=createSearchPolicy({character:'ironclad',schedulingMilliseconds:30,forkCurrent:source(game)}),initialize=CardProgram.prototype.initial;
 try{
  const first=await request(game),input={request:first,visibleHistory:events.map(event=>({event})),random,signal,memory:{}};
  CardProgram.prototype.initial=()=>{throw Error('Local planning must not initialize or replay');};
  let proposal:Awaited<ReturnType<typeof policy.decide>>|undefined;
  for(let slices=0;!proposal;slices++){
   assert.ok(slices<100,'local planning must act without solving this whole combat');
   try{proposal=await policy.decide(input);}catch(error){assert.ok(error instanceof PolicyWorkSuspended&&error.reason==='scheduling-yield');}
  }
  const evidence=(proposal.nextMemory as {evidence:{status:string;searchComplete:boolean;pendingEdges:number;actions:{unresolved:{numerator:string;denominator:string}}[]}}).evidence;
  assert.equal(evidence.status,'estimated-action');assert.equal(evidence.searchComplete,false);assert.ok(evidence.pendingEdges>0);
  assert.ok(evidence.actions.some(row=>BigInt(row.unresolved.numerator)>0n),'unvisited future mass stays explicit');
  assert.deepEqual(await request(game),first,'a proposal alone never advances the real worldline');
  const action=contract.schemas.actions.action.action.parse(proposal.action);
  assert.ok(publicDecision(first,input.visibleHistory).actions.some(candidate=>candidate.bits===action.bits));
  const evaluated=(proposal.nextMemory as {evidence:{actions:{key:string;observedSuccessorMass:{numerator:string}}[]}}).evidence.actions.find(row=>row.key===String(action.bits))!;
  assert.ok(BigInt(evaluated.observedSuccessorMass.numerator)>0n,'the selected action has an original successor, not just a different actions evidence');
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent}));assert.ok(unwrap(await game.run()).accepted);
  const next=await request(game);assert.notEqual(next.id.callId,first.id.callId);
 }finally{CardProgram.prototype.initial=initialize;policyWork(policy)!.close();unwrap(await game.close());}
});

test('production does not discard a held potion merely because future action laws are incomplete',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,instructionsPerSlice:4096}).load(combatContentDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:potionId.ATTACK_POTION,durable:false,elite:false,detailedEvents:true})),contract}));
 const events:StsEvent[]=[],onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
 unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
 const policy=createSearchPolicy({character:'ironclad',schedulingMilliseconds:30,forkCurrent:source(game)}),initialize=CardProgram.prototype.initial;
 try{
  CardProgram.prototype.initial=()=>{throw Error('Potion decision must continue the actual current');};
  for(let plays=0;;plays++){
   const d=publicDecision(await request(game),events.map(event=>({event})));
   if(d.observation.battle!.player.energy===0)break;
   assert.ok(plays<5);const action=d.actions.find(action=>describeAction(d.observation,action.bits).kind==='play-card');assert.ok(action);
   unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent}));assert.ok(unwrap(await game.run()).accepted);
  }
  const current=await request(game),input={request:current,visibleHistory:events.map(event=>({event})),random,signal,memory:{}};
  const d=publicDecision(current,input.visibleHistory),discard=d.actions.find(action=>describeAction(d.observation,action.bits).kind==='discard-potion');assert.ok(discard);
  let proposal:Awaited<ReturnType<typeof policy.decide>>|undefined;
  for(let slices=0;!proposal;slices++){
   assert.ok(slices<100);
   try{proposal=await policy.decide(input);}catch(error){assert.ok(error instanceof PolicyWorkSuspended&&error.reason==='scheduling-yield');}
  }
  const action=contract.schemas.actions.action.action.parse(proposal.action);
  assert.notEqual(describeAction(d.observation,action.bits).kind,'discard-potion');
  const evidence=proposal.nextMemory as {evidence:{heuristicExclusions:{key:string;reason:string}[];actions:{key:string}[];searchComplete:boolean}};
  assert.ok(evidence.evidence.heuristicExclusions.some(row=>row.key===String(discard.bits)&&row.reason==='discard-without-observed-compensation'));
  assert.ok(evidence.evidence.actions.some(row=>row.key===String(discard.bits)),'the original discard law is retained in the evidence');
  assert.equal(evidence.evidence.searchComplete,false);assert.deepEqual(await request(game),current);
 }finally{CardProgram.prototype.initial=initialize;policyWork(policy)!.close();unwrap(await game.close());}
});

for(const chemicalX of [false,true])test(`zero-energy Whirlwind needs original observed benefit; Chemical X=${chemicalX}`,async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,instructionsPerSlice:4096}).load(combatContentDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,
  relics:chemicalX?['CHEMICAL_X']:[],potion:null,durable:false,elite:false,bottledCard:'WHIRLWIND',detailedEvents:true})),contract}));
 const events:StsEvent[]=[],onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
 unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
 const policy=createSearchPolicy({character:'ironclad',schedulingMilliseconds:30,forkCurrent:source(game)}),initialize=CardProgram.prototype.initial;
 try{
  CardProgram.prototype.initial=()=>{throw Error('Advance only the current fixture; never reconstruct or replay');};
  // Spend the actual opening energy through original legal cards. This is a
  // new forward-only fixture, not restoration of an earlier failed run.
  for(;;){
   const before=await request(game),decision=publicDecision(before,events.map(event=>({event})));
   if(decision.observation.battle!.player.energy===0)break;
   const action=decision.actions.find(a=>{const shown=describeAction(decision.observation,a.bits);
    return shown.kind==='play-card'&&decision.observation.battle!.hand[Number(shown.details.hand)]!.costForTurn>0;});
   assert.ok(action,'the original opening hand can spend its energy');
   unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent}));assert.ok(unwrap(await game.run()).accepted);
  }
  const before=await request(game),visibleHistory=events.map(event=>({event})),decision=publicDecision(before,visibleHistory);
  const whirlwind=decision.actions.find(a=>{const shown=describeAction(decision.observation,a.bits);return shown.kind==='play-card'&&decision.observation.battle!.hand[Number(shown.details.hand)]!.id==='WHIRLWIND';})!;
  assert.ok(whirlwind);
  const proposal=await policy.decide({request:before,visibleHistory,random,signal,memory:{}});
  const evidence=(proposal.nextMemory as {evidence:{heuristicExclusions:{key:string;reason:string}[];actions:{key:string;observedSuccessorMass:{numerator:string;denominator:string}}[]}}).evidence;
  const shown=describeAction(decision.observation,(proposal.action as {bits:number}).bits);
  if(chemicalX){
   assert.equal((proposal.action as {bits:number}).bits,whirlwind.bits,'the original relic makes the zero-energy attack useful');
   assert.ok(!evidence.heuristicExclusions.some(row=>row.key===String(whirlwind.bits)));
  }else{
   assert.equal(shown.kind,'end-turn','do not select an empty play just because it was observed before end turn');
   assert.ok(evidence.heuristicExclusions.some(row=>row.key===String(whirlwind.bits)&&row.reason==='zero-energy-whirlwind-without-observed-benefit'));
  }
  const evaluated=evidence.actions.find(row=>row.key===String(whirlwind.bits))!;
  assert.equal(evaluated.observedSuccessorMass.numerator,evaluated.observedSuccessorMass.denominator,'the whole original direct law was retained and evaluated');
  assert.deepEqual(await request(game),before,'policy only proposes from the actual current');
 }finally{CardProgram.prototype.initial=initialize;policyWork(policy)!.close();unwrap(await game.close());}
});

test('a missing exact law suspends the policy with retained work and never supplies a sampled action',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true})),contract}));
 const events:StsEvent[]=[];unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
 let evidence:StsSearchResult|undefined;
 const makePolicy=()=>createSearchPolicy({character:'ironclad',schedulingMilliseconds:60000,forkCurrent:source(game),onEvidence:value=>{evidence=value;}});
 let policy=makePolicy();const step=ProbabilityExpansion.prototype.step,initial=CardProgram.prototype.initial;
 try{
  const before=await request(game),input={request:before,visibleHistory:events.map(event=>({event})),random,memory:{},signal};
  CardProgram.prototype.initial=()=>{throw Error('Resuming a missing law must not initialize');};
  ProbabilityExpansion.prototype.step=function(){throw new ExactProbabilityUnavailable();};
  const unavailable=(error:unknown)=>error instanceof PolicyWorkSuspended&&error.reason==='exact-space-unavailable';
  await assert.rejects(policy.decide(input),unavailable);
  assert.equal(evidence!.action,null);assert.equal((evidence!.evidence as {status:string}).status,'incomplete');
  const saved=policyWork(policy)!.save() as {entries:{search:unknown}[]};assert.equal(saved.entries.length,1);
  policyWork(policy)!.close();policy=makePolicy();policyWork(policy)!.restore(saved);
  await assert.rejects(policy.decide(input),unavailable);
  const resumed=policyWork(policy)!.save() as typeof saved;
  assert.deepEqual(resumed.entries,saved.entries);assert.deepEqual(await request(game),before);assert.equal(evidence!.action,null);
 }finally{ProbabilityExpansion.prototype.step=step;CardProgram.prototype.initial=initial;policyWork(policy)!.close();unwrap(await game.close());}
});
test('layered Neow is a public stochastic preference from host requests but no future execution or initial-state reconstruction',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(cardDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',detailedEvents:true})),contract}));
 const events:StsEvent[]=[];unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
 const original=CardProgram.prototype.initial,advance=CardMachine.prototype.advanceExactProbability;
 let evidence:StsSearchResult|undefined;
 const policy=createSearchPolicy({character:'ironclad',forkCurrent:source(game),onEvidence:r=>{evidence=r;}});
 try{
  const before=await request(game),visibleHistory=events.map(event=>({event})),decision=publicDecision(before,visibleHistory);
  const a=chooseAdventure(decision,random),b=chooseAdventure(decision,random);assert.deepEqual(a,b);assert.equal(a.random.position,random.position+1);assert.ok(a.logProbability<=0);
  CardProgram.prototype.initial=()=>{throw Error('No reinitialization');};
  CardMachine.prototype.advanceExactProbability=()=>{throw Error('Adventure preference must not execute a future');};
  const result=await policy.decide({request:before,visibleHistory,random,memory:{},signal});
  assert.equal((evidence!.evidence as {method:string}).method,'layered-adventure');assert.deepEqual(result.action,a.action);assert.deepEqual(await request(game),before);
  const o=structuredClone(decision.observation);o.game.screen='REST_ROOM';o.game.act=3;o.game.y=14;o.game.keys.red=false;
  assert.ok(adventureScore(o,2)>adventureScore(o,1),'required red key beats an optional upgrade');
  const event=structuredClone(o);event.game.screen='EVENT_SCREEN';delete event.game.neow;event.game.optionDetails={'0':'获得150金币；获得1张DOUBT','1':'离开'};assert.ok(adventureScore(event,0)<adventureScore(event,1),'original named curse cards must count as a construction cost');
  event.game.optionDetails={'0':'战斗；获胜获得20–30金币、ODD_MUSHROOM及卡牌奖励，可能获得药水','1':'获得50金币离开'};assert.ok(adventureScore(event,1)>adventureScore(event,0),'leaving with a reward keeps its benefit and avoids an unready event battle');
  assert.ok(cardPreference(decision.observation,{id:'ANGER',upgraded:false})>cardPreference(decision.observation,{id:'SECOND_WIND',upgraded:false}),'starter construction first fills damage, not unsupported exhaust');
  assert.ok(cardPreference(o,{id:'ENTRENCH',upgraded:false})<0,'avoid unsupported block multiplication');
  assert.ok(cardPreference(o,{id:'CLASH',upgraded:false})<0,'curse-bearing starter deck cannot reliably play Clash');
  assert.ok(cardPreference(o,{id:'SHRUG_IT_OFF',upgraded:false})>cardPreference(o,{id:'STRIKE_RED',upgraded:false}));
  // These are public construction-scoring fixtures, never game Contexts.
  const full=structuredClone(decision.observation);
  full.game.deck=['ASCENDERS_BANE',...Array(4).fill('STRIKE_RED'),...Array(4).fill('DEFEND_RED'),'BASH','HEADBUTT','CARNAGE','THUNDERCLAP','IMPERVIOUS','SECOND_WIND','PERFECTED_STRIKE','IRON_WAVE']
    .map(id=>({id,misc:0,upgraded:id==='IMPERVIOUS'}));
  const heavy={id:'HEAVY_BLADE',upgraded:false},beforeFull=structuredClone(full);
  assert.ok(cardPreference(decision.observation,heavy)>0,'a starter still wants a needed early damage card');
  assert.ok(cardPreference(full,heavy)<0,'surplus unsupported damage loses to skipping before the deck-size penalty starts');
  assert.ok(cardPreference(full,{id:'BATTLE_TRANCE',upgraded:false})>0,'sufficient damage does not reject missing draw');
  const undefended=structuredClone(full);undefended.game.deck=undefended.game.deck.filter(c=>!['DEFEND_RED','IMPERVIOUS','SECOND_WIND','IRON_WAVE'].includes(c.id));
  assert.ok(cardPreference(undefended,{id:'SHRUG_IT_OFF',upgraded:false})>cardPreference(undefended,heavy),'defense deficit outranks further surplus attacks');
  const strength=structuredClone(full);strength.game.deck.push({id:'INFLAME',misc:0,upgraded:false},{id:'SPOT_WEAKNESS',misc:0,upgraded:false});
  assert.ok(cardPreference(strength,heavy)>0,'observed strength synergy can justify the otherwise surplus attack');
  const surplus=structuredClone(full);surplus.game.deck.push({id:'BLUDGEON',misc:0,upgraded:false},{id:'WILD_STRIKE',misc:0,upgraded:false});
  assert.ok(cardPreference(surplus,heavy)<cardPreference(full,heavy),'more existing damage lowers the marginal value even beyond the target');
  const blood={id:'BLOOD_FOR_BLOOD',upgraded:false};
  assert.ok(cardPreference(full,blood)<0,'an unlisted damage card cannot escape the surplus-output penalty');
  const loaded=structuredClone(full);loaded.game.deck.push({...blood,misc:0});
  assert.ok(deckProfile(loaded).attack>deckProfile(full).attack,'existing Blood for Blood contributes output');
  assert.ok(cardPreference(loaded,heavy)<cardPreference(full,heavy),'its output reduces the need for another damage card');
  for(const id of ['CLEAVE','REAPER','DROPKICK','RECKLESS_CHARGE','IMMOLATE','WHIRLWIND']){
   const added=structuredClone(full);added.game.deck.push({id,misc:0,upgraded:false});
   assert.ok(deckProfile(added).attack>deckProfile(full).attack,`${id} contributes output in addition to its other roles`);
  }
  const upgrades=structuredClone(full);upgrades.game.deck.push({id:'BLOOD_FOR_BLOOD',misc:0,upgraded:false});
  const index=upgrades.game.deck.length-1,beforeUpgrades=structuredClone(upgrades);
  assert.ok(cardPreference(upgrades,upgrades.game.deck[index]!)<0,'a surplus copy can be unwanted');
  assert.ok(upgradePreference(upgrades,index)>2,'upgrading the owned copy still values its original cost reduction');
  const clutter=structuredClone(upgrades);clutter.game.deck.push(...Array.from({length:20},()=>({id:'INJURY',misc:0,upgraded:false})));
  assert.ok(Math.abs(upgradePreference(clutter,index)-upgradePreference(upgrades,index))<1e-10,'deck size does not impose an acquisition penalty on an existing slot upgrade');
  upgrades.game.screen='CARD_SELECT';upgrades.game.select={type:3,remaining:1,cards:[{card:upgrades.game.deck[index]!,deckIndex:index}],selected:[]};
  assert.equal(adventureScore(upgrades,0),upgradePreference(upgrades,index),'selection uses the original candidate deck index');
  upgrades.game.screen=beforeUpgrades.game.screen;upgrades.game.select=beforeUpgrades.game.select;
  assert.deepEqual(upgrades.game.deck,beforeUpgrades.game.deck,'upgrade scoring never upgrades the real deck');
  assert.deepEqual(full,beforeFull,'construction evaluation only reads public facts');
 }finally{CardProgram.prototype.initial=original;CardMachine.prototype.advanceExactProbability=advance;policyWork(policy)!.close();unwrap(await game.close());}
});
test('local combat utility values health, threat and turns while an unobserved slice remains incomplete',async()=>{
 const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition));
 const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true})),contract}));
 const events:StsEvent[]=[];unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
 const original=CardProgram.prototype.initial;
 let evidence:StsSearchResult|undefined;
 const policy=createSearchPolicy({character:'ironclad',schedulingMilliseconds:1,forkCurrent:source(game),onEvidence:r=>{evidence=r;}});
 try{
  const before=await request(game),visibleHistory=events.map(event=>({event})),d=publicDecision(before,visibleHistory),o=d.observation;
  // Pure public pruning fixtures; none replaces or advances a real Context.
  const duplicate=structuredClone(d),base={...o.battle!.hand[0]!,id:'STRIKE_RED',cost:1,costForTurn:1,upgraded:false};
  duplicate.observation.battle!.hand=[{...base,uniqueId:101},{...base,uniqueId:202},{...base,uniqueId:303}];
  duplicate.observation.battle!.costs={};
  duplicate.observation.battle!.monsters=[0,1].map(index=>({...o.battle!.monsters[0]!,index}));
  duplicate.actions=[0,1,2,65536,65537,65538,2147483648].map(bits=>({bits}));
  const untouched=structuredClone(duplicate),keys=(value:typeof duplicate)=>combatExclusions(value).map(row=>row.key);
  assert.deepEqual(keys(duplicate),['1','2','65537','65538'],'identical physical copies share a representative only for the same target');
  assert.deepEqual(exactCombatPosition(duplicate,o,0).localExclusions,combatExclusions(duplicate));
  assert.deepEqual(exactCombatPosition(duplicate,o,0).actions.map(a=>a.key),duplicate.actions.map(a=>String(a.bits)),'original legal actions are all retained');
  for(const patch of [{upgraded:true},{costForTurn:0},{retain:!base.retain},{specialData:base.specialData+1}]){
   const changed=structuredClone(duplicate);Object.assign(changed.observation.battle!.hand[1]!,patch);
   assert.deepEqual(keys(changed),['2','65538']);
  }
  const priced=structuredClone(duplicate);priced.observation.battle!.costs={'1':0};
  assert.deepEqual(keys(priced),['2','65537','65538'],'original per-action effective cost remains distinct');
  const other=structuredClone(duplicate);other.observation.battle!.hand.forEach(c=>{c.id='BASH';});assert.deepEqual(keys(other),[],'the heuristic is restricted to starter strike/defend');
  assert.deepEqual(duplicate,untouched);
  const exhaust=structuredClone(d);exhaust.observation.battle!.select={task:'EXHAUST_ONE',pickCount:1,canPickZero:false,canPickAnyNumber:false,
   candidates:['DISARM','SLIMED','WOUND','DOUBT'].map((id,index)=>({index,card:{...base,id,uniqueId:100+index}}))};
  exhaust.actions=[0,1,2,3].map(index=>({bits:1073741824+index}));
  const exhaustBefore=structuredClone(exhaust),expectedPreferences={'1073741825':1,'1073741826':1,'1073741827':1};
  assert.deepEqual(combatTiePreferences(exhaust),expectedPreferences);
  assert.deepEqual(exactCombatPosition(exhaust,o,0).localTiePreferences,expectedPreferences,'production exposes the public tie preference');
  assert.deepEqual(exactCombatPosition(exhaust,o,0).actions.map(a=>a.key),exhaust.actions.map(a=>String(a.bits)),'every original candidate remains available');
  assert.deepEqual(exhaust,exhaustBefore);
  exhaust.observation.battle!.select!.task='HEADBUTT';assert.deepEqual(combatTiePreferences(exhaust),{},'exhaust preference must not affect retrieval');
  const focus=structuredClone(duplicate);focus.observation.battle!.monsters=[37,17,39].map((hp,index)=>({...o.battle!.monsters[0]!,hp,maxHp:43,index}));
  focus.actions=[0,65536,131072].map(bits=>({bits}));
  const focusBefore=structuredClone(focus),focusPreferences=combatTiePreferences(focus);
  assert.ok(focusPreferences['65536']!>focusPreferences['0']!&&focusPreferences['65536']!>focusPreferences['131072']!,'equal-value targeted attacks prefer a wounded enemy');
  focus.actions.reverse();assert.deepEqual(combatTiePreferences(focus),focusPreferences,'target preference is independent of candidate ordering');
  focus.actions.reverse();assert.deepEqual(focus,focusBefore);
  assert.deepEqual(exactCombatPosition(focus,o,0).localTiePreferences,focusPreferences);
  assert.deepEqual(exactCombatPosition(focus,o,0).actions.map(a=>a.key),focus.actions.map(a=>String(a.bits)),'focus preference never removes an attack target');
  const nonattack=structuredClone(focus);nonattack.observation.battle!.hand[0]!.id='DISARM';
  nonattack.observation.battle!.intents=[];
  assert.deepEqual(combatTiePreferences(nonattack),{},'without exposed threat a defensive skill gains no attack-target preference');
  const setupOrder=structuredClone(d);setupOrder.observation.battle!.player.energy=3;
  setupOrder.observation.battle!.hand=[{...base,id:'STRIKE_RED'},{...base,id:'BASH',cost:2,costForTurn:2},{...base,id:'BATTLE_TRANCE',cost:0,costForTurn:0}];
  setupOrder.observation.battle!.costs={};setupOrder.observation.battle!.intents=[];setupOrder.actions=[0,1,2,2147483648].map(bits=>({bits}));
  const setupBefore=structuredClone(setupOrder),setupPreferences=combatTiePreferences(setupOrder);
  assert.ok(setupPreferences['2']!>setupPreferences['1']!&&setupPreferences['1']!>setupPreferences['0']!,'draw and vulnerability setup receive work before ordinary damage while follow-up energy remains');
  setupOrder.actions.reverse();assert.deepEqual(combatTiePreferences(setupOrder),setupPreferences);setupOrder.actions.reverse();assert.deepEqual(setupOrder,setupBefore);
  setupOrder.observation.battle!.player.energy=2;
  assert.equal(combatTiePreferences(setupOrder)['1'],combatTiePreferences(setupOrder)['0'],'Bash receives no setup bonus when no energy remains for another attack');
  setupOrder.observation.battle!.player.energy=0;
  assert.equal(combatTiePreferences(setupOrder)['2'],undefined,'zero-energy draw cannot claim productive follow-up energy');
  const strengthOrder=structuredClone(setupBefore);
  strengthOrder.observation.battle!.hand=[{...base,id:'ANGER',cost:0,costForTurn:0},{...base,id:'INFLAME'},{...base,id:'FLEX',cost:0,costForTurn:0}];
  const strengthBefore=structuredClone(strengthOrder),strengthPreferences=combatTiePreferences(strengthOrder);
  assert.ok(strengthPreferences['1']!>strengthPreferences['0']!&&strengthPreferences['2']!>strengthPreferences['0']!,'immediate strength setup is explored before spending the available attack');
  assert.deepEqual(strengthOrder,strengthBefore,'ordering reads only the public board');
  strengthOrder.observation.battle!.player.energy=1;
  assert.ok(combatTiePreferences(strengthOrder)['1']!>combatTiePreferences(strengthOrder)['0']!,'a zero-cost attack remains a follow-up after paying for Inflame');
  strengthOrder.observation.battle!.hand[0]!.costForTurn=1;
  assert.equal(combatTiePreferences(strengthOrder)['1'],undefined,'no immediate setup bonus without an affordable following attack');
  strengthOrder.observation.battle!.hand[0]!.id='DEFEND_RED';
  assert.equal(combatTiePreferences(strengthOrder)['2'],undefined,'defense alone does not justify strength preparation priority');
  assert.deepEqual(exactCombatPosition(strengthBefore,o,0).actions.map(a=>a.key),strengthBefore.actions.map(a=>String(a.bits)),'strength ordering retains every action');
  const coverOrder=structuredClone(setupBefore);coverOrder.observation.battle!.player.hp=15;
  coverOrder.observation.battle!.hand=[{...base,id:'STRIKE_RED'},{...base,id:'DISARM'},{...base,id:'DEFEND_RED'}];
  coverOrder.observation.battle!.intents=[{index:0,name:'public attack',attack:true,baseDamage:20,attackDamage:20,hits:1}];
  const coverPreferences=combatTiePreferences(coverOrder);
  assert.ok(coverPreferences['1']!>coverPreferences['2']!&&coverPreferences['2']!>coverPreferences['0']!,'urgent original intent orders defensive work before ordinary attacks');
  coverOrder.observation.battle!.player.block=20;assert.equal(combatTiePreferences(coverOrder)['1'],undefined,'covered threat no longer boosts defensive setup');
  const ability=structuredClone(o);ability.battle!.player.strength+=3;assert.ok(combatValue(ability,o)>combatValue(o,o));
  const danger=structuredClone(o);danger.battle!.intents=[{index:0,name:'fixture-public-intent',attack:true,baseDamage:20,attackDamage:20,hits:1}];
  const defended=structuredClone(danger);defended.battle!.player.block=10;assert.ok(combatValue(defended,o)>combatValue(danger,o));
  const quieter=structuredClone(danger);quieter.battle!.intents![0]!.attackDamage=5;
  assert.ok(combatValue(quieter,o)>combatValue(defended,o),'less uncovered original intent outranks more block facing a larger threat');
  const covered=structuredClone(quieter);covered.battle!.player.block=5;
  const peaceful=structuredClone(quieter);peaceful.battle!.intents=[];
  assert.equal(combatValue(covered,o),combatValue(peaceful,o),'fully covered intent cannot earn a bonus over the same state with no incoming attack');
  const excess=structuredClone(covered);excess.battle!.player.block=50;assert.equal(combatValue(excess,o),combatValue(covered,o));
  // Public scoring fixtures, never replacement Contexts or game transitions.
  const slimes=structuredClone(o);slimes.game.hp=68;slimes.game.maxHp=75;
  Object.assign(slimes.battle!.player,{hp:68,maxHp:75,energy:0,block:5});
  slimes.battle!.monsters=[{...slimes.battle!.monsters[0]!,hp:13,maxHp:13},{...slimes.battle!.monsters[0]!,hp:33,maxHp:33}];
  slimes.battle!.intents=[{index:0,name:'small',attack:true,baseDamage:6,attackDamage:6,hits:1},{index:1,name:'medium',attack:true,baseDamage:12,attackDamage:12,hits:1}];
  const split=structuredClone(slimes);split.battle!.monsters[0]!.hp=1;split.battle!.monsters[1]!.hp=27;
  const defeated=structuredClone(slimes);defeated.battle!.monsters[0]!.hp=0;defeated.battle!.intents!.shift();
  assert.ok(combatValue(defeated,slimes)>combatValue(split,slimes),'the observed slime positions must credit removal of the six-point original intent');
  // Public score comparisons only: no historical Context is restored, and
  // neither these synthetic observations nor their deltas execute game rules.
  const reserve=structuredClone(slimes);Object.assign(reserve.battle!.player,{hp:18,block:0});
  reserve.battle!.monsters=[28,28,56].map((hp,index)=>({...slimes.battle!.monsters[0]!,index,hp,maxHp:hp}));
  reserve.battle!.intents=[0,1].map(index=>({index,name:'public-threat',attack:true,baseDamage:10,attackDamage:7,hits:1}));
  const preserved=structuredClone(reserve);preserved.battle!.player.block=6;
  const chipped=structuredClone(reserve);chipped.battle!.monsters[0]!.hp-=9;
  const untouchedReserve=structuredClone(reserve);
  assert.ok(combatValue(preserved,reserve)>combatValue(chipped,reserve),'at 18 HP, covering 6 of 14 exposed attack outweighs nonlethal chip damage');
  const fullReserve=structuredClone(reserve);fullReserve.battle!.player.hp=75;
  const fullPreserved=structuredClone(fullReserve);fullPreserved.battle!.player.block=6;
  assert.ok(combatValue(preserved,reserve)-combatValue(reserve,reserve)>combatValue(fullPreserved,fullReserve)-combatValue(fullReserve,fullReserve),'the same cover has greater urgency when the remaining life reserve is smaller');
  const removedThreat=structuredClone(reserve);removedThreat.battle!.monsters[0]!.hp=0;removedThreat.battle!.intents!.shift();
  assert.ok(combatValue(removedThreat,reserve)>combatValue(preserved,reserve),'actual attacker removal still beats covering less of its threat');
  assert.deepEqual(reserve,untouchedReserve);
  const focusBase=structuredClone(o);focusBase.battle!.intents=[];
  focusBase.battle!.monsters=[21,45,45].map((hp,index)=>({...o.battle!.monsters[0]!,index,hp,maxHp:45}));
  const concentrated=structuredClone(focusBase);concentrated.battle!.monsters[0]!.hp-=10;
  const scattered=structuredClone(focusBase);scattered.battle!.monsters[2]!.hp-=10;
  assert.ok(combatValue(concentrated,focusBase)>combatValue(scattered,focusBase),'equal nonlethal damage favors approaching a kill instead of spreading damage');
  const reversed=structuredClone(concentrated);reversed.battle!.monsters.reverse();
  assert.equal(combatValue(reversed,focusBase),combatValue(concentrated,focusBase),'focus value does not depend on target order');
  const finishedTarget=structuredClone(concentrated);finishedTarget.battle!.monsters[0]!.hp=0;
  assert.ok(combatValue(finishedTarget,focusBase)>combatValue(concentrated,focusBase),'further original HP reduction and a kill both improve the board');
  const fatalFocus=structuredClone(finishedTarget);fatalFocus.battle!.player.hp=0;
  assert.equal(combatValue(fatalFocus,focusBase),-1,'concentration cannot outweigh actual death');
  const hit=structuredClone(o);hit.battle!.monsters[0]!.hp-=6;hit.battle!.monsters[0]!.strength+=2;assert.ok(combatValue(hit,o)>combatValue(o,o),'damage progress is not erased by a small enemy strength gain');
  const scalingThreat=structuredClone(o);scalingThreat.battle!.player.hp=44;scalingThreat.battle!.player.block=7;
  scalingThreat.battle!.monsters=[{...o.battle!.monsters[0]!,hp:78,maxHp:109,strength:3}];
  scalingThreat.battle!.intents=[{index:0,name:'original-public-attack',attack:true,baseDamage:16,attackDamage:19,hits:1}];
  const scalingCovered=structuredClone(scalingThreat);scalingCovered.battle!.player.block=12;
  scalingCovered.battle!.monsters[0]!.strength=6;scalingCovered.battle!.intents![0]!.attackDamage=22;
  assert.ok(combatValue(scalingCovered,scalingThreat)<combatValue(scalingThreat,scalingThreat),'saving only two points of current exposure cannot hide three permanent enemy strength');
  const normalCover=structuredClone(scalingThreat);normalCover.battle!.player.block=12;
  assert.ok(combatValue(normalCover,scalingThreat)>combatValue(scalingThreat,scalingThreat),'ordinary cover still improves the board');
  const urgent=structuredClone(scalingThreat);urgent.battle!.player.hp=11;urgent.battle!.player.block=0;urgent.battle!.intents![0]!.attackDamage=12;
  const urgentCover=structuredClone(urgent);urgentCover.battle!.player.block=5;urgentCover.battle!.intents![0]!.attackDamage=15;urgentCover.battle!.monsters[0]!.strength+=3;
  assert.ok(combatValue(urgentCover,scalingThreat)>combatValue(urgent,scalingThreat),'avoiding an immediate lethal exposure still outweighs the scaling penalty');
  const shielded=structuredClone(o);shielded.battle!.monsters[0]!.block+=20;
  assert.equal(combatValue(shielded,o),combatValue(o,o),'temporary enemy block is not counted as permanent health or damage progress');
  // Public score counterexample observed at a boss phase transition. The
  // original executor, not this scoring fixture, decides when phases change.
  const phaseBefore=structuredClone(o);phaseBefore.battle!.monsters[0]!.maxHp=250;phaseBefore.battle!.monsters[0]!.hp=141;
  phaseBefore.battle!.monsters[0]!.block=0;phaseBefore.battle!.intents=[];phaseBefore.battle!.player.energy=1;
  phaseBefore.battle!.hand=phaseBefore.battle!.hand.slice(0,1);phaseBefore.battle!.hand[0]!.costForTurn=1;
  const phaseAfter=structuredClone(phaseBefore);phaseAfter.battle!.monsters[0]!.hp=135;phaseAfter.battle!.monsters[0]!.block=20;
  phaseAfter.battle!.player.energy=0;phaseAfter.battle!.hand=[];
  assert.ok(combatValue(phaseAfter,phaseBefore)>combatValue(phaseBefore,phaseBefore),'real HP progress is not rejected just because a phase transition grants temporary block');
  const routed=structuredClone(o);routed.game.floor+=1;routed.game.keys.red=true;assert.equal(combatValue(routed,o),combatValue(o,o));
  const boundary=structuredClone(o);boundary.battle!.turn++;
  assert.ok(combatValue(boundary,o)<combatValue(o,o),'an otherwise identical later turn must lose value');
  const lessHealth=structuredClone(o);lessHealth.battle!.player.hp-=1;assert.ok(combatValue(o,o)>combatValue(lessHealth,o));
  const lethal=structuredClone(o);lethal.battle!.player.hp=10;lethal.battle!.intents=[{index:0,name:'danger',attack:true,baseDamage:10,attackDamage:10,hits:1}];
  const mitigated=structuredClone(lethal);mitigated.battle!.player.block=10;assert.ok(combatValue(mitigated,o)>combatValue(lethal,o),'public lethal exposure lowers the heuristic without claiming a settlement proof');
  const earlyExit=structuredClone(d);earlyExit.observation.battle=null;
  const lateExit=structuredClone(earlyExit);lateExit.observation.history.push({kind:'battle',bits:2147483648});
  assert.ok(exactCombatPosition(earlyExit,o,0).priority>exactCombatPosition(lateExit,o,0).priority,'terminal board preference also penalizes an extra elapsed turn');
  const refreshed=structuredClone(boundary);refreshed.battle!.player.energy+=3;refreshed.battle!.hand.push(...structuredClone(o.battle!.hand));assert.equal(combatValue(refreshed,o),combatValue(boundary,o),'new turn resources cannot reward waiting');
  const unused=structuredClone(o);unused.battle!.player.energy=0;unused.game.potions=[potionId.ENERGY_POTION];
  unused.battle!.hand=unused.battle!.hand.slice(0,1);unused.battle!.hand[0]!.costForTurn=1;
  const drank=structuredClone(unused);drank.battle!.player.energy=2;drank.game.potions=[potionId.EMPTY_POTION_SLOT];
  assert.ok(combatPriority(drank,unused)>combatPriority(unused,unused),'newly playable resources still prioritize continuation work');
  assert.ok(combatValue(drank,unused)<combatValue(unused,unused),'unused potion energy is not realized combat value');
  const setup=structuredClone(unused);setup.battle!.player.hp-=6;setup.battle!.player.energy=2;
  setup.battle!.hand.push(...structuredClone(setup.battle!.hand),...structuredClone(setup.battle!.hand));
  assert.ok(combatValue(setup,unused)<combatValue(unused,unused),'paying health for unused resources is still a board cost');
  assert.ok(combatPriority(setup,unused)>combatPriority(unused,unused),'same-turn resource setup receives work to reveal original follow-up plays despite its immediate HP cost');
  const abundant=structuredClone(setup);abundant.battle!.player.energy=6;
  const excessive=structuredClone(abundant);excessive.battle!.player.energy=100;
  assert.equal(combatPriority(abundant,unused),combatPriority(excessive,unused),'energy work preference saturates instead of escalating without bound');
  for(const [stat,expiry,potion] of [['strength',PS.LOSE_STRENGTH,potionId.FLEX_POTION],['dexterity',PS.LOSE_DEXTERITY,potionId.SPEED_POTION]] as const){
    const held=structuredClone(unused);held.game.potions=[potion];
    const temporary=structuredClone(held);temporary.game.potions=[potionId.EMPTY_POTION_SLOT];temporary.battle!.player[stat]+=5;
    temporary.battle!.player.statusBits0=(BigInt(temporary.battle!.player.statusBits0)|(1n<<BigInt(expiry))).toString();
    temporary.battle!.player.statuses.push([expiry,5]);
    assert.ok(combatValue(temporary,held)<combatValue(held,held),'unused expiring stats cannot compensate for consuming a potion');
    const retained=structuredClone(temporary);retained.battle!.player.statusBits0=(BigInt(retained.battle!.player.statusBits0)&~(1n<<BigInt(expiry))).toString();
    assert.ok(combatValue(retained,held)>combatValue(held,held),'an inactive expiry counter does not discount retained stats');
    const realized=structuredClone(temporary);realized.battle!.monsters[0]!.hp-=6;
    assert.ok(combatValue(realized,held)>combatValue(temporary,held),'original realized damage still earns value with expiring stats');
  }
  const scoring={...d,actions:[{bits:2147483648}]};
  const unusedPosition=exactCombatPosition({...scoring,observation:unused},unused,0),drankPosition=exactCombatPosition({...scoring,observation:drank},unused,0);
  assert.ok(drankPosition.priority>unusedPosition.priority);
  assert.ok(drankPosition.utility!<unusedPosition.utility!,'production exposes a distinct action utility, not its sorting bonus');
  assert.equal(drankPosition.utility,(combatValue(drank,unused)+1)/2);
  const power=structuredClone(o);power.battle!.player.statusBits0=(BigInt(power.battle!.player.statusBits0)|(1n<<BigInt(PS.DARK_EMBRACE))).toString();power.battle!.player.statuses.push([PS.DARK_EMBRACE,1]);assert.ok(combatValue(power,o)>combatValue(o,o),'use the original status identity regardless of presentation language');
  // Score an installed original power against publicly known clutter. These
  // observations test preferences only and never become execution Contexts.
  const clogged=structuredClone(o);clogged.battle!.draw=[];clogged.battle!.hand=[];
  clogged.battle!.discard=Array.from({length:6},(_,i)=>({...base,id:'DAZED',uniqueId:400+i}));
  const evolved=structuredClone(clogged);evolved.battle!.player.statusBits0=(BigInt(evolved.battle!.player.statusBits0)|(1n<<BigInt(PS.EVOLVE))).toString();
  evolved.battle!.player.statuses.push([PS.EVOLVE,1]);evolved.battle!.player.energy--;
  const originalClogged=structuredClone(clogged),originalEvolved=structuredClone(evolved);
  assert.ok(combatValue(evolved,clogged)>combatValue(clogged,clogged),'installed Evolve has value before its original status-draw reaction fires');
  assert.ok(exactCombatPosition({...scoring,observation:evolved},clogged,0).utility!>exactCombatPosition({...scoring,observation:clogged},clogged,0).utility!,'the production local utility includes status-flow value');
  const reordered=structuredClone(evolved);reordered.battle!.discard.reverse();
  assert.equal(combatValue(reordered,clogged),combatValue(evolved,clogged),'the preference uses no future card order');
  const cursed=structuredClone(evolved);cursed.battle!.discard.forEach(card=>{card.id='DOUBT';});
  const curseBase=structuredClone(clogged);curseBase.battle!.discard=structuredClone(cursed.battle!.discard);
  assert.equal(combatValue(cursed,clogged),combatValue(curseBase,clogged),'curses cannot stand in for status cards');
  const spent=structuredClone(evolved);spent.battle!.exhaust=spent.battle!.discard;spent.battle!.discard=[];
  assert.equal(combatValue(spent,clogged),combatValue(curseBase,clogged),'already exhausted clutter cannot justify Evolve setup');
  const stacked=structuredClone(evolved);stacked.battle!.player.statuses.find(row=>row[0]===PS.EVOLVE)![1]=2;
  assert.ok(combatValue(stacked,clogged)>combatValue(evolved,clogged));
  const overstacked=structuredClone(stacked);overstacked.battle!.player.statuses.find(row=>row[0]===PS.EVOLVE)![1]=100;
  assert.equal(combatValue(overstacked,clogged),combatValue(stacked,clogged),'setup preference saturates rather than rewarding endless stacking');
  const deadSetup=structuredClone(evolved);deadSetup.battle!.player.hp=0;assert.equal(combatValue(deadSetup,clogged),-1);
  assert.deepEqual(clogged,originalClogged);assert.deepEqual(evolved,originalEvolved);
  const nextTurn=structuredClone(d);nextTurn.observation.battle!.turn+=1000;assert.equal(exactCombatPosition(nextTurn,o,0).terminal,null,'even a distant turn is not the end of the current combat');
  const stronger={...d,observation:ability};assert.equal(exactCombatPosition(stronger,o,0).terminal,null,'heuristic gains never become terminal rewards');
  const exit=structuredClone(d);exit.observation.battle=null;assert.notEqual(exactCombatPosition(exit,o,0).terminal,null);
  CardProgram.prototype.initial=()=>{throw Error('No reinitialization');};
  const proposal=await policy.decide({request:before,visibleHistory,random,memory:{},signal});
  const progress=evidence!.evidence as {status:string;steps:string;pendingEdges:number;searchComplete:boolean;actions:{key:string;observedSuccessorMass:{numerator:string}}[]};
  assert.deepEqual(evidence!.action,proposal.action);assert.equal(progress.status,'estimated-action');assert.equal(progress.searchComplete,false);
  const selected=progress.actions.find(row=>row.key===String((proposal.action as {bits:number}).bits))!;
  assert.ok(BigInt(selected.observedSuccessorMass.numerator)>0n);assert.ok(BigInt(progress.steps)>0n);assert.ok(progress.pendingEdges>0);assert.deepEqual(await request(game),before);
  const work=policyWork(policy)!.save() as {entries:{search:{queue:unknown[];steps:bigint}}[]};
  assert.equal(work.entries.length,1);assert.ok(work.entries[0]!.search.queue.length>0);assert.equal(work.entries[0]!.search.steps,BigInt(progress.steps));
 }finally{CardProgram.prototype.initial=original;policyWork(policy)!.close();unwrap(await game.close());}
});
