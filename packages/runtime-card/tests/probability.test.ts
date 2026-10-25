import {ownRuleValue} from '../../card-engine/src/rules-values.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,card} from '@bear-forge/card-engine';
import {probabilityOperation} from '../../card-engine/src/probability.ts';
import {privateCardGraph} from '../src/graph.ts';
import {graphDataBytes} from '../src/graph-codec.ts';
import {ProbabilityCurrent,takeProbabilityCurrent,packProbabilitySnapshot,unpackProbabilitySnapshot} from '../src/probability.ts';
import {createCardLoader} from '../src/loader.ts';

import type {PortShape} from '@bear-forge/contracts/core';
import {serialize,deserialize} from 'node:v8';
import {ProbabilityExpansion} from '../src/probability-expansion.ts';
import {addMass,multiplyMass,probabilityMass,unitMass,zeroMass} from '../../card-engine/src/probability-mass.ts';

function complete<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(
  current:ProbabilityCurrent<S,Setup,P,R>,reply:unknown,data:D,
  options:NonNullable<Parameters<typeof ProbabilityExpansion.from<S,Setup,P,R,D>>[3]>={},cold=false,
){
  let expansion=ProbabilityExpansion.from(current,reply,data,options);
  const outcomes:NonNullable<ReturnType<typeof expansion.take>>[]=[];
  try{
    while(!expansion.complete){
      expansion.step();const mass=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
      for(let row=expansion.take();row;row=expansion.take())outcomes.push(row);
      if(cold){const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(current.machine.program,saved,options);}
    }
    for(let row=expansion.take();row;row=expansion.take())outcomes.push(row);
    assert.deepEqual(outcomes.reduce((mass,row)=>addMass(mass,row.mass),zeroMass()),unitMass());return{outcomes};
  }catch(error){for(const row of outcomes)row.current.close();throw error;}
  finally{expansion.close();}
}
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
for(const direct of [false,true])test(`durable compressed currents retain aliases, external anchors and original continuation without initialization; direct=${direct}`,()=>{
  const external=ownRuleValue({tag:'external'});let initialized=0,advanced=0;
  type State={left:{value:number};right:{value:number};cycle:any;external:typeof external;large:string[]};
  const program=new CardProgram<State,void,{input:{input:null;output:null}},number>({id:'durable-probability-current',schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initialized++;const shared={value:3},cycle:any={};cycle.self=cycle;return{left:shared,right:shared,cycle,external,large:Array.from({length:4000},()=> 'complete original Context')};},
    entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'input',input:null})),card.operation(s=>{advanced++;s.state.left.value++;}),card.return(s=>s.state.right.value)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const original=new ProbabilityCurrent(machine),initial=CardProgram.prototype.initial;
  let restored:ProbabilityCurrent<any,any,any,any>|undefined;
  try{
    const raw=original.snapshot();original.park();
    const storage=machine.storage as ReturnType<typeof privateCardGraph>,snapshot=storage.snapshot;
    let packed:ReturnType<typeof packProbabilitySnapshot>;
    try{
      if(direct)storage.snapshot=()=>{throw Error('A parked durable export must not rematerialize its graph');};
      packed=direct?original.packedSnapshot():packProbabilitySnapshot(program,raw);
    }finally{storage.snapshot=snapshot;}
    assert.equal(storage.nodeCount,0);
    assert.ok(graphDataBytes(packed.packed)<serialize(raw).byteLength/5);
    assert.ok(packed.packed.anchors.includes(external));
    const decoded=unpackProbabilitySnapshot<typeof machine.root.state>(packed);assert.equal(decoded.context.state.external,external);
    const [cold,anchor]=deserialize(serialize([packed,external]));
    const saved=unpackProbabilitySnapshot<typeof machine.root.state>(cold);
    assert.equal(saved.context.state.external,anchor);assert.equal(saved.context.state.left,saved.context.state.right);assert.equal(saved.context.state.cycle.self,saved.context.state.cycle);
    CardProgram.prototype.initial=()=>{throw Error('No initialization while decoding saved current');};
    restored=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(saved.context,saved.immutable,saved.nullPrototypes,saved.contextValues)));
    assert.deepEqual(restored.advanceExact(null),{kind:'done',result:4});assert.equal(initialized,1);assert.equal(advanced,1);
    assert.equal(original.machine.root.state.left.value,3);
    const damaged=structuredClone(packed);if('bytes' in damaged.packed)damaged.packed.bytes.fill(0);else damaged.packed.chunks[0]={data:'invalid'};assert.throws(()=>unpackProbabilitySnapshot(damaged));
    if('bytes' in packed.packed)packed.packed.bytes.fill(0);else packed.packed.chunks[0]={data:'invalid'};packed.packed.anchors.length=0;
    assert.equal(unpackProbabilitySnapshot<State>(original.packedSnapshot()).context.state.external,external,
      'exported bytes and anchor arrays must not alias the retained image');
    assert.equal(original.machine.root.state.large.length,4000);
  }finally{CardProgram.prototype.initial=initial;restored?.close();original.close();}
});

test('probability current equivalence retains hidden state, control, aliases and original Program identity',()=>{
  const f=fixture(),root=f.current,same=root.fork(),different=root.fork();
  try{
    assert.equal(root.sameCurrent(same),true);assert.deepEqual(f.counts(),{before:0,between:0});
    different.machine.root.state.before=1;
    assert.deepEqual(different.inspect(),root.inspect(),'public waiting IO alone cannot distinguish these states');
    assert.equal(root.sameCurrent(different),false);
    for(const mutate of [
      (current:typeof root)=>{current.machine.root.nextCall++;},
      (current:typeof root)=>{current.machine.root.budget--;},
      (current:typeof root)=>{current.machine.root.frames[0]!.locals.hidden=1;},
    ]){
      const child=root.fork();try{mutate(child);assert.equal(root.sameCurrent(child),false);}finally{child.close();}
    }
    const detached=root.machine.storage.export(root.machine.root),otherProgram=new CardProgram(root.machine.program.definition);
    const foreign=new ProbabilityCurrent(new CardMachine(otherProgram,privateCardGraph(detached)));
    try{assert.equal(root.sameCurrent(foreign),false);}finally{foreign.close();}
    assert.deepEqual(f.counts(),{before:0,between:0},'comparison never advances an original operation');
  }finally{root.close();same.close();different.close();}
});
test('parking keeps the same machine and pending publications and resumes original operations exactly once',()=>{
  let initialized=0,resolved=0;
  const draw=()=>0;probabilityOperation(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>{resolved++;return Number(c);},publication:(_s,result)=>({observed:result})});
  const program=new CardProgram({id:'park-original-current',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},
    initialize:()=>{initialized++;return{};},entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(draw,'choice'),card.return(s=>s.locals.choice)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),storage=machine.storage as ReturnType<typeof privateCardGraph>;
  const initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Parking must not initialize');};
    current.park();const sibling=current.fork();
    try{assert.equal(storage.isParked,true);sibling.park();assert.equal(current.sameCurrent(sibling),true);assert.equal(storage.isParked,true);assert.equal((sibling.machine.storage as typeof storage).isParked,true);}
    finally{sibling.close();}
    assert.equal(current.advance(null).kind,'chance');current.park();
    const saved=current.snapshot();assert.equal(saved.context.stop.kind,'chance');assert.equal(storage.isParked,true);
    assert.deepEqual(current.advance(1n),{kind:'done',result:1});current.park();
    assert.equal(current.machine,machine);assert.equal(current.machine.program,program);
    assert.deepEqual(machine.takeProbabilityPublications(),[{observed:1}]);assert.deepEqual(machine.takeProbabilityPublications(),[]);
    assert.deepEqual(current.inspect(),{kind:'done',result:1});assert.equal(initialized,1);assert.equal(resolved,1);
  }finally{CardProgram.prototype.initial=initial;current.close();}
});
for(const cold of [false,true])test(`retained currents reclaim discarded temporary state; cold=${cold}`,()=>{
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
    let priorNodes=initialNodes,collections=0;
    for(let step=0;step<48;step++){
      const parent=current.inspect(),result=complete(current,null,null,{},cold);
      assert.equal(result.outcomes.length,1);assert.deepEqual(current.inspect(),parent);
      current.close();current=result.outcomes[0]!.current;
      assert.equal(current.machine.root.state.count,step+1);
      assert.equal(current.machine.root.state.left,current.machine.root.state.right);
      assert.equal(current.machine.root.state.right.value,399*(step+1));
      const nodes=(current.machine.storage as ReturnType<typeof privateCardGraph>).nodeCount;
      if(nodes<priorNodes)collections++;
      priorNodes=nodes;
      // Collection is allocation-triggered (2048 rows), not a full scan at
      // every small successor. Allow one original operation's allocations,
      // while rejecting growth across multiple due collection cycles.
      assert.ok(nodes<initialNodes+2500,'dead temporary allocations must remain bounded across retained successors');
    }
    if(!cold)assert.ok(collections>=7,'live successors must finish repeated due collections without relying on serialization');
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

for(const earlyTerminal of [false,true])test(`exact COW expansion retains every conditional result and shares deterministic prefixes; early=${earlyTerminal}`,()=>{
  const f=fixture(earlyTerminal),before=f.current.machine.storage.export(f.current.machine.root),result=complete(f.current,null,null,{},true);
  try{
    const rows=result.outcomes.map(row=>{const stop=row.current.inspect();if(stop.kind!=='done')throw Error('Expected terminal');return{...stop.result,mass:row.mass};}).sort((a,b)=>a.a-b.a||a.b-b.b);
    assert.deepEqual(rows,[...(earlyTerminal?[{a:0,b:0,mass:probabilityMass(1n,2n)}]:[0,1].map(b=>({a:0,b,mass:probabilityMass(1n,4n)}))),...[0,1,2].map(b=>({a:1,b,mass:probabilityMass(1n,6n)}))]);
    assert.deepEqual(f.counts(),{before:1,between:2});
    for(const row of result.outcomes){assert.equal(row.current.machine.program,f.current.machine.program);assert.deepEqual(row.current.machine.storage.export(row.current.machine.root.state),{before:1,between:1});}
    assert.deepEqual(f.current.machine.storage.export(f.current.machine.root),before);
  }finally{for(const row of result.outcomes)row.current.close();f.current.close();}
});

test('an interrupted exact frontier retains its owned currents until explicit close and can resume without repeating edges',()=>{
  const f=fixture(),active=new Set<object>();let paused=false,steps=0;
  function track(current:typeof f.current):typeof f.current{active.add(current);const fork=current.fork.bind(current),close=current.close.bind(current);current.fork=()=>track(fork());current.close=()=>{close();active.delete(current);};return current;}
  track(f.current);const expansion=ProbabilityExpansion.from(f.current,null,null,{check(){if(paused)throw Error('interrupted');}});
  try{
    while(steps++<6)expansion.step();const saved=expansion.save();paused=true;
    assert.throws(()=>expansion.step(),/interrupted/);assert.deepEqual(expansion.save(),saved);assert.ok(active.size>1);assert.equal(f.current.inspect().kind,'call');
    paused=false;while(!expansion.complete)expansion.step();assert.deepEqual(f.counts(),{before:1,between:2});
    expansion.close();assert.deepEqual([...active],[f.current]);
  }finally{expansion.close();f.current.close();assert.equal(active.size,0);}
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
    const outcomes=complete(current,null,null);
    try{assert.equal(outcomes.outcomes.length,5);assert.equal(current.inspect().kind,'call');}
    finally{for(const child of outcomes.outcomes)child.current.close();}
    await assert.rejects(takeProbabilityCurrent(owner),/instance_owned|instance_closed/);
  }finally{CardProgram.prototype.initial=initialize;current?.close();}
});

test('a named boundary retains the joint effect result and resumes its current frames exactly once',()=>{
  type State={prefix:number;selected:number;count:number;after:number;markers:number};
  let initialized=0,prefix=0,first=0,second=0;
  const a=()=>17,b=()=>29;
  const marker=(s:{state:State})=>{s.state.markers++;};
  probabilityOperation<State>(a,{space:()=>({kind:'rational',weights:[probabilityMass(1n,4n),probabilityMass(3n,4n)]}),resolve:(_s,c)=>{first++;return Number(c);}});
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
  const result=complete(root,null,null,{stopAtBoundary:'selected'},true);
  try{
    result.outcomes.sort((a,b)=>a.current.machine.root.state.count-b.current.machine.root.state.count);
    assert.deepEqual(result.outcomes.map(o=>o.mass),[probabilityMass(1n,4n),probabilityMass(3n,8n),probabilityMass(3n,8n)]);
    assert.deepEqual({initialized,prefix,first,second},{initialized:1,prefix:1,first:2,second:3});
    const joint=result.outcomes.map(o=>o.current.machine.storage.export(o.current.machine.root.state));
    assert.deepEqual(joint,[{prefix:1,selected:0,count:0,after:0,markers:0},{prefix:1,selected:1,count:1,after:0,markers:0},{prefix:1,selected:1,count:2,after:0,markers:0}]);
    for(const outcome of result.outcomes){
      assert.deepEqual(outcome.current.inspect(),{kind:'chance',space:{kind:'boundary',name:'selected'}});
      const source=outcome.current.machine.storage.export(outcome.current.machine.root);
      const next=complete(outcome.current,0n,null,{},true);
      try{assert.equal(next.outcomes.length,1);assert.deepEqual(next.outcomes[0]!.current.inspect(),{kind:'done',result:{...source.state,after:1,markers:1}});}
      finally{for(const child of next.outcomes)child.current.close();}
      assert.deepEqual(outcome.current.machine.storage.export(outcome.current.machine.root),source);
    }
    assert.deepEqual({initialized,prefix,first,second},{initialized:1,prefix:1,first:2,second:3},'continuation cannot execute the selected effect again');
    assert.deepEqual(machine.storage.export(machine.root),before);
    assert.deepEqual(machine.advance(null),{kind:'done',result:{prefix:1,selected:17,count:46,after:1,markers:1}},'normal execution uses the same operations and ignores internal stops');
  }finally{for(const outcome of result.outcomes)outcome.current.close();root.close();}
});

function jointCurrentFixture(){
  type State={prefix:number;selected:number;record:{count:number};updates:number};
  type Result={selected:number;count:number;updates:number};
  type Ports={begin:{input:null;output:null};event:{input:string;output:null};nested:{input:Result;output:number}};
  let initialized=0,prefixCalls=0;
  const draw=()=>0,marker=()=>undefined;
  probabilityOperation<State>(draw,{space:()=>({kind:'rational',weights:[probabilityMass(1n,4n),probabilityMass(3n,4n)]}),resolve:(_s,c)=>Number(c)});
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


test('weighted original nested frames preserve joint state, aliases, event order and mass through cold continuation',()=>{
  const f=jointCurrentFixture(),before=f.root.machine.storage.export(f.root.machine.root),initial=CardProgram.prototype.initial;
  const owned=new Set<ProbabilityCurrent<any,any,any,any>>([f.root]);
  try{
    CardProgram.prototype.initial=function(){throw Error('Original nested continuation cannot initialize');};
    const selected=complete(f.root,null,null,{stopAtBoundary:'joint-selected'},true);for(const row of selected.outcomes)owned.add(row.current);
    const result:{mass:ReturnType<typeof probabilityMass>;events:string[];value:unknown}[]=[];
    for(const row of selected.outcomes){
      const nested=complete(row.current,0n,[] as string[],{continueCall(stop,data){if(stop.call.port==='event')return{reply:null,data:[...data,stop.call.input]};}},true);
      assert.equal(nested.outcomes.length,1);
      for(const child of nested.outcomes){owned.add(child.current);
        const stop=child.current.inspect();if(stop.kind!=='call'||stop.call.port!=='nested')throw Error('Expected original nested IO');
        const state=child.current.machine.root.state;assert.equal(child.current.machine.root.frames.at(-1)!.locals.alias,state.record);
        const completed=complete(child.current,5,child.data,{},true);assert.equal(completed.outcomes.length,1);
        for(const last of completed.outcomes){owned.add(last.current);result.push({mass:multiplyMass(row.mass,multiplyMass(child.mass,last.mass)),events:last.data,value:last.current.inspect()});}
      }
    }
    assert.deepEqual(result,[{mass:probabilityMass(1n,4n),events:['increment'],value:{kind:'done',result:{selected:0,count:9,updates:1}}},
      {mass:probabilityMass(3n,4n),events:['multiply','second-event'],value:{kind:'done',result:{selected:1,count:13,updates:1}}}]);
    assert.deepEqual(f.counts(),{initialized:1,prefixCalls:1});assert.deepEqual(f.root.machine.storage.export(f.root.machine.root),before);
  }finally{CardProgram.prototype.initial=initial;for(const current of owned)current.close();}
});

test('per-branch observation memory preserves map aliases and isolates retained callback references across cold restore',()=>{
  const f=jointCurrentFixture(),identities=new Map<string,number>([['initial',0]]),memory={identities,alias:identities,seen:[] as string[]};
  const held:typeof memory[]=[];
  const result=complete(f.root,null,memory,{continueCall(stop,data){
    if(stop.call.port!=='event')return;
    assert.equal(data.alias,data.identities);data.identities.set(stop.call.input,data.identities.size);data.seen.push(stop.call.input);held.push(data);
    return{reply:null,data};
  }},true);
  try{
    for(const value of held){value.identities.clear();value.seen.push('invalid later edit');}
    assert.deepEqual(memory.seen,[]);assert.deepEqual([...memory.identities],[['initial',0]]);
    const rows=result.outcomes.sort((a,b)=>a.current.machine.root.state.selected-b.current.machine.root.state.selected);
    assert.deepEqual(rows.map(row=>row.data.seen),[['increment'],['multiply','second-event']]);
    assert.notEqual(rows[0]!.data.identities,rows[1]!.data.identities);
    for(const row of rows){assert.equal(row.data.alias,row.data.identities);assert.deepEqual([...row.data.identities.keys()],['initial',...row.data.seen]);}
    assert.deepEqual(f.counts(),{initialized:1,prefixCalls:1});
  }finally{for(const row of result.outcomes)row.current.close();f.root.close();}
});

test('a failing event callback leaves the original IO and detached memory pending for direct continuation',()=>{
  const f=jointCurrentFixture(),initial=CardProgram.prototype.initial;let fail=true;
  const options={continueCall(stop:Extract<ReturnType<typeof f.root.inspect>,{kind:'call'}>,data:string[]){
    if(stop.call.port!=='event')return;data.push(stop.call.input);if(fail)throw Error('observer interrupted');return{reply:null,data};
  }};
  let expansion=ProbabilityExpansion.from(f.root,null,[] as string[],options);
  try{
    CardProgram.prototype.initial=function(){throw Error('Event resumption cannot rebuild a Context');};
    assert.throws(()=>{while(!expansion.complete)expansion.step();},/observer interrupted/);
    const saved=deserialize(serialize(expansion.save()));assert.ok(saved.pending.some((row:any)=>row.context.stop.kind==='call'&&row.context.stop.call.port==='event'));
    assert.ok(saved.pending.every((row:any)=>row.data.length===0),'failed callback edits never enter retained memory');
    expansion.close();expansion=ProbabilityExpansion.restore(f.root.machine.program,saved,options);fail=false;
    while(!expansion.complete)expansion.step();const events:string[][]=[];
    for(let row=expansion.take();row;row=expansion.take()){events.push(row.data);row.current.close();}
    assert.deepEqual(events.sort(),[['increment'],['multiply','second-event']]);assert.deepEqual(f.counts(),{initialized:1,prefixCalls:1});
  }finally{CardProgram.prototype.initial=initial;expansion.close();f.root.close();}
});

test('unit-mass steps execute once without redundant forks',()=>{
  type State={left:{n:number};right:{n:number}};let initialized=0,operations=0,forks=0;
  const unit=()=>undefined,weighted=()=>undefined,marker=()=>undefined;
  const change=(s:import('@bear-forge/card-engine').CardScope<State>,c:bigint)=>{s.state.left.n+=Number(c)+1;operations++;return undefined;};
  probabilityOperation<State>(unit,{space:()=>({kind:'uniform',size:1n}),resolve:change});
  probabilityOperation<State>(weighted,{space:()=>({kind:'weighted',weights:[0,0,1,0]}),resolve:change});
  probabilityOperation<State>(marker,{space:()=>({kind:'boundary',name:'unit-marker'}),resolve:change,publication:()=>({visible:'unit'})});
  const program=new CardProgram<State,void,{begin:{input:null;output:null}},number>({id:'unit-mass-current',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>{initialized++;const shared={n:0};return{left:shared,right:shared};},entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),...Array.from({length:12},()=>[card.operation(unit),card.operation(weighted),card.operation(marker)]).flat(),card.return(s=>s.state.right.n)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  function track(node:typeof current){const fork=node.fork.bind(node);node.fork=()=>{forks++;return track(fork());};return node;}track(current);
  try{
    const result=complete(current,null,null);
    try{assert.equal(result.outcomes.length,1);assert.deepEqual(result.outcomes[0]!.mass,unitMass());assert.deepEqual(result.outcomes[0]!.current.inspect(),{kind:'done',result:60});assert.equal(result.outcomes[0]!.current.machine.root.state.left,result.outcomes[0]!.current.machine.root.state.right);assert.equal(initialized,1);assert.equal(operations,36);assert.equal(forks,1);assert.deepEqual(machine.storage.export(machine.root),before);}
    finally{for(const row of result.outcomes)row.current.close();}
  }finally{current.close();}
});


for(const mode of ['equal','hidden','alias','publication','anchor'] as const)test(`complete original successor Contexts retain ${mode} distinctions`,()=>{
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
    const result=complete(current,null,{identities:new Map([[1,0]])},{continueCall:(_stop,data)=>({reply:null,data})});
    try{
      // No unproved equivalence merges states. Even equal visible values keep
      // distinct underlying aliases, anchors and private state until proved.
      assert.equal(result.outcomes.length,3);assert.equal(suffix,3);assert.equal(chosen,3);assert.equal(initialized,1);
      assert.ok(result.outcomes.every(row=>row.mass.numerator===1n&&row.mass.denominator===3n));
      if(mode==='equal')for(const row of result.outcomes)assert.equal(row.current.machine.root.state.left,row.current.machine.root.state.right);
      if(mode==='alias')assert.deepEqual(result.outcomes.map(row=>row.current.machine.root.state.left===row.current.machine.root.state.right).sort(),[false,false,true]);
      if(mode==='anchor')assert.deepEqual(result.outcomes.map(row=>row.current.inspect()).sort((a,b)=>(a as {result:number}).result-(b as {result:number}).result),[0,0,1].map(result=>({kind:'done',result})));
      if(mode==='hidden')assert.deepEqual(result.outcomes.map(row=>row.current.inspect()).sort((a,b)=>(a as {result:number}).result-(b as {result:number}).result),[0,1,2].map(result=>({kind:'done',result})));
      assert.deepEqual(machine.storage.export(machine.root),before);
    }finally{for(const row of result.outcomes)row.current.close();}
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
