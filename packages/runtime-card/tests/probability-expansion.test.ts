import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {z} from 'zod';
import {card,CardMachine,CardProgram} from '@bear-forge/card-engine';
import {probabilityOperation} from '../../card-engine/src/probability.ts';
import {addMass,probabilityMass,unitMass,probabilityCursor,nextProbabilityCoordinate} from '../../card-engine/src/probability-cursor.ts';
import {CardGraph,privateCardGraph} from '../src/graph.ts';
import {ProbabilityCurrent,ProbabilityBudgetStopped,restoreProbabilityCurrent} from '../src/probability.ts';
import {ProbabilityExpansion} from '../src/probability-expansion.ts';
import {ExactProbabilityUnavailable} from '../../card-engine/src/probability-cursor.ts';
import {ownRuleValue} from '../../card-engine/src/rules-values.ts';

test('an unavailable exact law retains its original pending operation and all mass across cold restore',()=>{
  let prefixes=0,resolutions=0;
  const draw=()=>7;
  probabilityOperation(draw,{space:()=>({kind:'unavailable',reason:'Missing exact fixture law'}),resolve:()=>{resolutions++;throw Error('No finite substitute is permitted');}});
  const program=new CardProgram<{},void,{input:{input:null;output:null}},number>({id:'unsupported-exact-law',
    schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),card.operation(()=>{prefixes++;}),card.operation(draw,'value'),card.return(scope=>scope.locals.value),
    ]}],
  });
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),before=machine.storage.export(machine.root);
  let expansion=ProbabilityExpansion.from(current,null,null);
  const initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('An unresolved law cannot initialize again');};
    expansion.step();assert.throws(()=>expansion.step(),ExactProbabilityUnavailable);
    const saved=deserialize(serialize(expansion.save()));assert.equal(saved.pending[0].phase,'inspect');assert.equal(saved.pending[0].context.stop.space.kind,'unavailable');
    assert.deepEqual(expansion.masses(),{pending:unitMass(),ready:probabilityMass(0n),transferred:probabilityMass(0n)});
    expansion.close();expansion=ProbabilityExpansion.restore(program,saved);
    assert.throws(()=>expansion.step(),ExactProbabilityUnavailable);assert.deepEqual(expansion.save(),saved);
    assert.equal(prefixes,1);assert.equal(resolutions,0);assert.equal(expansion.complete,false);assert.equal(expansion.take(),undefined);
    assert.deepEqual(machine.storage.export(machine.root),before);
  }finally{CardProgram.prototype.initial=initial;expansion.close();current.close();}
});

function fixture(size=2n){
  type State={prefix:number;middle:number};let initializations=0,prefix=0,middle=0;
  const a=()=>-1,b=()=>-1;
  probabilityOperation<State>(a,{space:()=>({kind:'uniform',size}),resolve:(_s,c)=>Number(c)});
  probabilityOperation<State>(b,{space:s=>({kind:'uniform',size:BigInt(s.locals.a+2)}),resolve:(_s,c)=>Number(c)});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},{a:number;b:number}>({id:'exact-expansion',
    schemas:{setup:z.undefined(),result:z.object({a:z.number(),b:z.number()}),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initializations++;return{prefix:0,middle:0};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),card.operation<State>(s=>{s.state.prefix++;prefix++;}),card.operation(a,'a'),
      card.operation<State>(s=>{s.state.middle++;middle++;}),card.operation(b,'b'),card.return(s=>({a:s.locals.a,b:s.locals.b})),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  return{program,current:new ProbabilityCurrent(machine),counts:()=>({initializations,prefix,middle})};
}

for(const cold of [false,true])test(`a lone chance current skips indexing until it actually has a possible merge partner; cold=${cold}`,()=>{
  const f=fixture(1n),key=ProbabilityCurrent.prototype.candidateKey;let indexed=0;
  let expansion=ProbabilityExpansion.from(f.current,null,null);
  ProbabilityCurrent.prototype.candidateKey=function(){indexed++;return key.call(this);};
  try{
    for(let i=0;i<5;i++){
      expansion.step();
      if(cold&&i===1){const saved=deserialize(serialize(expansion.savePacked())),before=f.counts();
        expansion.close();expansion=ProbabilityExpansion.restore(f.program,saved);assert.deepEqual(f.counts(),before);}
    }
    assert.equal(indexed,0,'the singleton operation and lone two-way cursor need no Context index');
    const outcomes:{a:number;b:number;mass:ReturnType<typeof probabilityMass>}[]=[];
    while(!expansion.complete){
      expansion.step();
      const masses=expansion.masses();assert.deepEqual(addMass(addMass(masses.pending,masses.ready),masses.transferred),unitMass());
      for(let row=expansion.take();row;row=expansion.take()){
        try{const stop=row.current.inspectExact();assert.equal(stop.kind,'done');if(stop.kind==='done')outcomes.push({...stop.result,mass:row.mass});}
        finally{row.current.close();}
      }
    }
    assert.ok(indexed>0,'branching builds the ordinary full-equality candidate index');
    assert.deepEqual(outcomes.sort((a,b)=>a.b-b.b),[0,1].map(b=>({a:0,b,mass:probabilityMass(1n,2n)})));
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:1});
    assert.deepEqual(expansion.delivered,unitMass());
  }finally{ProbabilityCurrent.prototype.candidateKey=key;expansion.close();f.current.close();}
});
for(const cold of [false,true])test(`frontier reads preserve pending and ready mass without consuming or executing originals; cold=${cold}`,()=>{
 const f=fixture();let expansion=ProbabilityExpansion.from(f.current,null,{tag:'public'}),sawReady=false;
 try{
  while(!expansion.complete){
   expansion.step();
   if(cold){const saved=deserialize(serialize(expansion.savePacked())),before=f.counts();expansion.close();
    expansion=ProbabilityExpansion.restore(f.program,saved);assert.deepEqual(f.counts(),before);}
   const before=f.counts(),masses=expansion.masses(),frontier=expansion.readFrontier((current,data)=>({kind:current.inspectExact().kind,tag:data.tag}));
   assert.deepEqual(f.counts(),before);assert.deepEqual(expansion.masses(),masses);
   assert.deepEqual(frontier.reduce((sum,row)=>addMass(sum,row.mass),probabilityMass(0n)),addMass(masses.pending,masses.ready));
   assert.ok(frontier.every(row=>row.value.tag==='public'));sawReady||=masses.ready.numerator>0n;
   for(const row of frontier)row.mass.numerator=0n;
   assert.deepEqual(expansion.masses(),masses,'returned coefficients do not alias the original law');
   for(let row=expansion.take();row;row=expansion.take())row.current.close();
  }
  assert.ok(sawReady);assert.deepEqual(expansion.delivered,unitMass());
  assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
 }finally{expansion.close();f.current.close();}
});
test('packed restoration preserves the complete current without executing pending work',()=>{
  const f=fixture(),saved=f.current.packedSnapshot(),before=f.counts();
  const first=restoreProbabilityCurrent(f.program,saved),second=restoreProbabilityCurrent(f.program,saved);
  try{assert.deepEqual(f.counts(),before);assert.equal(first.sameCurrent(second),true);}
  finally{first.close();second.close();f.current.close();}
});

test('a cold-restored probability current exports its saved image without repeating decoding or original work',()=>{
  const f=fixture(),saved=deserialize(serialize(f.current.packedSnapshot())),before=f.counts();
  const restored=restoreProbabilityCurrent(f.program,saved),zlib=createRequire(import.meta.url)('node:zlib') as typeof import('node:zlib'),inflate=zlib.inflateRawSync;
  try{
    zlib.inflateRawSync=()=>{throw Error('Export must reuse the stored encoding');};syncBuiltinESMExports();
    assert.deepEqual(restored.packedSnapshot(),saved);assert.deepEqual(f.counts(),before);
    zlib.inflateRawSync=inflate;syncBuiltinESMExports();
  }finally{zlib.inflateRawSync=inflate;syncBuiltinESMExports();restored.close();f.current.close();}
});

test('passive parked publication preserves the full current while ordinary inspection activates its identities',()=>{
  const f=fixture();let current=f.current;
  const check=()=>{
    const expected=current.inspectExact(),before=f.counts(),saved=deserialize(serialize(current.packedSnapshot()));
    current.close();current=restoreProbabilityCurrent(f.program,saved);
    const graph=current.machine.storage as CardGraph<unknown>;
    Object.defineProperty(graph,'root',{configurable:true,get(){throw Error('Inspection must not activate the complete execution graph');}});
    try{
      if(expected.kind!=='yield')assert.deepEqual(current.inspectPublication(),expected);
      assert.equal(graph.isParked,true);assert.deepEqual(current.packedSnapshot(),saved);assert.deepEqual(f.counts(),before);
    }finally{delete (graph as {root?:unknown}).root;}
    assert.deepEqual(current.inspectExact(),expected);assert.equal(graph.isParked,false);assert.deepEqual(f.counts(),before);
    return expected.kind;
  };
  try{
    assert.equal(check(),'call');current.advanceExact(null);assert.equal(check(),'chance');
    current.advanceExact(0n,undefined,1);assert.equal(check(),'yield');current.advanceExact();assert.equal(check(),'chance');
    current.advanceExact(1n);assert.equal(check(),'done');
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:1});
  }finally{current.close();f.current.close();}
});

test('parked inspection retains the original custom projection and its boundary validation',()=>{
  let projections=0,invalid=false;
  const program=new CardProgram<{},void,{input:{input:number;output:number}},number>({id:'parked-custom-projection',schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.number(),output:z.number()}}},
    initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'input',input:3}),'answer'),card.return(s=>s.locals.answer)]}],
    project(stop){projections++;if(invalid)return{kind:'done',result:9};return stop.kind==='call'?{...stop,call:{...stop.call,input:stop.call.input*2}}:stop;}});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine);
  try{
    current.park();const before=projections;assert.deepEqual(current.inspectPublication(),{kind:'call',call:{port:'input',input:6}});assert.equal(projections,before+1);
    current.park();invalid=true;assert.throws(()=>current.inspectPublication(),/Projection changed execution boundary/);
  }finally{current.close();}
});

test('passive publication copies cannot replace ordinary Context-owned reply identities',()=>{
  type Box={n:number};type S={box:Box};type P={input:{input:Box;output:Box}};
  const box=z.custom<Box>(value=>typeof value==='object'&&value!==null&&'n' in value);
  const program=new CardProgram<S,void,P,boolean>({id:'passive-publication-identity',schemas:{setup:z.undefined(),result:z.boolean(),ports:{input:{input:box,output:box}}},
    initialize:()=>({box:ownRuleValue({n:7})}),entry:'root',effects:[{id:'root',steps:[
      card.request<S>(s=>({port:'input',input:s.state.box}),'answer'),card.return<S>(s=>s.locals.answer===s.state.box),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const current=new ProbabilityCurrent(machine);
  try{
    current.park();const projected=current.inspectPublication();assert.equal((machine.storage as CardGraph<unknown>).isParked,true);
    const original=current.inspect();assert.equal(projected.kind,'call');assert.equal(original.kind,'call');
    if(projected.kind!=='call'||original.kind!=='call')throw Error('Expected original request');
    assert.deepEqual(projected,original);assert.notEqual(projected.call.input,original.call.input);
    assert.equal(original.call.input,machine.root.state.box);
    assert.deepEqual(current.advanceExact(original.call.input),{kind:'done',result:true});
  }finally{current.close();}
});

test('heap pressure stops restoration before decoding and leaves the original frontier available',()=>{
  const f=fixture(),v8=createRequire(import.meta.url)('node:v8') as typeof import('node:v8'),statistics=v8.getHeapStatistics;
  let expansion=ProbabilityExpansion.from(f.current,null,null),reads=0;
  try{
    expansion.step();const saved=expansion.savePacked(),bytes=serialize(saved),packed=saved.pending[0]!.packed;
    expansion.close();Object.defineProperty(saved.pending[0],'packed',{enumerable:true,get(){reads++;return packed;}});
    v8.getHeapStatistics=()=>({...statistics(),total_available_size:1});syncBuiltinESMExports();
    assert.throws(()=>ProbabilityExpansion.restore(f.program,saved),ProbabilityBudgetStopped);
    assert.equal(reads,0);assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:0});
    v8.getHeapStatistics=statistics;syncBuiltinESMExports();
    assert.deepEqual(serialize(saved),bytes);
    expansion=ProbabilityExpansion.restore(f.program,saved);
    while(!expansion.complete)expansion.step();
    for(let row=expansion.take();row;row=expansion.take())row.current.close();
    assert.deepEqual(expansion.masses().transferred,unitMass());
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
  }finally{v8.getHeapStatistics=statistics;syncBuiltinESMExports();expansion.close();f.current.close();}
});

test('direct packed expansion export retains every phase, ready outcome and cached edge across cold continuation',()=>{
  const f=fixture();let expansion=ProbabilityExpansion.from(f.current,null,{history:['retained']}),steps=0,sawReady=false,sawCache=false;
  const phases=new Set<string>(),totals=new Map<string,ReturnType<typeof probabilityMass>>(),initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=()=>{throw Error('Packed restore cannot initialize');};
    while(!expansion.complete){
      assert.equal(expansion.step(),true);assert.ok(++steps<100);
      const before=f.counts(),mass=expansion.masses(),stored=deserialize(serialize(expansion.savePacked())) as ReturnType<typeof expansion.savePacked>;
      assert.deepEqual(f.counts(),before);stored.pending.forEach(row=>phases.add(row.phase));sawReady ||= stored.ready.length>0;sawCache ||= !!stored.transitions?.entries.length;
      // Restore keeps encoded currents parked without exporting whole graphs.
      expansion.close();const snapshot=CardGraph.prototype.snapshot;
      CardGraph.prototype.snapshot=function(){throw Error('packed restoration must retain its existing encoding');};
      try{expansion=ProbabilityExpansion.restore(f.program,stored);}
      finally{CardGraph.prototype.snapshot=snapshot;}
      assert.deepEqual(expansion.masses(),mass);assert.deepEqual(expansion.delivered,mass.transferred);assert.deepEqual(f.counts(),before);
      for(let row=expansion.take();row;row=expansion.take())try{
        const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind==='done'){
          const key=JSON.stringify(stop.result);totals.set(key,addMass(totals.get(key)??probabilityMass(0n),row.mass));
          assert.deepEqual(row.mass,probabilityMass(1n,stop.result.a===0?4n:6n));
        }
        assert.deepEqual(row.data,{history:['retained']});
      }finally{row.current.close();}
    }
    assert.equal(totals.size,5);assert.deepEqual(expansion.masses().transferred,unitMass());assert.deepEqual(expansion.delivered,unitMass());
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
    assert.ok(sawReady&&sawCache);assert.deepEqual([...phases].sort(),['advance','chance','inspect']);
  }finally{CardProgram.prototype.initial=initial;expansion.close();f.current.close();}
});

for(const weighted of [false,true])for(const [partial,indexFailure] of [[false,false],[false,true],[true,false]])test(`equal remaining currents share original future execution with exact accumulated mass; partial=${partial}, indexFailure=${indexFailure}, weighted=${weighted}`,()=>{
  type P={input:{input:null;output:null}};
  let initializations=0,prefix=0,firstDraws=0,secondDraws=0;
  const first=()=>0,second=()=>0;
  probabilityOperation(first,{space:()=>({kind:'uniform',size:2n}),resolve:()=>{firstDraws++;return undefined;}});
  probabilityOperation(second,{space:()=>weighted?{kind:'rational',weights:Array.from({length:3},()=>probabilityMass(1n,3n))}:{kind:'uniform',size:3n},resolve:(_s,c)=>{secondDraws++;return Number(c);}});
  const program=new CardProgram<{},void,P,number>({id:'coalesced-original-current',schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initializations++;return{};},entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'input',input:null})),card.operation(()=>{prefix++;}),card.operation(first),card.operation(second,'value'),card.return(s=>s.locals.value)]}]});
  const parent=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(program.initial(undefined))));parent.machine.advance();parent.advanceExact(null);
  const children=[parent.fork(),parent.fork()];let expansion:ProbabilityExpansion<{},void,P,number,unknown>|undefined;
  const initialize=CardProgram.prototype.initial;
  try{
    children.forEach((child,i)=>child.advanceExact(BigInt(i)));
    assert.equal(children[0]!.sameCurrent(children[1]!),true,'distinct original coordinates have reached the same full current');
    const rows=children.map((child,i)=>{
      const stop=child.inspectExact();assert.equal(stop.kind,'chance');if(stop.kind!=='chance')throw Error('Expected chance');
      let cursor=probabilityCursor(stop.space);
      if(partial){const choice=nextProbabilityCoordinate(cursor)!;cursor=choice.cursor;const delivered=child.fork();try{delivered.advanceExact(choice.coordinate);assert.equal(delivered.inspectExact().kind,'done');}finally{delivered.close();}}
      if(!partial&&i===0)cursor.offset=1n;
      const row={...child.snapshot(),mass:probabilityMass(1n,2n),data:{history:['same public fact']},service:0n,stride:1n};
      return !partial&&i===1?{...row,phase:'inspect' as const}:{...row,phase:'chance' as const,cursor};
    });
    const saved={version:1 as const,stopAtBoundary:null,schedule:{ticks:0n,localRemaining:31n,chanceOrder:0n,preferred:1},transferred:partial?probabilityMass(1n,3n):probabilityMass(0n),pending:rows,ready:[]};
    CardProgram.prototype.initial=()=>{throw Error('No initialization during merge/restore');};
    expansion=ProbabilityExpansion.restore(program,deserialize(serialize(saved)));
    if(!partial){
      // The retained cursor has cold-cloned weight arrays. The inspect node
      // below will create fresh packed arrays from the original rational law.
      // Different host encodings must not prevent their full equality check.
      assert.equal(expansion.save().pending.length,2);
      if(indexFailure){
        const key=ProbabilityCurrent.prototype.candidateKey;ProbabilityCurrent.prototype.candidateKey=()=>{throw Error('fixture-index-allocation');};
        try{assert.throws(()=>expansion!.step(),/fixture-index-allocation/);}finally{ProbabilityCurrent.prototype.candidateKey=key;}
        const committed=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,committed);
      }else expansion.step();
    }
    assert.equal(expansion.save().pending.length,1);assert.deepEqual(expansion.save().pending[0]!.mass,unitMass());
    const leaves:{value:unknown;mass:ReturnType<typeof probabilityMass>}[]=[];
    while(!expansion.complete){
      expansion.step();const masses=expansion.masses();assert.deepEqual(addMass(addMass(masses.pending,masses.ready),masses.transferred),unitMass());
      assert.deepEqual(expansion.readFrontier(()=>null).reduce((total,row)=>addMass(total,row.mass),probabilityMass(0n)),addMass(masses.pending,masses.ready));
      for(;;){const row=expansion.take();if(!row)break;try{const stop=row.current.inspectExact();assert.equal(stop.kind,'done');if(stop.kind==='done')leaves.push({value:stop.result,mass:row.mass});}finally{row.current.close();}}
      const current=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,current);
    }
    leaves.sort((a,b)=>Number(a.value)-Number(b.value));
    assert.deepEqual(leaves,[...(partial?[]:[0]),1,2].map(value=>({value,mass:probabilityMass(1n,3n)})));
    assert.equal(secondDraws,partial?4:3,'the shared remaining law executes once; already delivered prefixes are not replayed');
    assert.equal(firstDraws,2);assert.equal(prefix,1);assert.equal(initializations,1);assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{CardProgram.prototype.initial=initialize;expansion?.close();children.forEach(child=>child.close());parent.close();}
});

test('chance coalescing rejects different hidden current data and different metadata aliases even with candidate collisions',()=>{
  const f=fixture(),parent=f.current;parent.advanceExact(null);
  const baseline=parent.snapshot(),cursor=probabilityCursor({kind:'uniform',size:2n});
  const key=ProbabilityCurrent.prototype.candidateKey;ProbabilityCurrent.prototype.candidateKey=()=> 'forced-collision';
  try{for(const difference of ['hidden','aliases']){
    const shared={n:1},left={a:shared,b:shared},right=difference==='aliases'?{a:{n:1},b:{n:1}}:left;
    const saved={version:1 as const,stopAtBoundary:null,schedule:{ticks:0n,localRemaining:31n,chanceOrder:0n,preferred:0},transferred:probabilityMass(0n),pending:[left,right].map(data=>({...structuredClone(baseline),phase:'chance' as const,cursor:structuredClone(cursor),mass:probabilityMass(1n,2n),data,service:0n,stride:1n})),ready:[]};
    if(difference==='hidden')saved.pending[1]!.context.state.prefix++;
    const expansion=ProbabilityExpansion.restore(f.program,saved);try{assert.equal(expansion.save().pending.length,2);assert.deepEqual(expansion.masses().pending,unitMass());}finally{expansion.close();}
  }}finally{ProbabilityCurrent.prototype.candidateKey=key;parent.close();}
});

for(const weighted of [false,true])test(`overlapping cursor suffixes retain every coordinate weight and execute their intersection once; weighted=${weighted}`,()=>{
  type P={input:{input:null;output:null}};let prefix=0,firstDraws=0,secondDraws=0;
  const first=()=>0,second=()=>0,weights=weighted?[1,0,2,3,1,4]:[1,1,1,1,1,1],total=weights.reduce((a,b)=>a+b,0);
  probabilityOperation(first,{space:()=>({kind:'uniform',size:2n}),resolve:()=>{firstDraws++;return undefined;}});
  probabilityOperation(second,{space:()=>weighted?{kind:'rational',weights:weights.map(weight=>probabilityMass(BigInt(weight),BigInt(total)))}:{kind:'uniform',size:6n},resolve:(_s,c)=>{secondDraws++;return Number(c);}});
  const program=new CardProgram<{},void,P,number>({id:'overlapping-original-currents',schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'input',input:null})),card.operation(()=>{prefix++;}),card.operation(first),card.operation(second,'value'),card.return(s=>s.locals.value)]}]});
  const parent=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(program.initial(undefined))));parent.machine.advance();parent.advanceExact(null);
  const children=[parent.fork(),parent.fork()],totals=weights.map(()=>probabilityMass(0n));let transferred=probabilityMass(0n),expansion:ProbabilityExpansion<{},void,P,number,unknown>|undefined;
  const initialize=CardProgram.prototype.initial,fork=ProbabilityCurrent.prototype.fork;
  try{
    const pending=children.map((child,index)=>{
      child.advanceExact(BigInt(index));const stop=child.inspectExact();if(stop.kind!=='chance')throw Error('Expected second original draw');
      let cursor=probabilityCursor(stop.space);if(index===1)cursor.offset=3n;
      for(let i=0;i<2;i++){
        const choice=nextProbabilityCoordinate(cursor)!;cursor=choice.cursor;const old=child.fork();
        try{old.advanceExact(choice.coordinate);const result=old.inspectExact();if(result.kind!=='done')throw Error('Expected original result');const mass=probabilityMass(choice.probability.numerator,choice.probability.denominator*2n);transferred=addMass(transferred,mass);totals[result.result]=addMass(totals[result.result]!,mass);}finally{old.close();}
      }
      return{...child.snapshot(),phase:'chance' as const,cursor,mass:probabilityMass(1n,2n),data:{history:[]},service:0n,stride:1n};
    });
    const saved={version:1 as const,stopAtBoundary:null,schedule:{ticks:0n,localRemaining:31n,chanceOrder:0n,preferred:1},transferred,pending,ready:[]};
    CardProgram.prototype.initial=()=>{throw Error('No replay of original prefix');};
    ProbabilityCurrent.prototype.fork=()=>{throw Error('Coalescing must share one existing Context');};
    try{expansion=ProbabilityExpansion.restore(program,deserialize(serialize(saved)));}finally{ProbabilityCurrent.prototype.fork=fork;}
    assert.equal(secondDraws,4);
    const compact=expansion.save();assert.equal(compact.pending.length,1);
    assert.equal(compact.pending[0]!.phase,'chance');
    if(compact.pending[0]!.phase!=='chance')throw Error('Expected compact chance');
    assert.ok(compact.pending[0]!.remainder?.length);
    while(!expansion.complete){
      expansion.step();const mass:ReturnType<ProbabilityExpansion<{},void,P,number,unknown>['masses']>=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
      for(;;){const row=expansion.take();if(!row)break;try{const stop=row.current.inspectExact();if(stop.kind!=='done')throw Error('Expected original result');const value=Number(stop.result);totals[value]=addMass(totals[value]!,row.mass);}finally{row.current.close();}}
      const current=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,current);
    }
    assert.deepEqual(totals,weights.map(weight=>probabilityMass(BigInt(weight),BigInt(total))));
    assert.equal(secondDraws,weighted?9:10);assert.equal(firstDraws,2);assert.equal(prefix,1);assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{ProbabilityCurrent.prototype.fork=fork;CardProgram.prototype.initial=initialize;expansion?.close();children.forEach(child=>child.close());parent.close();}
});

for(const distinct of [false,true])test(`completed next edges survive cold restore, preserve mass and compare full currents; distinct=${distinct}`,()=>{
  type S={hidden:number};type P={begin:{input:null;output:null}};let prefix=0,first=0,second=0;
  const a=()=>0,b=()=>0;
  probabilityOperation<S>(a,{space:()=>({kind:'uniform',size:20n}),resolve:(scope,c)=>{first++;if(distinct)scope.state.hidden=Number(c);}});
  probabilityOperation<S>(b,{space:()=>({kind:'uniform',size:2n}),resolve:(scope,c)=>{second++;return Number(c)+100*scope.state.hidden;}});
  const program=new CardProgram<S,void,P,number>({id:'completed-original-next',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({hidden:0}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(()=>{prefix++;}),card.operation(a),card.operation(b,'value'),card.return(scope=>scope.locals.value)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const root=new ProbabilityCurrent(machine);
  let expansion=ProbabilityExpansion.from(root,null,{history:['caller']}),saved:ReturnType<typeof expansion.save>|undefined;
  const totals=new Map<number,ReturnType<typeof probabilityMass>>(),initial=CardProgram.prototype.initial,key=ProbabilityCurrent.prototype.candidateKey;
  try{
    CardProgram.prototype.initial=()=>{throw Error('No initialization during retained successor reuse');};
    ProbabilityCurrent.prototype.candidateKey=()=> 'forced-transition-collision';
    while(!expansion.complete){
      expansion.step();const mass=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
      for(let row=expansion.take();row;row=expansion.take())try{const stop=row.current.inspectExact();assert.equal(stop.kind,'done');if(stop.kind==='done')totals.set(stop.result,addMass(totals.get(stop.result)??probabilityMass(0n),row.mass));assert.deepEqual(row.data,{history:['caller']});}finally{row.current.close();}
      saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,saved!);
    }
    assert.equal(prefix,1);assert.equal(first,20);assert.equal(second,distinct?40:2);
    assert.equal(totals.size,distinct?40:2);for(const mass of totals.values())assert.deepEqual(mass,probabilityMass(1n,distinct?40n:2n));
    assert.equal(expansion.transitionStats().hits>0n,!distinct);
    assert.ok(saved!.transitions?.entries.length);
  }finally{CardProgram.prototype.initial=initial;ProbabilityCurrent.prototype.candidateKey=key;expansion.close();root.close();}
});

test('transition source caching avoids redecoding before execution while pending successors stay parked',()=>{
  const f=fixture();let expansion=ProbabilityExpansion.from(f.current,null,null);
  const zlib=createRequire(import.meta.url)('node:zlib') as typeof import('node:zlib'),inflate=zlib.inflateRawSync;
  const advance=ProbabilityCurrent.prototype.advanceExact;let inflations=0,executing:typeof f.current|undefined;
  try{
    // Original input, chance admission, then one unconsumed coordinate. The
    // last step forks an active child; do not park it by saving before use.
    expansion.step();expansion.step();expansion.step();
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:0});
    zlib.inflateRawSync=(...args:Parameters<typeof inflate>)=>{inflations++;return inflate(...args);};syncBuiltinESMExports();
    ProbabilityCurrent.prototype.advanceExact=function(...args){executing=this;return advance.apply(this,args);};
    try{expansion.step();}finally{zlib.inflateRawSync=inflate;syncBuiltinESMExports();ProbabilityCurrent.prototype.advanceExact=advance;}
    assert.equal(inflations,0,'retaining source and successor must not release and then decode the active owner');
    assert.ok(executing);assert.equal((executing.machine.storage as CardGraph<unknown>).isParked,true,'suspended successors must not retain a live COW graph in every expansion');
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:1});
    const saved=deserialize(serialize(expansion.savePacked()));
    assert.equal(saved.transitions.entries.length,1);assert.equal(saved.transitions.currents.length,2);
    expansion.close();expansion=ProbabilityExpansion.restore(f.program,saved);
    let outcomes=0;
    while(!expansion.complete){expansion.step();for(let row=expansion.take();row;row=expansion.take()){outcomes++;row.current.close();}}
    assert.equal(outcomes,5);assert.deepEqual(expansion.masses().transferred,unitMass());
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
  }finally{zlib.inflateRawSync=inflate;syncBuiltinESMExports();ProbabilityCurrent.prototype.advanceExact=advance;expansion.close();f.current.close();}
});

test('failed transition-witness admission releases its private fork and leaves the original coordinate unconsumed',()=>{
  const f=fixture(),expansion=ProbabilityExpansion.from(f.current,null,null);
  const fork=ProbabilityCurrent.prototype.fork,key=ProbabilityCurrent.prototype.candidateKey;let witness:typeof f.current|undefined;
  try{
    expansion.step();expansion.step();expansion.step();
    ProbabilityCurrent.prototype.fork=function(){witness=fork.call(this);return witness;};
    ProbabilityCurrent.prototype.candidateKey=()=>{throw Error('fixture-witness-key');};
    try{assert.throws(()=>expansion.step(),/fixture-witness-key/);}finally{ProbabilityCurrent.prototype.fork=fork;ProbabilityCurrent.prototype.candidateKey=key;}
    assert.ok(witness);assert.throws(()=>witness!.inspectExact(),/Closed card storage/);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:0});
    assert.deepEqual(expansion.masses().pending,unitMass());
    while(!expansion.complete){expansion.step();for(let row=expansion.take();row;row=expansion.take())row.current.close();}
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
    assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{ProbabilityCurrent.prototype.fork=fork;ProbabilityCurrent.prototype.candidateKey=key;expansion.close();f.current.close();}
});

test('a successor-cache allocation failure retains the already advanced current and never repeats its operation',()=>{
  let prefix=0,resolved=0;const draw=()=>0;
  probabilityOperation(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>{resolved++;return Number(c);}});
  const program=new CardProgram({id:'failed-successor-cache',schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()}}},initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(()=>{prefix++;}),card.operation(draw,'x'),card.return(s=>s.locals.x)]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();const root=new ProbabilityCurrent(machine);
  let expansion=ProbabilityExpansion.from(root,null,null),failed=false;const fork=ProbabilityCurrent.prototype.fork,initial=CardProgram.prototype.initial;
  try{
    ProbabilityCurrent.prototype.fork=function(){if(this.inspectExact().kind==='done')throw Error('fixture-successor-allocation');return fork.call(this);};
    for(let i=0;i<12&&!failed;i++)try{expansion.step();}catch(error){assert.match(String(error),/fixture-successor-allocation/);failed=true;}
    assert.equal(failed,true);assert.equal(resolved,1);assert.equal(prefix,1);
    const saved=deserialize(serialize(expansion.save()));assert.ok(saved.pending.some((row:any)=>row.phase==='inspect'&&row.context.stop.kind==='done'));
    ProbabilityCurrent.prototype.fork=fork;CardProgram.prototype.initial=()=>{throw Error('Cannot initialize');};
    expansion.close();expansion=ProbabilityExpansion.restore(program,saved);
    while(!expansion.complete){expansion.step();for(let row=expansion.take();row;row=expansion.take())row.current.close();}
    assert.equal(resolved,2);assert.equal(prefix,1);assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{ProbabilityCurrent.prototype.fork=fork;CardProgram.prototype.initial=initial;expansion.close();root.close();}
});

test('restore at every scheduling boundary preserves conditional mass and executes each shared prefix once',()=>{
  const f=fixture(),parent=f.current.machine.storage.export(f.current.machine.root);
  let expansion=ProbabilityExpansion.from(f.current,null,{tag:'original'});
  const leaves:{a:number;b:number;mass:ReturnType<typeof probabilityMass>}[]=[];
  try{
    while(!expansion.complete){
      expansion.step();const mass=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
      for(;;){const outcome=expansion.take();if(!outcome)break;
        try{const stop=outcome.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected terminal');leaves.push({...stop.result,mass:outcome.mass});}
        finally{outcome.current.close();}
      }
      const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(f.program,saved);
    }
    leaves.sort((a,b)=>a.a-b.a||a.b-b.b);
    assert.deepEqual(leaves,[{a:0,b:0,mass:probabilityMass(1n,4n)},{a:0,b:1,mass:probabilityMass(1n,4n)},
      ...[0,1,2].map(b=>({a:1,b,mass:probabilityMass(1n,6n)}))]);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
    assert.deepEqual(expansion.masses(),{pending:probabilityMass(0n),ready:probabilityMass(0n),transferred:unitMass()});
    assert.deepEqual(f.current.machine.storage.export(f.current.machine.root),parent);
  }finally{expansion.close();f.current.close();}
});
test('a cooperative stop retains the cursor, generated children and all unexpanded support',()=>{
  const f=fixture(1n<<64n);let paused=false;
  const expansion=ProbabilityExpansion.from(f.current,null,null,{check(){if(paused)throw Error('pause');}});
  try{
    expansion.step();expansion.step();expansion.step();const before=expansion.save();
    paused=true;assert.throws(()=>expansion.step(),/pause/);assert.deepEqual(expansion.save(),before);
    assert.deepEqual(addMass(expansion.masses().pending,expansion.masses().ready),unitMass());
    const row=before.pending.find(row=>row.phase==='chance');assert.ok(row&&row.phase==='chance');
    assert.equal(row.cursor.next,1n);assert.deepEqual(row.cursor.remaining,probabilityMass((1n<<64n)-1n,1n<<64n));
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:0});
  }finally{expansion.close();f.current.close();}
});
test('streaming a wide finite law releases leaves while retaining the complete conditional frontier',()=>{
  const f=fixture(32n),expansion=ProbabilityExpansion.from(f.current,null,null);
  const seen=new Set<string>();let peak=0,mass=probabilityMass(0n);
  try{
    while(!expansion.complete){
      expansion.step();peak=Math.max(peak,expansion.save().pending.length);
      for(let row=expansion.take();row;row=expansion.take()){
        try{
          const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected complete outcome');
          const {a,b}=stop.result,key=`${a}:${b}`;assert.equal(seen.has(key),false);seen.add(key);
          assert.deepEqual(row.mass,probabilityMass(1n,32n*BigInt(a+2)));mass=addMass(mass,row.mass);
        }finally{row.current.close();}
      }
    }
    assert.equal(seen.size,560);assert.deepEqual(mass,unitMass());
    assert.ok(peak<128,`streaming retained ${peak} pending Contexts for 560 leaves`);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:32});
  }finally{expansion.close();f.current.close();}
});
test('huge chance cardinality does not postpone finite descendants until its cursor is exhausted',()=>{
  const size=1n<<64n,f=fixture(size);let expansion=ProbabilityExpansion.from(f.current,null,null),delivered=0;
  try{
    // Observe a finite prefix while preserving the entire 2^64-way law.
    for(let step=0;step<128&&delivered<2;step++){
      expansion.step();for(let row=expansion.take();row;row=expansion.take()){
        try{
          const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected descendant');
          assert.ok(stop.result.b>=0&&stop.result.b<stop.result.a+2);
          assert.deepEqual(row.mass,probabilityMass(1n,size*BigInt(stop.result.a+2)));delivered++;
        }finally{row.current.close();}
      }
      const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(f.program,saved);
    }
    assert.ok(delivered>=2);assert.equal(expansion.complete,false);
    const masses=expansion.masses();assert.deepEqual(addMass(addMass(masses.pending,masses.ready),masses.transferred),unitMass());
    assert.ok(expansion.save().pending.some(node=>node.phase==='chance'&&node.cursor.space.kind==='uniform'&&node.cursor.space.size===size&&node.cursor.remaining.numerator>0n));
    assert.equal(f.counts().initializations,1);assert.equal(f.counts().prefix,1);
  }finally{expansion.close();f.current.close();}
});
test('bounded locality bursts survive cold continuation and exhaust a deep conditional law',t=>{
  type State={path:number[]};let resolutions=0,events=0;
  const draw=()=>0;
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:4n}),resolve:(_s,c)=>{resolutions++;return Number(c);}});
  const program=new CardProgram<State,void,{input:{input:null;output:null};event:{input:null;output:null}},number[]>({id:'deep-locality',
    schemas:{setup:z.undefined(),result:z.array(z.number()),ports:{input:{input:z.null(),output:z.null()},event:{input:z.null(),output:z.null()}}},
    initialize:()=>({path:[]}),entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),card.forEach(()=>[0,1,2,3],'draw'),card.return<State>(s=>s.state.path),
    ]},{id:'draw',steps:[card.operation(draw,'pick'),card.operation<State>(s=>{s.state.path.push(s.locals.pick);}),
      card.forEach(()=>Array.from({length:24},(_,i)=>i),'event'),
    ]},{id:'event',steps:[card.request(()=>({port:'event',input:null})),card.operation(()=>{events++;})]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),options={continueCall:(stop:any,data:null)=>stop.call.port==='event'?{reply:null,data}:undefined};
  let expansion=ProbabilityExpansion.from(current,null,null,options),steps=0,peak=0,longest=0n;
  const seen=new Set<string>();
  try{
    while(!expansion.complete){
      expansion.step();steps++;
      for(let row=expansion.take();row;row=expansion.take()){
        try{const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected complete path');
          assert.equal(stop.result.length,4);assert.ok(stop.result.every(n=>n>=0&&n<4));
          const key=stop.result.join(',');assert.equal(seen.has(key),false);seen.add(key);assert.deepEqual(row.mass,probabilityMass(1n,256n));
        }finally{row.current.close();}
      }
      if(steps%64===0){
        const saved=deserialize(serialize(expansion.save()));peak=Math.max(peak,saved.pending.length);longest=longest>saved.schedule.localRemaining?longest:saved.schedule.localRemaining;
        expansion.close();expansion=ProbabilityExpansion.restore(program,saved,options);
        assert.deepEqual(expansion.save().schedule,saved.schedule);
      }
    }
    assert.equal(seen.size,256);assert.equal(resolutions,4+16+64+256);assert.equal(events,(4+16+64+256)*24);
    assert.deepEqual(expansion.masses().transferred,unitMass());assert.ok(peak>=32,'the fixture must exercise a wide frontier');assert.ok(longest<=63n,'a wide frontier must keep the bounded locality burst');
    assert.ok(peak<256,`streaming retained ${peak} Contexts for 256 leaves`);
    t.diagnostic(`Peak retained frontier=${peak}; longest locality countdown=${longest}`);
  }finally{expansion.close();current.close();}
});
test('collection failure after original execution cannot leave its reply pending',()=>{
  const f=fixture();let expansion=ProbabilityExpansion.from(f.current,null,null);
  const collect=CardGraph.prototype.finishCollection;
  try{
    CardGraph.prototype.finishCollection=function(){throw Error('collection interrupted');};
    assert.throws(()=>expansion.step(),/collection interrupted/);
    CardGraph.prototype.finishCollection=collect;
    const saved=deserialize(serialize(expansion.save()));assert.equal(saved.pending[0].phase,'inspect');
    expansion.close();expansion=ProbabilityExpansion.restore(f.program,saved);
    while(!expansion.complete)expansion.step();
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
  }finally{CardGraph.prototype.finishCollection=collect;expansion.close();f.current.close();}
});
for(const kind of ['chance','done'] as const)test(`${kind} export failure preserves the committed successor for cold continuation`,()=>{
  const f=fixture();let expansion=ProbabilityExpansion.from(f.current,null,null),failed=false;
  const exporter=CardGraph.prototype.export;
  try{
    CardGraph.prototype.export=function<V>(value:V):V{
      if(!failed&&(value as {kind?:string}|null)?.kind===kind){failed=true;throw Error('boundary export interrupted');}
      return exporter.call(this,value) as V;
    };
    assert.throws(()=>{while(!expansion.complete)expansion.step();},/boundary export interrupted/);
    CardGraph.prototype.export=exporter;
    const saved=deserialize(serialize(expansion.save()));
    assert.ok(saved.pending.some((row:any)=>row.phase==='inspect'&&row.context.stop.kind===kind));
    assert.ok(saved.pending.every((row:any)=>row.context.stop.kind!=='fault'));
    expansion.close();expansion=ProbabilityExpansion.restore(f.program,saved);
    while(!expansion.complete)expansion.step();
    let leaves=0;for(;;){const row=expansion.take();if(!row)break;try{assert.equal(row.current.inspect().kind,'done');leaves++;}finally{row.current.close();}}
    assert.equal(leaves,5);assert.deepEqual(expansion.masses().transferred,unitMass());
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,middle:2});
  }finally{CardGraph.prototype.export=exporter;expansion.close();f.current.close();}
});

for(const mode of ['events','chance'] as const)test(`locality scheduling cannot starve a finite sibling behind infinite ${mode}`,()=>{
  const draw=()=>0;
  probabilityOperation(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  const program=new CardProgram<{},void,{begin:{input:null;output:null};event:{input:null;output:null}},number>({id:'fair-probability-'+mode,
    schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()},event:{input:z.null(),output:z.null()}}},
    initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'begin',input:null})),card.operation(draw,'route'),
      card.branch(s=>s.locals.route===0,[card.repeat(()=>true,mode==='events'?[card.request(()=>({port:'event',input:null}))]:[card.operation(draw)])]),
      card.return(()=>7),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),options={continueCall(stop:{call:{port:string}},data:null){if(stop.call.port==='event')return{reply:null,data};}};
  let expansion=ProbabilityExpansion.from(current,null,null,options),delivered=0;
  try{
    // Inspect a live infinite frontier; this is not a solver cutoff.
    for(let step=0;step<256;step++){
      expansion.step();for(let row=expansion.take();row;row=expansion.take()){
        try{assert.deepEqual(row.current.inspect(),{kind:'done',result:7});assert.deepEqual(row.mass,probabilityMass(1n,2n));delivered++;}
        finally{row.current.close();}
      }
      const saved=deserialize(serialize(expansion.save()));
      expansion.close();expansion=ProbabilityExpansion.restore(program,saved,options);
    }
    assert.equal(delivered,1);assert.equal(expansion.complete,false);
    assert.deepEqual(expansion.masses(),{pending:probabilityMass(1n,2n),ready:probabilityMass(0n),transferred:probabilityMass(1n,2n)});
  }finally{expansion.close();current.close();}
});

for(const size of [16,96])for(const cold of [false,true])test(`later coordinates receive service beside earlier infinite continuations (size=${size}, cold=${cold})`,t=>{
  let initializations=0,prefixes=0;const coordinates:bigint[]=[];
  const draw=()=>0;
  probabilityOperation(draw,{space:()=>({kind:'uniform',size:BigInt(size)}),resolve:(_s,c)=>{coordinates.push(c);return Number(c);}});
  const program=new CardProgram<{},void,{begin:{input:null;output:null};event:{input:null;output:null}},number>({id:'late-coordinate-service',
    schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()},event:{input:z.null(),output:z.null()}}},
    initialize:()=>{initializations++;return{};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'begin',input:null})),card.operation(()=>{prefixes++;}),card.operation(draw,'route'),
      card.branch(s=>s.locals.route<size-1,[card.repeat(()=>true,[card.request(()=>({port:'event',input:null}))])]),
      card.return(s=>s.locals.route),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),parent=machine.storage.export(machine.root);
  const options={continueCall(stop:{call:{port:string}},data:null){if(stop.call.port==='event')return{reply:null,data};}};
  let expansion=ProbabilityExpansion.from(current,null,null,options),delivered=false,steps=0;
  if(cold){
    const saved=expansion.savePacked();saved.schedule.localRemaining=97n;
    expansion.close();expansion=ProbabilityExpansion.restore(program,saved,options);
    assert.equal(expansion.savePacked().schedule.localRemaining,97n);
  }
  try{
    // Inspect scheduling latency, not convergence: all earlier infinite
    // continuations must still exist when the finite last result is delivered.
    for(let step=1;step<=(size===16?4096:8192)&&!delivered;step++){
      expansion.step();steps=step;
      if(cold&&[1,97,98].includes(step))assert.equal(expansion.savePacked().schedule.localRemaining,step===1?96n:step===97?0n:31n);
      for(let row=expansion.take();row;row=expansion.take())try{
        assert.equal(delivered,false);assert.deepEqual(row.current.inspect(),{kind:'done',result:size-1});
        assert.deepEqual(row.mass,probabilityMass(1n,BigInt(size)));delivered=true;
      }finally{row.current.close();}
      if(cold&&step%32===0){
        const saved=deserialize(serialize(expansion.savePacked()));expansion.close();
        expansion=ProbabilityExpansion.restore(program,saved,options);
        assert.deepEqual(expansion.savePacked().schedule,saved.schedule);
      }
    }
    t.diagnostic(`Last coordinate delivered=${delivered} after ${steps} scheduling steps; resolved coordinates=${coordinates.length}`);
    assert.equal(delivered,true,'the last coordinate must not incur a width-dependent or exponential scheduling penalty');
    assert.deepEqual(coordinates,Array.from({length:size},(_,i)=>BigInt(i)));
    assert.equal(initializations,1);assert.equal(prefixes,1);assert.equal(expansion.complete,false);
    assert.deepEqual(expansion.masses(),{pending:probabilityMass(BigInt(size-1),BigInt(size)),ready:probabilityMass(0n),transferred:probabilityMass(1n,BigInt(size))});
    assert.deepEqual(machine.storage.export(machine.root),parent);
  }finally{expansion.close();current.close();}
});

test('a long finite continuation gets a full service burst beside an infinitely branching path',()=>{
  const draw=()=>0;
  probabilityOperation(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>Number(c)});
  const program=new CardProgram<{},void,{begin:{input:null;output:null};event:{input:null;output:null}},number>({id:'long-fair-probability',
    schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()},event:{input:z.null(),output:z.null()}}},
    initialize:()=>({}),entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'begin',input:null})),card.operation(draw,'route'),
      card.branch(s=>s.locals.route===0,[card.repeat(()=>true,[card.operation(draw)])]),
      ...Array.from({length:24},()=>card.request(()=>({port:'event' as const,input:null}))),card.return(()=>7),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),expansion=ProbabilityExpansion.from(current,null,null,{
    continueCall(stop,data){if(stop.call.port==='event')return{reply:null,data};},
  });
  let delivered=false;
  try{
    // A regression inspection window, not a production search cutoff. The
    // infinitely branching half must remain represented after delivery.
    for(let step=0;step<2048&&!delivered;step++){
      expansion.step();const row=expansion.take();if(!row)continue;
      try{assert.deepEqual(row.current.inspect(),{kind:'done',result:7});assert.deepEqual(row.mass,probabilityMass(1n,2n));delivered=true;}
      finally{row.current.close();}
    }
    assert.equal(delivered,true);assert.equal(expansion.complete,false);
    assert.deepEqual(expansion.masses(),{pending:probabilityMass(1n,2n),ready:probabilityMass(0n),transferred:probabilityMass(1n,2n)});
  }finally{expansion.close();current.close();}
});

test('a named scope boundary transfers its current without executing later random work',()=>{
  let initializations=0,settlements=0,later=0;
  type State={hp:number};
  const marker=()=>undefined,random=()=>0;
  probabilityOperation<State>(marker,{space:()=>({kind:'boundary',name:'combat-finished'}),boundaryValue:s=>s.locals.final,resolve:()=>undefined});
  probabilityOperation<State>(random,{space:()=>({kind:'uniform',size:1n<<64n}),resolve:()=>{later++;return 0;}});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},number>({id:'exact-terminal-boundary',
    schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},
    initialize:()=>{initializations++;return{hp:1};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),card.operation<State>(s=>{settlements++;s.state.hp+=6;}),
      card.operation<State>(s=>({hp:s.state.hp}),'final'),card.operation(marker),card.operation(random),card.return(s=>s.state.hp),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));machine.advance();
  const current=new ProbabilityCurrent(machine),options={stopAtBoundary:'combat-finished'};
  let expansion=ProbabilityExpansion.from(current,null,null,options);
  try{
    while(!expansion.complete){
      expansion.step();const saved=deserialize(serialize(expansion.save()));
      expansion.close();expansion=ProbabilityExpansion.restore(program,saved,options);
    }
    // The ready boundary itself survives a cold transfer, including its value.
    const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,saved,options);
    const row=expansion.take();assert.ok(row);
    try{
      assert.deepEqual(row.current.inspect(),{kind:'chance',space:{kind:'boundary',name:'combat-finished'}});
      assert.deepEqual(row.current.machine.probabilityBoundaryValue(),{hp:7});
      assert.deepEqual(row.mass,unitMass());
      const value=row.current.machine.probabilityBoundaryValue() as {hp:number};value.hp=99;
      assert.deepEqual(row.current.machine.probabilityBoundaryValue(),{hp:7},'projection is detached from the current');
      assert.deepEqual({initializations,settlements,later},{initializations:1,settlements:1,later:0});
      assert.equal(expansion.take(),undefined);
    }finally{row.current.close();}
  }finally{expansion.close();current.close();}
});

test('instruction slices resume nested frames and aliases beyond the original cumulative budget without replay',()=>{
  type State={seen:number[]};let initializations=0;const executed:number[]=[],coordinates:bigint[]=[];
  const draw=()=>-1;
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>{coordinates.push(c);return Number(c);}});
  const program=new CardProgram<State,void,{input:{input:null;output:number}},{seen:number[];answer:number;draw:number}>({id:'sliced-probability',
    schemas:{setup:z.undefined(),result:z.object({seen:z.array(z.number()),answer:z.number(),draw:z.number()}),ports:{input:{input:z.null(),output:z.number()}}},
    initialize:()=>{initializations++;return{seen:[]};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null}),'answer'),card.operation<State>(s=>s.state.seen,'alias'),
      card.forEach(()=>[0,1,2,3,4],'child'),
      card.operation<State>(s=>{assert.equal(s.locals.alias,s.state.seen,'restored local must alias original state');}),
      card.operation(draw,'draw'),card.return<State>(s=>({seen:s.state.seen,answer:s.locals.answer,draw:s.locals.draw})),
    ]},{id:'child',steps:[card.invoke('leaf',s=>s.input)]},{id:'leaf',steps:[
      card.operation<State>(s=>{executed.push(s.input);s.state.seen.push(s.input);}),card.return(),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined,1)));assert.equal(machine.advance().kind,'call');
  const current=new ProbabilityCurrent(machine),parent=machine.storage.export(machine.root);assert.equal(parent.budget,0);
  let expansion=ProbabilityExpansion.from(current,37,null,{instructionsPerStep:1}),slices=0,steps=0;
  const leaves:{seen:number[];answer:number;draw:number}[]=[];
  try{
    while(!expansion.complete){
      expansion.step();steps++;
      for(;;){const row=expansion.take();if(!row)break;try{
        const stop=row.current.inspectExact();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected terminal');
        leaves.push(stop.result);assert.deepEqual(row.mass,probabilityMass(1n,2n));
      }finally{row.current.close();}}
      const saved=deserialize(serialize(expansion.save()));
      const yielded=saved.pending.find((node:any)=>node.context.stop.kind==='yield');
      if(yielded){slices++;assert.equal(yielded.context.budget,0);assert.equal(yielded.context.waiting,null);
        assert.throws(()=>program.validate(yielded.context),/snapshot root/,'scheduler stops are not public Instance saves');
      }
      expansion.close();expansion=ProbabilityExpansion.restore(program,saved,{instructionsPerStep:steps%2?3:1});
    }
    assert.ok(slices>1);assert.equal(initializations,1);assert.deepEqual(executed,[0,1,2,3,4]);
    assert.deepEqual(coordinates.sort(),[0n,1n]);
    assert.deepEqual(leaves.sort((a,b)=>a.draw-b.draw),[0,1].map(draw=>({seen:[0,1,2,3,4],answer:37,draw})));
    assert.deepEqual(machine.storage.export(machine.root),parent);assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{expansion.close();current.close();}
});

test('a deterministic infinite continuation retains its mass and cannot starve a terminating chance sibling',()=>{
  type State={ticks:number};const draw=()=>0;let choices=0;
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_s,c)=>{choices++;return Number(c);}});
  const program=new CardProgram<State,void,{input:{input:null;output:null}},number>({id:'sliced-infinite-current',
    schemas:{setup:z.undefined(),result:z.number(),ports:{input:{input:z.null(),output:z.null()}}},initialize:()=>({ticks:0}),entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'input',input:null})),card.operation(draw,'draw'),
      card.branch(s=>s.locals.draw===0,[card.repeat(()=>true,[card.operation<State>(s=>{s.state.ticks++;})])]),card.return(()=>7),
    ]}]});
  const machine=new CardMachine(program,privateCardGraph(program.initial(undefined,1)));machine.advance();
  const current=new ProbabilityCurrent(machine);let expansion=ProbabilityExpansion.from(current,null,null,{instructionsPerStep:2}),delivered=0;
  try{
    // This is an inspection window, not an algorithmic cutoff or a terminal
    // value for the retained infinite branch. Save and resume the live loop.
    for(let step=0;step<60;step++){
      expansion.step();const row=expansion.take();if(row){try{
        assert.deepEqual(row.current.inspectExact(),{kind:'done',result:7});assert.deepEqual(row.mass,probabilityMass(1n,2n));delivered++;
      }finally{row.current.close();}}
      const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,saved,{instructionsPerStep:2});
    }
    assert.equal(choices,2);assert.equal(delivered,1);assert.equal(expansion.complete,false);
    assert.deepEqual(expansion.masses(),{pending:probabilityMass(1n,2n),ready:probabilityMass(0n),transferred:probabilityMass(1n,2n)});
    const saved=expansion.save();assert.ok(saved.pending.some(node=>node.context.state.ticks>0));
  }finally{expansion.close();current.close();}
});
