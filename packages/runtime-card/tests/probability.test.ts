import {ownRuleValue} from '../../card-engine/src/rules-values.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,card} from '@bear-forge/card-engine';
import {probabilityOperation} from '../../card-engine/src/probability.ts';
import {privateCardGraph} from '../src/graph.ts';
import {ProbabilityCurrent,nextProbability,nextProbabilityFrontier,conditionedNextProbabilityFrontier,conditionProbabilityFrontier,saveProbabilityFrontier,restoreProbabilityFrontier,captureForwardFrontier,type ProbabilityFrontier,takeProbabilityCurrent,takeProbabilityRoot} from '../src/probability.ts';
import {createCardLoader} from '../src/loader.ts';
import {ProbabilityTracker,withProbabilityTracking,inspectProbabilityTracking,acquireProbabilityHostCost} from '../src/probability-tracking.ts';
import {memorySnapshotStore} from '../src/store.ts';
import {serialize,deserialize} from 'node:v8';

function fixture(earlyTerminal=false){
  type State={before:number;between:number};
  let before=0,between=0;
  const a=()=>-1,b=()=>-1;
  probabilityOperation<State>(a,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(b,{space:s=>({kind:'uniform',size:BigInt(s.locals.a+2)}),resolve:(_s,c)=>Number(c)});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},{a:number;b:number}>({id:'probability-cow',
    schemas:{setup:z.undefined(),result:z.object({a:z.number(),b:z.number()}),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>({before:0,between:0}),entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),
      card.operation<State>(s=>{s.state.before++;before++;}),card.operation(a,'a'),
      card.operation<State>(s=>{s.state.between++;between++;}),
      ...(earlyTerminal?[card.branch<State>(s=>s.locals.a===0,[card.return(s=>({a:s.locals.a,b:0}))],[])]:[]),card.operation(b,'b'),
      card.return(s=>({a:s.locals.a,b:s.locals.b}))
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));
  machine.advance();
  return{current:new ProbabilityCurrent(machine),counts:()=>({before,between})};
}
const exactEntropy={word(){throw Error('Unexpected sample');},check(){}};
for(const conditioned of [false,true])test(`retained ${conditioned?'conditioned':'ordinary'} currents reclaim discarded temporary state across short forks`,()=>{
  type State={count:number;scratch:{value:number}[]|null;left:{value:number};right:{value:number}};
  let initializations=0,executions=0;
  const program=new CardProgram<State,void,{input:{input:number;output:null}},number>({id:'retained-current-collection',
    schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.number(),output:z.null()}}},
    initialize:()=>{initializations++;const shared={value:0};return{count:0,scratch:null,left:shared,right:shared};},entry:'root',
    effects:[{id:'root',steps:[
      ...Array.from({length:48},()=>[
        card.request<State>(s=>({port:'input' as const,input:s.state.count})),
        card.operation<State>(s=>{executions++;s.state.scratch=Array.from({length:400},(_,value)=>({value}));s.state.left.value+=s.state.scratch[399]!.value;s.state.scratch=null;s.state.count++;}),
      ]).flat(),card.return<State>(s=>s.state.count),
    ]}],
  });
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  let current=new ProbabilityCurrent(machine);
  try{
    const initialNodes=(machine.storage as ReturnType<typeof privateCardGraph>).nodeCount;
    for(let step=0;step<48;step++){
      const parent=current.inspect(),source={representation:'exact' as const,outcomes:[{current,probability:1,data:null}]};
      const result=conditioned?conditionedNextProbabilityFrontier(source,()=>null,{maximum:8,attempts:64,entropy:exactEntropy,likelihood:()=>1}).frontier!:nextProbabilityFrontier(source,()=>null,{maximum:8,entropy:exactEntropy});
      assert.equal(result.outcomes.length,1);assert.deepEqual(current.inspect(),parent);
      current.close();current=result.outcomes[0]!.current;
      assert.equal(current.machine.root.state.count,step+1);
      assert.equal(current.machine.root.state.left,current.machine.root.state.right);
      assert.equal(current.machine.root.state.right.value,399*(step+1));
      assert.ok((current.machine.storage as ReturnType<typeof privateCardGraph>).nodeCount<initialNodes+128,'dead temporary allocations must not accumulate in retained successors');
    }
    assert.deepEqual(current.inspect(),{kind:'done',result:48});assert.equal(initializations,1);assert.equal(executions,48);
  }finally{current.close();}
});
test('chance-to-chance forks finish due collection without repeating original operations',()=>{
  type State={live:{value:number}[];scratch:{value:number}[]|null;count:number};
  let initialized=0,executed=0;
  const draw=()=>0;
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:1n}),resolve:()=>0});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},number>({id:'chance-current-collection',
    schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initialized++;return{live:Array.from({length:5000},(_,value)=>({value})),scratch:null,count:0};},entry:'root',
    effects:[{id:'root',steps:[card.request(()=>({port:'input',input:null})),
      ...Array.from({length:48},()=>[card.operation(draw),card.operation<State>(s=>{
        executed++;s.state.scratch=Array.from({length:400},(_,value)=>({value}));
        s.state.live[0]!.value+=s.state.scratch[399]!.value;s.state.scratch=null;s.state.count++;
      })]).flat(),card.return<State>(s=>s.state.count)]}],
  });
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const root=new ProbabilityCurrent(machine);let current=root.fork();
  try{
    assert.equal(current.advance(null).kind,'chance');
    const initialNodes=(machine.storage as ReturnType<typeof privateCardGraph>).nodeCount;
    for(let step=0;step<48;step++){
      const child=current.fork();
      try{child.advance(0n);}catch(error){child.close();throw error;}
      assert.equal(current.machine.root.state.count,step);
      current.close();current=child;
      assert.equal(current.machine.root.state.count,step+1);
      assert.equal(current.machine.root.state.live[0]!.value,399*(step+1));
      assert.ok((current.machine.storage as ReturnType<typeof privateCardGraph>).nodeCount<initialNodes*2+2048,'short chance forks must not accumulate untraced temporary rows');
    }
    assert.deepEqual(current.inspect(),{kind:'done',result:48});
    assert.equal(initialized,1);assert.equal(executed,48);
    assert.equal(root.machine.root.state.count,0);assert.equal(root.machine.root.state.live[0]!.value,0);
  }finally{current.close();root.close();}
});
test('COW probability expansion executes shared deterministic prefixes once and preserves conditional mass',()=>{
  const f=fixture(),before=f.current.machine.storage.export(f.current.machine.root);
  const result=nextProbability(f.current,null,{maximum:8,entropy:exactEntropy});
  try{
    assert.equal(result.representation,'exact');assert.equal(result.outcomes.length,5);
    assert.deepEqual(result.outcomes.map(o=>o.probability),[.25,.25,1/6,1/6,1/6]);
    assert.deepEqual(result.outcomes.map(o=>o.current.inspect()),[0,1].flatMap(a=>Array.from({length:a+2},(_,b)=>({kind:'done',result:{a,b}}))));
    assert.deepEqual(f.counts(),{before:1,between:2});
    for(const outcome of result.outcomes){assert.equal(outcome.current.machine.program,f.current.machine.program);assert.deepEqual(outcome.current.machine.storage.export(outcome.current.machine.root.state),{before:1,between:1});}
    assert.deepEqual(f.current.machine.storage.export(f.current.machine.root),before);
  }finally{for(const o of result.outcomes)o.current.close();f.current.close();}
});
test('a bounded future tree samples explicitly instead of dropping excess probability branches',()=>{
  const f=fixture();
  const result=nextProbability(f.current,null,{maximum:1,entropy:{check(){},word:()=>0}});
  try{assert.equal(result.representation,'particles');assert.equal(result.outcomes.length,1);assert.equal(result.outcomes[0]!.probability,1);}
  finally{for(const o of result.outcomes)o.current.close();f.current.close();}
});
test('a probability failure closes every internal fork and leaves the source usable',()=>{
  const f=fixture(),active=new Set<object>();
  function track(current:typeof f.current):typeof f.current {
    active.add(current);
    const fork=current.fork.bind(current),close=current.close.bind(current);
    current.fork=()=>track(fork());current.close=()=>{close();active.delete(current);};return current;
  }
  track(f.current);let checks=0;
  try{
    assert.throws(()=>nextProbability(f.current,null,{maximum:8,entropy:{word:()=>0,check(){if(++checks===7)throw Error('cancelled');}}}),/cancelled/);
    assert.deepEqual([...active],[f.current]);assert.equal(f.current.inspect().kind,'call');
  }finally{f.current.close();}
});
test('normal reply schema validation happens before modifying the current continuation',()=>{
  const f=fixture(),before=f.current.machine.storage.export(f.current.machine.root);
  try{assert.throws(()=>f.current.advance(5));assert.deepEqual(f.current.machine.storage.export(f.current.machine.root),before);}
  finally{f.current.close();}
});

test('loader transfers only the current owner into a probability Context, without initializing again',async()=>{
  const f=fixture(),definition=f.current.machine.program.definition;
  f.current.close();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(definition));
  const instance=unwrap(await loaded.core.start(undefined)),owner=unwrap(await instance.transfer());
  const initialize=CardProgram.prototype.initial;
  let current:ProbabilityCurrent<unknown,unknown,{input:{input:null;output:null}},{a:number;b:number}>|undefined;
  try{
    CardProgram.prototype.initial=function(){throw Error('No initialization during handoff');};
    await assert.rejects(takeProbabilityCurrent(instance),/instance_owned/);
    current=await takeProbabilityCurrent(owner);
    assert.equal((await owner.inspect()).ok,false);
    const outcomes=nextProbability(current,null,{maximum:8,entropy:exactEntropy});
    try{assert.equal(outcomes.outcomes.length,5);assert.equal(current.inspect().kind,'call');}
    finally{for(const child of outcomes.outcomes)child.current.close();}
    await assert.rejects(takeProbabilityCurrent(owner),/instance_owned|instance_closed/);
  }finally{CardProgram.prototype.initial=initialize;current?.close();}
});

test('generated values cross COW branches once per sample and cancellation releases their pending Context',()=>{
  let sampled=0,committed=0;
  const draw=()=>({value:-1});
  probabilityOperation(draw,{space:()=>({kind:'sampled'}),resolve:()=>{throw Error('Expected sample');},
    sample:(_s,entropy)=>{sampled++;return{value:entropy.word()};},resolveSample:(_s,value)=>{committed++;return value;}});
  const program=new CardProgram({id:'sampled-current',schemas:{setup:z.undefined(),result:z.object({value:z.number()}),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(draw,'value'),card.return(s=>s.locals.value)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const root=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root),active=new Set<object>();
  function track(current:typeof root):typeof root{active.add(current);const fork=current.fork.bind(current),close=current.close.bind(current);current.fork=()=>track(fork());current.close=()=>{close();active.delete(current);};return current;}
  track(root);
  try{
    let word=0;
    const result=nextProbability(root,null,{maximum:3,entropy:{word:()=>++word,check(){}}});
    try{assert.equal(result.representation,'particles');assert.deepEqual(result.outcomes.map(o=>o.current.inspect()),[1,2,3].map(value=>({kind:'done',result:{value}})));assert.equal(sampled,3);assert.equal(committed,3);}
    finally{for(const child of result.outcomes)child.current.close();}
    assert.deepEqual([...active],[root]);assert.deepEqual(machine.storage.export(machine.root),before);
    let reads=0;
    assert.throws(()=>nextProbability(root,null,{maximum:3,entropy:{word(){if(++reads===2)throw Error('cancelled generator');return 4;},check(){}}}),/cancelled generator/);
    assert.deepEqual([...active],[root]);assert.equal(committed,3);assert.deepEqual(machine.storage.export(machine.root),before);
  }finally{root.close();}
});

test('a named boundary retains the joint effect result and resumes its current frames exactly once',()=>{
  type State={prefix:number;selected:number;count:number;after:number;markers:number};
  let initialized=0,prefix=0,first=0,second=0;
  const a=()=>17,b=()=>29;
  const marker=(s:{state:State})=>{s.state.markers++;};
  probabilityOperation<State>(a,{space:()=>({kind:'weighted',weights:[.25,.75]}),resolve:(_s,c)=>{first++;return Number(c);}});
  probabilityOperation<State>(b,{space:s=>({kind:'uniform',size:BigInt(s.locals.a+1)}),resolve:(_s,c)=>{second++;return Number(c);}});
  probabilityOperation<State>(marker,{space:()=>({kind:'boundary',name:'selected'}),resolve:s=>marker(s)});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},State>({id:'probability-joint-boundary',
    schemas:{setup:z.undefined(),result:z.object({prefix:z.number(),selected:z.number(),count:z.number(),after:z.number(),markers:z.number()}),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initialized++;return{prefix:0,selected:0,count:0,after:0,markers:0};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),
      card.operation<State>(s=>{s.state.prefix++;prefix++;}),card.operation(a,'a'),card.operation(b,'b'),
      card.operation<State>(s=>{s.state.selected=s.locals.a;s.state.count+=s.locals.a+s.locals.b;}),
      card.operation(marker),card.operation<State>(s=>{s.state.after++;}),card.return(s=>s.state),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const root=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  const result=nextProbability(root,null,{maximum:8,entropy:exactEntropy,untilBoundary:'selected'});
  try{
    assert.equal(result.representation,'exact');assert.deepEqual(result.outcomes.map(o=>o.probability),[.25,.375,.375]);
    assert.deepEqual({initialized,prefix,first,second},{initialized:1,prefix:1,first:2,second:3});
    const joint=result.outcomes.map(o=>o.current.machine.storage.export(o.current.machine.root.state));
    assert.deepEqual(joint,[{prefix:1,selected:0,count:0,after:0,markers:0},{prefix:1,selected:1,count:1,after:0,markers:0},{prefix:1,selected:1,count:2,after:0,markers:0}]);
    for(const outcome of result.outcomes){
      assert.deepEqual(outcome.current.inspect(),{kind:'chance',space:{kind:'boundary',name:'selected'}});
      const source=outcome.current.machine.storage.export(outcome.current.machine.root);
      const next=nextProbability(outcome.current,0n,{maximum:8,entropy:exactEntropy});
      try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:{...source.state,after:1,markers:1}});}
      finally{for(const child of next.outcomes)child.current.close();}
      assert.deepEqual(outcome.current.machine.storage.export(outcome.current.machine.root),source);
    }
    assert.deepEqual({initialized,prefix,first,second},{initialized:1,prefix:1,first:2,second:3},'continuation cannot execute the selected effect again');
    assert.deepEqual(machine.storage.export(machine.root),before);
    assert.deepEqual(machine.advance(null),{kind:'done',result:{prefix:1,selected:17,count:46,after:1,markers:1}},'normal execution uses the same operations and ignores internal stops');
  }finally{for(const outcome of result.outcomes)outcome.current.close();root.close();}
});

test('normal execution captures original future branches at first generation and saves only joint data',()=>{
  type State={prefix:number;realRandomCalls:number;selected:number;count:number;law:import('../../card-engine/src/probability.ts').ForwardProbabilityResult|null};
  let initialized=0,prefixCalls=0,normalDraws=0;
  const begin=()=>undefined,end=()=>undefined;
  probabilityOperation<State>(begin,{
    space:()=>({kind:'boundary',name:'begin'}),resolve:()=>undefined,
    forward:{plan:()=>({until:'end',maximum:8,milliseconds:2000,random:{state:1,position:0}}),word(){throw Error('Small exact law needs no entropy');},project:s=>({selected:s.state.selected,count:s.state.count})},
    resolveForward:(s,value)=>{s.state.law=value;},
  });
  const draw=(s:{state:State})=>{normalDraws++;s.state.realRandomCalls++;return 1;};
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(end,{space:()=>({kind:'boundary',name:'end'}),resolve:()=>undefined});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},State>({id:'normal-forward-law',
    schemas:{setup:z.undefined(),result:z.custom<State>(),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initialized++;return{prefix:0,realRandomCalls:0,selected:-1,count:3,law:null};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),card.operation<State>(s=>{s.state.prefix++;prefixCalls++;}),
      card.operation(begin),card.operation(draw,'draw'),card.operation<State>(s=>{s.state.selected=s.locals.draw;s.state.count+=s.locals.draw;}),
      card.operation(end),card.return(s=>s.state),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('No initialization during live forward capture');};
  try{
    const stop=machine.advance(null);if(stop.kind!=='done')throw Error(JSON.stringify(stop));
    assert.deepEqual({initialized,prefixCalls,normalDraws},{initialized:1,prefixCalls:1,normalDraws:1});
    assert.equal(stop.result.realRandomCalls,1);assert.equal(stop.result.selected,1);assert.equal(stop.result.count,4);
    const law=stop.result.law!;assert.equal(law.reason,null);assert.equal(law.representation,'exact');assert.deepEqual(law.basis,{selected:-1,count:3});
    assert.deepEqual(law.outcomes,[{probability:.5,value:{selected:0,count:3}},{probability:.5,value:{selected:1,count:4}}]);
    assert.equal(law.cost.words,0);assert.ok(law.cost.nodes>=3);
    // Direct Context persistence retains data, never an earlier executable frame.
    const saved=machine.storage.export(machine.root);program.validate(saved);
    const restored=new CardMachine(program,privateCardGraph(saved));
    try{assert.deepEqual(restored.current(),stop);assert.equal(restored.root.frames.length,0);}
    finally{restored.storage.close?.();}
  }finally{CardProgram.prototype.initial=initialize;machine.storage.close?.();}
});

function jointCurrentFixture(){
  type State={prefix:number;selected:number;record:{count:number};updates:number};
  type Result={selected:number;count:number;updates:number};
  type Ports={begin:{input:null;output:null};event:{input:string;output:null};nested:{input:Result;output:number}};
  let initialized=0,prefixCalls=0;
  const draw=()=>0,marker=()=>undefined;
  probabilityOperation<State>(draw,{space:()=>({kind:'weighted',weights:[.25,.75]}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(marker,{space:()=>({kind:'boundary',name:'joint-selected'}),resolve:()=>undefined});
  const result=z.object({selected:z.number(),count:z.number(),updates:z.number()});
  const program=new CardProgram<State,void,Ports,Result>({id:'retained-joint-current',
    schemas:{setup:z.undefined(),result,ports:{begin:{input:z.null(),output:z.null()},event:{input:z.string(),output:z.null()},nested:{input:result,output:z.number()}}},
    initialize:()=>{initialized++;return{prefix:0,selected:-1,record:{count:3},updates:0};},entry:'root',effects:[
      {id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation<State>(s=>{s.state.prefix++;prefixCalls++;}),card.invoke('inner',()=>null,'result'),card.return(s=>s.locals.result)]},
      {id:'inner',steps:[card.operation(draw,'choice'),card.operation<State>(s=>{s.state.selected=s.locals.choice;s.state.record.count+=s.locals.choice;return s.state.record;},'alias'),card.operation(marker),
        card.branch<State>(s=>s.state.selected===0,[card.operation<State>(s=>{s.state.record.count++;}),card.request(()=>({port:'event',input:'increment'}))],
          [card.operation<State>(s=>{s.state.record.count*=2;}),card.request(()=>({port:'event',input:'multiply'})),card.request(()=>({port:'event',input:'second-event'}))]),
        card.operation<State>(s=>{s.state.updates++;}),card.request<State>(s=>({port:'nested',input:{selected:s.state.selected,count:s.locals.alias.count,updates:s.state.updates}}),'reply'),
        card.operation<State>(s=>{s.state.record.count+=s.locals.reply;}),card.return<State>(s=>({selected:s.state.selected,count:s.locals.alias.count,updates:s.state.updates})),
      ]},
    ]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  return{root:new ProbabilityCurrent(machine),counts:()=>({initialized,prefixCalls})};
}

test('weighted current contexts follow original divergent control, preserve aliases across nested IO, and restore without rerunning',()=>{
  const f=jointCurrentFixture(),before=f.root.machine.storage.export(f.root.machine.root),owned=new Set<ProbabilityCurrent<any,any,any,any>>([f.root]);
  const initialize=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Retained current continuations cannot initialize');};
    const selected=nextProbability(f.root,null,{maximum:8,entropy:exactEntropy,untilBoundary:'joint-selected'});
    for(const node of selected.outcomes)owned.add(node.current);
    const start={...selected,outcomes:selected.outcomes.map(node=>({...node,data:[] as string[]}))};
    assert.throws(()=>saveProbabilityFrontier(start),/snapshot root/,'internal chance stops are not persistence boundaries');
    const nested=nextProbabilityFrontier(start,()=>0n,{maximum:8,entropy:exactEntropy,continueCall(stop,events){
      if(stop.call.port!=='event')return;events.push(stop.call.input);return{reply:null,data:events};
    }});
    for(const node of nested.outcomes)owned.add(node.current);
    assert.equal(nested.representation,'exact');
    assert.deepEqual(nested.outcomes.map(node=>({weight:node.probability,stop:node.current.inspect(),events:node.data})),[
      {weight:.25,stop:{kind:'call',call:{port:'nested',input:{selected:0,count:4,updates:1}}},events:['increment']},
      {weight:.75,stop:{kind:'call',call:{port:'nested',input:{selected:1,count:8,updates:1}}},events:['multiply','second-event']},
    ]);
    const saved=saveProbabilityFrontier(nested);
    for(const node of [...selected.outcomes,...nested.outcomes]){node.current.close();owned.delete(node.current);}
    const restored=restoreProbabilityFrontier(f.root.machine.program,saved);for(const node of restored.outcomes)owned.add(node.current);
    assert.deepEqual(saveProbabilityFrontier(restored),saved);
    const finished=nextProbabilityFrontier(restored,()=>5,{maximum:8,entropy:exactEntropy});for(const node of finished.outcomes)owned.add(node.current);
    assert.deepEqual(finished.outcomes.map(node=>node.current.inspect()),[{kind:'done',result:{selected:0,count:9,updates:1}},{kind:'done',result:{selected:1,count:13,updates:1}}]);
    assert.deepEqual(f.counts(),{initialized:1,prefixCalls:1});
    assert.deepEqual(f.root.machine.storage.export(f.root.machine.root),before);
    assert.deepEqual(saveProbabilityFrontier(restored),saved,'advancing children does not change the restored parent frontier');
  }finally{CardProgram.prototype.initial=initialize;for(const current of owned)current.close();}
});

test('observation identity updates survive direct restore and stay isolated from parents and observer references',()=>{
  const f=jointCurrentFixture(),owned=new Set<ProbabilityCurrent<any,any,any,any>>([f.root]);
  type Memory={identities:Map<number,number>;alias:Map<number,number>;seen:number[]};
  const initialize=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Observation and restore cannot rebuild a Context');};
    const selected=nextProbability(f.root,null,{maximum:8,entropy:exactEntropy,untilBoundary:'joint-selected'});
    for(const row of selected.outcomes)owned.add(row.current);
    const source=nextProbabilityFrontier({...selected,outcomes:selected.outcomes.map(row=>{
      const identities=new Map([[10,0]]);return{...row,data:{identities,alias:identities,seen:[]} as Memory};
    })},()=>0n,{maximum:8,entropy:exactEntropy,continueCall:(stop,data)=>stop.call.port==='event'?{reply:null,data}:undefined});
    for(const row of source.outcomes)owned.add(row.current);
    const before=saveProbabilityFrontier(source),counts=f.counts(),held:Memory[]=[];
    const conditioned=conditionProbabilityFrontier(source,(current,data)=>{
      const stop=current.inspect();assert.equal(stop.kind,'call');
      if(stop.kind!=='call'||stop.call.port!=='nested')throw Error('Expected original nested observation');
      const id=stop.call.input.selected===0?31:47;
      assert.equal(data.identities,data.alias);
      data.identities.set(id,data.identities.size);data.seen.push(data.identities.get(id)!);held.push(data);
      return stop.call.input.selected===0?.5:1;
    },{entropy:exactEntropy});
    assert.equal(conditioned.evidence,.875);assert.ok(conditioned.frontier);
    for(const row of conditioned.frontier.outcomes)owned.add(row.current);
    assert.deepEqual(conditioned.frontier.outcomes.map(row=>row.probability),[1/7,6/7]);
    // Even a producer retaining its projection input cannot later mutate the
    // accepted observation or another branch's identity correspondence.
    for(const memory of held){memory.identities.clear();memory.seen.push(99);}
    const checkMemory=(rows:readonly {data:Memory}[])=>{
      assert.deepEqual(rows.map(row=>[...row.data.identities]),[[[10,0],[31,1]],[[10,0],[47,1]]]);
      for(const row of rows){assert.equal(row.data.alias,row.data.identities);assert.deepEqual(row.data.seen,[1]);}
      assert.notEqual(rows[0]!.data.identities,rows[1]!.data.identities);
    };
    checkMemory(conditioned.frontier.outcomes);
    assert.deepEqual(saveProbabilityFrontier(source),before);assert.deepEqual(f.counts(),counts);
    let observations=0;
    assert.throws(()=>conditionProbabilityFrontier(source,(_current,data)=>{
      data.identities.set(99,99);if(++observations===2)throw Error('observer-fault');return 1;
    },{entropy:exactEntropy}),/observer-fault/);
    assert.deepEqual(saveProbabilityFrontier(source),before,'failed projections never commit their identity edits');
    const saved=saveProbabilityFrontier(conditioned.frontier);
    for(const row of conditioned.frontier.outcomes){row.current.close();owned.delete(row.current);}
    const restored=restoreProbabilityFrontier(f.root.machine.program,saved);
    for(const row of restored.outcomes)owned.add(row.current);
    checkMemory(restored.outcomes);assert.deepEqual(saveProbabilityFrontier(restored),saved);
    const finished=nextProbabilityFrontier(restored,()=>5,{maximum:8,entropy:exactEntropy});
    for(const row of finished.outcomes)owned.add(row.current);
    checkMemory(finished.outcomes);
    assert.deepEqual(finished.outcomes.map(row=>row.current.inspect()),[{kind:'done',result:{selected:0,count:9,updates:1}},{kind:'done',result:{selected:1,count:13,updates:1}}]);
    assert.deepEqual(f.counts(),counts);assert.deepEqual(saveProbabilityFrontier(restored),saved);
  }finally{CardProgram.prototype.initial=initialize;for(const current of owned)current.close();}
});

test('observation conditioning retains correlated current states, reports evidence mass and distinguishes empty particle support',()=>{
  const f=jointCurrentFixture(),selected=nextProbability(f.root,null,{maximum:8,entropy:exactEntropy,untilBoundary:'joint-selected'});
  const source={...selected,representation:'particles' as const,outcomes:selected.outcomes.map(node=>({...node,data:{untouched:true}}))};
  const owned=new Set([f.root,...selected.outcomes.map(node=>node.current)]);
  try{
    const conditioned=conditionProbabilityFrontier(source,(current,data)=>{data.untouched=false;return current.machine.root.state.selected===0?.5:1;},{entropy:exactEntropy});
    assert.equal(conditioned.evidence,.875);assert.ok(conditioned.frontier);
    for(const node of conditioned.frontier.outcomes)owned.add(node.current);
    assert.equal(conditioned.frontier.representation,'particles');
    assert.deepEqual(conditioned.frontier.outcomes.map(node=>node.probability),[1/7,6/7]);
    assert.deepEqual(conditioned.frontier.outcomes.map(node=>[node.current.machine.root.state.selected,node.current.machine.root.state.record.count]),[[0,3],[1,4]]);
    assert.ok(source.outcomes.every(node=>node.data.untouched));
    assert.ok(conditioned.frontier.outcomes.every(node=>!node.data.untouched),'accepted observation updates belong to the retained branch');
    const empty=conditionProbabilityFrontier(source,()=>0,{entropy:exactEntropy});assert.deepEqual(empty,{evidence:0,frontier:null});
    assert.throws(()=>conditionProbabilityFrontier(source,()=>-1,{entropy:exactEntropy}),/likelihood/);
    assert.throws(()=>conditionProbabilityFrontier({...source,outcomes:source.outcomes.slice(0,1)},()=>1,{entropy:exactEntropy}),/frontier/,'missing mass cannot be treated as conditioning');
  }finally{for(const current of owned)current.close();}
});

test('frontier IO failures clean up all owned currents and leave original contexts and metadata intact',()=>{
  const f=jointCurrentFixture(),active=new Set<object>();
  function track(current:typeof f.root):typeof f.root{active.add(current);const fork=current.fork.bind(current),close=current.close.bind(current);current.fork=()=>track(fork());current.close=()=>{close();active.delete(current);};return current;}
  track(f.root);
  const selected=nextProbability(f.root,null,{maximum:8,entropy:exactEntropy,untilBoundary:'joint-selected'});
  const before=new Set(active),source={...selected,outcomes:selected.outcomes.map(node=>({...node,data:[] as string[]}))};
  try{
    assert.throws(()=>nextProbabilityFrontier(source,()=>0n,{maximum:8,entropy:exactEntropy,continueCall(_stop,data){data.push('private child');throw Error('event handler cancelled');}}),/event handler cancelled/);
    assert.deepEqual(active,before);assert.ok(source.outcomes.every(node=>node.data.length===0));
    let checks=0;
    assert.throws(()=>conditionProbabilityFrontier(source,()=>1,{entropy:{word:()=>0,check(){if(++checks===4)throw Error('cancelled second fork');}}}),/cancelled second fork/);
    assert.deepEqual(active,before);
  }finally{for(const node of selected.outcomes)node.current.close();f.root.close();}
});


function liveCaptureFixture(again=false,normalExtra=0,identityEvents=false,afterDecisionEvent=false){
  type Result={selected:number;count:number;extra:number};
  type State={prefix:number;selected:number;count:number;law:import('../../card-engine/src/probability.ts').ForwardProbabilityResult|null};
  type Ports={begin:{input:null;output:null};event:{input:string;output:null};decision:{input:Result;output:number}};
  let initialized=0,prefix=0,realDraws=0;
  const begin=()=>undefined,end=()=>undefined;
  probabilityOperation<State>(begin,{space:()=>({kind:'boundary',name:'live-before'}),resolve:()=>undefined,
    forward:{plan:()=>({until:'live-after',maximum:2,milliseconds:2000,random:{state:1,position:0}}),word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),project:s=>({selected:s.state.selected,count:s.state.count})},
    resolveForward:(s,result)=>{s.state.law=result;},
  });
  const draw=()=>{realDraws++;return 1;},extra=()=>{realDraws++;return normalExtra;};
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(extra,{space:()=>({kind:'uniform',size:3n}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(end,{space:()=>({kind:'boundary',name:'live-after'}),resolve:()=>undefined});
  const result=z.object({selected:z.number(),count:z.number(),extra:z.number()});
  const program=new CardProgram<State,void,Ports,Result>({id:'live-frontier-handoff',schemas:{setup:z.undefined(),result,ports:{begin:{input:z.null(),output:z.null()},event:{input:z.string(),output:z.null()},decision:{input:result,output:z.number()}}},
    initialize:()=>{initialized++;return{prefix:0,selected:-1,count:3,law:null};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'begin',input:null})),card.operation<State>(s=>{prefix++;s.state.prefix++;}),
      ...(identityEvents?[card.request(()=>({port:'event',input:'30'}))]:[]),card.operation(begin),card.operation(draw,'selected'),
      card.operation<State>(s=>{s.state.selected=s.locals.selected;s.state.count+=s.locals.selected;}),card.operation(end),
      card.branch<State>(s=>s.state.selected===0,[card.operation<State>(s=>{s.state.count++;})],[card.operation<State>(s=>{s.state.count*=2;})]),
      card.request<State>(s=>({port:'event',input:identityEvents?String(s.state.selected===0?10:20):'original event'})),
      ...(identityEvents?[card.request(()=>({port:'event',input:'20'}))]:[]),card.operation(extra,'extra'),
      card.request<State>(s=>({port:'decision',input:{selected:s.state.selected,count:s.state.count,extra:s.locals.extra}}),'reply'),
      ...(again?[card.operation(begin),card.operation(end)]:[]),
      ...(afterDecisionEvent?[card.request(()=>({port:'event',input:'after accepted decision'}))]:[]),
      card.return<State>(s=>({selected:s.state.selected,count:s.state.count+s.locals.reply,extra:s.locals.extra})),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  return{machine,counts:()=>({initialized,prefix,realDraws})};
}

test('normal first-generation handoff continues live leaves to public currents and charges the same entropy account',()=>{
  const f=liveCaptureFixture();type Frontier=ProbabilityFrontier<ReturnType<typeof f.machine.program.definition.initialize>,void,{begin:{input:null;output:null};event:{input:string;output:null};decision:{input:{selected:number;count:number;extra:number};output:number}},{selected:number;count:number;extra:number},string[]>;
  let delivered:Frontier|undefined,deliveries=0;
  const detach=captureForwardFrontier(f.machine,{data:[] as string[],continueCall(stop,data){if(stop.call.port!=='event')return;data.push(stop.call.input);return{reply:null,data};},receive(frontier){delivered=frontier;deliveries++;}});
  const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('No initialization during original live handoff');};
  try{
    assert.throws(()=>captureForwardFrontier(f.machine,{data:null,receive(){}}),/already installed/);
    let stop=f.machine.advance(null);while(stop.kind==='call'&&stop.call.port==='event')stop=f.machine.advance(null);
    assert.ok(delivered);assert.equal(deliveries,1);assert.equal(stop.kind,'call');
    assert.deepEqual(f.counts(),{initialized:1,prefix:1,realDraws:2});
    assert.equal(delivered.representation,'particles');assert.equal(delivered.outcomes.length,2);
    assert.deepEqual(delivered.outcomes.map(node=>({weight:node.probability,stop:node.current.inspect(),events:node.data})),[
      {weight:.5,stop:{kind:'call',call:{port:'decision',input:{selected:0,count:4,extra:0}}},events:['original event']},
      {weight:.5,stop:{kind:'call',call:{port:'decision',input:{selected:1,count:8,extra:0}}},events:['original event']},
    ]);
    const law=f.machine.root.state.law!;assert.equal(law.reason,null);assert.equal(law.cost.words,2);assert.equal(law.random.position,2);
    assert.ok(law.cost.nodes>=7);assert.ok(law.cost.advances>=7,'continuation work is charged with capture');
    const saved=saveProbabilityFrontier(delivered);for(const node of delivered.outcomes)node.current.close();delivered=undefined;
    const restored=restoreProbabilityFrontier(f.machine.program,saved);
    try{assert.deepEqual(saveProbabilityFrontier(restored),saved);assert.deepEqual(f.counts(),{initialized:1,prefix:1,realDraws:2});}
    finally{for(const node of restored.outcomes)node.current.close();}
  }finally{CardProgram.prototype.initial=initialize;detach();for(const node of delivered?.outcomes??[])node.current.close();f.machine.storage.close?.();}
});

test('a rejected live handoff closes every candidate instead of leaking or claiming a completed collection',()=>{
  const f=liveCaptureFixture(),received:ProbabilityCurrent<any,any,any,any>[]=[];
  const detach=captureForwardFrontier(f.machine,{data:null,receive(frontier){received.push(...frontier.outcomes.map(node=>node.current));throw Error('Receiver failed before accepting ownership');}});
  try{
    const stop=f.machine.advance(null);assert.equal(stop.kind,'fault');if(stop.kind!=='fault')throw Error('Expected failed receiver');
    assert.match(stop.error.message,/Receiver failed/);assert.ok(received.length>0);
    for(const current of received)assert.throws(()=>current.inspect(),/closed/i);
    assert.equal(f.counts().realDraws,0,'failure is reported before running the real selection');
  }finally{detach();f.machine.storage.close?.();}
});


test('current-only tracking preserves actual state, branches only future randomness and restores costs without historical execution',async()=>{
  const f=liveCaptureFixture(),definition=withProbabilityTracking(f.machine.program.definition,{
    mode:'current',isDecision:stop=>stop.call.port==='decision',
  });
  f.machine.storage.close?.();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition));
  const parent=unwrap(await loaded.core.start(undefined));
  unwrap(await parent.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'pause'}),decision:async()=>({kind:'pause'})}));
  while(unwrap(await parent.run()).accepted){}
  const before=unwrap(await parent.inspect()),counts=f.counts(),initial=CardProgram.prototype.initial;
  assert.equal(before.kind,'call');if(before.kind!=='call'||before.call.port!=='event')throw Error('Expected original event before future draw');
  assert.equal(counts.prefix,1);assert.equal(counts.realDraws,1);
  const model=await inspectProbabilityTracking(parent);assert.ok(model);
  assert.equal(model.mode,'current');assert.equal(model.phase,'waiting');assert.equal(model.worlds,0);assert.equal(model.account.captures,0);assert.equal(model.account.words,0);
  CardProgram.prototype.initial=function(){throw Error('Current fork/restore/search cannot initialize');};
  const owned=[parent];
  try{
    const cost=await acquireProbabilityHostCost(parent);cost.update(17);
    const saved=unwrap(await loaded.persistence!.save(parent)),bytes=(await store.get(saved.snapshotId))!,snapshot=deserialize(bytes);
    assert.equal(snapshot.tracking.mode,'current');assert.equal(snapshot.tracking.frontier,null);
    const cold=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition));
    const restored=unwrap(await cold.persistence!.restore(saved));owned.push(restored);
    const recovered=await inspectProbabilityTracking(restored);assert.ok(recovered);assert.ok(recovered.account.milliseconds>=17);assert.equal(recovered.worlds,0);
    for(const instance of [parent,restored]){
      const current=await takeProbabilityCurrent(unwrap(await instance.fork!()));
      const original=current.machine.storage.export(current.machine.root),children=new Set<ProbabilityCurrent<any,any,any,any>>();
      try{
        assert.equal((current.machine.root.state as any).selected,1);assert.equal((current.machine.root.state as any).count,8);assert.equal((current.machine.root.state as any).law,null);
        const next=nextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,entropy:exactEntropy});
        for(const row of next.outcomes)children.add(row.current);
        assert.equal(next.representation,'exact');assert.deepEqual(next.outcomes.map(row=>row.probability),[1/3,1/3,1/3]);
        assert.deepEqual(next.outcomes.map(row=>row.current.inspect()),[0,1,2].map(extra=>({kind:'call',call:{port:'decision',input:{selected:1,count:8,extra}}})));
        assert.deepEqual(current.machine.storage.export(current.machine.root),original);assert.deepEqual(f.counts(),counts);
      }finally{for(const child of children)child.close();current.close();}
      assert.deepEqual(unwrap(await instance.inspect()),before);
    }
    snapshot.tracking.mode='posterior';await store.put(saved.snapshotId,serialize(snapshot));
    assert.equal((await cold.persistence!.restore(saved)).ok,false,'old posterior model cannot silently become a current-only save');
  }finally{CardProgram.prototype.initial=initial;for(const instance of owned)await instance.close();}
});

test('loader owns the live posterior across accepted replies, rejected input, COW fork, cold restore and close',async()=>{
  const f=liveCaptureFixture(true),definition=withProbabilityTracking(f.machine.program.definition,{
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop){
      if(stop.kind==='fault')throw Error(stop.error.message);
      if(stop.kind==='done')return{key:JSON.stringify(stop.result)};
      if(stop.call.port==='event')return{reply:null};
      return{key:stop.call.port==='decision'?'decision:'+stop.call.input.extra:'begin'};
    },respond:(_actual,reply)=>reply,
  });
  f.machine.storage.close?.();
  const unwrap=<T>(value:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!value.ok)throw Error(JSON.stringify(value.error));return value.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition));
  const parent=unwrap(await loaded.core.start(undefined));
  unwrap(await parent.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));while(unwrap(await parent.run()).accepted){}
  const initial=await inspectProbabilityTracking(parent);assert.equal(initial!.phase,'active');assert.equal(initial!.aligned,true);assert.equal(initial!.worlds,2);assert.equal(initial!.account.captures,1);
  const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Fork/restore cannot initialize or execute past replies');};
  const owned=[parent];
  try{
    const before=unwrap(await parent.inspect());
    unwrap(await parent.bind({decision:async()=>({kind:'reply',value:'bad' as any})}));
    const rejected=unwrap(await parent.run());assert.equal(rejected.accepted,false);assert.equal(rejected.pause,'invalid_reply');assert.deepEqual(unwrap(await parent.inspect()),before);
    assert.deepEqual(await inspectProbabilityTracking(parent),initial,'schema rejection must not advance the collection or its cursor');
    const child=unwrap(await parent.fork!());owned.push(child);
    const childStart=await inspectProbabilityTracking(child);assert.equal(childStart!.worlds,2);assert.equal(childStart!.account.captures,1);
    const saved=unwrap(await loaded.persistence!.save(parent)),afterSave=await inspectProbabilityTracking(parent);
    const cold=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition));
    const restored=unwrap(await cold.persistence!.restore(saved));owned.push(restored);
    const recovered=await inspectProbabilityTracking(restored);assert.ok(recovered&&afterSave);
    const savedCost=deserialize((await store.get(saved.snapshotId))!).tracking;
    assert.equal(recovered.account.nodes,afterSave.account.nodes+afterSave.worlds);
    assert.equal(recovered.window.nodes,afterSave.window.nodes+afterSave.worlds);
    assert.ok(recovered.account.milliseconds>=savedCost.account.milliseconds);assert.ok(recovered.window.milliseconds>=savedCost.window.milliseconds);
    assert.deepEqual({...recovered,account:afterSave.account,window:afterSave.window},afterSave);
    assert.deepEqual(recovered.account.random,afterSave.account.random);assert.equal(recovered.account.captures,afterSave.account.captures);
    for(const [instance,reply] of [[child,5],[restored,9]] as const){
      unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());
      const state=unwrap(await instance.inspect());assert.equal(state.kind,'done');if(state.kind!=='done')throw Error('Expected terminal');
      assert.equal(state.result.count,8+reply);
      const posterior=await inspectProbabilityTracking(instance);assert.equal(posterior!.phase,'active');assert.equal(posterior!.aligned,true);assert.equal(posterior!.worlds,1);
      assert.equal(posterior!.account.captures,1,'later real selection markers cannot replace the existing correlated collection');
    }
    assert.deepEqual(unwrap(await parent.inspect()),before,'child advances must not affect the actual parent');
    assert.equal((await inspectProbabilityTracking(parent))!.worlds,2);
    const bytes=(await store.get(saved.snapshotId))!;
    for(const corrupt of [(data:any)=>{delete data.tracking;},(data:any)=>{data.tracking.frontier.outcomes[0].context.frames[0].index=-1;},(data:any)=>{data.tracking.account.random.position=-1;},(data:any)=>{delete data.tracking.window;},(data:any)=>{data.tracking.window.milliseconds=-1;}]){
      const data=deserialize(bytes);corrupt(data);await store.put(saved.snapshotId,serialize(data));assert.equal((await cold.persistence!.restore(saved)).ok,false);
    }
  }finally{CardProgram.prototype.initial=initialize;for(const instance of owned)await instance.close();}
  await assert.rejects(inspectProbabilityTracking(parent),/closed/);
});

test('an observation outside particle support remains explicit through save and restore, without a hidden-root replacement',async()=>{
  const f=liveCaptureFixture(true,2),definition=withProbabilityTracking(f.machine.program.definition,{
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop){
      if(stop.kind==='fault')throw Error(stop.error.message);
      if(stop.kind==='call'&&stop.call.port==='event')return{reply:null};
      return{key:stop.kind==='call'&&stop.call.port==='decision'?'extra:'+stop.call.input.extra:JSON.stringify(stop)};
    },respond:(_actual,reply)=>reply,
  });
  f.machine.storage.close?.();
  const store=memorySnapshotStore(),unwrap=(r:any):any=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
  const loaded=unwrap(await createCardLoader({recordCore:false,snapshots:store}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
  try{
    unwrap(await instance.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));while(unwrap(await instance.run()).accepted){}
    const state=await inspectProbabilityTracking(instance);assert.equal(state!.phase,'failed');assert.equal(state!.reason,'observation-outside-particle-support');assert.equal(state!.worlds,0);
    const saved=unwrap(await loaded.persistence.save(instance)),restored=unwrap(await loaded.persistence.restore(saved));
    try{
      const recovered=await inspectProbabilityTracking(restored),prior=await inspectProbabilityTracking(instance);assert.ok(recovered&&prior);
      assert.deepEqual({...recovered,account:prior.account,window:prior.window},prior);
      assert.deepEqual(recovered.account.random,prior.account.random);
      assert.ok(recovered.account.milliseconds>=deserialize((await store.get(saved.snapshotId))!).tracking.account.milliseconds);
      unwrap(await restored.bind({decision:async()=>({kind:'reply',value:3})}));unwrap(await restored.run());
      const after=await inspectProbabilityTracking(restored);assert.equal(after!.phase,'failed');assert.equal(after!.account.captures,1);assert.equal(after!.worlds,0);
      assert.equal(unwrap(await restored.inspect()).result.count,11,'normal production settlement continues unchanged');
    }finally{await restored.close();}
  }finally{await instance.close();}
});


test('public identity associations survive separate deliveries, initial generation, COW fork and direct restore',async()=>{
  const f=liveCaptureFixture(false,0,true),definition=withProbabilityTracking(f.machine.program.definition,{
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop,memory){
      if(stop.kind==='fault')throw Error(stop.error.message);
      if(stop.kind==='call'&&stop.call.port==='event'){
        const ids=(memory.ids??=new Map<string,number>()) as Map<string,number>;
        if(!ids.has(stop.call.input))ids.set(stop.call.input,ids.size);
        return{key:'entity:'+ids.get(stop.call.input)};
      }
      return{key:stop.kind==='call'?(stop.call.port==='decision'?'decision:'+stop.call.input.extra:stop.call.port):JSON.stringify(stop.result)};
    },respond:(_actual,reply)=>reply,
  });
  f.machine.storage.close?.();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(definition)),parent=unwrap(await loaded.core.start(undefined)),owned=[parent];
  try{
    unwrap(await parent.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
    unwrap(await parent.run()); // First public entity, before original random generation.
    unwrap(await parent.run()); // First generated event: both branches have a new public entity.
    assert.equal((await inspectProbabilityTracking(parent))!.worlds,2);
    const saved=unwrap(await loaded.persistence!.save(parent)),restored=unwrap(await loaded.persistence!.restore(saved)),child=unwrap(await parent.fork!());owned.push(restored,child);
    const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Current identity matching cannot reinitialize');};
    try{
      for(const instance of [restored,child]){
        unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
        unwrap(await instance.run()); // Same entity appears again only in the actual-compatible branch.
        const state=await inspectProbabilityTracking(instance);assert.equal(state!.phase,'active');assert.equal(state!.worlds,1);
        while(unwrap(await instance.run()).accepted){}
        assert.equal((await inspectProbabilityTracking(instance))!.worlds,1);
      }
      assert.equal((await inspectProbabilityTracking(parent))!.worlds,2,'observing child events must not mutate parent identity associations');
    }finally{CardProgram.prototype.initial=initialize;}
  }finally{for(const instance of owned)unwrap(await instance.close());}
});


test('observed successors are conditioned before the accepted-world cap, with exact evidence and one shared prefix',()=>{
  const f=fixture(),before=f.current.machine.storage.export(f.current.machine.root),initialize=CardProgram.prototype.initial;
  CardProgram.prototype.initial=function(){throw Error('Conditional next cannot initialize or replay');};
  let retained:{current:{close():void}}[]=[];
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:f.current,probability:1,data:null}]},()=>null,{
      maximum:1,attempts:8,entropy:exactEntropy,likelihood(current){const stop=current.inspect();return stop.kind==='done'&&stop.result.b===2?1:0;},
    });
    retained=result.frontier?.outcomes??[];
    assert.equal(result.evidence,1/6);assert.ok(result.frontier);assert.equal(result.frontier.representation,'exact');
    assert.deepEqual(result.frontier.outcomes.map(row=>({p:row.probability,stop:row.current.inspect()})),[{p:1,stop:{kind:'done',result:{a:1,b:2}}}]);
    assert.deepEqual(f.counts(),{before:1,between:2});assert.deepEqual(f.current.machine.storage.export(f.current.machine.root),before);
  }finally{CardProgram.prototype.initial=initialize;for(const row of retained)row.current.close();f.current.close();}
});

test('conditional likelihood multiplies joint mass and reduction samples the posterior rather than truncating it',()=>{
  for(const reduced of [false,true]){
    const f=fixture();let words=0;
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:f.current,probability:1,data:null}]},()=>null,{
      maximum:reduced?1:2,attempts:8,entropy:{check(){},word(){words++;return 0;}},likelihood(current){const stop=current.inspect();if(stop.kind!=='done'||stop.result.b!==0)return 0;return stop.result.a===0?.5:1;},
    });
    try{
      assert.ok(Math.abs(result.evidence-7/24)<1e-12);assert.ok(result.frontier);
      if(reduced){assert.equal(result.frontier.representation,'particles');assert.equal(result.frontier.outcomes.length,1);assert.equal(result.frontier.outcomes[0]!.probability,1);assert.equal(words,2);}
      else{assert.equal(result.frontier.representation,'exact');assert.equal(words,0);assert.ok(Math.abs(result.frontier.outcomes[0]!.probability-3/7)<1e-12);assert.ok(Math.abs(result.frontier.outcomes[1]!.probability-4/7)<1e-12);}
    }finally{for(const row of result.frontier?.outcomes??[])row.current.close();f.current.close();}
  }
});

test('conditional attempt exhaustion and invalid likelihood discard every candidate without publishing partial mass',()=>{
  for(const mode of ['attempts','likelihood','empty'] as const){
    const f=fixture(mode==='attempts'),active=new Set<object>();
    function track(current:typeof f.current):typeof f.current{active.add(current);const fork=current.fork.bind(current),close=current.close.bind(current);current.fork=()=>track(fork());current.close=()=>{close();active.delete(current);};return current;}
    track(f.current);
    const run=()=>conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:f.current,probability:1,data:null}]},()=>null,{
      maximum:1,attempts:mode==='attempts'?3:8,entropy:exactEntropy,likelihood(current){const stop=current.inspect();return mode==='likelihood'?(stop.kind==='done'&&stop.result.b===2?-1:1):0;},
    });
    try{
      if(mode==='empty')assert.deepEqual(run(),{evidence:0,frontier:null});
      else assert.throws(run,mode==='attempts'?/observation-attempt-budget/:/Invalid observation likelihood/);
      assert.deepEqual([...active],[f.current]);assert.equal(f.current.inspect().kind,'call');
    }finally{f.current.close();}
  }
});

test('instance observation constrains a new random step before sampling, without replacing earlier hidden correlations',async()=>{
  const f=liveCaptureFixture(true,2),definition=withProbabilityTracking(f.machine.program.definition,{
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop){
      if(stop.kind==='fault')throw Error(stop.error.message);
      if(stop.kind==='done')return{key:JSON.stringify(stop.result)};
      return{key:stop.call.port==='decision'?'extra:'+stop.call.input.extra:stop.call.port};
    },respond:(_actual,reply)=>reply,
  });
  f.machine.storage.close?.();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
  const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Accepted observation cannot reconstruct a root');};
  try{
    unwrap(await instance.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
    while(unwrap(await instance.run()).accepted){}
    const current=await inspectProbabilityTracking(instance);assert.equal(current!.phase,'active');assert.equal(current!.aligned,true);assert.equal(current!.worlds,2);assert.equal(current!.account.captures,1);
    assert.equal(f.counts().realDraws,2,'the actual draw and extra operation each execute only once');
    const saved=unwrap(await loaded.persistence!.save(instance)),restored=unwrap(await loaded.persistence!.restore(saved));
    try{
      unwrap(await restored.bind({decision:async()=>({kind:'reply',value:3})}));unwrap(await restored.run());
      const posterior=await inspectProbabilityTracking(restored);assert.equal(posterior!.phase,'active');assert.equal(posterior!.worlds,1);assert.equal(posterior!.account.captures,1);
      const terminal=unwrap(await restored.inspect());assert.equal(terminal.kind,'done');if(terminal.kind!=='done')throw Error('Expected terminal');assert.deepEqual(terminal.result,{selected:1,count:11,extra:2});
      assert.equal((await inspectProbabilityTracking(instance))!.worlds,2);
    }finally{unwrap(await restored.close());}
  }finally{CardProgram.prototype.initial=initialize;unwrap(await instance.close());}
});


test('search receives the full actual current and its maintained joint posterior, never a replacement root',async()=>{
  const f=liveCaptureFixture(),definition=withProbabilityTracking(f.machine.program.definition,{
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop){
      if(stop.kind==='fault')throw Error(stop.error.message);
      if(stop.kind==='call'&&stop.call.port==='event')return{reply:null};
      return{key:stop.kind==='call'&&stop.call.port==='decision'?'extra:'+stop.call.input.extra:JSON.stringify(stop)};
    },respond:(_actual,reply)=>reply,
  });
  f.machine.storage.close?.();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(definition)),parent=unwrap(await loaded.core.start(undefined));
  unwrap(await parent.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
  while(unwrap(await parent.run()).accepted){}
  const before=unwrap(await parent.inspect()),counts=f.counts(),initialize=CardProgram.prototype.initial;
  if(before.kind!=='call')throw Error('Expected actual decision');
  const rawStop={kind:'call',call:before.call};
  CardProgram.prototype.initial=function(){throw Error('Root delivery must not initialize');};
  try{
    const child=unwrap(await parent.fork!()),root=await takeProbabilityRoot(child);
    try{
      assert.deepEqual(root.current.inspect(),rawStop);
      assert.equal((root.current.machine.root.state as {selected:number}).selected,1);
      assert.equal((root.current.machine.root.state as {count:number}).count,8);
      assert.ok(root.posterior);assert.equal(root.posterior.outcomes.length,2);
      assert.deepEqual(root.posterior.outcomes.map(row=>row.probability),[.5,.5]);
      assert.deepEqual(f.counts(),counts,'delivery executes no past or current instruction');
      const result=nextProbabilityFrontier(root.posterior,()=>5,{maximum:8,entropy:exactEntropy});
      try{
        assert.deepEqual(result.outcomes.map(row=>({stop:row.current.inspect(),p:row.probability})),[
          {stop:{kind:'done',result:{selected:0,count:9,extra:0}},p:.5},
          {stop:{kind:'done',result:{selected:1,count:13,extra:0}},p:.5},
        ]);
        assert.deepEqual(root.current.inspect(),rawStop,'future distribution never advances the actual singleton');
      }finally{for(const row of result.outcomes)row.current.close();}
    }finally{root.close();root.close();}
    assert.throws(()=>root.current.inspect(),/closed/);
    for(const row of root.posterior!.outcomes)assert.throws(()=>row.current.inspect(),/closed/);
    assert.equal((await child.inspect()).ok,false);assert.deepEqual(unwrap(await parent.inspect()),before);
    assert.equal((await inspectProbabilityTracking(parent))!.worlds,2);
  }finally{CardProgram.prototype.initial=initialize;unwrap(await parent.close());}
});

test('root delivery rejects failed or unaligned posteriors and cleans partially forked collections',async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  for(const extra of [0,2]){
    const f=liveCaptureFixture(false,extra),definition=withProbabilityTracking(f.machine.program.definition,{
      word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
      observe(stop){
        if(stop.kind==='fault')throw Error(stop.error.message);
        if(stop.kind==='call'&&stop.call.port==='event')return{reply:null};
        return{key:stop.kind==='call'&&stop.call.port==='decision'?'extra:'+stop.call.input.extra:JSON.stringify(stop)};
      },respond:(_actual,reply)=>reply,
    });
    f.machine.storage.close?.();
    const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(definition)),parent=unwrap(await loaded.core.start(undefined));
    try{
      unwrap(await parent.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
      unwrap(await parent.run());
      assert.equal((await inspectProbabilityTracking(parent))!.aligned,false);
      const unaligned=unwrap(await parent.fork!());await assert.rejects(takeProbabilityRoot(unaligned),/not reached the actual public boundary/);
      assert.equal((await unaligned.inspect()).ok,false);
      while(unwrap(await parent.run()).accepted){}
      const before=unwrap(await parent.inspect());
      if(extra===2){
        const failed=unwrap(await parent.fork!());await assert.rejects(takeProbabilityRoot(failed),/observation-outside-particle-support/);
        assert.equal((await failed.inspect()).ok,false);
      }else for(const failAt of [1,2,3]){
        const branch=unwrap(await parent.fork!()),fork=ProbabilityCurrent.prototype.fork,close=ProbabilityCurrent.prototype.close,active=new Set<object>();let calls=0;
        try{
          ProbabilityCurrent.prototype.fork=function(){const child=fork.call(this);active.add(child);return child;};
          ProbabilityCurrent.prototype.close=function(){close.call(this);active.delete(this);};
          await assert.rejects(takeProbabilityRoot(branch,{check(){},execute(phase,run){if(phase==='fork'&&++calls===failAt)throw Error('cancelled handoff');return run();}}),/cancelled handoff/);
          assert.equal(active.size,0);assert.equal((await branch.inspect()).ok,false);
          assert.equal((await inspectProbabilityTracking(parent))!.worlds,2);
        }finally{ProbabilityCurrent.prototype.fork=fork;ProbabilityCurrent.prototype.close=close;}
      }
      assert.deepEqual(unwrap(await parent.inspect()),before);
    }finally{unwrap(await parent.close());}
  }
});


function decisionBudgetFixture(eventCount:number){
  type Ports={decision:{input:null;output:null};event:{input:number;output:null}};
  const program=new CardProgram<{},void,Ports,null>({id:'decision-budget',schemas:{setup:z.undefined(),result:z.null(),ports:{decision:{input:z.null(),output:z.null()},event:{input:z.number(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[
    card.request(()=>({port:'decision',input:null})),
    ...Array.from({length:eventCount},(_,i)=>card.request(()=>({port:'event' as const,input:i}))),
    card.request(()=>({port:'decision',input:null})),card.request(()=>({port:'event',input:eventCount})),card.return(()=>null),
  ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  let now=0;
  const spec={isDecision:(stop:Extract<ReturnType<typeof machine.current>,{kind:'call'}>)=>stop.call.port==='decision',word:(cursor:{state:number;position:number})=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop:ReturnType<typeof machine.current>){if(stop.kind==='call'&&stop.call.port==='event'){now+=800;return{reply:null};}return{key:JSON.stringify(stop)};},respond:(_actual:unknown,reply:unknown)=>reply};
  const clock=()=>now,tracker=new ProbabilityTracker(machine,spec,undefined,clock);
  return{program,machine,tracker,spec,clock};
}

test('intermediate event IO, forks and direct restore cannot renew the current decision probability allowance',()=>{
  const f=decisionBudgetFixture(3),initialize=CardProgram.prototype.initial;
  const owned:[ProbabilityTracker<any,any,any,any>,CardMachine<any,any,any,any>][]=[[f.tracker,f.machine]];
  try{
    f.tracker.advance(null);assert.equal(f.tracker.inspect().window.milliseconds,800);
    const saved=f.tracker.snapshot(),context=f.machine.storage.export(f.machine.root);
    const branchMachine=new CardMachine(f.program,(f.machine.storage as import('../src/graph.ts').CardGraph<any>).fork()),branch=f.tracker.fork(branchMachine);owned.push([branch,branchMachine]);
    CardProgram.prototype.initial=function(){throw Error('Budget recovery cannot initialize');};
    const restoredMachine=new CardMachine(f.program,privateCardGraph(context)),restored=new ProbabilityTracker(restoredMachine,f.spec,saved,f.clock);owned.push([restored,restoredMachine]);
    for(const tracker of [branch,restored]){
      assert.equal(tracker.inspect().window.milliseconds,800);
      tracker.advance(null);assert.equal(tracker.inspect().window.milliseconds,1600);assert.equal(tracker.inspect().phase,'waiting');
      const actual=tracker.advance(null);assert.equal(actual.kind,'call');
      assert.equal(tracker.inspect().reason,'tracking-wall-budget');assert.equal(tracker.inspect().window.milliseconds,2400);
    }
    assert.equal(f.tracker.inspect().window.milliseconds,800,'a child has its own decision window');
    assert.equal(f.machine.current().kind,'call');
  }finally{CardProgram.prototype.initial=initialize;for(const [tracker,machine] of owned){tracker.close();machine.storage.close?.();}}
});

test('only accepting a new player decision resets its allowance; the game total never resets',()=>{
  const f=decisionBudgetFixture(2);
  try{
    f.tracker.advance(null);f.tracker.advance(null);f.tracker.advance(null);
    assert.equal(f.machine.current().kind,'call');assert.equal(f.tracker.inspect().window.milliseconds,1600);
    const saved=f.tracker.snapshot();saved.account.milliseconds=59_500;
    const restoredMachine=new CardMachine(f.program,privateCardGraph(f.machine.storage.export(f.machine.root))),restored=new ProbabilityTracker(restoredMachine,f.spec,saved,f.clock);
    try{
      restored.advance(null);
      assert.equal(restored.inspect().window.milliseconds,800,'a new accepted decision resets only its window');
      assert.equal(restored.inspect().account.milliseconds,60_300);
      assert.equal(restored.inspect().reason,'tracking-game-budget');
    }finally{restored.close();restoredMachine.storage.close?.();}
    f.tracker.advance(null);assert.equal(f.tracker.inspect().window.milliseconds,800);assert.equal(f.tracker.inspect().account.milliseconds,2400);
    assert.equal(f.tracker.inspect().phase,'waiting');
  }finally{f.tracker.close();f.machine.storage.close?.();}
});

test('first forward generation shares the remaining instance node allowance and leaves actual settlement intact',()=>{
  const f=liveCaptureFixture();
  const spec={isDecision:()=>false,word:(cursor:{state:number;position:number})=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop:ReturnType<typeof f.machine.current>){if(stop.kind==='call'&&stop.call.port==='event')return{reply:null};return{key:JSON.stringify(stop)};},respond:(_actual:unknown,reply:unknown)=>reply};
  const initial=new ProbabilityTracker(f.machine,spec),saved=initial.snapshot();initial.close();saved.window.nodes=10000;
  const tracker=new ProbabilityTracker(f.machine,spec,saved);
  try{
    const stop=tracker.advance(null);assert.equal(stop.kind,'call');
    assert.equal(tracker.inspect().phase,'failed');assert.equal(tracker.inspect().reason,'tracking-node-budget');
    assert.equal(tracker.inspect().account.captures,1);assert.equal(tracker.inspect().window.nodes,10000);
    assert.equal(f.machine.root.state.selected,1);assert.equal(f.machine.root.state.count,8);assert.equal(f.counts().realDraws,1);
    assert.equal(f.machine.root.state.law!.reason,'tracking-node-budget');assert.deepEqual(f.machine.root.state.law!.outcomes,[]);
  }finally{tracker.close();f.machine.storage.close?.();}
});

test('live search costs include discarded work, merge overlapping fork costs and persist into the instance budget',()=>{
  const f=decisionBudgetFixture(2);
  try{
    f.tracker.advance(null);const before=f.tracker.inspect(),lease=f.tracker.beginSearch(1100);
    assert.equal(lease.account.milliseconds,1100);assert.equal(lease.window.milliseconds,800);
    assert.throws(()=>f.tracker.beginSearch(0),/already in use/);
    assert.throws(()=>f.tracker.snapshot(),/unfinished probability search/);
    assert.throws(()=>f.tracker.advance(null),/during probability search/);
    // The enclosing policy used 400 ms. It is charged even when its proposal
    // is discarded; no accepted action or game RNG cursor is advanced.
    const cost=lease.close({milliseconds:400,nodes:20,advances:8});
    assert.equal(cost.milliseconds,1500);assert.equal(f.tracker.inspect().window.milliseconds,1200);
    assert.equal(cost.nodes,before.account.nodes+20);assert.equal(f.tracker.inspect().window.nodes,20);
    assert.deepEqual(lease.close({milliseconds:400,nodes:20,advances:8}),cost,'closing twice cannot charge twice');
    const snapshot=f.tracker.snapshot(),machine=new CardMachine(f.program,privateCardGraph(f.machine.storage.export(f.machine.root))),restored=new ProbabilityTracker(machine,f.spec,snapshot,f.clock);
    try{
      assert.deepEqual(restored.inspect(),f.tracker.inspect());
      restored.advance(null);assert.equal(restored.inspect().reason,'tracking-wall-budget');
    }finally{restored.close();machine.storage.close?.();}
    const exhausted=f.tracker.beginSearch(60_000);exhausted.close({milliseconds:0,nodes:0,advances:0});
    f.tracker.advance(null);assert.equal(f.tracker.inspect().reason,'tracking-game-budget');
    assert.ok(f.tracker.inspect().account.milliseconds>=60_000);
  }finally{f.tracker.close();f.machine.storage.close?.();}
});


test('enclosing search accounting does not add source fork work a second time',()=>{
  const f=liveCaptureFixture(),tracker=new ProbabilityTracker(f.machine,{
    isDecision:stop=>stop.call.port==='decision',word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
    observe(stop){if(stop.kind==='call'&&stop.call.port==='event')return{reply:null};return{key:stop.kind==='call'&&stop.call.port==='decision'?'extra:'+stop.call.input.extra:JSON.stringify(stop)};},respond:(_actual,reply)=>reply,
  });
  let child:typeof tracker|undefined,childMachine:typeof f.machine|undefined;
  try{
    tracker.advance(null);tracker.advance(null);assert.equal(tracker.inspect().worlds,2);
    const lease=tracker.beginSearch(0),before=tracker.inspect();
    childMachine=new CardMachine(f.machine.program,(f.machine.storage as import('../src/graph.ts').CardGraph<any>).fork());child=tracker.fork(childMachine);
    assert.equal(tracker.inspect().account.nodes,before.account.nodes+2);
    const total=lease.close({milliseconds:100,nodes:3,advances:0});
    assert.equal(total.nodes,before.account.nodes+3);
    assert.equal(total.milliseconds,before.account.milliseconds+100);
  }finally{child?.close();childMachine?.storage.close?.();tracker.close();f.machine.storage.close?.();}
});


test('snapshot encoding/storage and restore costs reach the live budget, including failed writes and host recovery tails',async t=>{
  let now=0,failWrite=false;t.mock.method(performance,'now',()=>now);
  const storage=memorySnapshotStore(),store={...storage,async put(id:string,bytes:Uint8Array){now+=25;if(failWrite)throw Error('store unavailable');return storage.put(id,bytes);},async get(id:string){now+=10;return storage.get(id);}};
  const f=fixture(),definition=withProbabilityTracking(f.current.machine.program.definition,{
    observe:stop=>({key:JSON.stringify(stop)}),respond:(_actual,reply)=>reply,word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),
  });f.current.close();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition)),parent=unwrap(await loaded.core.start(undefined));
  try{
    const before=unwrap(await parent.inspect()),saved=unwrap(await loaded.persistence!.save(parent));
    assert.equal((await inspectProbabilityTracking(parent))!.account.milliseconds,25);
    assert.equal((await inspectProbabilityTracking(parent))!.window.milliseconds,25);
    const restored=unwrap(await loaded.persistence!.restore(saved));
    try{
      assert.equal((await inspectProbabilityTracking(restored))!.account.milliseconds,10,'reading and loading the saved current is not free');
      const host=await acquireProbabilityHostCost(restored,25);
      assert.equal(host.update(0).milliseconds,35,'the host save tail must be added before, not instead of, the new restore cost');
      assert.equal((await inspectProbabilityTracking(restored))!.window.milliseconds,35);
      assert.equal((await acquireProbabilityHostCost(restored,35)).update(0).milliseconds,35,'reconciliation is applied once');
    }finally{unwrap(await restored.close());}
    failWrite=true;const failed=await loaded.persistence!.save(parent);assert.equal(failed.ok,false);
    assert.equal((await inspectProbabilityTracking(parent))!.account.milliseconds,50,'failed persistence remains paid');
    assert.deepEqual(unwrap(await parent.inspect()),before);
  }finally{unwrap(await parent.close());}
});


test('an accepted pending current input survives invisible IO, fork and direct restore without executing a prefix',async()=>{
  const f=liveCaptureFixture(false,0,false,true),definition=withProbabilityTracking(f.machine.program.definition,{
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),isDecision:stop=>stop.call.port==='decision',
    observe(stop){if(stop.kind==='fault')throw Error(stop.error.message);if(stop.kind==='done')return{key:JSON.stringify(stop.result)};if(stop.call.port==='event')return{reply:null};return{key:stop.call.port==='decision'?'extra:'+stop.call.input.extra:'begin'};},respond:(_actual,reply)=>reply,
  });f.machine.storage.close?.();
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition)),instance=unwrap(await loaded.core.start(undefined)),owned=[instance];
  const initialize=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Pending input restore cannot initialize');};
    unwrap(await instance.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
    while(unwrap(await instance.run()).accepted){}
    const ready=await inspectProbabilityTracking(instance);assert.equal(ready!.aligned,true);
    unwrap(await instance.bind({decision:async()=>({kind:'reply',value:3}),event:async()=>({kind:'pause'})}));unwrap(await instance.run());
    const current=unwrap(await instance.inspect()),model=await inspectProbabilityTracking(instance);assert.equal(model!.aligned,false);assert.equal(model!.phase,'active');
    if(current.kind!=='call'||current.call.port!=='event')throw Error('Expected invisible current IO');
    const counts=f.counts(),saved=unwrap(await loaded.persistence!.save(instance)),raw=deserialize((await store.get(saved.snapshotId))!);
    assert.deepEqual(raw.tracking.pending,[3,3]);assert.equal(raw.tracking.frontier.outcomes.length,2);
    const restored=unwrap(await loaded.persistence!.restore(saved)),forked=unwrap(await instance.fork!());owned.push(restored,forked);
    for(const branch of [restored,forked]){
      assert.deepEqual(unwrap(await branch.inspect()),current);
      unwrap(await branch.bind({event:async()=>({kind:'reply',value:null})}));unwrap(await branch.run());
      const after=unwrap(await branch.inspect());assert.equal(after.kind,'done');if(after.kind!=='done')throw Error('Expected terminal');assert.deepEqual(after.result,{selected:1,count:11,extra:0});
      const posterior=await inspectProbabilityTracking(branch);assert.equal(posterior!.phase,'active');assert.equal(posterior!.aligned,true);assert.equal(posterior!.worlds,1);
    }
    assert.deepEqual(f.counts(),counts,'no initializer, accepted prefix or random operation was executed again');
    assert.deepEqual(unwrap(await instance.inspect()),current);
  }finally{CardProgram.prototype.initial=initialize;for(const branch of owned)unwrap(await branch.close());}
});


test('public automatic evidence defers unexecuted successors and survives fork and direct restoration',()=>{
  type State={latent:number;checksum:number;law:import('../../card-engine/src/probability.ts').ForwardProbabilityResult|null};
  type Ports={begin:{input:null;output:null};event:{input:string;output:null};decision:{input:number;output:number}};
  let initialized=0,realDraws=0,resolutions=0,callbacks=0;
  const start=()=>undefined,end=()=>undefined,coin=()=>1,draw=()=>15,publication=()=>undefined;
  probabilityOperation<State>(start,{space:()=>({kind:'boundary',name:'start'}),resolve:()=>undefined,forward:{plan:()=>({until:'end',maximum:2,milliseconds:2000,random:{state:1,position:0}}),word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),project:s=>s.state.latent},resolveForward:(s,result)=>{s.state.law=result;}});
  probabilityOperation<State>(end,{space:()=>({kind:'boundary',name:'end'}),resolve:()=>undefined});
  probabilityOperation<State>(coin,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  const actualDraw=()=>{realDraws++;return draw();};
  probabilityOperation<State>(actualDraw,{space:()=>({kind:'uniform',size:16n}),resolve:(_s,c)=>{resolutions++;return Number(c);},partition:(_s,hint)=>{
    assert.deepEqual(hint,[{kind:'discrete-result',name:'shown',value:15}]);
    return{representation:'particles',outcomes:[{coordinate:15n,probability:1/16},{coordinate:0n,probability:15/16}]};
  }});
  probabilityOperation<State>(publication,{space:()=>({kind:'boundary',name:'shown'}),resolve:()=>undefined,publication:s=>({kind:'discrete-result',name:'shown',value:s.locals.value})});
  const program=new CardProgram<State,void,Ports,number>({id:'deferred-visible-evidence',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()},event:{input:z.string(),output:z.null()},decision:{input:z.number(),output:z.number()}}},initialize:()=>{initialized++;return{latent:-1,checksum:0,law:null};},entry:'root',effects:[{id:'root',steps:[
    card.request(()=>({port:'begin',input:null})),card.operation(start),card.operation(coin,'latent'),card.operation<State>(s=>{s.state.latent=s.locals.latent;}),card.operation(end),
    card.request(()=>({port:'decision',input:0}),'action'),card.operation(actualDraw,'value'),card.operation<State>(s=>{callbacks++;s.state.checksum=s.locals.action*100+s.locals.value;}),
    card.request(()=>({port:'event',input:'before reveal'})),card.operation(publication),card.request<State>(s=>({port:'event',input:'shown:'+s.locals.value})),
    card.request<State>(s=>({port:'decision',input:s.state.checksum})),card.return<State>(s=>s.state.checksum),
  ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const spec:import('../src/probability-tracking.ts').ProbabilityTrackingSpec<Ports,number>={
    isDecision:stop=>stop.call.port==='decision',word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),respond:(_actual,reply)=>reply,
    observe(stop){if(stop.kind==='fault')throw Error(stop.error.message);if(stop.kind==='done')return{key:'done:'+stop.result};if(stop.call.port==='event')return{key:stop.call.input,acknowledgement:null};return{key:stop.call.port+':'+stop.call.input};},
  };
  const tracker=new ProbabilityTracker(machine,spec),owned=[{machine,tracker}],initialize=CardProgram.prototype.initial;
  try{
    assert.equal(tracker.advance(null).kind,'call');assert.equal(tracker.inspect().aligned,true);assert.equal(tracker.inspect().worlds,2);
    CardProgram.prototype.initial=function(){throw Error('No initialization during deferred evidence');};
    const boundary=tracker.advance(3);assert.equal(boundary.kind,'call');assert.equal(tracker.inspect().aligned,false);assert.equal(realDraws,1);assert.equal(resolutions,0);assert.equal(callbacks,1);
    assert.throws(()=>tracker.forkForSearch({check(){},execute:(_phase,run)=>run()}),/not reached/);
    const snapshot=tracker.snapshot(),context=machine.storage.export(machine.root);program.validate(context);
    assert.deepEqual(snapshot.pending,[3,3]);assert.deepEqual(snapshot.deferred,['before reveal']);
    const restoredMachine=new CardMachine(program,privateCardGraph(context)),restored=new ProbabilityTracker(restoredMachine,spec,structuredClone(snapshot));owned.push({machine:restoredMachine,tracker:restored});
    const forkedMachine=new CardMachine(program,(machine.storage as import('../src/graph.ts').CardGraph<any>).fork()),forked=tracker.fork(forkedMachine);owned.push({machine:forkedMachine,tracker:forked});
    for(const branch of [restored,forked]){
      branch.advance(null);assert.equal(branch.inspect().aligned,false);assert.deepEqual(branch.snapshot().deferred,['before reveal','shown:15']);
      const stop=branch.advance(null);assert.deepEqual(stop,{kind:'call',call:{port:'decision',input:315}});
      assert.equal(branch.inspect().phase,'active',branch.inspect().reason??'missing posterior');assert.equal(branch.inspect().aligned,true);assert.equal(branch.inspect().worlds,2);
      assert.deepEqual(branch.snapshot().deferred,[]);assert.equal(branch.snapshot().pending,null);
      const before:{resolutions:number;callbacks:number}={resolutions,callbacks};assert.deepEqual(branch.advance(0),{kind:'done',result:315});assert.deepEqual({resolutions,callbacks},before,'the original candidate edge is never executed twice');
    }
    assert.equal(initialized,1);assert.equal(realDraws,1);assert.equal(resolutions,8);assert.equal(callbacks,9);
    assert.deepEqual(machine.storage.export(machine.root),context);assert.deepEqual(tracker.snapshot().deferred,['before reveal']);
  }finally{CardProgram.prototype.initial=initialize;for(const row of owned){row.tracker.close();row.machine.storage.close?.();}}
});

test('public request scheduling can retain immediate event conditioning without renewing its budget',()=>{
  const f=liveCaptureFixture(false,0,false,true);
  const tracker=new ProbabilityTracker(f.machine,{
    isDecision:stop=>stop.call.port==='decision',deferAutomatic:()=>false,
    word:cursor=>({value:0,random:{...cursor,position:cursor.position+1}}),respond:(_actual,reply)=>reply,
    observe(stop){if(stop.kind==='fault')throw Error(stop.error.message);if(stop.kind==='done')return{key:JSON.stringify(stop.result)};if(stop.call.port==='event')return{key:stop.call.input,acknowledgement:null};return{key:stop.call.port==='decision'?'extra:'+stop.call.input.extra:'begin'};},
  });
  try{
    tracker.advance(null);tracker.advance(null);assert.equal(tracker.inspect().aligned,true);
    tracker.advance(3);assert.equal(tracker.inspect().aligned,true);assert.deepEqual(tracker.snapshot().deferred,[]);assert.equal(tracker.snapshot().pending,null);assert.equal(tracker.snapshot().deferAutomatic,false);
    const before=tracker.inspect().window;tracker.advance(null);assert.equal(tracker.inspect().aligned,true);assert.ok(tracker.inspect().window.nodes>=before.nodes);assert.ok(tracker.inspect().window.milliseconds>=before.milliseconds);
  }finally{tracker.close();f.machine.storage.close?.();}
});

test('probability partitions preserve public evidence and reject malformed mass before executing children',()=>{
  for(const malformed of [false,true]){
    type State={value:number};const pick=(scope:import('../../card-engine/src/card.types.ts').CardScope<State>)=>{scope.state.value=1;return 1;};
    probabilityOperation<State>(pick,{
      space:()=>({kind:'sampled'}),sample:()=>0,resolve:()=>{throw Error('Expected sampled coordinate');},resolveSample:(scope,value)=>{scope.state.value=value as number;return value;},
      partition:(_scope,hint,maximum)=>{assert.deepEqual(hint,[{revealed:1}]);assert.ok(maximum>=2);return{representation:'exact',outcomes:[{coordinate:{kind:'sample',value:0},probability:.25},{coordinate:{kind:'sample',value:1},probability:malformed?.5:.75}]};},
      publication:scope=>({revealed:scope.state.value}),
    });
    const definition={id:'partition-publication',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({value:-1}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(pick,'value'),card.return<State>(scope=>scope.locals.value)]}]};
    const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const source=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
    try{
      const run=()=>conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:source,probability:1,data:null}]},()=>null,{
        maximum:2,attempts:8,hint:[{revealed:1}],entropy:exactEntropy,
        likelihood:(_current,_data,publications)=>JSON.stringify(publications)===JSON.stringify([{revealed:1}])?1:0,
      });
      if(malformed)assert.throws(run,/Invalid probability partition mass/);
      else{const result=run();try{assert.equal(result.evidence,.75);assert.equal(result.frontier!.outcomes.length,1);assert.deepEqual(result.frontier!.outcomes[0]!.current.inspect(),{kind:'done',result:1});}finally{for(const row of result.frontier?.outcomes??[])row.current.close();}}
      assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{source.close();}
  }
});

test('public prefix conditioning prunes a joint space incrementally without losing its evidence mass',()=>{
  type State={total:number};let resolutions=0,initializations=0;
  const pick=()=>7,publication=()=>undefined;
  probabilityOperation<State>(pick,{space:()=>({kind:'uniform',size:8n}),resolve:(_scope,c)=>{resolutions++;return Number(c);}});
  probabilityOperation<State>(publication,{space:()=>({kind:'uniform',size:1n}),resolve:()=>undefined,publication:scope=>({revealed:scope.locals.value})});
  const program=new CardProgram<State,void,{begin:{input:null;output:null}},number>({id:'public-prefix-conditioning',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>{initializations++;return{total:0};},entry:'root',effects:[{id:'root',steps:[
    card.request(()=>({port:'begin',input:null})),...Array.from({length:3},()=>[card.operation(pick,'value'),card.operation(publication),card.operation<State>(scope=>{scope.state.total+=scope.locals.value;})]).flat(),card.return<State>(scope=>scope.state.total),
  ]}]});
  const storage=privateCardGraph(program.initial(undefined)),machine=new CardMachine(program,storage);machine.advance();
  const current=new ProbabilityCurrent(new CardMachine(program,storage.fork()));
  const before=current.machine.storage.export(current.machine.root),actual=machine.advance(null),publications=machine.takeProbabilityPublications();
  assert.deepEqual(actual,{kind:'done',result:21});assert.deepEqual(publications,Array.from({length:3},()=>({revealed:7})));
  const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,publications,entropy:exactEntropy,likelihood:c=>c.inspect().kind==='done'?1:0});
  try{
    assert.equal(result.evidence,1/512);assert.equal(result.frontier!.representation,'exact');assert.equal(result.frontier!.outcomes.length,1);
    assert.deepEqual(result.frontier!.outcomes[0]!.current.inspect(),actual);assert.equal(resolutions,24);assert.equal(initializations,1);
    assert.deepEqual(current.machine.storage.export(current.machine.root),before);
  }finally{for(const row of result.frontier?.outcomes??[])row.current.close();current.close();machine.storage.close?.();}
});

test('a public declaration alone does not resample away unobserved hidden support',()=>{
  const declare=()=>undefined,hidden=()=>5;
  probabilityOperation(declare,{space:()=>({kind:'boundary',name:'public-roster'}),resolve:()=>undefined,publication:()=>({kind:'discrete-result',name:'roster',value:'same'})});
  probabilityOperation(hidden,{space:()=>({kind:'uniform',size:6n}),resolve:(_scope,c)=>Number(c)});
  const program=new CardProgram({id:'unguided-public-declaration',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(declare),card.operation(hidden,'value'),card.return(scope=>scope.locals.value)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  const publications=[{kind:'discrete-result',name:'roster',value:'same'}];
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:2,attempts:64,publications,hint:publications,entropy:exactEntropy,likelihood:child=>{const stop=child.inspect();return stop.kind==='done'&&stop.result===5?1:0;}});
    try{
      assert.equal(result.evidence,1/6);assert.equal(result.frontier!.representation,'exact');assert.equal(result.frontier!.outcomes.length,1);
      assert.deepEqual(result.frontier!.outcomes[0]!.current.inspect(),{kind:'done',result:5});
      assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
  }finally{current.close();}
});

test('finite public result population reduction keeps surviving evidence mass and current continuations',()=>{
  const declaration=(value:unknown)=>({kind:'discrete-result',name:'public',value});
  const publicDraw=()=>1,hidden=()=>0;
  probabilityOperation(publicDraw,{space:()=>({kind:'uniform',size:2n}),resolve:(_scope,c)=>Number(c),publication:(_scope,value)=>declaration(value),partition:()=>({representation:'exact',outcomes:[{coordinate:0n,probability:.5},{coordinate:1n,probability:.5}]})});
  probabilityOperation(hidden,{space:()=>({kind:'uniform',size:6n}),resolve:(_scope,c)=>Number(c)});
  const program=new CardProgram({id:'finite-result-population',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({hidden:-1}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(publicDraw,'visible'),card.operation(hidden,'hidden'),card.operation<{hidden:number}>(s=>{s.state.hidden=s.locals.hidden;}),card.return(scope=>scope.locals.visible)]}]});
  const storage=privateCardGraph(program.initial(undefined)),machine=new CardMachine(program,storage);machine.advance();
  const current=new ProbabilityCurrent(machine),before=current.machine.storage.export(current.machine.root);
  let word=0,checked=0;
  const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:2,attempts:64,publications:[declaration(1)],hint:[declaration(1)],entropy:{check(){},word:()=>word=(Math.imul(word,1664525)+1013904223)>>>0},likelihood:()=>{checked++;return 1;}});
  try{
    assert.ok(Math.abs(result.evidence-.5)<1e-12);assert.equal(result.frontier!.representation,'particles');assert.ok(checked<=2,'a real finite partition enables reduction before the public boundary');assert.ok(result.frontier!.outcomes.length<=2);
    assert.ok(Math.abs(result.frontier!.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
    for(const row of result.frontier!.outcomes)assert.deepEqual(row.current.inspect(),{kind:'done',result:1});
    assert.deepEqual(current.machine.storage.export(current.machine.root),before);
  }finally{for(const row of result.frontier?.outcomes??[])row.current.close();current.close();}
});

test('candidate constraints prune only against public targets and never expose actual intermediate results',()=>{
  type State={prefix:number;raw:number};let initialized=0,prefix=0;
  const draw=()=>5;
  const publish=(s:import('@bear-forge/card-engine').CardScope<State>)=>Math.floor(s.locals.raw/2);
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:8n}),resolve:(_s,c)=>Number(c),constraints:(_s,result)=>[{name:'final',values:[Math.floor(Number(result)/2)]}]});
  probabilityOperation<State>(publish,{space:()=>({kind:'boundary',name:'visible'}),resolve:s=>publish(s),publication:(_s,value)=>({kind:'discrete-result',name:'final',value})});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},number>({id:'future-public-constraints',schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},initialize:()=>{initialized++;return{prefix:0,raw:-1};},entry:'root',effects:[{id:'root',steps:[
    card.request(()=>({port:'input',input:null})),card.operation<State>(s=>{s.state.prefix++;prefix++;}),card.operation(draw,'raw'),card.operation<State>(s=>{s.state.raw=s.locals.raw;}),card.operation(publish,'final'),card.return(s=>s.locals.final),
  ]}]});
  const storage=privateCardGraph(program.initial(undefined)),machine=new CardMachine(program,storage);machine.advance();
  const root=new ProbabilityCurrent(new CardMachine(program,storage.fork()));
  try{
    assert.deepEqual(machine.advance(null),{kind:'done',result:2});
    const publications=machine.takeProbabilityPublications();assert.deepEqual(publications,[{kind:'discrete-result',name:'final',value:2}]);
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current:root,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,entropy:exactEntropy,publications,hint:publications,likelihood:()=>1});
    try{
      assert.equal(result.evidence,1/4);assert.equal(result.frontier!.representation,'exact');assert.equal(result.frontier!.outcomes.length,2);
      for(const row of result.frontier!.outcomes){assert.equal(row.probability,.5);assert.deepEqual(row.current.inspect(),{kind:'done',result:2});}
      assert.deepEqual(result.frontier!.outcomes.map(row=>row.current.machine.root.state.raw),[4,5]);
      assert.equal(root.machine.root.state.prefix,0);assert.equal(initialized,1);assert.equal(prefix,2,'one original prefix per real/candidate transition');
    }finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
  }finally{root.close();machine.storage.close?.();}
});


test('conditional depth-first sampling leaves capacity for later public partitions',()=>{
  let hiddenDraws=0,partitionCalls=0;
  const hidden=()=>0,visible=()=>3;
  probabilityOperation(hidden,{space:()=>({kind:'uniform',size:100n}),resolve:(_s,c)=>{hiddenDraws++;return Number(c);}});
  probabilityOperation(visible,{space:()=>({kind:'uniform',size:4n}),resolve:(_s,c)=>Number(c),publication:(_s,value)=>({kind:'ordered-prefix',orderedMembers:[value]}),partition:(_s,_hint,maximum)=>{assert.ok(maximum>=2);partitionCalls++;return{representation:'particles',outcomes:[{coordinate:3n,probability:.25},{coordinate:0n,probability:.75}]};}});
  const program=new CardProgram({id:'depth-first-observation-capacity',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(hidden,'latent'),card.operation(visible,'shown'),card.return(s=>s.locals.shown)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);let word=0;
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,publications:[{kind:'ordered-prefix',orderedMembers:[3]}],hint:[{kind:'ordered-prefix',orderedMembers:[3]}],entropy:{check(){},word:()=>word=(Math.imul(word,1664525)+1013904223)>>>0},likelihood:()=>1});
    try{assert.equal(hiddenDraws,8);assert.equal(partitionCalls,8);assert.equal(result.evidence,.25);assert.equal(result.frontier!.representation,'particles');assert.equal(result.frontier!.outcomes.length,8);assert.deepEqual(machine.storage.export(machine.root),before);}
    finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
  }finally{current.close();}
});

for(const conditioned of [false,true])test(`unit-mass ${conditioned?'conditional':'ordinary'} steps execute once without redundant forks`,()=>{
  type State={left:{n:number};right:{n:number}};let initialized=0,operations=0,forks=0,advances=0;
  const unit=()=>undefined,weighted=()=>undefined,marker=()=>undefined;
  const change=(s:import('@bear-forge/card-engine').CardScope<State>,c:bigint)=>{s.state.left.n+=Number(c)+1;operations++;return undefined;};
  probabilityOperation<State>(unit,{space:()=>({kind:'uniform',size:1n}),resolve:change});
  probabilityOperation<State>(weighted,{space:()=>({kind:'weighted',weights:[0,0,1,0]}),resolve:change});
  probabilityOperation<State>(marker,{space:()=>({kind:'boundary',name:'unit-marker'}),resolve:change,publication:()=>({visible:'unit'})});
  const program=new CardProgram<State,void,{begin:{input:null;output:null}},number>({id:'unit-mass-current',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>{initialized++;const shared={n:0};return{left:shared,right:shared};},entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),...Array.from({length:12},()=>[card.operation(unit),card.operation(weighted),card.operation(marker)]).flat(),card.return(s=>s.state.right.n)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  const execute=<T>(phase:'fork'|'advance'|'cleanup',run:()=>T)=>{if(phase==='fork')forks++;if(phase==='advance')advances++;return run();};
  try{
    const source={representation:'exact' as const,outcomes:[{current,probability:1,data:null}]},options={maximum:8,entropy:exactEntropy,execute};
    const result=conditioned?conditionedNextProbabilityFrontier(source,()=>null,{...options,attempts:64,publications:Array.from({length:12},()=>({visible:'unit'})),likelihood:()=>1}).frontier!:nextProbabilityFrontier(source,()=>null,options);
    try{assert.equal(result.representation,'exact');assert.equal(result.outcomes.length,1);assert.equal(result.outcomes[0]!.probability,1);assert.deepEqual(result.outcomes[0]!.current.inspect(),{kind:'done',result:60});assert.equal(result.outcomes[0]!.current.machine.root.state.left,result.outcomes[0]!.current.machine.root.state.right);assert.equal(initialized,1);assert.equal(operations,36);assert.equal(forks,1);assert.equal(advances,37);assert.deepEqual(machine.storage.export(machine.root),before);}
    finally{for(const row of result.outcomes)row.current.close();}
  }finally{current.close();}
});


for(const mode of ['equal','hidden','alias','publication','anchor'] as const)test(`coalescing original successor Contexts retains ${mode} distinctions`,()=>{
  type State={left:{n:number};right:{n:number};event:unknown};let initialized=0,chosen=0,suffix=0;
  const anchored=ownRuleValue({payload:{n:1}}),draw=()=>0,marker=()=>undefined;
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:3n}),resolve:(_s,c)=>{chosen++;return Number(c);},...(mode==='publication'?{publication:(_s:unknown,value:unknown)=>({value})}:{})});
  probabilityOperation<State>(marker,{space:()=>({kind:'boundary',name:'after-original-choice'}),resolve:()=>undefined});
  const program=new CardProgram<State,void,{begin:{input:null;output:null};event:{input:null;output:null}},number>({id:'complete-current-coalescing-'+mode,schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()},event:{input:z.null(),output:z.null()}}},initialize:()=>{initialized++;const shared={n:0};return{left:shared,right:shared,event:null};},entry:'root',effects:[
    {id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.invoke('choose',()=>null),card.operation(marker),card.request(()=>({port:'event',input:null})),card.operation(()=>{suffix++;}),card.return<State>(s=>mode==='anchor'?Number(s.state.event===anchored):s.state.right.n)]},
    {id:'choose',steps:[card.operation(draw,'choice'),card.operation<State>(s=>{s.state.event=mode==='anchor'&&s.locals.choice===0?anchored:ownRuleValue({payload:{n:1}});s.state.left.n=mode==='hidden'?s.locals.choice:1;if(mode==='alias'&&s.locals.choice>0)s.state.right={n:1};}),card.return(()=>undefined)]},
  ]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:{identities:new Map([[1,0]])}}]},()=>null,{maximum:8,attempts:64,entropy:exactEntropy,likelihood:()=>1,continueCall:(_stop,data)=>({reply:null,data})}).frontier!;
    try{
      const expected=mode==='equal'?1:mode==='alias'||mode==='anchor'?2:3;assert.equal(result.representation,'exact');assert.equal(result.outcomes.length,expected);assert.equal(suffix,expected);assert.equal(chosen,3);assert.equal(initialized,1);
      assert.ok(Math.abs(result.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
      if(mode==='equal'){assert.equal(result.outcomes[0]!.probability,1);assert.equal(result.outcomes[0]!.current.machine.root.state.left,result.outcomes[0]!.current.machine.root.state.right);}
      if(mode==='alias'||mode==='anchor')assert.deepEqual(result.outcomes.map(row=>row.probability),[1/3,2/3]);
      if(mode==='anchor')assert.deepEqual(result.outcomes.map(row=>row.current.inspect()),[1,0].map(result=>({kind:'done',result})));
      if(mode==='hidden')assert.deepEqual(result.outcomes.map(row=>row.current.inspect()),[0,1,2].map(result=>({kind:'done',result})));
      assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{for(const row of result.outcomes)row.current.close();}
  }finally{current.close();}
});


test('population reduction preserves a rare verified prefix beside unfinished public evidence',()=>{
  type State={branch:number;hidden:number};const branch=()=>0,hidden=()=>0,rare=()=>1;
  probabilityOperation<State>(branch,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(hidden,{space:()=>({kind:'uniform',size:6n}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(rare,{space:()=>({kind:'weighted',weights:[1-1e-6,1e-6]}),resolve:(_s,c)=>Number(c),publication:(_s,value)=>({kind:'discrete-result',name:'rare',value}),partition:()=>({representation:'exact',outcomes:[{coordinate:0n,probability:1-1e-6},{coordinate:1n,probability:1e-6}]})});
  const program=new CardProgram<State,void,{begin:{input:null;output:null}},number>({id:'rare-public-progress-strata',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({branch:-1,hidden:-1}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(branch,'branch'),card.operation<State>(s=>{s.state.branch=s.locals.branch;}),card.branch<State>(s=>s.state.branch===1,[card.operation(hidden,'hidden'),card.operation<State>(s=>{s.state.hidden=s.locals.hidden;})],[]),card.operation(rare,'rare'),card.return<State>(s=>s.state.branch)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root),publications=[{kind:'discrete-result',name:'rare',value:1}];
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:2,attempts:64,entropy:{check(){},word:()=>0},publications,hint:publications,likelihood:()=>1});
    try{assert.ok(Math.abs(result.evidence-1e-6)<1e-16);assert.equal(result.frontier!.representation,'particles');assert.deepEqual(result.frontier!.outcomes.map(row=>row.current.machine.root.state.branch),[0,1]);for(const row of result.frontier!.outcomes)assert.ok(Math.abs(row.probability-.5)<1e-12);assert.deepEqual(machine.storage.export(machine.root),before);}
    finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
  }finally{current.close();}
});


test('due collection is charged to the executed continuation and never to fork',()=>{
  const operation=()=>0;probabilityOperation(operation,{space:()=>({kind:'uniform',size:1n}),resolve:()=>0});
  let executions=0;
  const program=new CardProgram({id:'transient-collection-scheduling',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({n:0}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(operation),card.operation<{n:number}>(s=>{executions++;s.state.n++;}),card.operation(operation),card.return<{n:number}>(s=>s.state.n)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const root=new ProbabilityCurrent(machine),current=root.fork(),storage=current.machine.storage as ReturnType<typeof privateCardGraph>,finish=storage.finishCollection.bind(storage);let forced=0;
  storage.finishCollection=()=>{forced++;finish();};
  try{
    assert.equal(current.advance(null).kind,'chance');assert.equal(current.advance(0n).kind,'chance');assert.equal(forced,2);assert.equal(executions,1);
    const child=current.fork();try{assert.equal(forced,2);assert.deepEqual(child.advance(0n),{kind:'done',result:1});assert.equal(executions,1);assert.equal(current.inspect().kind,'chance');}
    finally{child.close();}
    assert.equal(root.machine.root.state.n,0);
  }finally{current.close();root.close();}
});


test('a long known observation batch shares samples while preserving every declaration and parent mass',()=>{
  let draws=0;const hidden=()=>0,visible=()=>3,publish=(s:import('@bear-forge/card-engine').CardScope<{}>)=>s.input;
  probabilityOperation(hidden,{space:()=>({kind:'uniform',size:100n}),resolve:(_s,c)=>{draws++;return Number(c);}});
  probabilityOperation(visible,{space:()=>({kind:'uniform',size:4n}),resolve:(_s,c)=>Number(c),publication:(_s,value)=>({kind:'ordered-prefix',orderedMembers:[value]}),partition:()=>({representation:'particles',outcomes:[{coordinate:3n,probability:.25},{coordinate:0n,probability:.75}]})});
  probabilityOperation<{}>(publish,{space:()=>({kind:'boundary',name:'visible'}),resolve:s=>publish(s),publication:(_s,value)=>({kind:'ordered-prefix',orderedMembers:[value]})});
  const program=new CardProgram({id:'known-batch-sampling',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(hidden,'latent'),card.operation(visible,'shown'),...Array.from({length:4},(_,i)=>card.invoke('publish',()=>i+4)),card.return(s=>s.locals.shown)]},{id:'publish',steps:[card.operation(publish),card.return(()=>undefined)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root),publications=[3,4,5,6,7].map(value=>({kind:'ordered-prefix',orderedMembers:[value]}));let word=0;
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,publications,hint:publications,entropy:{check(){},word:()=>word=(Math.imul(word,1664525)+1013904223)>>>0},likelihood:()=>1});
    try{assert.equal(draws,1);assert.equal(result.evidence,.25);assert.equal(result.frontier!.representation,'particles');assert.equal(result.frontier!.outcomes.length,1);assert.equal(result.frontier!.outcomes[0]!.probability,1);assert.deepEqual(result.frontier!.outcomes[0]!.current.inspect(),{kind:'done',result:3});assert.deepEqual(machine.storage.export(machine.root),before);}
    finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
  }finally{current.close();}
});

test('identical complete currents coalesce before a subsequent chance without repeating its outgoing edges',()=>{
  let initialized=0,first=0,second=0;const choose=()=>0,next=()=>0;
  probabilityOperation<{}>(choose,{space:()=>({kind:'uniform',size:3n}),resolve:()=>{first++;return 0;}});
  probabilityOperation<{}>(next,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>{second++;return Number(c);}});
  const program=new CardProgram<{},void,{begin:{input:null;output:null}},number>({id:'coalesce-before-next-chance',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>{initialized++;return{};},entry:'root',effects:[
    {id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.invoke('choose',()=>null),card.operation(next,'result'),card.return(s=>s.locals.result)]},
    {id:'choose',steps:[card.operation(choose),card.return(()=>undefined)]},
  ]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  try{
    const result=conditionedNextProbabilityFrontier({representation:'exact',outcomes:[{current,probability:1,data:null}]},()=>null,{maximum:8,attempts:64,entropy:exactEntropy,likelihood:()=>1});
    try{assert.equal(result.evidence,1);assert.equal(result.frontier!.representation,'exact');assert.equal(initialized,1);assert.equal(first,3);assert.equal(second,2);assert.deepEqual(result.frontier!.outcomes.map(row=>({stop:row.current.inspect(),mass:row.probability})),[0,1].map(result=>({stop:{kind:'done',result},mass:.5})));assert.deepEqual(machine.storage.export(machine.root),before);}
    finally{for(const row of result.frontier?.outcomes??[])row.current.close();}
  }finally{current.close();}
});
