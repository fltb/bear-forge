import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {SearchSession} from '../src/search/session.ts';
import type {ExactDomain,ExactExpansion,ExactPosition} from '../src/search/session.types.ts';
import {addMass,compareMass,multiplyMass,unitMass,zeroMass,probabilityMass,type ProbabilityMass} from '../../card-engine/src/probability-mass.ts';

type Current={state:string;identity:number};
type ExpansionState={source:Current;action:string;cursor:number;delivered:ProbabilityMass;ready:{current:Current;mass:ProbabilityMass}[]};
type Node={information?:string;reward?:ProbabilityMass;priority?:number;actions?:Record<string,{state:string;mass:ProbabilityMass}[]>};
function fixture(nodes:Record<string,Node>,reuse=false){
  let serial=1;const executions=new Map<string,number>(),closed=new Set<number>();
  function expansion(saved:ExpansionState):ExactExpansion<Current,ExpansionState>{
    const state=structuredClone(saved),choices=nodes[state.source.state]!.actions![state.action]!;
    return{get complete(){return state.cursor===choices.length;},get delivered(){return state.delivered;},
      step(){
        if(state.cursor===choices.length)return false;
        const choice=choices[state.cursor]!,key=state.source.identity+':'+state.action+':'+state.cursor;
        executions.set(key,(executions.get(key)??0)+1);state.cursor++;
        state.ready.push({current:{state:choice.state,identity:serial++},mass:choice.mass});return true;
      },
      take(){const row=state.ready.shift();if(row)state.delivered=addMass(state.delivered,row.mass);return row;},
      save:()=>structuredClone(state),close(){for(const row of state.ready)closed.add(row.current.identity);state.ready=[];},
    };
  }
  const domain:ExactDomain<Current,Current,ExpansionState>={upper:[unitMass()],
    // In this finite fixture state names select the complete transition law;
    // identity is only an external ownership/execution-count instrument.
    ...(reuse?{equivalent:(left:Current,right:Current)=>left.state===right.state}:{}),
    position(current):ExactPosition{const row=nodes[current.state]!;return{information:row.information??current.state,priority:row.priority??0,
      terminal:row.reward?[row.reward]:null,actions:Object.keys(row.actions??{}).map(key=>({key,action:key}))};},
    next:(source,action)=>expansion({source,action,cursor:0,delivered:zeroMass(),ready:[]}),
    save:current=>({...current}),restore:current=>({...current}),restoreExpansion:expansion,close:current=>{closed.add(current.identity);},
  };
  return{domain,root:{state:'root',identity:0},executions,closed};
}
const one=(state:string)=>[{state,mass:unitMass()}];
test('preferred setup continues through completed public successors with local action ordering',()=>{
 const f=fixture({root:{priority:.5,actions:{setup:one('ready'),other:one('loss')}},
  ready:{priority:.4,actions:{waste:one('loss'),follow:one('win')}},loss:{reward:zeroMass()},win:{reward:unitMass()}});
 const position=f.domain.position;f.domain.position=current=>({...position(current),...(current.state==='ready'?{localTiePreferences:{follow:2}}:{})});
 const session=SearchSession.from(f.domain,f.root,'local');
 try{
  session.stepLocal('setup');session.stepLocal('setup'); // Deliver, then close the completed root law.
  session.stepLocal('setup'); // Cover the other original root action first.
  assert.equal(f.executions.get('0:other:0'),1);assert.equal(f.executions.has('1:follow:0'),false);
  session.stepLocal('setup'); // Continue the already-published successor.
  assert.equal(f.executions.get('0:setup:0'),1);assert.equal(f.executions.get('1:follow:0'),1);
  assert.equal(f.executions.has('1:waste:0'),false);assert.equal(f.executions.get('0:other:0'),1);
  assert.equal(session.localEvidence(p=>p.terminal?Number(p.terminal[0]!.numerator):p.priority).action!.key,'setup');
  assert.ok(session.save().queue.some(task=>task.action==='waste'),'unserved original support remains retained');
 }finally{session.close();}
});
for(const cold of [false,true])test(`preferred public combo progresses alongside an indefinitely pending root alternative; cold=${cold}`,()=>{
 const f=fixture({root:{priority:.5,actions:{setup:one('ready'),pending:one('loss')}},
  ready:{priority:.4,actions:{follow:one('win')}},loss:{reward:zeroMass()},win:{reward:unitMass()}});
 const next=f.domain.next,restore=f.domain.restoreExpansion;let pendingTicks=0;
 const wrap=(inner:ExactExpansion<Current,ExpansionState>,action:string):ExactExpansion<Current,ExpansionState>=>action!=='pending'?inner:{
  get complete(){return false;},get delivered(){return zeroMass();},step(){pendingTicks++;return true;},
  take(){return undefined;},save:()=>inner.save(),close:()=>inner.close()};
 f.domain.next=(current,action)=>wrap(next(current,action),action);
 f.domain.restoreExpansion=saved=>wrap(restore(saved),saved.action);
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  for(let i=0;i<3;i++)session.stepLocal('setup');
  if(cold){const saved=deserialize(serialize(session.save())),calls=[...f.executions];session.close();
   session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual([...f.executions],calls);}
  for(let i=0;i<8;i++)session.stepLocal('setup');
  const evidence=session.localEvidence(p=>p.terminal?Number(p.terminal[0]!.numerator):p.priority);
  assert.equal(evidence.action!.key,'setup');
  assert.deepEqual(evidence.actions.find(row=>row.key==='setup')!.estimate,unitMass(),'the combo is backed up before any FIFO visit');
  assert.deepEqual(evidence.actions.find(row=>row.key==='pending')!.unresolved,unitMass());
  assert.ok(pendingTicks>1,'root coverage progresses alongside the combo');
  assert.equal(f.executions.get('1:follow:0'),1);assert.ok([...f.executions.values()].every(n=>n===1));
 }finally{session.close();}
});
for(const cold of [false,true])test(`a finished alternative root opens its combo while the favorite continuation waits; cold=${cold}`,()=>{
 const f=fixture({root:{priority:.5,actions:{favorite:one('waiting'),alternative:one('ready')}},
  waiting:{priority:.6,actions:{pending:one('loss')}},ready:{priority:.4,actions:{follow:one('win')}},
  loss:{reward:zeroMass()},win:{reward:unitMass()}});
 const next=f.domain.next,restore=f.domain.restoreExpansion;let pendingTicks=0;
 const wrap=(inner:ExactExpansion<Current,ExpansionState>,action:string):ExactExpansion<Current,ExpansionState>=>action!=='pending'?inner:{
  get complete(){return false;},get delivered(){return zeroMass();},step(){pendingTicks++;return true;},
  take(){return undefined;},save:()=>inner.save(),close:()=>inner.close()};
 f.domain.next=(current,action)=>wrap(next(current,action),action);
 f.domain.restoreExpansion=saved=>wrap(restore(saved),saved.action);
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  for(let i=0;i<4;i++)session.stepLocal('favorite');
  if(cold){const saved=deserialize(serialize(session.save())),calls=[...f.executions];session.close();
   session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual([...f.executions],calls);}
  for(let i=0;i<12;i++)session.stepLocal('favorite');
  const evidence=session.localEvidence(p=>p.terminal?Number(p.terminal[0]!.numerator):p.priority);
  assert.equal(evidence.action!.key,'alternative');
  assert.equal(evidence.actions.find(row=>row.key==='alternative')!.distributionComplete,true);
  assert.deepEqual(evidence.actions.find(row=>row.key==='alternative')!.estimate,unitMass());
  assert.deepEqual(evidence.actions.find(row=>row.key==='favorite')!.frontier,unitMass());
  const pending=session.save().executions.find(row=>row.current.state==='waiting')!.edges.find(row=>row.action==='pending')!;
  assert.equal(pending.complete,false);assert.deepEqual(pending.outcomes,[]);assert.deepEqual(pending.expansion!.delivered,zeroMass());
  assert.ok(pendingTicks>1);assert.equal(f.executions.get('0:alternative:0'),1);
  assert.ok([...f.executions.keys()].some(key=>key.includes(':follow:')));assert.ok([...f.executions.values()].every(n=>n===1));
 }finally{session.close();}
});
for(const cold of [false,true])test(`a newly demanded unseen root takes priority over a published sibling continuation; cold=${cold}`,()=>{
 const f=fixture({root:{priority:.5,actions:{known:one('ready'),pending:one('win')}},
  ready:{priority:.5,actions:{follow:one('win')}},win:{reward:unitMass()}});
 const next=f.domain.next,restore=f.domain.restoreExpansion;let ticks=0;
 const wrap=(inner:ExactExpansion<Current,ExpansionState>,action:string):ExactExpansion<Current,ExpansionState>=>action!=='pending'?inner:{
  get complete(){return false;},get delivered(){return zeroMass();},step(){ticks++;return true;},
  take(){return undefined;},save:()=>inner.save(),close:()=>inner.close()};
 f.domain.next=(current,action)=>wrap(next(current,action),action);f.domain.restoreExpansion=saved=>wrap(restore(saved),saved.action);
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  session.stepLocal('known');session.stepLocal('known');
  if(cold){const saved=deserialize(serialize(session.save())),calls=[...f.executions];session.close();
   session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual([...f.executions],calls);}
  for(let i=0;i<32;i++)session.stepLocal('pending');
  assert.ok(ticks>=30,'only the independent FIFO service may interrupt the explicitly awaited first successor');
  assert.equal(f.executions.get('0:known:0'),1);assert.equal(f.executions.get('1:follow:0'),1,'FIFO still advances the published sibling');
  assert.deepEqual(session.localEvidence(p=>p.terminal?1:p.priority).actions.find(row=>row.key==='pending')!.unresolved,unitMass());
 }finally{session.close();}
});

test('demanding an unseen root edge retains FIFO service and never repeats an original transition',()=>{
 const f=fixture({root:{priority:.8,actions:{useful:one('win'),pending:one('win'),...Object.fromEntries(Array.from({length:64},(_,i)=>['other'+i,one('win')]))}},win:{reward:unitMass()}});
 const next=f.domain.next;let ticks=0;
 f.domain.next=(current,action)=>{
  const inner=next(current,action);if(action!=='pending')return inner;
  return{get complete(){return false;},get delivered(){return zeroMass();},step(){ticks++;return true;},
   take(){return undefined;},save:()=>inner.save(),close:()=>inner.close()};
 };
 const session=SearchSession.from(f.domain,f.root,'local');
 try{
  session.stepLocal('pending');assert.equal(ticks,1);assert.equal(f.executions.size,0,'the demanded edge receives the first visit');
  for(let i=1;i<64;i++)assert.equal(session.stepLocal('pending'),true);
  assert.ok(ticks>=60);assert.equal(f.executions.get('0:useful:0'),1,'FIFO reaches the other action despite an indefinitely pending preferred edge');
  const evidence=session.localEvidence(p=>p.terminal?1:p.priority);assert.equal(evidence.action!.key,'useful');
  assert.deepEqual(evidence.actions.find(row=>row.key==='pending')!.unresolved,unitMass());
 }finally{session.close();}
});
for(const cold of [false,true])test(`local heuristic exclusions retain dormant laws without executing or selecting them; cold=${cold}`,()=>{
 const f=fixture({root:{priority:.5,actions:{keep:one('child'),duplicate:one('best')}},
  child:{priority:.5,actions:{finish:one('good'),duplicate:one('good')}},
  good:{priority:.6,reward:probabilityMass(3n,5n)},best:{priority:1,reward:unitMass()}});
 const position=f.domain.position;
 f.domain.position=current=>({...position(current),localExclusions:['root','child'].includes(current.state)?[{key:'duplicate',reason:'fixture-public-heuristic'}]:[]});
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  assert.equal(session.stepLocal(),true);
  if(cold){const saved=session.save(),calls=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual([...f.executions],calls);}
  let steps=0;while(session.stepLocal())assert.ok(++steps<20);
  assert.ok([...f.executions.keys()].every(key=>!key.includes(':duplicate:')));
  const evidence=session.localEvidence(p=>p.priority),duplicate=evidence.actions.find(row=>row.key==='duplicate')!;
  assert.equal(evidence.action!.key,'keep');assert.equal(evidence.searchComplete,false);
  assert.deepEqual(duplicate.unresolved,unitMass());assert.deepEqual(duplicate.upper,unitMass());
  assert.deepEqual(evidence.heuristicExclusions,[{key:'duplicate',reason:'fixture-public-heuristic'}]);
  const saved=session.save();assert.equal(saved.queue.filter(row=>row.action==='duplicate').length,2);
  assert.equal(session.evidence().status,'incomplete','heuristic exhaustion cannot certify exact optimality');
  while(session.step())assert.ok(++steps<50);
  assert.ok([...f.executions.keys()].some(key=>key.includes(':duplicate:')),'exact scheduling can still execute the intact original law');
  assert.equal(session.evidence().action!.key,'duplicate');assert.ok([...f.executions.values()].every(count=>count===1));
 }finally{session.close();}

});

for(const cold of [false,true])test(`local utility is independent of work priority and survives direct restoration; cold=${cold}`,()=>{
 const f=fixture({root:{actions:{resource:one('unspent'),useful:one('progress')}},
  unspent:{priority:100,actions:{wait:one('unspent')}},progress:{priority:0,actions:{wait:one('progress')}}},true);
 const position=f.domain.position;
 f.domain.position=current=>({...position(current),utility:current.state==='unspent'?.2:current.state==='progress'?.8:.5});
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  for(let i=0;i<8;i++)session.stepLocal();
  if(cold){const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved,'local');}
  const before=[...f.executions],evidence=session.localEvidence(p=>p.utility!);
  assert.equal(evidence.action!.key,'useful');assert.deepEqual([...f.executions],before);
  assert.ok(evidence.actions.every(a=>compareMass(a.lower,a.estimate)<=0&&compareMass(a.estimate,a.upper)<=0));
 }finally{session.close();}

});

for(const cold of [false,true])test(`local root groups follow a low-score setup beyond a wide high-score sibling; cold=${cold}`,()=>{
 const nodes:Record<string,Node>={root:{priority:.1,actions:{setup:one('first'),defend:one('wide'),unknown:one('wide')}},
  first:{priority:.2,actions:{continue:one('second')}},second:{priority:.15,actions:{finish:one('win')}},
  wide:{priority:.9,actions:{}},win:{priority:1,reward:unitMass()}};
 for(let i=0;i<1000;i++)nodes.wide!.actions!['wait'+i]=one('wide');
 const f=fixture(nodes,true),next=f.domain.next,restore=f.domain.restoreExpansion;
 type Delayed=ExpansionState&{ticks?:number};
 const wrap=(inner:ExactExpansion<Current,ExpansionState>,saved:Delayed):ExactExpansion<Current,ExpansionState>=>{
  let ticks=saved.ticks??0;const infinite=saved.source.state==='wide'||saved.action==='unknown';
  return{get complete(){return !infinite&&inner.complete;},get delivered(){return inner.delivered;},
   step(){ticks++;return infinite?true:inner.step();},take:()=>inner.take(),save:()=>({...inner.save(),ticks}),close:()=>inner.close()};
 };
 f.domain.next=(current,action)=>{const inner=next(current,action);return wrap(inner,inner.save());};f.domain.restoreExpansion=saved=>wrap(restore(saved),saved);
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  for(let i=0;i<160;i++){
   assert.equal(session.stepLocal(),true);
   if(cold&&i%7===0){const saved=session.save(),calls=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual(session.save(),saved);assert.deepEqual([...f.executions],calls);}
  }
  const saved=session.save();assert.ok(saved.executions.some(e=>e.current.state==='win'),'the low-score setup receives continuation work');
  assert.equal(session.localEvidence(p=>p.priority).action!.key,'setup');
  assert.ok(saved.queue.some(task=>task.belief===0&&task.action==='unknown'));
  assert.ok(saved.executions.find(e=>e.current.state==='wide')!.edges.some(e=>(e.expansion as Delayed)?.ticks!>0));
  assert.ok([...f.executions.values()].every(count=>count===1));
 }finally{session.close();}
});
for(const cold of [false,true])for(const blockedHead of [false,true])test(`local groups finish slow continuations while FIFO services siblings behind an infinite head; cold=${cold}, blocked=${blockedHead}`,()=>{
 const setup:NonNullable<Node['actions']>={};if(blockedHead)setup.blocked=one('wide');setup.finish=one('win');
 for(let i=0;i<40;i++)setup['other'+i]=one('loss');
 const nodes:Record<string,Node>={root:{priority:.1,actions:{setup:one('setup'),wide:one('wide'),unknown:one('wide')}},
  setup:{priority:.2,actions:setup},wide:{priority:.9,actions:{}},win:{priority:1,reward:unitMass()},loss:{priority:0,reward:zeroMass()}};
 for(let i=0;i<40;i++)nodes.wide!.actions!['wait'+i]=one('wide');
 const f=fixture(nodes,true),next=f.domain.next,restore=f.domain.restoreExpansion;
 type Delayed=ExpansionState&{ticks?:number};
 const wrap=(inner:ExactExpansion<Current,ExpansionState>,saved:Delayed):ExactExpansion<Current,ExpansionState>=>{
  let ticks=saved.ticks??0;
  const infinite=saved.source.state==='wide'||saved.action==='unknown'||saved.action==='blocked';
  return{get complete(){return !infinite&&inner.complete;},get delivered(){return inner.delivered;},
   step(){ticks++;if(infinite||!blockedHead&&saved.source.state==='setup'&&ticks%80!==0)return true;return inner.step();},
   take:()=>inner.take(),save:()=>({...inner.save(),ticks}),close:()=>inner.close()};
 };
 f.domain.next=(current,action)=>{const inner=next(current,action);return wrap(inner,inner.save());};f.domain.restoreExpansion=saved=>wrap(restore(saved),saved);
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  // A finite measurement window for this scheduling fixture, not a search
  // horizon, probability cutoff, or rule permitting a production fallback.
  for(let i=0;i<(blockedHead?3500:1600);i++){
   assert.equal(session.stepLocal(),true);
   if(cold&&i%97===0){const saved=session.save(),calls=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual(session.save(),saved);assert.deepEqual([...f.executions],calls);}
  }
  const saved=session.save();assert.ok(saved.executions.some(row=>row.current.state==='win'),blockedHead?'global FIFO must pass an unfinished group head':'local group service must finish a slow follow-up instead of spreading all work over its siblings');
  assert.equal(session.localEvidence(p=>p.priority).action!.key,'setup');
  assert.ok(saved.queue.some(task=>task.belief===0&&task.action==='unknown'),'unresolved support remains scheduled');
  assert.ok(saved.executions.some(row=>row.current.state==='wide'&&row.edges.some(edge=>(edge.expansion as Delayed)?.ticks!>0)),'other root groups still progress');
  assert.ok([...f.executions.values()].every(count=>count===1),'cold scheduling never repeats a committed edge');
 }finally{session.close();}
});

for(const cold of [false,true])test(`local root probability completion precedes deeper high-score distractions; cold=${cold}`,()=>{
 const nodes:Record<string,Node>={root:{priority:.1,actions:{hit:Array.from({length:27},()=>({state:'hit',mass:probabilityMass(1n,27n)})),plain:one('plain'),unknown:one('later')}},
  hit:{priority:.8,actions:{wait:one('hit')}},plain:{priority:.95,actions:{}},later:{priority:.2,actions:{wait:one('later')}}};
 for(let i=0;i<40;i++)nodes.plain!.actions!['wait'+i]=one('plain');
 const f=fixture(nodes,true),next=f.domain.next,restore=f.domain.restoreExpansion;
 type Delayed=ExpansionState&{ticks?:number};
 const wrap=(inner:ExactExpansion<Current,ExpansionState>,saved:Delayed):ExactExpansion<Current,ExpansionState>=>{
  let ticks=saved.ticks??0;
  const infinite=saved.source.state!=='root'||saved.action==='unknown';
  return{get complete(){return !infinite&&inner.complete;},get delivered(){return inner.delivered;},
   step(){ticks++;if(infinite||saved.action==='hit'&&ticks%8!==0)return true;return inner.step();},
   take:()=>inner.take(),save:()=>({...inner.save(),ticks}),close:()=>inner.close()};
 };
 f.domain.next=(current,action)=>{const inner=next(current,action);return wrap(inner,inner.save());};
 f.domain.restoreExpansion=saved=>wrap(restore(saved),saved);
 let session=SearchSession.from(f.domain,f.root,'local');
 try{
  // This window measures scheduler service, never limits the retained law.
  for(let i=0;i<600;i++){
   assert.equal(session.stepLocal(),true);
   if(cold&&i%19===0){const saved=session.save(),calls=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved,'local');assert.deepEqual([...f.executions],calls);assert.deepEqual(session.save(),saved);}
  }
  const saved=session.save(),hit=saved.beliefs[0]!.edges.find(e=>e.action==='hit')!;
  assert.equal(hit.published,true,'all 27 current outcomes receive service despite higher-score descendants');
  assert.deepEqual(hit.outcomes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());
  const unknown=saved.executions[0]!.edges.find(e=>e.action==='unknown')!;
  assert.ok((unknown.expansion as Delayed).ticks!>0,'an unseen infinite sibling still receives fair service');
  assert.equal(unknown.complete,false);assert.ok(saved.queue.some(t=>t.belief===0&&t.action==='unknown'));
  assert.ok(saved.executions.some(e=>e.current.state==='plain'&&e.edges.some(edge=>(edge.expansion as Delayed)?.ticks!>0)),'descendants retain FIFO service');
  assert.ok([...f.executions.values()].every(count=>count===1));
 }finally{session.close();}
});
test('local evidence reads retained currents without executing, renormalizing, or changing cold-resumable work',()=>{
 const f=fixture({root:{actions:{play:one('board'),die:one('dead')}},board:{priority:.8,actions:{continue:one('later')}},later:{reward:unitMass()},dead:{reward:zeroMass()}});
 let session=SearchSession.from(f.domain,f.root);
 try{
  assert.equal(session.stepLocal(),true);const saved=session.save(),calls=[...f.executions];
  const evaluate=(p:ExactPosition)=>p.terminal?(p.terminal[0]!.numerator===0n?0:1):p.priority;
  const live=session.localEvidence(evaluate);assert.equal(live.action!.key,'play');assert.equal(live.searchComplete,false);assert.ok(live.pendingEdges>0);
  assert.deepEqual(session.save(),saved);assert.deepEqual([...f.executions],calls);
  live.action!.key='mutated';assert.equal(session.localEvidence(evaluate).action!.key,'play');
  session.close();f.domain.next=()=>{throw Error('Local restore must not execute an edge');};
  session=SearchSession.restore(f.domain,saved);
  assert.deepEqual(session.localEvidence(evaluate).actions,live.actions);assert.deepEqual(session.save(),saved);assert.deepEqual([...f.executions],calls);
 }finally{session.close();}
});
test('an existing exact frontier migrates to local scheduling without solving its terminal proof or replaying work',()=>{
 const f=fixture({root:{actions:{a:one('board'),b:one('dead')}},board:{priority:.5,actions:{forward:one('dead')}},dead:{reward:zeroMass()}});
 let session=SearchSession.from(f.domain,f.root);
 try{
  session.step();const saved=session.save(),before=[...f.executions];session.close();
  f.domain.next=()=>{throw Error('Migration cannot execute an old action');};
  session=SearchSession.restore(f.domain,saved,'local');const migrated=session.save();
  assert.deepEqual(migrated,{...saved,schedule:{...saved.schedule!,mode:'local'}});
  assert.deepEqual([...f.executions],before);assert.equal(saved.schedule?.mode,undefined,'source snapshot stays unchanged');
 }finally{session.close();}
});
for(const cold of [false,true])test(`local planning never returns to predecessor work after a committed move; cold=${cold}`,()=>{
 const f=fixture({root:{actions:{enter:one('middle'),revise:[{state:'win',mass:probabilityMass(1n,2n)},{state:'win',mass:probabilityMass(1n,2n)}]}},middle:{priority:.5,actions:{forward:one('dead')}},win:{reward:unitMass()},dead:{reward:zeroMass()}},true);
 let session=SearchSession.from(f.domain,f.root);
 try{
  while(!session.save().beliefs[0]!.edges.find(edge=>edge.action==='enter')!.published)assert.equal(session.stepLocal(),true);
  const previous=[...f.executions].filter(([key])=>key.startsWith('0:revise:'));
  assert.equal(session.rebase({state:'middle',identity:1000},'enter'),true);
  if(cold){const saved=session.save();session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual(session.save(),saved);}
  while(session.stepLocal()){}
  assert.deepEqual([...f.executions].filter(([key])=>key.startsWith('0:revise:')),previous,'a winning abandoned alternative cannot be searched after the real move');
  const saved=session.save();assert.ok(saved.queue.some(task=>task.belief===0&&task.action==='revise'),'the old unconsumed law remains stored');
  assert.equal(session.localEvidence(p=>p.terminal?(p.terminal[0]!.numerator===0n?0:1):p.priority).action!.key,'forward','even an inevitable death stays on the new root');
  assert.ok([...f.executions.values()].every(count=>count===1));
 }finally{session.close();}
});
for(const cold of [false,true])test(`retained successors advance before a wide incoming law finishes without choosing by hidden world (${cold?'cold':'live'})`,()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:[{state:'a',mass:half},{state:'b',mass:half}]}},
    a:{information:'same',actions:{left:one('win'),right:one('loss')}},
    b:{information:'same',actions:{left:one('loss'),right:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  type Delayed=ExpansionState&{waited?:number};
  const originalNext=f.domain.next,originalRestore=f.domain.restoreExpansion;
  const delay=(inner:ExactExpansion<Current,ExpansionState>,saved?:Delayed):ExactExpansion<Current,ExpansionState>=>{
    let waited=saved?.waited??0;
    return{get complete(){return inner.complete;},get delivered(){return inner.delivered;},
      step(){const state=inner.save();if(state.cursor===1&&waited<160){waited++;return true;}return inner.step();},
      take:()=>inner.take(),save:()=>({...inner.save(),waited}),close:()=>inner.close()};
  };
  f.domain.next=(current,action)=>current.state==='root'?delay(originalNext(current,action)):originalNext(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?delay(originalRestore(saved),saved):originalRestore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0,sawPrepared=false;
  try{
    while(session.step()){
      assert.ok(++steps<1000);
      const saved=session.save(),root=saved.beliefs[0]!.edges[0]!,a=saved.executions.find(row=>row.current.state==='a');
      if(!root.published&&a?.edges.length===2&&a.edges.every(edge=>edge.complete)){
        sawPrepared=true;
        assert.equal(saved.beliefs.length,1,'partial incoming law never publishes a player information set');
        assert.deepEqual(session.evidence().score,{lower:[half],upper:[unitMass()]},'one consistent public policy has a half-mass winning path, never a clairvoyant unit reward');
        assert.equal(session.evidence().action,null,'one hidden world winning cannot certify the common action');
      }
      if(cold){
        const before=[...f.executions],next=f.domain.next;
        session.close();f.domain.next=()=>{throw Error('Restore must not execute an old action');};
        try{session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}finally{f.domain.next=next;}
        assert.deepEqual(session.save(),saved);assert.deepEqual([...f.executions],before);
      }
    }
    assert.ok(sawPrepared,'a delivered current must progress before the remaining law completes');
    assert.equal(session.evidence().status,'proven-action');
    assert.deepEqual(session.evidence().score,{lower:[half],upper:[half]},'opposite hidden optima must use one common decision');
    assert.equal(f.executions.size,6);assert.ok([...f.executions.values()].every(count=>count===1),'prepared original transitions are reused after publication');
  }finally{session.close();}
});

for(const cold of [false,true])test(`prepared continuation follows a lower-scored child before an infinite ancestor alternative (${cold?'cold':'live'})`,()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:[{state:'a',mass:half},{state:'loss',mass:half}]}},
    a:{priority:100,actions:{descend:one('middle'),wait:one('a')}},middle:{priority:0,actions:{descend:one('deep')}},
    deep:{priority:-100,actions:{finish:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  type Delayed=ExpansionState&{waited?:number};
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const wrap=(inner:ExactExpansion<Current,ExpansionState>,saved:Delayed):ExactExpansion<Current,ExpansionState>=>{
    let waited=saved.waited??0;
    return{get complete(){return saved.action==='wait'?false:inner.complete;},get delivered(){return inner.delivered;},
      step(){if(saved.action==='wait'){waited++;return true;}if(saved.source.state==='root'&&inner.save().cursor===1&&waited<160){waited++;return true;}return inner.step();},
      take:()=>inner.take(),save:()=>({...inner.save(),waited}),close:()=>inner.close()};
  };
  f.domain.next=(current,action)=>{const expansion=next(current,action);return wrap(expansion,expansion.save());};
  f.domain.restoreExpansion=saved=>wrap(restore(saved),saved);
  let session=SearchSession.from(f.domain,f.root),steps=0,early=false;
  try{
    while(!session.save().beliefs[0]!.edges[0]!.published){
      assert.equal(session.step(),true);assert.ok(++steps<200,'preparation cannot starve the ordinary incoming law');
      const saved=session.save();
      if(!saved.beliefs[0]!.edges[0]!.published&&saved.executions.some(row=>row.current.state==='win'))early=true;
      if(cold){session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual(session.save(),saved);}
    }
    assert.ok(early,'a high-scored ancestor must not prevent prepared descendants reaching their real terminal');
    assert.equal(session.evidence().status,'incomplete','the open recurrent alternative is retained');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('wide search follows a complete path early and cold continuation still exhausts every tied action',()=>{
  const nodes:Record<string,Node>={root:{actions:{}},win:{reward:unitMass()}};
  for(let branch=0;branch<64;branch++){
    nodes.root!.actions!['a'+branch]=one(branch+':0');
    for(let depth=0;depth<3;depth++)nodes[branch+':'+depth]={actions:{next:one(depth===2?'win':branch+':'+(depth+1))}};
  }
  const f=fixture(nodes);let session=SearchSession.from(f.domain,f.root),steps=0,firstTerminal=0,sawBatch=false;
  try{
    while(session.step()){
      steps++;const saved=session.save();sawBatch ||= saved.schedule!.localRemaining>0n;
      if(!firstTerminal&&saved.executions.some(row=>row.current.state==='win'))firstTerminal=steps;
      if(steps%17===0){
        const cold=deserialize(serialize(saved));session.close();session=SearchSession.restore(f.domain,cold);
        assert.deepEqual(session.save().schedule,saved.schedule);
      }
      assert.ok(steps<600,'finite fixture must finish without dropping equal-valued actions');
    }
    assert.ok(sawBatch);assert.ok(firstTerminal>0&&firstTerminal<=16,'reach a real terminal before opening all 64 siblings');
    assert.equal(f.executions.size,256);assert.ok([...f.executions.values()].every(count=>count===1));
    assert.equal(session.evidence().status,'proven-action');assert.equal(session.evidence().pendingEdges,0);
  }finally{session.close();}
});
for(const cold of [false,true])test(`global public priority overrides stale locality without changing terminal choice during ${cold?'cold':'live'} continuation`,()=>{
  const actions:NonNullable<Node['actions']>={a0:one('low'),a1:one('high')};
  for(let i=2;i<64;i++)actions['a'+i]=one('loss');
  const f=fixture({root:{priority:10,actions},low:{priority:0,actions:{finish:one('win')}},
    high:{priority:20,actions:{finish:one('loss')}},win:{reward:unitMass()},loss:{reward:zeroMass()}});
  const visited:string[]=[],next=f.domain.next;
  f.domain.next=(current,action)=>{visited.push(current.state+':'+action);return next(current,action);};
  let session=SearchSession.from(f.domain,f.root),steps=0;
  const advance=()=>{
    const moved=session.step();assert.ok(++steps<2000);
    if(cold){const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);}
    return moved;
  };
  try{
    while(visited.length<3)assert.equal(advance(),true);
    assert.deepEqual(visited,['root:a0','root:a1','high:finish'],
      'root alternatives outrank the low child; the high child then outranks remaining root alternatives');
    while(advance()){}
    assert.equal(session.evidence().status,'proven-action');
    assert.equal(session.evidence().action?.key,'a0','a misleading high heuristic cannot replace terminal reward');
    assert.deepEqual(session.evidence().score,{lower:[unitMass()],upper:[unitMass()]});
    assert.ok(visited.includes('low:finish'),'the lower-scoring branch remains searchable');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});
for(const cold of [false,true])test(`equal public priorities finish the more delivered law without treating its mass as reward; cold=${cold}`,()=>{
  const actions:NonNullable<Node['actions']>={
    a0:[{state:'loss',mass:probabilityMass(9n,10n)},{state:'win',mass:probabilityMass(1n,10n)}],
    a1:[{state:'loss',mass:probabilityMass(1n,10n)},{state:'win',mass:probabilityMass(9n,10n)}],
  };
  for(let i=2;i<64;i++)actions['a'+i]=one('loss');
  const f=fixture({root:{actions},win:{reward:unitMass()},loss:{reward:zeroMass()}});
  let session=SearchSession.from(f.domain,f.root);
  const reschedule=(remaining:bigint)=>{
    const saved=deserialize(serialize(session.save()));saved.schedule.localRemaining=remaining;
    session.close();session=SearchSession.restore(f.domain,saved);
  };
  try{
    session.step();reschedule(0n);session.step();
    assert.ok(f.executions.has('0:a0:0'));assert.ok(f.executions.has('0:a1:0'));
    assert.equal(session.save().schedule!.preferred!.action,'a1','the last FIFO service prefers the less complete law');
    reschedule(31n);
    const before=[...f.executions];session.step();
    assert.ok(f.executions.has('0:a0:1'),'equal public priority must prefer 9/10 delivered over 1/10');
    assert.equal(f.executions.has('0:a1:1'),false);
    for(const [key,count] of before)assert.equal(f.executions.get(key),count,'existing successors must not execute again');
    let steps=0;
    while(session.step()){
      assert.ok(++steps<1000);
      if(cold){const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);}
    }
    assert.equal(session.evidence().status,'proven-action');assert.equal(session.evidence().action?.key,'a1');
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(9n,10n)],upper:[probabilityMass(9n,10n)]});
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const split of [false,true])test(`law completion ordering weights the posterior and survives splitting one hidden world; split=${split}`,()=>{
  const pair=(first:bigint)=>[{state:'loss',mass:probabilityMass(first,10n)},{state:'win',mass:probabilityMass(10n-first,10n)}];
  const a:NonNullable<Node['actions']>={a0:pair(1n),a1:pair(9n)},b:NonNullable<Node['actions']>={a0:pair(9n),a1:pair(1n)};
  for(let i=2;i<64;i++){a['a'+i]=one('loss');b['a'+i]=one('loss');}
  const worlds=split?[{state:'a',mass:probabilityMass(9n,20n)},{state:'a',mass:probabilityMass(9n,20n)},{state:'b',mass:probabilityMass(1n,10n)}]
    :[{state:'a',mass:probabilityMass(9n,10n)},{state:'b',mass:probabilityMass(1n,10n)}];
  const f=fixture({root:{actions:{enter:worlds}},a:{information:'shared',actions:a},b:{information:'shared',actions:b},win:{reward:unitMass()},loss:{reward:zeroMass()}});
  let session=SearchSession.from(f.domain,f.root);
  try{
    while(!session.save().beliefs[0]!.edges[0]!.published)session.step();
    const child=session.save().beliefs[0]!.edges[0]!.outcomes[0]!.belief;
    // Populate one original successor in each hidden world's two action laws.
    // Only the scheduling queue is rearranged; every execution and tail stays.
    for(const action of ['a1','a0'])for(let i=0;i<worlds.length;i++){
      const saved=deserialize(serialize(session.save())),index=saved.queue.findIndex((task:{belief:number;action:string})=>task.belief===child&&task.action===action);
      saved.queue.unshift(...saved.queue.splice(index,1));saved.schedule.localRemaining=0n;
      session.close();session=SearchSession.restore(f.domain,saved);session.step();
    }
    const saved=deserialize(serialize(session.save()));assert.equal(saved.schedule.preferred.action,'a0');saved.schedule.localRemaining=31n;
    session.close();session=SearchSession.restore(f.domain,saved);
    session.step();assert.ok(f.executions.has('1:a1:1'),'weighted delivered mass 41/50 beats 9/50 despite the stale a0 preference');
    assert.equal(f.executions.has('1:a0:1'),false);
    let steps=0;while(session.step())assert.ok(++steps<2000);
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(41n,50n)],upper:[probabilityMass(41n,50n)]});
    const finished=session.save();
    assert.ok(finished.beliefs[child]!.edges.find(edge=>edge.action==='a0')!.published);
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('unchanged wide task sets do not rescan every public priority on each local continuation',()=>{
  const actions:NonNullable<Node['actions']>={};for(let i=0;i<96;i++)actions['a'+i]=one('win');
  const f=fixture({root:{actions},win:{reward:unitMass()}}),position=f.domain.position;let reads=0;
  f.domain.position=current=>{const row=position(current),priority=row.priority;Object.defineProperty(row,'priority',{enumerable:true,get(){reads++;return priority;}});return row;};
  const pending=(saved:ExpansionState):ExactExpansion<Current,ExpansionState>=>{
    const state=structuredClone(saved);return{get complete(){return false;},get delivered(){return zeroMass();},
      step(){const key=state.source.identity+':'+state.action+':'+state.cursor++;f.executions.set(key,(f.executions.get(key)??0)+1);return true;},
      take:()=>undefined,save:()=>structuredClone(state),close:()=>{},};
  };
  f.domain.next=(source,action)=>pending({source,action,cursor:0,delivered:zeroMass(),ready:[]});f.domain.restoreExpansion=pending;
  const session=SearchSession.from(f.domain,f.root),before=reads;
  try{
    for(let i=0;i<24;i++)assert.equal(session.step(),true);
    assert.ok(reads-before<96*3,'unchanged public priorities require one derived-index build, not a full scan per instruction');
    assert.equal(session.evidence().pendingEdges,96);assert.equal(session.evidence().status,'incomplete');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`priority index selects the same tasks as a full ordered scan through changing laws and publications; cold=${cold}`,()=>{
  const choices=(state:string,count:number)=>Array.from({length:count},()=>({state,mass:probabilityMass(1n,BigInt(count))}));
  const actions:NonNullable<Node['actions']>={a0:choices('a',2),a1:choices('b',2)};
  for(let i=2;i<64;i++)actions['a'+i]=one('win');
  const nodes:Record<string,Node>={root:{actions},a:{priority:20,actions:{finish:choices('win',8),descend:one('middle')}},
    b:{priority:10,actions:{finish:choices('win',4),descend:one('middle')}},middle:{priority:-10,actions:{finish:one('win')}},win:{reward:unitMass()}};
  const f=fixture(nodes),next=f.domain.next,restore=f.domain.restoreExpansion,trace:{identity:number;action:string}[]=[];
  const watch=(base:ExactExpansion<Current,ExpansionState>,source:Current,action:string):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return base.complete;},get delivered(){return base.delivered;},step(){trace.push({identity:source.identity,action});return base.step();},
    take:()=>base.take(),save:()=>base.save(),close:()=>base.close(),
  });
  f.domain.next=(source,action)=>watch(next(source,action),source,action);f.domain.restoreExpansion=saved=>watch(restore(saved),saved.source,saved.action);
  let session=SearchSession.from(f.domain,f.root),steps=0,compared=0;
  try{
    while(true){
      const saved=session.save();let chosen=saved.queue[0];const length=trace.length;
      const priority=(task:NonNullable<typeof chosen>)=>nodes[saved.executions[saved.beliefs[task.belief]!.worlds[0]!.execution]!.current.state]!.priority??0;
      const delivered=(task:NonNullable<typeof chosen>)=>saved.beliefs[task.belief]!.worlds.reduce((sum,world)=>{
        const law=saved.executions[world.execution]!.edges.find(edge=>edge.action===task.action);
        return law?addMass(sum,multiplyMass(world.mass,law.complete?unitMass():law.expansion!.delivered)):sum;
      },zeroMass());
      if(chosen&&saved.schedule!.localRemaining>0n)for(const task of saved.queue.slice(1)){
        const p=priority(task)-priority(chosen),mass=p===0?compareMass(delivered(task),delivered(chosen)):0;
        if(p>0||p===0&&(mass>0||mass===0&&task.belief===saved.schedule!.preferred?.belief&&task.action===saved.schedule!.preferred.action))chosen=task;
      }
      const unfinished=saved.queue.filter(task=>task.belief===saved.root);
      if(saved.schedule!.localRemaining>0n&&(saved.schedule!.localRemaining===16n||unfinished.length>0&&saved.schedule!.localRemaining<16n)&&saved.queue.length>=32){
        // This fixture is a tree, so its discovery parent supplies an
        // independent root-group oracle; production also supports sharing.
        const roots=saved.beliefs[saved.root]!.edges;
        const group=(task:NonNullable<typeof chosen>)=>{
          if(task.belief===saved.root)return roots.findIndex(edge=>edge.action===task.action);
          let child=task.belief;
          while(saved.beliefs[child]!.parent!==saved.root)child=saved.beliefs[child]!.parent!;
          return roots.findIndex(edge=>edge.outcomes.some(row=>row.belief===child));
        };
        for(let offset=0;offset<roots.length;offset++){
          const index=Number(((saved.schedule!.rootCursor??0n)+BigInt(offset))%BigInt(roots.length));
          const task=(unfinished.length?unfinished:saved.queue).find(task=>group(task)===index);if(task){chosen=task;break;}
        }
      }
      if(!session.step())break;
      assert.ok(++steps<1000);
      // Prepared continuations have their separately specified service slot.
      // These acyclic, equal-reward laws have no cycle work or strict pruning.
      if(chosen&&saved.steps%32n!==31n&&trace.length>length){
        const belief=saved.beliefs[chosen.belief]!,edge=belief.edges.find(edge=>edge.action===chosen!.action)!,world=belief.worlds[edge.nextWorld]!;
        assert.deepEqual(trace.slice(length),[{identity:saved.executions[world.execution]!.current.identity,action:chosen.action}]);compared++;
      }
      if(cold){const image=deserialize(serialize(session.save())),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,image);assert.deepEqual([...f.executions],before);}
    }
    assert.ok(compared>32);assert.equal(session.evidence().status,'proven-action');
    assert.deepEqual(session.evidence().score,{lower:[unitMass()],upper:[unitMass()]});
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`root-group service reaches a narrow alternative behind a wide high-priority sibling; cold=${cold}`,()=>{
  const broad:NonNullable<Node['actions']>={};for(let i=0;i<64;i++)broad['wait'+i]=one('loss');
  const f=fixture({root:{actions:{wide:one('broad'),narrow:one('critical')}},broad:{priority:100,actions:broad},
    critical:{priority:-100,actions:{finish:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}});
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const forever=(saved:ExpansionState):ExactExpansion<Current,ExpansionState>=>{
    const state=structuredClone(saved);return{get complete(){return false;},get delivered(){return zeroMass();},
      step(){const key=state.source.identity+':'+state.action+':'+state.cursor++;f.executions.set(key,(f.executions.get(key)??0)+1);return true;},
      take:()=>undefined,save:()=>structuredClone(state),close:()=>{},};
  };
  f.domain.next=(current,action)=>current.state==='broad'?forever({source:current,action,cursor:0,delivered:zeroMass(),ready:[]}):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='broad'?forever(saved):restore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0;
  try{
    for(;;){
      const saved=session.save(),critical=saved.beliefs.find(belief=>saved.executions[belief.worlds[0]!.execution]!.current.state==='critical');
      if(critical?.edges[0]!.published)break;
      assert.equal(session.step(),true);assert.ok(++steps<180,'root fairness must not wait for all 64 sibling actions to receive global FIFO service');
      if(cold&&steps%11===0){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
    }
    const result=session.evidence();assert.equal(result.status,'incomplete');assert.equal(result.action,null);
    assert.deepEqual(result.score.lower,[unitMass()]);assert.equal(result.pendingEdges,64,'the wide unfinished alternative keeps every original action');
    const saved=session.save();assert.ok(saved.schedule!.rootCursor!>=4n);
    const legacy=deserialize(serialize(saved)),before=[...f.executions];delete legacy.schedule.rootCursor;
    const imported=SearchSession.restore(f.domain,legacy);try{assert.equal(imported.save().schedule!.rootCursor,0n);assert.deepEqual([...f.executions],before);}finally{imported.close();}
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`unfinished root laws complete on priority visits before already published wide descendants; cold=${cold}`,()=>{
  const root:NonNullable<Node['actions']>={},broad:NonNullable<Node['actions']>={};
  for(let i=0;i<6;i++)root['wide'+i]=one('broad');
  root.left=one('win');root.right=one('win');
  for(let i=0;i<64;i++)broad['wait'+i]=one('loss');
  const f=fixture({root:{actions:root},broad:{priority:100,actions:broad},win:{reward:unitMass()},loss:{reward:zeroMass()}});
  type Delayed=ExpansionState&{waited?:number};
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const wrap=(saved:Delayed):ExactExpansion<Current,ExpansionState>=>{
    if(saved.source.state==='broad'){
      const state=structuredClone(saved);return{get complete(){return false;},get delivered(){return zeroMass();},
        step(){const key=state.source.identity+':'+state.action+':'+state.cursor++;f.executions.set(key,(f.executions.get(key)??0)+1);return true;},
        take:()=>undefined,save:()=>structuredClone(state),close:()=>{},};
    }
    const inner=restore(saved);let waited=saved.waited??0;
    return{get complete(){return inner.complete;},get delivered(){return inner.delivered;},
      step(){if(waited<8){waited++;return true;}return inner.step();},take:()=>inner.take(),
      save:()=>({...inner.save(),waited}),close:()=>inner.close()};
  };
  const delayed=(source:Current,action:string)=>source.state==='broad'||source.state==='root'&&(action==='left'||action==='right');
  f.domain.next=(current,action)=>delayed(current,action)?wrap({source:current,action,cursor:0,delivered:zeroMass(),ready:[]}):next(current,action);
  f.domain.restoreExpansion=saved=>delayed(saved.source,saved.action)?wrap(saved):restore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0;
  const advance=()=>{
    assert.equal(session.step(),true);steps++;
    if(cold&&steps%17===0){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
  };
  try{
    while(!session.save().beliefs[0]!.edges.filter(edge=>edge.action.startsWith('wide')).every(edge=>edge.published)){
      advance();assert.ok(steps<1000);
    }
    const start=steps;
    while(!session.save().beliefs[0]!.edges.every(edge=>edge.published)){
      advance();assert.ok(steps-start<80,'root posterior dependencies must not wait for a single visit in each priority burst');
    }
    const saved=session.save();assert.equal(saved.queue.length,6*64,'all infinite descendant actions remain represented');
    assert.equal(session.evidence().status,'incomplete');assert.equal(session.evidence().action,null);
    assert.deepEqual(session.evidence().score.lower,[unitMass()]);
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`an infinite root law retains its full mass while finite descendants still finish; cold=${cold}`,()=>{
  const actions:NonNullable<Node['actions']>={};for(let i=0;i<64;i++)actions['finish'+i]=one('win');
  const f=fixture({root:{actions:{enter:one('child'),open:one('win')}},child:{priority:100,actions},win:{reward:unitMass()}});
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const forever=(saved:ExpansionState):ExactExpansion<Current,ExpansionState>=>{
    const state=structuredClone(saved);return{get complete(){return false;},get delivered(){return zeroMass();},
      step(){const key=state.source.identity+':'+state.action+':'+state.cursor++;f.executions.set(key,(f.executions.get(key)??0)+1);return true;},
      take:()=>undefined,save:()=>structuredClone(state),close:()=>{},};
  };
  f.domain.next=(current,action)=>action==='open'?forever({source:current,action,cursor:0,delivered:zeroMass(),ready:[]}):next(current,action);
  f.domain.restoreExpansion=saved=>saved.action==='open'?forever(saved):restore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0;
  try{
    while(!session.save().beliefs.some(node=>node.edges.length===64&&node.edges.every(edge=>edge.published))){
      assert.equal(session.step(),true);assert.ok(++steps<64*80,'root dependency priority must not disable finite-sibling service');
      if(cold&&steps%17===0){const saved=deserialize(serialize(session.save())),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual([...f.executions],before);}
    }
    const saved=session.save(),open=saved.executions[0]!.edges.find(edge=>edge.action==='open')!;
    assert.equal(open.complete,false);assert.equal(open.outcomes.length,0);assert.ok(open.expansion!.cursor>0);
    assert.deepEqual(open.expansion!.delivered,zeroMass());assert.equal(saved.queue.length,1);
    const evidence=session.evidence();assert.equal(evidence.status,'incomplete');assert.equal(evidence.action,null);
    assert.deepEqual(evidence.score.lower,[unitMass()]);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`root-group scheduling rebuilds shared ownership after adopting the actual successor; cold=${cold}`,()=>{
  const root:NonNullable<Node['actions']>={},shared:NonNullable<Node['actions']>={};
  for(let i=0;i<64;i++){root['enter'+i]=one('shared');shared['wait'+i]=one('loss');}
  const f=fixture({root:{actions:root},shared:{priority:100,actions:shared},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion,visited:string[]=[];
  const forever=(saved:ExpansionState):ExactExpansion<Current,ExpansionState>=>{
    const state=structuredClone(saved);return{get complete(){return false;},get delivered(){return zeroMass();},
      step(){visited.push(state.source.state);const key=state.source.identity+':'+state.action+':'+state.cursor++;f.executions.set(key,(f.executions.get(key)??0)+1);return true;},
      take:()=>undefined,save:()=>structuredClone(state),close:()=>{},};
  };
  f.domain.next=(current,action)=>current.state==='shared'?forever({source:current,action,cursor:0,delivered:zeroMass(),ready:[]}):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='shared'?forever(saved):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let i=0;i<180;i++)session.step();
    const before=session.save(),cursor=before.schedule!.rootCursor!;
    assert.ok(cursor>0n);assert.ok(session.evidence().equivalentExecutions>0);
    assert.equal(session.rebase({state:'shared',identity:100000},'enter0'),true);
    visited.length=0;
    for(let i=0;i<100;i++){
      assert.equal(session.step(),true);
      if(cold&&i%13===0){const saved=session.save(),executed=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],executed);}
    }
    assert.ok(visited.length>0&&visited.every(state=>state==='shared'));
    const after=session.save();assert.ok(after.schedule!.rootCursor!>cursor);assert.equal(session.evidence().runnableEdges,64);
    assert.ok(after.executions.length>=before.executions.length,'old root currents are still owned');
    assert.equal(session.evidence().status,'incomplete');assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('an infinite higher-priority history cannot starve older FIFO actions across cold continuation',()=>{
  const actions:NonNullable<Node['actions']>={a0:one('loop')};
  for(let i=1;i<64;i++)actions['a'+i]=one('win');
  const f=fixture({root:{actions},loop:{priority:100,actions:{again:one('loop')}},win:{reward:unitMass()}});
  let session=SearchSession.from(f.domain,f.root),steps=0;
  try{
    while(!session.save().beliefs[0]!.edges.every(edge=>edge.published)){
      assert.equal(session.step(),true);assert.ok(++steps<10000,'older finite siblings must receive service');
      if(steps%127===0){const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);}
    }
    assert.ok(actions.a63&&f.executions.has('0:a63:0'));
    assert.ok([...f.executions.values()].every(count=>count===1));
    assert.equal(session.evidence().status,'incomplete','unfinished infinite histories cannot be certified by a value tie');
  }finally{session.close();}
});

for(const cold of [false,true])test(`wide pending laws have bounded FIFO delay despite an infinite preferred expansion with ${cold?'cold':'live'} continuation`,()=>{
  const count=96,actions:NonNullable<Node['actions']>={a0:one('busy')};
  for(let i=1;i<count;i++)actions['a'+i]=one('win');
  const f=fixture({root:{actions},busy:{priority:100,actions:{wait:one('busy')}},win:{reward:unitMass()}});
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const forever=(saved:ExpansionState):ExactExpansion<Current,ExpansionState>=>{
    const state=structuredClone(saved);
    return{get complete(){return false;},get delivered(){return zeroMass();},
      step(){const key=state.source.identity+':wait:'+state.cursor++;f.executions.set(key,(f.executions.get(key)??0)+1);return true;},
      take:()=>undefined,save:()=>structuredClone(state),close:()=>{},
    };
  };
  f.domain.next=(source,action)=>source.state==='busy'?forever({source,action,cursor:0,delivered:zeroMass(),ready:[]}):next(source,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='busy'?forever(saved):restore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0;
  try{
    // Every finite root law needs two visits. This is a scheduling regression
    // window, not a cutoff on any production distribution or search depth.
    while(!session.evidence().actions.every(action=>action.distributionComplete)){
      assert.equal(session.step(),true);assert.ok(++steps<count*80,'wide frontiers must not multiply the fair-service interval by their own size');
      if(cold&&steps%127===0){const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);}
    }
    assert.ok(f.executions.has('0:a95:0'));
    assert.ok([...f.executions.values()].every(count=>count===1),'saved fair service must never repeat an original step');
    assert.equal(session.evidence().status,'incomplete','the infinite law remains unknown despite a tied known terminal');
    assert.ok(session.evidence().pendingEdges>0);
  }finally{session.close();}
});

for(const cold of [false,true])test(`accepted public successors adopt the actual current and retain consumed laws with ${cold?'cold':'live'} continuation`,()=>{
  const f=fixture({root:{actions:{enter:one('middle')}},middle:{actions:{finish:one('win')}},win:{reward:unitMass()}},true);
  let session=SearchSession.from(f.domain,f.root);const actual={state:'middle',identity:10000};
  try{
    while(session.step()){}
    const before=session.save(),executed=[...f.executions];
    assert.equal(session.rebase(actual,'enter'),true);
    const saved=session.save();assert.notEqual(saved.root,0);
    assert.equal(saved.executions.length,before.executions.length+1);
    assert.deepEqual(saved.executions.at(-1)!.current,actual);
    assert.deepEqual(saved.beliefs[saved.root]!.worlds,[{execution:saved.executions.length-1,mass:unitMass()}]);
    assert.deepEqual(saved.executions.slice(0,-1),before.executions,'all old currents and consumed laws remain owned');
    if(cold){session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    assert.equal(session.evidence().action?.key,'finish');assert.equal(session.step(),false);
    assert.deepEqual([...f.executions],executed,'neither adopting nor restoring executes old edges');
  }finally{session.close();}
  assert.ok(f.closed.has(actual.identity),'success transfers ownership of the full actual current');
});

test('adopting one actual current resets a multi-witness cursor while preserving partially expanded mass',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:[{state:'middle',mass:half},{state:'middle',mass:half}]}},
    middle:{actions:{finish:[{state:'win',mass:half},{state:'loss',mass:half}]}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    while(!session.save().beliefs[0]!.edges[0]!.published)assert.equal(session.step(),true);
    assert.equal(session.step(),true);
    const before=session.save(),child=before.beliefs[0]!.edges[0]!.outcomes[0]!.belief;
    assert.equal(before.beliefs[child]!.worlds.length,2);assert.equal(before.beliefs[child]!.edges[0]!.nextWorld,1);
    const consumed=[...f.executions];assert.equal(session.rebase({state:'middle',identity:10000},'enter'),true);
    const saved=deserialize(serialize(session.save()));assert.equal(saved.beliefs[child].edges[0].nextWorld,0);
    session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual([...f.executions],consumed);
    while(session.step()){}
    assert.deepEqual(session.evidence().score,{lower:[half],upper:[half]});
    assert.ok([...f.executions.values()].every(count=>count===1));
    assert.equal([...f.executions.keys()].filter(key=>key.includes(':finish:')).length,2,'each random coordinate executes once');
  }finally{session.close();}
});

test('adoption cannot use an actual hidden state to choose one world from an observable mixture',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:[{state:'a',mass:half},{state:'b',mass:half}]}},
    a:{information:'same',actions:{left:one('win'),right:one('loss')}},
    b:{information:'same',actions:{left:one('loss'),right:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const session=SearchSession.from(f.domain,f.root),actual={state:'a',identity:10000};
  try{
    while(session.step()){}
    const before=session.save(),equal=f.domain.equivalent!;
    f.domain.equivalent=(left,right)=>{assert.notEqual(right.identity,actual.identity,'mixture rejection must precede inspection of actual hidden state');return equal(left,right);};
    assert.equal(session.rebase(actual,'enter'),false);assert.deepEqual(session.save(),before);
    assert.equal(f.closed.has(actual.identity),false,'rejected current remains owned by caller');
  }finally{session.close();f.domain.close(actual);}
});

test('a failed complete-state adoption proof preserves the old focus and every frontier',()=>{
  const f=fixture({root:{actions:{enter:one('middle')}},middle:{information:'same',actions:{finish:one('win')}},
    other:{information:'same',actions:{finish:one('loss')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const session=SearchSession.from(f.domain,f.root),actual={state:'middle',identity:10000},different={state:'other',identity:10001};
  try{
    const initial=session.save();assert.equal(session.rebase(actual,'enter'),false);assert.deepEqual(session.save(),initial);
    while(!session.save().beliefs[0]!.edges[0]!.published)assert.equal(session.step(),true);
    const before=session.save();assert.equal(session.rebase(different,'enter'),false);assert.deepEqual(session.save(),before);
    const equal=f.domain.equivalent!;
    f.domain.equivalent=(left,right)=>{if(right.identity===actual.identity)throw Error('comparison interrupted');return equal(left,right);};
    assert.throws(()=>session.rebase(actual,'enter'),/comparison interrupted/);assert.deepEqual(session.save(),before);
    assert.equal(f.closed.has(actual.identity),false);assert.equal(f.closed.has(different.identity),false);
    f.domain.equivalent=equal;assert.equal(session.rebase(actual,'enter'),true);
    while(session.step()){}assert.equal(session.evidence().action?.key,'finish');
  }finally{session.close();f.domain.close(actual);f.domain.close(different);}
});

test('a growing recurrent component retains old algebra work and cold-restores the merged component without replay',()=>{
  const choices=Array.from({length:12},(_,index)=>({state:index<6?'root':'win',mass:probabilityMass(1n,12n)}));
  const f=fixture({root:{actions:{loop:one('other'),exit:one('later')}},other:{actions:{back:one('root')}},
    later:{actions:{retry:choices}},win:{reward:unitMass()}},true);
  let session=SearchSession.from(f.domain,f.root);let sawOldWork=false,sawMerged=false,steps=0;
  try{
    while(session.step()){
      assert.ok(++steps<400);
      const saved=deserialize(serialize(session.save())) as ReturnType<typeof session.save>;
      sawOldWork ||= !!saved.cycles?.some(cycle=>cycle.graph.length===2&&cycle.work!==null);
      if(saved.cycles?.some(cycle=>cycle.graph.length===3)){
        sawMerged=true;assert.ok(saved.cycles.some(cycle=>cycle.graph.length===2),'obsolete component algebra is retained, not silently discarded');
      }
      const evidence=session.evidence(),executed=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved);
      assert.deepEqual(session.evidence(),evidence);assert.deepEqual([...f.executions],executed);
    }
    assert.ok(sawOldWork);assert.ok(sawMerged);
    const result=session.evidence();assert.equal(result.action?.key,'exit');assert.equal(result.pendingCycles,0);
    assert.deepEqual(result.score,{lower:[unitMass()],upper:[unitMass()]});
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('indistinguishable worlds share their player action instead of selecting clairvoyant optima',()=>{
  const f=fixture({
    root:{actions:{safe:one('safe'),guess:[{state:'hidden-left',mass:probabilityMass(1n,2n)},{state:'hidden-right',mass:probabilityMass(1n,2n)}]}},
    safe:{reward:probabilityMass(3n,5n)},
    'hidden-left':{information:'same-observation',actions:{left:one('win'),right:one('lose')}},
    'hidden-right':{information:'same-observation',actions:{left:one('lose'),right:one('win')}},
    win:{reward:unitMass()},lose:{reward:zeroMass()},
  });
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step()){
      // Persist and restore the CURRENT graph after every unit of work.
      const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);
      assert.ok(++steps<200,'fixture should fully terminate');
    }
    const result=session.evidence();assert.equal(result.action?.key,'safe');assert.equal(result.status,'proven-action');
    assert.deepEqual(result.actions.find(row=>row.key==='guess')!.score,{lower:[probabilityMass(1n,2n)],upper:[probabilityMass(1n,2n)]});
    assert.equal(result.runnableEdges,0);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`equal complete states share consumed action laws with ${cold?'cold':'live'} continuation`,()=>{
  const f=fixture({root:{actions:{left:one('middle'),right:one('middle')}},
    middle:{actions:{finish:one('half')}},half:{reward:probabilityMass(1n,2n)}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    while(session.step())if(cold){
      const evidence=session.evidence(),saved=deserialize(serialize(session.save()));
      session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual(session.evidence(),evidence);
    }
    const result=session.evidence(),saved=session.save();
    assert.equal(result.runnableEdges,0);assert.equal(result.pendingEdges,0);
    assert.deepEqual(result.score,{lower:[probabilityMass(1n,2n)],upper:[probabilityMass(1n,2n)]});
    assert.equal(result.equivalentExecutions,1);
    const finishes=[...f.executions].filter(([key])=>key.includes(':finish:'));
    assert.equal(finishes.length,1,'the common current/action is executed only once');assert.equal(finishes[0]![1],1);
    const alias=saved.executions.find(row=>row.equivalentTo!=null)!;assert.ok(alias);assert.deepEqual(alias.edges,[]);
    const representative=saved.executions[alias.equivalentTo!]!;assert.equal(representative.current.state,'middle');
    assert.equal(representative.edges.length,1);assert.equal(representative.edges[0]!.complete,true);
    assert.equal(saved.beliefs.filter(row=>row.worlds.some(world=>saved.executions[world.execution]!.current.state==='middle')).length,1,
      'identical conditional distributions of complete states share their future information-set decisions');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('equal observations and terminal scores cannot justify sharing different hidden transition laws',()=>{
  const f=fixture({root:{actions:{safe:one('safe'),guess:[{state:'a',mass:probabilityMass(1n,2n)},{state:'b',mass:probabilityMass(1n,2n)}]}},
    safe:{reward:probabilityMass(3n,5n)},a:{information:'same',actions:{left:one('win'),right:one('loss')}},
    b:{information:'same',actions:{left:one('loss'),right:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const session=SearchSession.from(f.domain,f.root);
  try{
    while(session.step()){}
    assert.equal(session.evidence().action?.key,'safe');
    const snapshot=session.save(),hidden=snapshot.executions.filter(row=>row.current.state==='a'||row.current.state==='b');
    assert.equal(hidden.length,2);assert.ok(hidden.every(row=>row.equivalentTo===null));
  }finally{session.close();}
});

test('an interrupted equivalence proof retains its current and retries only pure comparison after restore',()=>{
  const f=fixture({root:{actions:{a:one('middle'),b:one('middle')}},middle:{actions:{end:one('win')}},win:{reward:unitMass()}},true);
  const equal=f.domain.equivalent!;let interrupted=false;
  f.domain.equivalent=(left,right)=>{
    if(left.state==='middle'&&right.state==='middle'&&!interrupted){interrupted=true;throw Error('comparison paused');}
    return equal(left,right);
  };
  let session=SearchSession.from(f.domain,f.root);
  try{
    session.step();assert.throws(()=>session.step(),/comparison paused/);
    const saved=deserialize(serialize(session.save()));
    assert.equal(saved.executions.length,3);assert.equal(saved.executions[2].identified,false);
    assert.equal(saved.executions[0].edges.find((row:any)=>row.action==='b').outcomes[0].execution,2);
    const before=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved);
    assert.deepEqual([...f.executions],before,'restore only checks the already retained current');
    while(session.step()){}
    assert.equal(session.evidence().equivalentExecutions,1);
    assert.equal([...f.executions.keys()].filter(key=>key.includes(':end:')).length,1);
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('an exact posterior self loop chooses the exit instead of repeatedly choosing a value-equivalent wait',()=>{
  const f=fixture({root:{actions:{wait:one('root'),exit:one('half')}},half:{reward:probabilityMass(1n,2n)}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step()){
      assert.ok(++steps<20);
      const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);
    }
    const result=session.evidence();assert.equal(result.status,'proven-action');assert.equal(result.action?.key,'exit');assert.equal(result.runnableEdges,0);
    assert.equal(result.executions,3);assert.equal(result.beliefs,2);assert.equal(result.equivalentExecutions,1);
    assert.deepEqual(result.score,{lower:[probabilityMass(1n,2n)],upper:[probabilityMass(1n,2n)]});
    assert.deepEqual(session.save().beliefs[0]!.edges.find(row=>row.action==='wait')!.outcomes,[{belief:0,mass:unitMass()}]);
    assert.deepEqual([...f.executions],[['0:wait:0',1],['0:exit:0',1]]);
  }finally{session.close();}
});

for(const cold of [false,true])test(`geometric self returns preserve the full infinite support with ${cold?'cold':'live'} continuation`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{safe:one('safe'),retry:[{state:'root',mass:half},{state:'win',mass:quarter},{state:'loss',mass:quarter}]}},
    safe:{reward:probabilityMass(2n,5n)},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step()){
      assert.ok(++steps<30);
      if(cold){const evidence=session.evidence(),saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual(session.evidence(),evidence);}
    }
    const result=session.evidence();assert.equal(result.action?.key,'retry');
    assert.deepEqual(result.score,{lower:[half],upper:[half]});
    const edge=session.save().beliefs[0]!.edges.find(row=>row.action==='retry')!;
    assert.deepEqual(edge.outcomes.find(row=>row.belief===0)!.mass,half,'the original self-loop mass remains in the graph');
    assert.deepEqual(edge.outcomes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('a fully closed nonterminal self loop has no realized terminal reward and is not reported as a victory or an exit',()=>{
  const f=fixture({root:{actions:{wait:one('root'),waitAgain:one('root')}}},true),session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step())assert.ok(++steps<10);
    const result=session.evidence();assert.equal(result.status,'incomplete');assert.equal(result.action,null);
    assert.equal(result.closedNonterminalLoop,true);assert.equal(result.beliefs,1);
    assert.deepEqual(result.score,{lower:[zeroMass()],upper:[zeroMass()]});
    assert.equal(result.pendingEdges,0);assert.equal([...f.executions.values()].reduce((sum,n)=>sum+n,0),2);
  }finally{session.close();}
});

test('equal observations with different conditional world weights do not collapse into a self loop',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:[{state:'a',mass:half},{state:'b',mass:half}]}},
    a:{information:'hidden',actions:{continue:[{state:'a',mass:half},{state:'win',mass:half}]}},
    b:{information:'hidden',actions:{continue:one('b')}},win:{reward:unitMass()}},true),session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<20;step++)assert.equal(session.step(),true);
    const snapshot=session.save(),hidden=snapshot.beliefs.filter(row=>snapshot.executions[row.worlds[0]!.execution]!.current.state!=='root'&&row.worlds.length===2);
    assert.ok(hidden.some(row=>row.worlds.every(world=>compareMass(world.mass,half)===0)));
    assert.ok(hidden.some(row=>row.worlds.some(world=>compareMass(world.mass,probabilityMass(1n,3n))===0)&&row.worlds.some(world=>compareMass(world.mass,probabilityMass(2n,3n))===0)));
    assert.ok(session.evidence().runnableEdges>0,'changed posteriors remain a retained frontier');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('multi-state recurrence has an exact exit policy and survives every algebra step being cold-restored',()=>{
  const f=fixture({root:{actions:{loop:one('other'),exit:one('half')}},
    other:{actions:{back:one('root')}},half:{reward:probabilityMass(1n,2n)}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0,sawCycleWork=false;while(session.step()){
      assert.ok(++steps<200);const evidence=session.evidence();sawCycleWork ||= evidence.pendingCycles>0;
      const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual(session.evidence(),evidence);
    }
    const evidence=session.evidence();assert.equal(evidence.status,'proven-action');assert.equal(evidence.action?.key,'exit');
    assert.deepEqual(evidence.score,{lower:[probabilityMass(1n,2n)],upper:[probabilityMass(1n,2n)]});
    assert.equal(evidence.beliefs,3);assert.equal(evidence.executions,4);assert.equal(evidence.pendingCycles,0);assert.equal(evidence.cyclePoliciesEvaluated,2);
    assert.deepEqual(evidence.cycleWitness,{action:'exit',policy:1,exitMass:unitMass(),exitSteps:unitMass()});
    assert.ok(sawCycleWork);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('a probabilistic multi-state cycle prefers eventual victory over a faster but lower terminal reward',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{retry:one('other'),safe:one('safe')}},
    other:{actions:{roll:[{state:'root',mass:half},{state:'win',mass:half}]}},
    safe:{reward:probabilityMass(3n,5n)},win:{reward:unitMass()}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step()){
      assert.ok(++steps<200);const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);
    }
    const result=session.evidence();assert.equal(result.action?.key,'retry');
    assert.deepEqual(result.score,{lower:[unitMass()],upper:[unitMass()]});
    assert.deepEqual(result.cycleWitness?.exitMass,unitMass());assert.deepEqual(result.cycleWitness?.exitSteps,probabilityMass(4n));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('a closed multi-state component reports nontermination without inventing terminal or sampled outcomes',()=>{
  const f=fixture({root:{actions:{a:one('other'),b:one('other')}},other:{actions:{back:one('root')}}},true),session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step())assert.ok(++steps<200);
    const result=session.evidence();assert.equal(result.action,null);assert.equal(result.status,'incomplete');
    assert.equal(result.closedNonterminalLoop,true);assert.equal(result.beliefs,2);assert.equal(result.pendingCycles,0);
    assert.deepEqual(result.score,{lower:[zeroMass()],upper:[zeroMass()]});
    assert.ok(session.save().beliefs.every(row=>row.edges.every(edge=>edge.published)));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('a positive geometric exit is never rounded into a closed loop',()=>{
  const denominator=1n<<100n,exit=probabilityMass(1n,denominator);
  const f=fixture({root:{actions:{retry:[{state:'root',mass:probabilityMass(denominator-1n,denominator)},{state:'win',mass:exit}]}},win:{reward:unitMass()}},true);
  const session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step())assert.ok(++steps<10);
    const result=session.evidence();assert.deepEqual(result.score,{lower:[unitMass()],upper:[unitMass()]});
    assert.equal(result.closedNonterminalLoop,false);assert.equal(result.action?.key,'retry');
    assert.deepEqual(session.save().beliefs[0]!.edges[0]!.outcomes.find(row=>row.belief!==0)!.mass,exit);
    assert.equal(f.executions.get('0:retry:0'),1);assert.equal(f.executions.get('0:retry:1'),1);
  }finally{session.close();}
});

test('a shared posterior stays runnable through another live parent when its discovery path is dominated',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{risk:[{state:'loss',mass:half},{state:'middle',mass:half}],safe:one('s1')}},
    s1:{actions:{next:one('s2')}},s2:{actions:{next:one('middle')}},
    middle:{actions:{go:[{state:'win',mass:probabilityMass(3n,4n)},{state:'loopA',mass:probabilityMass(1n,4n)}]}},
    loopA:{actions:{next:one('loopB')}},loopB:{actions:{next:one('loopA')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0,sharedPending=false;while(session.step()){
      assert.ok(++steps<300);const evidence=session.evidence();
      if(evidence.actions.find(row=>row.key==='risk')!.dominatedBy==='safe'&&(evidence.runnableEdges>0||evidence.pendingCycles>0))sharedPending=true;
      const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);
    }
    const result=session.evidence(),saved=session.save();
    assert.equal(result.action?.key,'safe');assert.equal(result.actions.find(row=>row.key==='risk')!.dominatedBy,'safe');
    assert.ok(sharedPending,'shared work stays reachable after its discovery path is dominated');
    assert.equal(result.pendingCycles,0);assert.deepEqual(result.score,{lower:[probabilityMass(3n,4n)],upper:[probabilityMass(3n,4n)]});
    assert.equal(saved.beliefs.filter(row=>saved.executions[row.worlds[0]!.execution]!.current.state==='middle').length,1);
    assert.equal([...f.executions.keys()].filter(key=>key.includes(':go:')).length,2,'the shared law is consumed once, including both original outcomes');
  }finally{session.close();}
});
test('a huge heuristic cannot turn an unfinished state into a terminal value',()=>{
  const f=fixture({root:{actions:{honest:one('good'),attractive:one('intermediate')}},
    good:{reward:probabilityMass(3n,4n)},intermediate:{priority:1e100,actions:{continue:one('bad')}},bad:{reward:zeroMass()}});
  const session=SearchSession.from(f.domain,f.root);
  try{while(session.step()){}assert.equal(session.evidence().action?.key,'honest');assert.deepEqual(session.evidence().score.lower,[probabilityMass(3n,4n)]);}
  finally{session.close();}
});
test('partial action distributions retain probability and cannot publish incomplete information sets',()=>{
  const f=fixture({root:{actions:{a:[{state:'win',mass:probabilityMass(1n,4n)},{state:'lose',mass:probabilityMass(3n,4n)}],b:one('half')}},win:{reward:unitMass()},lose:{reward:zeroMass()},half:{reward:probabilityMass(1n,2n)}});
  const session=SearchSession.from(f.domain,f.root);
  try{
    session.step();const saved=session.save(),edge=saved.beliefs[0]!.edges.find(row=>row.action==='a')!;
    assert.equal(edge.published,false);assert.deepEqual(edge.outcomes,[]);
    assert.deepEqual(session.evidence().actions.find(row=>row.key==='a')!.score,{lower:[probabilityMass(1n,4n)],upper:[unitMass()]});
    assert.equal(session.evidence().status,'incomplete');
  }finally{session.close();}
});
for(const upper of [unitMass(),probabilityMass(1n,2n)])test(`recurrent histories remain unfinished without an equivalence proof with upper ${upper.numerator}/${upper.denominator}`,()=>{
  const f=fixture({root:{actions:{wait:one('root'),exit:one('half')}},half:{reward:probabilityMass(1n,2n)}});
  f.domain.upper=[upper];
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let i=0;i<100;i++)assert.equal(session.step(),true);
    const result=session.evidence();assert.equal(result.status,'incomplete');assert.equal(result.action,null);assert.ok(result.pendingEdges>0);
    const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);
    assert.deepEqual(session.evidence(),result);session.step();assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`strict bound dominance retains an unexpanded law through ${cold?'cold':'live'} continuation`,()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{safe:one('safe'),risk:[{state:'loss',mass:half},{state:'loop',mass:half}]}},
    safe:{reward:probabilityMass(3n,4n)},loss:{reward:zeroMass()},loop:{actions:{again:one('loop')}}});
  let session=SearchSession.from(f.domain,f.root);
  try{
    session.step();session.step();
    const evidence=session.evidence(),risk=evidence.actions.find(row=>row.key==='risk')!;
    assert.deepEqual(risk.score,{lower:[zeroMass()],upper:[half]});
    assert.equal(risk.dominatedBy,'safe');assert.equal(risk.distributionComplete,false);
    assert.equal(evidence.pendingEdges,2);assert.equal(evidence.runnableEdges,1);
    const saved=deserialize(serialize(session.save())),retained=saved.executions[0]!.edges.find((row:any)=>row.action==='risk')!;
    assert.equal(retained.complete,false);assert.deepEqual(retained.expansion.delivered,half);
    assert.equal(retained.expansion.cursor,1,'the other half remains in the original expansion');
    if(cold){session.close();session=SearchSession.restore(f.domain,saved);assert.deepEqual(session.evidence(),evidence);}
    while(session.step()){}
    const result=session.evidence();assert.equal(result.action?.key,'safe');
    assert.equal(result.pendingEdges,1);assert.equal(result.runnableEdges,0);
    assert.equal(f.executions.has('0:risk:1'),false,'a dominated unknown successor is never executed');
    assert.deepEqual(session.save().executions[0]!.edges.find(row=>row.action==='risk'),retained,'pruning keeps the complete unconsumed law');
  }finally{session.close();}
});

test('a dominance proof suspends already published descendants, including an otherwise infinite history',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{safe:one('s1'),risk:[{state:'loss',mass:half},{state:'loop',mass:half}]}},
    s1:{actions:{next:one('s2')}},s2:{actions:{next:one('s3')}},s3:{actions:{next:one('safe')}},
    safe:{reward:probabilityMass(3n,4n)},loss:{reward:zeroMass()},loop:{actions:{again:one('loop')}}});
  let session=SearchSession.from(f.domain,f.root);
  try{
    let steps=0;while(session.step()){
      assert.ok(++steps<100,'the losing recurrent subtree must stop consuming work after the proof');
      const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(f.domain,saved);
    }
    const result=session.evidence(),snapshot=session.save();
    assert.equal(result.action?.key,'safe');assert.equal(result.actions.find(row=>row.key==='risk')!.dominatedBy,'safe');
    assert.equal(result.actions.find(row=>row.key==='risk')!.distributionComplete,true);
    assert.ok(snapshot.executions.some(row=>row.current.state==='loop'&&row.edges.length>0),'the recurrent branch had already begun expanding');
    assert.ok(result.pendingEdges>0);assert.equal(result.runnableEdges,0);
    assert.ok([...f.executions.values()].every(count=>count===1));
    const before=deserialize(serialize(snapshot));assert.equal(session.step(),false);assert.deepEqual(session.save(),before);
  }finally{session.close();}
});

test('equal action bounds never mutually dominate or drop their probability distributions',()=>{
  const f=fixture({root:{actions:{a:one('half'),b:one('half')}},half:{reward:probabilityMass(1n,2n)}}),session=SearchSession.from(f.domain,f.root);
  try{
    while(session.step()){}
    const result=session.evidence();assert.equal(result.pendingEdges,0);assert.equal(result.runnableEdges,0);
    assert.ok(result.actions.every(row=>row.distributionComplete&&row.dominatedBy===null));
    assert.equal(f.executions.get('0:a:0'),1);assert.equal(f.executions.get('0:b:0'),1);
  }finally{session.close();}
});

test('lexicographic dominance can prove survival better while later reward bounds remain infinite',()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{safe:one('safe'),risk:[{state:'loss',mass:half},{state:'loop',mass:half}]}},
    safe:{reward:unitMass()},loss:{reward:zeroMass()},loop:{actions:{again:one('loop')}}});
  f.domain.upper=[unitMass(),null];const position=f.domain.position;
  f.domain.position=current=>{const row=position(current);return{...row,terminal:row.terminal?[...row.terminal,current.state==='safe'?probabilityMass(10n):zeroMass()]:null};};
  const session=SearchSession.from(f.domain,f.root);
  try{
    while(session.step()){}
    const result=session.evidence();assert.equal(result.action?.key,'safe');
    const risk=result.actions.find(row=>row.key==='risk')!;
    assert.deepEqual(risk.score.upper,[half,null]);assert.equal(risk.dominatedBy,'safe');
    assert.equal(f.executions.has('0:risk:1'),false);assert.equal(result.runnableEdges,0);
  }finally{session.close();}
});
test('an unproved finite HP bound is represented as infinity, with exact terminal values after exhaustion',()=>{
  const f=fixture({root:{actions:{a:one('large'),b:one('small')}},large:{reward:probabilityMass(1n<<80n)},small:{reward:unitMass()}});
  f.domain.upper=[null];const session=SearchSession.from(f.domain,f.root);
  try{
    assert.deepEqual(session.evidence().score.upper,[null]);assert.equal(session.evidence().action,null);
    while(session.step()){}assert.equal(session.evidence().action?.key,'a');assert.deepEqual(session.evidence().score.lower,[probabilityMass(1n<<80n)]);
  }finally{session.close();}
});

for(const cold of [false,true])test(`a transferred successor survives projection failure and ${cold?'cold':'live'} continuation without reexecuting its edge`,()=>{
  const f=fixture({root:{actions:{good:one('win'),bad:one('lose')}},win:{reward:unitMass()},lose:{reward:zeroMass()}});
  const project=f.domain.position;let failed=false;
  f.domain.position=current=>{
    if(current.state==='win'&&!failed){failed=true;throw Error('projection temporarily unavailable');}
    return project(current);
  };
  let session=SearchSession.from(f.domain,f.root);
  try{
    assert.throws(()=>session.step(),/projection temporarily unavailable/);
    const saved=deserialize(serialize(session.save()));
    const edge=saved.executions[0].edges[0];
    assert.equal(saved.executions.length,2,'the transferred original Context remains owned');
    assert.deepEqual(edge.outcomes,[{execution:1,mass:unitMass()}],'the consuming edge already owns its mass');
    assert.deepEqual(edge.expansion.delivered,unitMass());
    assert.equal(saved.beliefs.length,1);assert.equal(saved.queue.length,2);
    if(cold){session.close();session=SearchSession.restore(f.domain,saved);}
    while(session.step()){}
    assert.equal(session.evidence().action?.key,'good');assert.equal(session.evidence().runnableEdges,0);
    assert.equal(f.executions.get('0:good:0'),1);assert.equal(f.executions.get('0:bad:0'),1);
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});



test('unequal future weights form exact posteriors and only revealed information permits distinct actions',()=>{
  const f=fixture({root:{actions:{safe:one('safe'),risk:[{state:'a',mass:probabilityMass(1n,5n)},{state:'b',mass:probabilityMass(3n,10n)},{state:'known',mass:probabilityMass(1n,2n)}]}},
    safe:{reward:probabilityMass(3n,4n)},
    a:{information:'unrevealed',actions:{left:one('win'),right:one('lose')}},
    b:{information:'unrevealed',actions:{left:one('lose'),right:one('win')}},
    known:{information:'revealed',actions:{left:one('win'),right:one('lose')}},win:{reward:unitMass()},lose:{reward:zeroMass()}});
  const session=SearchSession.from(f.domain,f.root);
  try{
    while(session.step()){}
    const result=session.evidence();assert.equal(result.action?.key,'risk');assert.deepEqual(result.score,{lower:[probabilityMass(4n,5n)],upper:[probabilityMass(4n,5n)]});
    const saved=session.save(),risk=saved.beliefs[0]!.edges.find(edge=>edge.action==='risk')!;
    assert.equal(risk.outcomes.length,2);assert.ok(risk.outcomes.every(row=>row.mass.numerator===1n&&row.mass.denominator===2n));
    const hidden=risk.outcomes.map(row=>saved.beliefs[row.belief]!).find(belief=>belief.worlds.length===2)!;
    assert.deepEqual(hidden.worlds.map(row=>row.mass),[probabilityMass(2n,5n),probabilityMass(3n,5n)]);
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('successive chance steps preserve conditional correlation before expectation',()=>{
  const f=fixture({root:{actions:{go:[{state:'a',mass:probabilityMass(1n,4n)},{state:'b',mass:probabilityMass(3n,4n)}]}},
    a:{information:'same',actions:{continue:[{state:'win',mass:probabilityMass(4n,5n)},{state:'lose',mass:probabilityMass(1n,5n)}]}},
    b:{information:'same',actions:{continue:[{state:'win',mass:probabilityMass(1n,5n)},{state:'lose',mass:probabilityMass(4n,5n)}]}},
    win:{reward:unitMass()},lose:{reward:zeroMass()}});
  const session=SearchSession.from(f.domain,f.root);
  try{while(session.step()){}assert.deepEqual(session.evidence().score,{lower:[probabilityMass(7n,20n)],upper:[probabilityMass(7n,20n)]});}
  finally{session.close();}
});

test('a complete information set can exceed the old world cap without losing support',()=>{
  // Keep both actions nondominated so this test measures the complete law;
  // separate dominance tests cover preserving a suspended partial law.
  const nodes:Record<string,Node>={root:{actions:{safe:one('safe'),guess:Array.from({length:12},(_,i)=>({state:'world'+i,mass:probabilityMass(1n,12n)}))}},safe:{reward:probabilityMass(1n,2n)},win:{reward:unitMass()},lose:{reward:zeroMass()}};
  for(let i=0;i<12;i++)nodes['world'+i]={information:'hidden',actions:{even:one(i%2?'lose':'win'),odd:one(i%2?'win':'lose')}};
  const f=fixture(nodes),session=SearchSession.from(f.domain,f.root);
  try{
    while(session.step()){}
    assert.equal(session.evidence().action?.key,'safe');
    assert.ok(session.save().beliefs.some(belief=>belief.worlds.length===12));
    assert.deepEqual(session.evidence().actions.find(edge=>edge.key==='guess')!.score,{lower:[probabilityMass(1n,2n)],upper:[probabilityMass(1n,2n)]});
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('original expansion errors propagate with the current frontier intact and no fallback',()=>{
  const f=fixture({root:{actions:{a:one('end')}},end:{reward:unitMass()}}),session=SearchSession.from(f.domain,f.root),before=session.save();
  f.domain.next=()=>{throw Error('original rule defect');};
  try{assert.throws(()=>session.step(),/original rule defect/);assert.deepEqual(session.save(),before);assert.equal(session.evidence().steps,0n);}
  finally{session.close();}
});

test('one cleanup failure cannot strand other retained contexts or expansions',()=>{
  const f=fixture({root:{actions:{a:one('win'),b:one('lose')}},win:{reward:unitMass()},lose:{reward:zeroMass()}});
  const close=f.domain.close;f.domain.close=current=>{close(current);if(current.identity===0)throw Error('cleanup interrupted');};
  const session=SearchSession.from(f.domain,f.root);session.step();session.step();
  assert.throws(()=>session.close(),error=>error instanceof AggregateError&&error.errors.some(error=>String(error).includes('cleanup interrupted')));
  assert.deepEqual([...f.closed].sort(),[0,1,2]);session.close();
});

for(const cold of [false,true])test(`terminal prefix accounting survives a later projection failure with ${cold?'cold':'live'} continuation`,()=>{
  const f=fixture({root:{actions:{go:[{state:'first',mass:probabilityMass(1n,4n)},
    {state:'second',mass:probabilityMass(1n,4n)},{state:'pending',mass:probabilityMass(1n,2n)}]}},
    first:{reward:unitMass()},second:{reward:probabilityMass(1n,2n)},pending:{actions:{finish:one('loss')}},loss:{reward:zeroMass()}});
  const position=f.domain.position;let interrupted=false;
  f.domain.position=current=>{if(current.state==='second'&&!interrupted){interrupted=true;throw Error('later projection failed');}return position(current);};
  let session=SearchSession.from(f.domain,f.root);
  try{
    session.step();assert.deepEqual(session.evidence().score,{lower:[probabilityMass(1n,4n)],upper:[unitMass()]});
    assert.throws(()=>session.step(),/later projection failed/);
    if(cold){
      const saved=deserialize(serialize(session.save())),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,saved);
      assert.deepEqual([...f.executions],before,'rebuilding derived sums executes no original edge');
      assert.deepEqual(session.evidence().score,{lower:[probabilityMass(3n,8n)],upper:[probabilityMass(7n,8n)]});
    }
    session.step();assert.deepEqual(session.evidence().score,{lower:[probabilityMass(3n,8n)],upper:[probabilityMass(7n,8n)]});
    while(session.step()){}
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(3n,8n)],upper:[probabilityMass(3n,8n)]});
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

test('growing a partial law does not reread previously accounted successor masses',()=>{
  const f=fixture({root:{actions:{go:[{state:'win',mass:probabilityMass(1n,3n)},
    {state:'win',mass:probabilityMass(1n,3n)},{state:'loss',mass:probabilityMass(1n,3n)}]}},win:{reward:unitMass()},loss:{reward:zeroMass()}});
  const next=f.domain.next;let prefixReads=0,first=true;
  f.domain.next=(current,action)=>{
    const expansion=next(current,action),take=expansion.take.bind(expansion);
    expansion.take=()=>{
      const row=take();if(!row||!first)return row;first=false;
      const mass=row.mass;
      return{current:row.current,mass:{get numerator(){prefixReads++;return mass.numerator;},get denominator(){prefixReads++;return mass.denominator;}}};
    };return expansion;
  };
  const session=SearchSession.from(f.domain,f.root);
  try{
    session.step();const before=prefixReads;assert.ok(before>0);
    session.step();assert.equal(prefixReads,before,'partial backup must use accumulated exact sums');
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(2n,3n)],upper:[unitMass()]});
    while(session.step()){}
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(2n,3n)],upper:[probabilityMass(2n,3n)]});
  }finally{session.close();}
});

for(const cold of [false,true])test(`instruction-only continuations retain exact values without rescanning the belief graph during ${cold?'cold':'live'} execution`,()=>{
  const f=fixture({root:{actions:{go:one('middle')}},middle:{actions:{finish:one('win')}},win:{reward:unitMass()}});
  type Delayed={base:ExpansionState;remaining:number};
  function delay(base:ExactExpansion<Current,ExpansionState>,remaining:number):ExactExpansion<Current,Delayed>{
    return{get complete(){return remaining===0&&base.complete;},get delivered(){return base.delivered;},
      step(){if(remaining){remaining--;return true;}return base.step();},take:()=>base.take(),
      save:()=>({base:base.save(),remaining}),close:()=>base.close()};
  }
  const domain:ExactDomain<Current,Current,Delayed>={...f.domain,
    next:(current,action)=>delay(f.domain.next(current,action),128),
    restoreExpansion:saved=>delay(f.domain.restoreExpansion(saved.base),saved.remaining)};
  let session=SearchSession.from(domain,f.root),scans=0;
  const instrument=()=>{
    // Count actual interval summations, not calls to the scheduling wrapper.
    const internal=session as unknown as {partial(...args:unknown[]):unknown};
    const partial=internal.partial.bind(session);internal.partial=(...args)=>{scans++;return partial(...args);};
  };
  try{
    session.evidence();instrument();
    for(let i=0;i<64;i++){assert.equal(session.step(),true);assert.equal(session.evidence().status,'incomplete');}
    assert.equal(scans,0,'no value evidence changed during these original continuations');
    if(cold){const saved=deserialize(serialize(session.save()));session.close();session=SearchSession.restore(domain,saved);instrument();}
    const before=scans;
    for(let i=0;i<64;i++){session.step();session.save();}
    assert.equal(scans,before,'saving or resuming a pure continuation must not sum unchanged laws');
    session.step();assert.equal(scans,before,'an unpublished nonterminal result still has the full unknown value interval');
    assert.equal(session.evidence().beliefs,1);
    session.step();assert.equal(session.evidence().beliefs,2);assert.ok(scans>before,'publication changes graph dependencies');
    while(session.step()){}
    assert.equal(session.evidence().action?.key,'go');
    assert.deepEqual(session.evidence().score,{lower:[unitMass()],upper:[unitMass()]});
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`new terminal evidence is visible after a later continuation exception during ${cold?'cold':'live'} execution`,()=>{
  const f=fixture({root:{actions:{go:[{state:'win',mass:probabilityMass(1n,4n)},{state:'loss',mass:probabilityMass(3n,4n)}]}},
    win:{reward:unitMass()},loss:{reward:zeroMass()}});
  const position=f.domain.position,next=f.domain.next;let failProjection=true,failTake=false;
  f.domain.position=current=>{if(current.state==='win'&&failProjection){failProjection=false;throw Error('projection interrupted');}return position(current);};
  f.domain.next=(current,action)=>{const expansion=next(current,action),take=expansion.take.bind(expansion);
    expansion.take=()=>{if(failTake){failTake=false;throw Error('continuation interrupted');}return take();};return expansion;};
  let session=SearchSession.from(f.domain,f.root);
  try{
    assert.throws(()=>session.step(),/projection interrupted/);
    failTake=true;assert.throws(()=>session.step(),/continuation interrupted/);
    // Projection committed the delivered terminal prefix before take failed.
    // Readers must refresh it even though neither scheduling step returned.
    const saved=deserialize(serialize(session.save()));
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(1n,4n)],upper:[unitMass()]});
    assert.equal(session.evidence().steps,0n);assert.equal(f.executions.get('0:go:0'),1);
    if(cold){session.close();session=SearchSession.restore(f.domain,saved);}
    while(session.step()){}
    assert.deepEqual(session.evidence().score,{lower:[probabilityMass(1n,4n)],upper:[probabilityMass(1n,4n)]});
    assert.equal(session.evidence().action?.key,'go');assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`prepared terminal evidence strictly bounds a partial law without choosing a hidden policy; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{safe:one('half'),risky:[{state:'doomed',mass:probabilityMass(3n,4n)},{state:'win',mass:quarter}]}},
    half:{reward:half},doomed:{actions:{left:one('loss'),right:one('loss')}},loss:{reward:zeroMass()},win:{reward:unitMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return inner.complete;},get delivered(){return inner.delivered;},
    step(){return inner.save().cursor===1?true:inner.step();},take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'&&action==='risky'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'&&saved.action==='risky'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0,sawOpenAlternative=false;
  try{
    while(session.step()){
      assert.ok(++steps<300,'a proved losing prefix must not wait forever for the remaining law');
      const saved=session.save(),doomed=saved.executions.find(row=>row.current.state==='doomed');
      if(doomed&&doomed.edges.length<2){
        sawOpenAlternative=true;assert.deepEqual(session.evidence().score.upper,[unitMass()], 'an unopened action keeps its full upper bound');
      }
      if(cold){
        const before=[...f.executions],advance=f.domain.next;session.close();
        f.domain.next=()=>{throw Error('Cold upper-bound derivation cannot execute history');};
        try{session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}finally{f.domain.next=advance;}
        assert.deepEqual([...f.executions],before);
      }
    }
    assert.ok(sawOpenAlternative);
    const result=session.evidence(),saved=session.save(),risky=saved.executions[0]!.edges.find(edge=>edge.action==='risky')!;
    assert.equal(result.status,'proven-action');assert.equal(result.action!.key,'safe');
    assert.deepEqual(result.score,{lower:[half],upper:[half]});
    assert.equal(risky.complete,false);assert.equal(risky.expansion!.cursor,1);
    assert.deepEqual(risky.expansion!.delivered,probabilityMass(3n,4n));
    assert.equal(saved.beliefs[0]!.edges.find(edge=>edge.action==='risky')!.published,false);
    assert.equal(saved.beliefs.length,2,'the partial law must never publish a hidden-world policy');
    assert.equal(result.pendingEdges,1);assert.equal(result.runnableEdges,0,'the remaining quarter stays retained behind strict dominance');
    assert.ok(saved.queue.some(task=>task.belief===0&&task.action==='risky'));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`prepared upper bounds take componentwise maxima and do not certify an open law; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:one('choice')}},choice:{actions:{first:one('a'),second:one('b')}},
    a:{reward:half},b:{reward:zeroMass()}},true);
  const position=f.domain.position;f.domain.upper=[unitMass(),null];
  f.domain.position=current=>{const result=position(current);return{...result,
    terminal:current.state==='a'?[half,zeroMass()]:current.state==='b'?[zeroMass(),unitMass()]:null};};
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return false;},get delivered(){return inner.delivered;},
    step(){return inner.complete?true:inner.step();},take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<160;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save();session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    }
    assert.deepEqual(session.evidence().score,{lower:[half,zeroMass()],upper:[half,unitMass()]},'the lower vector belongs to one feasible path, not componentwise independent choices');
    assert.equal(session.evidence().status,'incomplete');assert.equal(session.evidence().action,null);
    assert.equal(session.save().beliefs.length,1);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`prepared recurrent successors retain unknown mass instead of becoming terminal; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n);
  const f=fixture({root:{actions:{enter:one('loop')}},loop:{actions:{stay:[{state:'loss',mass:half},{state:'loop',mass:half}]}},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return false;},get delivered(){return inner.delivered;},step(){return inner.complete?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<160;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save();session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    }
    assert.deepEqual(session.evidence().score,{lower:[zeroMass()],upper:[half]});
    assert.equal(session.evidence().status,'incomplete');assert.equal(session.evidence().action,null);
    const saved=session.save();assert.equal(saved.beliefs.length,1);
    assert.ok(saved.executions.some(row=>row.equivalentTo!=null),'the retained recurrence is genuine complete-state equivalence');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`unconstrained nonterminal prefixes are not rescanned when another terminal arrives; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),f=fixture({root:{actions:{enter:[{state:'a',mass:half},{state:'win',mass:half}]}},
    a:{actions:{finish:one('win')}},win:{reward:unitMass()}},true);
  const position=f.domain.position;let actionReads=0;
  f.domain.position=current=>{const value=position(current);return current.state==='a'?{...value,get actions(){actionReads++;return value.actions;}}:value;};
  let session=SearchSession.from(f.domain,f.root);
  try{
    session.step();
    if(cold){const saved=session.save();session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    const before=actionReads;session.step();assert.equal(actionReads,before,'no prepared terminal evidence exists for that child');
    assert.deepEqual(session.evidence().score,{lower:[half],upper:[unitMass()]});
    while(session.step()){}
    assert.equal(session.evidence().status,'proven-action');assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`a failed prepared-dependency derivation retries accounting without repeating a transition; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),f=fixture({root:{actions:{enter:[{state:'win',mass:half},{state:'loss',mass:half}]}},
    win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const position=f.domain.position;let fail=false;
  f.domain.position=current=>{const value=position(current);return current.state==='root'?{...value,get actions(){
    if(fail){fail=false;throw Error('dependency unavailable');}return value.actions;
  }}:value;};
  let session=SearchSession.from(f.domain,f.root);
  try{
    fail=true;assert.throws(()=>session.step(),/dependency unavailable/);
    assert.equal(f.executions.size,1);const saved=session.save();assert.equal(saved.executions[0]!.edges[0]!.outcomes.length,1);
    if(cold){session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    while(session.step()){}
    assert.equal(session.evidence().status,'proven-action');assert.deepEqual(session.evidence().score,{lower:[half],upper:[half]});
    assert.equal(f.executions.size,2);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});


for(const cold of [false,true])test(`retained multi-node upper proofs leave a cyclic back edge unknown; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),f=fixture({root:{actions:{enter:one('a')}},
    a:{actions:{stay:[{state:'b',mass:half},{state:'loss',mass:half}]}},
    b:{actions:{stay:[{state:'a',mass:half},{state:'loss',mass:half}]}},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return false;},get delivered(){return inner.delivered;},step(){return inner.complete?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<600;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
    }
    const result=session.evidence();assert.deepEqual(result.score,{lower:[zeroMass()],upper:[probabilityMass(1n,4n)]});
    assert.equal(result.status,'incomplete');assert.equal(result.action,null,'the unresolved repeat mass cannot be treated as an already solved loss');
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`retained descendant bounds propagate through complete actions while preserving the unfinished parent law; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{safe:one('half'),bad:[{state:'deep',mass:probabilityMass(3n,4n)},{state:'win',mass:quarter}]}},
    deep:{actions:{left:one('middle'),right:one('middle')}},middle:{actions:{left:one('loss'),right:one('loss')}},
    half:{reward:half},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return inner.complete;},get delivered(){return inner.delivered;},step(){return inner.save().cursor===1?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'&&action==='bad'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'&&saved.action==='bad'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<400;step++){
      const progressed=session.step();
      if(cold){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
      if(!progressed)break;
    }
    const result=session.evidence(),bad=result.actions.find(action=>action.key==='bad')!;
    assert.deepEqual(bad.score.upper,[quarter],'all paths through the retained deeper actions already terminate at zero');
    assert.equal(bad.dominatedBy,'safe');assert.equal(result.action?.key,'safe');assert.equal(result.status,'proven-action');
    assert.equal(result.pendingEdges,1);assert.equal(result.runnableEdges,0);
    const saved=session.save(),law=saved.executions[0]!.edges.find(edge=>edge.action==='bad')!;
    assert.equal(law.complete,false);assert.equal(law.expansion!.cursor,1);assert.deepEqual(law.expansion!.delivered,probabilityMass(3n,4n));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`root witnesses sum compatible disjoint leaves after a shared prefix without completing an open law; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{enter:[{state:'middle',mass:half},{state:'loss',mass:half}],
    alternative:[{state:'win',mass:probabilityMass(3n,8n)},{state:'loss',mass:probabilityMass(5n,8n)}]}},
    middle:{actions:{draw:[{state:'a',mass:half},{state:'b',mass:half}]}},
    a:{information:'hidden',actions:{finish:one('win'),fail:one('loss')}},
    b:{information:'hidden',actions:{finish:one('win'),fail:one('loss')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return false;},get delivered(){return inner.delivered;},step(){return inner.complete?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<400;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
    }
    const result=session.evidence();assert.deepEqual(result.score.lower,[half],'two compatible 1/4 leaves sum to 1/2, not just one path or the entire root mass');
    assert.notDeepEqual(result.score.lower,[quarter]);assert.equal(result.action,null);assert.equal(result.status,'incomplete');
    const alternative=result.actions.find(action=>action.key==='alternative')!;
    assert.deepEqual(alternative.score.upper,[probabilityMass(3n,8n)]);assert.equal(alternative.dominatedBy,'enter');
    assert.equal(result.pendingEdges,2);assert.equal(result.runnableEdges,1,'only the compatible sum proves strict superiority; the unfinished alternative remains saved');
    assert.equal(session.save().beliefs.length,1);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`root path witnesses never add incompatible hidden policies; cold=${cold}`,()=>{
  const majority=probabilityMass(3n,4n),minority=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{enter:[{state:'a',mass:majority},{state:'b',mass:minority}]}},
    a:{information:'hidden',actions:{left:one('win'),right:one('loss')}},
    b:{information:'hidden',actions:{left:one('loss'),right:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return false;},get delivered(){return inner.delivered;},step(){return inner.complete?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<400;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save(),before=[...f.executions],advance=f.domain.next;session.close();f.domain.next=()=>{throw Error('Witness restoration cannot replay');};
        try{session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}finally{f.domain.next=advance;}assert.deepEqual([...f.executions],before);}
    }
    assert.deepEqual(session.evidence().score,{lower:[majority],upper:[unitMass()]});
    assert.equal(session.evidence().status,'incomplete');assert.equal(session.evidence().action,null);
    assert.equal(session.save().beliefs.length,1);assert.equal(f.executions.size,6);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const consistent of [false,true])for(const cold of [false,true])test(`root path witness checks repeated public information; consistent=${consistent}; cold=${cold}`,()=>{
  const f=fixture({root:{information:'repeated',actions:{go:one('middle'),exit:one('loss')}},
    middle:{information:'repeated',actions:{go:one(consistent?'win':'loss'),exit:one(consistent?'loss':'win')}},
    win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return false;},get delivered(){return inner.delivered;},step(){return inner.complete?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'&&action==='go'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'&&saved.action==='go'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<200;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save();session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    }
    assert.ok(session.save().executions.some(row=>row.current.state==='win'));
    assert.deepEqual(session.evidence().score.lower,[consistent?unitMass():zeroMass()]);
    assert.equal(session.evidence().status,'incomplete','even matching exact bounds cannot bypass the open law');
    assert.equal(session.evidence().action,null);assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`root witnesses condition their mass again after adopting an actual successor; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{enter:[{state:'middle',mass:quarter},{state:'loss',mass:probabilityMass(3n,4n)}]}},
    middle:{actions:{enter:[{state:'deep',mass:half},{state:'loss',mass:half}]}},deep:{actions:{finish:one('win')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return inner.complete;},get delivered(){return inner.delivered;},step(){return inner.save().cursor===1?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='middle'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='middle'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root),steps=0;
  try{
    while(!session.save().executions.some(row=>row.current.state==='win')){assert.equal(session.step(),true);assert.ok(++steps<200);}
    assert.deepEqual(session.evidence().score.lower,[probabilityMass(1n,8n)]);
    assert.equal(session.rebase({state:'middle',identity:100000},'enter'),true);
    if(cold){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
    assert.deepEqual(session.evidence().score.lower,[half],'the old 1/4 arrival chance is a realized observation after adoption');
    assert.equal(session.evidence().status,'incomplete');assert.equal(session.evidence().action,null);
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`internal belief path witnesses cannot combine conflicting hidden choices in open laws; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const winning=[{state:'deep',mass:half},{state:'loss',mass:half}],losing=[{state:'doomed',mass:half},{state:'loss',mass:half}];
  const f=fixture({root:{actions:{enter:[{state:'a',mass:half},{state:'b',mass:half}]}},
    a:{information:'hidden-choice',actions:{left:winning,right:losing}},b:{information:'hidden-choice',actions:{left:losing,right:winning}},
    deep:{actions:{finish:one('win')}},doomed:{actions:{finish:one('loss')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return inner.complete;},get delivered(){return inner.delivered;},step(){return inner.save().cursor===1?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  const hidden=(state:string)=>state==='a'||state==='b';
  f.domain.next=(current,action)=>hidden(current.state)?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>hidden(saved.source.state)?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<400;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
    }
    const result=session.evidence();assert.deepEqual(result.score.lower,[quarter],'one common action wins only one hidden half with half its conditional mass');
    assert.equal(result.status,'incomplete');assert.equal(result.action,null);assert.equal(result.pendingEdges,2);
    const saved=session.save();assert.equal(saved.beliefs.length,2);
    const internal=saved.beliefs[1]!;assert.equal(internal.worlds.length,2);assert.ok(internal.edges.every(edge=>!edge.published));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`internal belief witnesses use conditional mass and suspend an inferior open action; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{enter:[{state:'middle',mass:half},{state:'loss',mass:half}]}},
    middle:{actions:{go:[{state:'deep',mass:half},{state:'loss',mass:half}],trap:[{state:'doomed',mass:probabilityMass(3n,4n)},{state:'win',mass:quarter}]}},
    deep:{actions:{finish:one('win')}},doomed:{actions:{left:one('loss'),right:one('loss')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return inner.complete;},get delivered(){return inner.delivered;},step(){return inner.save().cursor===1?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='middle'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='middle'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<250;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save(),before=[...f.executions];session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));assert.deepEqual([...f.executions],before);}
    }
    const result=session.evidence();assert.deepEqual(result.score.lower,[quarter]);
    assert.equal(result.status,'incomplete');assert.equal(result.action,null);
    assert.equal(result.pendingEdges,2);assert.equal(result.runnableEdges,1,'the middle belief has lower(go)=1/2 > upper(trap)=1/4, independently of its 1/2 arrival chance');
    const saved=session.save(),middle=saved.executions.find(row=>row.current.state==='middle')!;
    const law=middle.edges.find(edge=>edge.action==='trap')!;
    assert.equal(law.complete,false);assert.equal(law.expansion!.cursor,1);assert.equal(saved.queue.length,2);
    assert.deepEqual(law.expansion!.delivered,probabilityMass(3n,4n));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});

for(const cold of [false,true])test(`a feasible root path lower bound suspends a strictly inferior open law without dropping it; cold=${cold}`,()=>{
  const half=probabilityMass(1n,2n),quarter=probabilityMass(1n,4n);
  const f=fixture({root:{actions:{go:[{state:'deep',mass:half},{state:'loss',mass:half}],
    trap:[{state:'doomed',mass:probabilityMass(3n,4n)},{state:'win',mass:quarter}]}},
    deep:{actions:{finish:one('win')}},doomed:{actions:{left:one('loss'),right:one('loss')}},win:{reward:unitMass()},loss:{reward:zeroMass()}},true);
  const next=f.domain.next,restore=f.domain.restoreExpansion;
  const hold=(inner:ExactExpansion<Current,ExpansionState>):ExactExpansion<Current,ExpansionState>=>({
    get complete(){return inner.complete;},get delivered(){return inner.delivered;},step(){return inner.save().cursor===1?true:inner.step();},
    take:()=>inner.take(),save:()=>inner.save(),close:()=>inner.close(),
  });
  f.domain.next=(current,action)=>current.state==='root'?hold(next(current,action)):next(current,action);
  f.domain.restoreExpansion=saved=>saved.source.state==='root'?hold(restore(saved)):restore(saved);
  let session=SearchSession.from(f.domain,f.root);
  try{
    for(let step=0;step<200;step++){
      assert.equal(session.step(),true);
      if(cold){const saved=session.save();session.close();session=SearchSession.restore(f.domain,deserialize(serialize(saved)));}
    }
    const result=session.evidence();assert.deepEqual(result.score.lower,[half]);
    assert.equal(result.status,'incomplete');assert.equal(result.action,null);
    assert.equal(result.pendingEdges,2);assert.equal(result.runnableEdges,1);
    const trap=result.actions.find(action=>action.key==='trap')!;
    assert.deepEqual(trap.score.upper,[quarter]);assert.equal(trap.dominatedBy,'go');
    const saved=session.save();assert.equal(saved.queue.length,2);assert.equal(saved.beliefs.length,1);
    const law=saved.executions[0]!.edges.find(edge=>edge.action==='trap')!;
    assert.equal(law.complete,false);assert.equal(law.expansion!.cursor,1);
    assert.deepEqual(law.expansion!.delivered,probabilityMass(3n,4n));
    assert.ok([...f.executions.values()].every(count=>count===1));
  }finally{session.close();}
});
