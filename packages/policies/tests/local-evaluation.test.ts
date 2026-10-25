import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLocalGraph,type LocalNode,type LocalEdge} from '../src/search/local-evaluation.ts';
import {unitMass,zeroMass,probabilityMass,numericMass,addMass,multiplyMass,type ProbabilityMass} from '../../card-engine/src/probability-mass.ts';
import type {ExactPosition} from '../src/search/session.types.ts';
const position=(information:string,priority:number,terminal=false,keys:string[]=[]):ExactPosition=>({information,priority,terminal:terminal?[numericMass(priority)]:null,actions:keys.map(key=>({key,action:key}))});
const law=(key:string,outcomes:{belief:number;mass:ProbabilityMass}[]):LocalEdge=>({key,published:true,outcomes,leaves:[]});
const known=(key:string,p:ExactPosition,mass=unitMass()):LocalEdge=>({key,published:false,outcomes:[],leaves:[{position:p,mass}]});
const run=(nodes:LocalNode[])=>evaluateLocalGraph(0,id=>nodes[id]!,p=>p.priority);

test('local evaluation selects a nonterminal board without calling it a terminal or a completed search',()=>{
 const nodes:LocalNode[]=[{position:position('root',.4,false,['weak','strong']),edges:[known('weak',position('weak',.2)),known('strong',position('strong',.8))]}];
 const before=structuredClone(nodes),r=run(nodes);
 assert.equal(r.action!.key,'strong');assert.equal(r.searchComplete,false);assert.deepEqual(nodes,before);
 assert.deepEqual(r.actions[1]!.frontier,unitMass());assert.deepEqual(r.actions[1]!.terminal,zeroMass());
});
test('unvisited probability keeps its full exact mass and is never normalized to the observed prefix',()=>{
 const quarter=probabilityMass(1n,4n);
 const r=run([{position:position('root',.5,false,['gamble','safe']),edges:[known('gamble',position('win',1,true),quarter),known('safe',position('safe',.4))]}]);
 assert.equal(r.action!.key,'gamble','selection uses an explicit public prior, not the pessimistic interval endpoint');const gamble=r.actions[0]!;
 assert.deepEqual(gamble.lower,quarter);assert.deepEqual(gamble.upper,unitMass());assert.deepEqual(gamble.unresolved,probabilityMass(3n,4n));
 assert.deepEqual(gamble.estimate,probabilityMass(5n,8n));
 assert.equal(r.unknownPrior,'source-public-board');assert.equal(r.confirmedDeathPenalty,1);
});
test('untransferred original public prefixes retain their weight and uncertainty without renormalizing leaves',()=>{
 const eighth=probabilityMass(1n,8n),edge=known('draw',position('observed',.75),eighth);
 edge.pending=[{utility:.5,mass:probabilityMass(3n,8n)},{utility:.75,mass:probabilityMass(4n,8n)}];
 const nodes:LocalNode[]=[{position:position('root',.25,false,['draw','safe']),edges:[edge,known('safe',position('safe',.5))]}];
 const before=structuredClone(nodes),r=run(nodes),draw=r.actions[0]!;
 assert.equal(r.action!.key,'draw');assert.equal(r.unknownPrior,'retained-public-prefix-or-source');
 assert.deepEqual(draw.estimate,probabilityMass(21n,32n));assert.deepEqual(draw.immediateEstimate,draw.estimate);
 assert.deepEqual(draw.unresolved,probabilityMass(7n,8n));assert.deepEqual(draw.lower,probabilityMass(3n,32n));
 assert.deepEqual(draw.upper,probabilityMass(31n,32n));assert.deepEqual(draw.observedSuccessorMass,eighth);
 assert.deepEqual(nodes,before);assert.equal(r.searchComplete,false);
 const cold=run(structuredClone(nodes));assert.deepEqual(cold,r);
});
test('prefix estimates retain the source prior for untouched mass and cannot manufacture an original successor',()=>{
 const edge:LocalEdge={key:'draw',published:false,outcomes:[],leaves:[],pending:[{utility:1,mass:probabilityMass(1n,4n)}]};
 const r=run([{position:position('root',.5,false,['draw']),edges:[edge]}]);
 assert.deepEqual(r.actions[0]!.estimate,probabilityMass(5n,8n));
 assert.deepEqual(r.actions[0]!.unresolved,unitMass());assert.deepEqual(r.actions[0]!.observedSuccessorMass,zeroMass());
 assert.deepEqual(r.actions[0]!.lower,zeroMass());assert.deepEqual(r.actions[0]!.upper,unitMass());
 assert.equal(r.action,null);assert.equal(r.pendingAction,'draw');assert.equal(r.informationDecisions,0);
});
test('an unfinished law is not scored as death and its estimate never normalizes the delivered prefix',()=>{
 const nodes:LocalNode[]=[{position:position('root',.5,false,['random','deterministic']),edges:[
  known('random',position('better',.75),probabilityMass(1n,8n)),known('deterministic',position('worse',.375)),
 ]}];
 const before=structuredClone(nodes),r=run(nodes),row=r.actions[0]!;
 assert.equal(r.action!.key,'random');assert.deepEqual(row.lower,probabilityMass(3n,32n));
 assert.deepEqual(row.estimate,probabilityMass(17n,32n));assert.deepEqual(row.upper,probabilityMass(31n,32n));
 assert.deepEqual(row.unresolved,probabilityMass(7n,8n));assert.deepEqual(row.frontier,probabilityMass(1n,8n));
 assert.deepEqual(row.minimumTerminal,zeroMass());assert.deepEqual(nodes,before);
 nodes[0]!.edges[0]=known('random',position('better',.75));
 const complete=run(nodes).actions[0]!;
 assert.deepEqual(complete.estimate,numericMass(.75));assert.deepEqual(complete.lower,complete.estimate);
 assert.deepEqual(complete.upper,complete.estimate);assert.deepEqual(complete.unresolved,zeroMass());
});
test('confirmed fatal probability penalizes a high mean and cannot disappear behind a favorable earlier frontier',()=>{
 const half=probabilityMass(1n,2n),emptyLaw:LocalEdge={key:'unknown',published:false,outcomes:[],leaves:[]};
 const risky:LocalEdge={key:'risk',published:false,outcomes:[],leaves:[
  {position:position('dead',0,true),mass:half},{position:position('win',1,true),mass:half},
 ]};
 assert.equal(run([{position:position('root',.5,false,['risk','safe']),edges:[risky,known('safe',position('safe',.375))]}]).action!.key,'safe');
 // Expose a small known fatal tail with unfinished work at a reached node.
 const r=run([
  {position:position('root',.5,false,['enter']),edges:[law('enter',[{belief:1,mass:unitMass()}])]},
  {position:position('tempting',.875,false,['risk','unknown']),edges:[
   {key:'risk',published:false,outcomes:[],leaves:[{position:position('dead',0,true),mass:probabilityMass(1n,64n)},
    {position:position('good',1),mass:probabilityMass(62n,64n)}]},emptyLaw,
  ]},
 ]);
 assert.deepEqual(r.actions[0]!.minimumTerminal,probabilityMass(1n,64n));
 assert.deepEqual(r.actions[0]!.unresolved,probabilityMass(1n,64n));
 assert.deepEqual(r.actions[0]!.estimate,probabilityMass(503n,512n));
 const forcedRisk=run([
  {position:position('root',.5,false,['enter']),edges:[law('enter',[{belief:1,mass:unitMass()}])]},
  {position:position('tempting',.875,false,['risk','worse']),edges:[
   {key:'risk',published:false,outcomes:[],leaves:[{position:position('dead',0,true),mass:probabilityMass(1n,4n)},
    {position:position('win',1,true),mass:probabilityMass(3n,4n)}]},known('worse',position('dead',0,true),half),
  ]},
 ]);
 assert.deepEqual(forcedRisk.actions[0]!.estimate,probabilityMass(3n,4n));
 assert.deepEqual(forcedRisk.actions[0]!.minimumTerminal,probabilityMass(1n,4n));
 assert.deepEqual(forcedRisk.actions[0]!.frontier,zeroMass(),'a higher earlier board cannot erase confirmed risk');
});
test('unknown action laws cannot manufacture a decision or erase a tiny retained probability',()=>{
 const tiny=probabilityMass(1n,10n**400n),root=position('root',.5,false,['a']);
 const empty:LocalEdge={key:'a',published:false,outcomes:[],leaves:[]};
 assert.equal(run([{position:root,edges:[empty]}]).action,null);
 const r=run([{position:root,edges:[known('a',position('win',1,true),tiny)]}]);
 assert.deepEqual(r.actions[0]!.lower,tiny);assert.deepEqual(r.actions[0]!.unresolved,probabilityMass(10n**400n-1n,10n**400n));
});
test('opposite hidden optima use one public action even across repeated information keys',()=>{
 const half=probabilityMass(1n,2n),p=position('same-visible',.5,false,['left','right']);
 const r=run([
  {position:position('root',.5,false,['enter']),edges:[law('enter',[{belief:1,mass:half},{belief:2,mass:half}])]},
  {position:p,edges:[known('left',position('win',1,true)),known('right',position('loss',0,true))]},
  {position:structuredClone(p),edges:[known('left',position('loss',0,true)),known('right',position('win',1,true))]},
 ]);
 assert.deepEqual(r.actions[0]!.lower,half);assert.deepEqual(r.actions[0]!.upper,half);assert.deepEqual(r.actions[0]!.minimumTerminal,half);
});
test('local lookahead combines original probabilities across several public decisions',()=>{
 const r=run([
  {position:position('root',.5,false,['direct','setup']),edges:[known('direct',position('direct',.6)),law('setup',[{belief:1,mass:unitMass()}])]},
  {position:position('setup',.3,false,['bad','finish']),edges:[known('bad',position('bad',.1)),known('finish',position('finish',.9))]},
 ]);
 assert.equal(r.action!.key,'setup');assert.deepEqual(r.actions[1]!.lower,numericMass(.9));assert.deepEqual(r.actions[1]!.frontier,unitMass());
});
test('opening an incomplete future law does not erase an already reached public board',()=>{
 const p=position('good-board',.8,false,['draw','waste']),nodes:LocalNode[]=[
  {position:position('root',.5,false,['good','other']),edges:[law('good',[{belief:1,mass:unitMass()}]),known('other',position('other',.6))]},
  {position:p,edges:[{key:'draw',published:false,outcomes:[],leaves:[]},known('waste',position('worse',.1))]},
 ];
 const untouched=structuredClone(nodes);
 assert.equal(run(nodes).action!.key,'good');
 nodes[1]!.edges[0]=known('draw',position('later',.9),probabilityMass(1n,1000n));
 const before=structuredClone(nodes),r=run(nodes);
 assert.equal(r.action!.key,'good');
 const knownPart=multiplyMass(numericMass(.9),probabilityMass(1n,1000n)),unknownPart=probabilityMass(999n,1000n);
 assert.deepEqual(r.actions[0]!.lower,knownPart);
 assert.deepEqual(r.actions[0]!.estimate,addMass(knownPart,multiplyMass(numericMass(.8),unknownPart)));
 assert.deepEqual(r.actions[0]!.unresolved,unknownPart);
 assert.deepEqual(r.actions[0]!.frontier,probabilityMass(1n,1000n));assert.deepEqual(r.actions[0]!.terminal,zeroMass());
 assert.deepEqual(nodes,before,'stopping the lookahead does not discard the future law or its unvisited mass');
 assert.notDeepEqual(nodes,untouched,'the extra observed future is retained');
});
test('partly observed nonfatal loss cannot be erased by inserting an earlier favorable board',()=>{
 for(const reverse of [false,true])for(const cold of [false,true]){
  let nodes:LocalNode[]=[
   {position:position('root',.875,false,['delay','direct']),edges:[law('delay',[{belief:1,mass:unitMass()}]),known('direct',position('direct',.625))]},
   {position:position('spent-resource',.75,false,['continue']),edges:[known('continue',position('loss',.25),probabilityMass(1n,2n))]},
  ];
  if(reverse)nodes[0]!.edges.reverse();if(cold)nodes=structuredClone(nodes);
  const before=structuredClone(nodes),r=run(nodes),delay=r.actions.find(row=>row.key==='delay')!;
  assert.equal(r.action!.key,'direct','adding a decision before the loss must not raise its value');
  assert.deepEqual(delay.lower,probabilityMass(1n,8n));assert.deepEqual(delay.upper,probabilityMass(5n,8n));
  assert.deepEqual(delay.estimate,probabilityMass(1n,2n));assert.deepEqual(delay.unresolved,probabilityMass(1n,2n));
  assert.deepEqual(delay.frontier,probabilityMass(1n,2n));assert.deepEqual(delay.minimumTerminal,zeroMass());
  assert.deepEqual(nodes,before,'unvisited support and observed successors remain retained');
 }
});
test('fully resolved future loss and certain death cannot be hidden by a favorable earlier board',()=>{
 for(const dead of [false,true]){
  const r=run([
   {position:position('root',.5,false,['trap','safe']),edges:[law('trap',[{belief:1,mass:unitMass()}]),known('safe',position('safe',.4))]},
   {position:position('tempting-board',.9,false,['forced']),edges:[known('forced',position('later',dead?0:.1,dead))]},
  ]);
  assert.equal(r.action!.key,'safe');assert.deepEqual(r.actions[0]!.lower,numericMass(dead?0:.1));
  assert.deepEqual(r.actions[0]!.minimumTerminal,dead?unitMass():zeroMass());
 }
});
test('certain death is rejected when an alternative is unresolved, but remains selectable if inevitable',()=>{
 const loss=known('die',position('dead',0,true)),other:LocalEdge={key:'unknown',published:false,outcomes:[],leaves:[]};
 const r=run([{position:position('root',.5,false,['die','unknown']),edges:[loss,other]}]);
 assert.equal(r.action,null);assert.equal(r.pendingAction,'unknown');assert.deepEqual(r.actions[1]!.unresolved,unitMass());
 assert.equal(run([{position:position('root',.5,false,['die']),edges:[loss]}]).action!.key,'die');
});
test('an anytime decision chooses a reached viable successor without chasing an unseen optimistic prior',()=>{
 const nodes:LocalNode[]=[{position:position('root',.8,false,['unseen','known']),edges:[
  {key:'unseen',published:false,outcomes:[],leaves:[]},known('known',position('worse',.6)),
 ]}];
 const before=structuredClone(nodes),waiting=run(nodes);
 assert.equal(waiting.action!.key,'known');assert.equal(waiting.pendingAction,null);assert.deepEqual(nodes,before);
 assert.deepEqual(waiting.actions[0]!.observedSuccessorMass,zeroMass());
 assert.deepEqual(waiting.actions[0]!.unresolved,unitMass());assert.equal(waiting.searchComplete,false);
 nodes[0]!.edges[0]=known('unseen',position('fatal',0,true));
 const decided=run(nodes);assert.equal(decided.action!.key,'known');assert.equal(decided.pendingAction,null);
 assert.deepEqual(decided.actions[0]!.minimumTerminal,unitMass());
});
test('a reached successor is actionable even when all of its later choices remain unknown',()=>{
 const result=run([
  {position:position('root',.5,false,['enter']),edges:[law('enter',[{belief:1,mass:unitMass()}])]},
  {position:position('child',.6,false,['later']),edges:[{key:'later',published:false,outcomes:[],leaves:[]}]},
 ]);
 assert.equal(result.action!.key,'enter');assert.equal(result.pendingAction,null);
 assert.deepEqual(result.actions[0]!.observedSuccessorMass,unitMass());
});
test('a fully unchanged self-loop is bypassed while its original support remains stored',()=>{
 const nodes:LocalNode[]=[{position:position('root',.9,false,['wait','exit']),edges:[law('wait',[{belief:0,mass:unitMass()}]),known('exit',position('exit',.6))]}];
 const before=structuredClone(nodes),r=run(nodes);assert.equal(r.action!.key,'exit');assert.equal(r.actions[0]!.stuttering,true);
 assert.deepEqual(r.actions[0]!.cycle,unitMass());assert.deepEqual(nodes,before);
});
test('explicit root exclusions preserve every law and cannot turn an unseen alternative into a decision',()=>{
 const nodes:LocalNode[]=[{position:position('root',.5,false,['discard','advance']),edges:[known('discard',position('empty-belt',.8)),{key:'advance',published:false,outcomes:[],leaves:[]}]}];
 const excluded=new Set(['discard']),before=structuredClone(nodes);
 const empty=evaluateLocalGraph(0,id=>nodes[id]!,p=>p.priority,excluded);
 assert.equal(empty.action,null);assert.equal(empty.actions.length,2);assert.deepEqual(empty.excludedRootActions,['discard']);assert.deepEqual(nodes,before);
 nodes[0]!.edges[1]=known('advance',position('later',.7),probabilityMass(1n,100n));
 const r=evaluateLocalGraph(0,id=>nodes[id]!,p=>p.priority,excluded);
 assert.equal(r.action!.key,'advance');assert.deepEqual(r.actions[1]!.unresolved,probabilityMass(99n,100n));
 assert.deepEqual(r.actions[0]!.lower,numericMass(.8),'excluded law remains visible and unmodified');
});
test('a root exclusion applies again at the same public information instead of choosing by its hidden occurrence',()=>{
 const p=position('same-public',.5,false,['discard','advance']),nodes:LocalNode[]=[
  {position:p,edges:[known('discard',position('discarded',.8)),law('advance',[{belief:1,mass:unitMass()}])]},
  {position:structuredClone(p),edges:[known('discard',position('later-discard',.9)),known('advance',position('later',.3))]},
 ];
 const r=evaluateLocalGraph(0,id=>nodes[id]!,p=>p.priority,new Set(['discard']));
 assert.equal(r.action!.key,'advance');assert.deepEqual(r.actions[1]!.lower,numericMass(.3));assert.equal(r.informationDecisions,1);
});
test('large finite local graphs use an explicit traversal stack instead of a depth cutoff',()=>{
 const nodes:LocalNode[]=Array.from({length:12000},(_,i)=>({position:position('n'+i,.5,false,['next']),edges:[law('next',[{belief:i+1,mass:unitMass()}])]}));
 nodes.push({position:position('last',.75,false,['pending']),edges:[{key:'pending',published:false,outcomes:[],leaves:[]}]});
 const r=run(nodes);assert.equal(r.action!.key,'next');assert.deepEqual(r.actions[0]!.lower,numericMass(.75));assert.deepEqual(r.actions[0]!.frontier,unitMass());
});


test('equal future values prefer an immediate finish over needless setup, independently of action order',()=>{
 for(const reverse of [false,true])for(const cold of [false,true]){
  let nodes:LocalNode[]=[
   {position:position('root',.4,false,['setup','finish']),edges:[law('setup',[{belief:1,mass:unitMass()}]),known('finish',position('won',.9,true))]},
   {position:position('setup',.4,false,['finish']),edges:[known('finish',position('won',.9,true))]},
  ];
  if(reverse)nodes[0]!.edges.reverse();if(cold)nodes=structuredClone(nodes);
  const before=structuredClone(nodes),r=run(nodes);
  assert.equal(r.action!.key,'finish');assert.deepEqual(nodes,before);
  assert.deepEqual(r.actions.find(row=>row.key==='setup')!.estimate,r.actions.find(row=>row.key==='finish')!.estimate);
 }
});
test('immediate tie preference weights all observed worlds and keeps the full unknown tail',()=>{
 const quarter=probabilityMass(1n,4n),threeQuarters=probabilityMass(3n,4n);
 const nodes:LocalNode[]=[
  {position:position('root',.5,false,['mixed','steady']),edges:[law('mixed',[{belief:1,mass:quarter},{belief:2,mass:threeQuarters}]),law('steady',[{belief:3,mass:unitMass()}])]},
  {position:position('high-now',1,false,['next']),edges:[known('next',position('future',.9))]},
  {position:position('low-now',0,false,['next']),edges:[known('next',position('future',.9))]},
  {position:position('steady-now',.5,false,['next']),edges:[known('next',position('future',.9))]},
 ];
 const r=run(nodes);assert.equal(r.action!.key,'steady');
 assert.deepEqual(r.actions[0]!.immediateEstimate,quarter);
 const partial=run([{position:position('root',.5,false,['open']),edges:[known('open',position('observed',1),quarter)]}]).actions[0]!;
 assert.deepEqual(partial.immediateEstimate,probabilityMass(5n,8n));assert.deepEqual(partial.unresolved,threeQuarters);
});

test('public action preferences break only exact local ties and survive order reversal and cold data',()=>{
 for(const reverse of [false,true])for(const cold of [false,true]){
  let nodes:LocalNode[]=[{position:{...position('root',.5,false,['useful','clutter']),localTiePreferences:{clutter:1}},
   edges:[known('useful',position('same',.5)),known('clutter',position('same',.5))]}];
  if(reverse)nodes[0]!.edges.reverse();if(cold)nodes=structuredClone(nodes);
  const before=structuredClone(nodes),tied=run(nodes);
  assert.equal(tied.action!.key,'clutter');assert.deepEqual(nodes,before);
  assert.deepEqual(tied.actions.map(a=>a.estimate),[numericMass(.5),numericMass(.5)]);
  nodes[0]!.edges=nodes[0]!.edges.map(edge=>edge.key==='useful'?known('useful',position('better',.75)):edge);
  assert.equal(run(nodes).action!.key,'useful','a better observed combination overrides the public preference');
  nodes[0]!.edges=nodes[0]!.edges.map(edge=>edge.key==='clutter'?known('clutter',position('dead',0,true)):edge);
  assert.equal(run(nodes).action!.key,'useful','a preference cannot override observed death');
 }
});
