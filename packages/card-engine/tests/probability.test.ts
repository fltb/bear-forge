import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,card,plainCardStorage,linkRules,rules} from '../src/index.ts';
import {generateProbability,permutationAt,permutationCount,permutationCoordinate,probabilityOperation,validateCoordinate} from '../src/probability.ts';
import {withProbability} from '../src/rules-probability.ts';

const noEntropy={word(){throw Error('Exact support must not sample');},check(){}};
test('stable permutation coordinates round trip every member of a finite support',()=>{
  for(let length=0;length<=6;length++){
    const items=Array.from({length},(_,i)=>i*3+7);
    for(let coordinate=0n;coordinate<permutationCount(length);coordinate++)assert.equal(permutationCoordinate(items,permutationAt(items,coordinate)),coordinate);
  }
  assert.throws(()=>permutationCoordinate([1,1],[1,1]),/members/);
  assert.throws(()=>permutationCoordinate([1,2],[1,1]),/member/);
});
test('internal scope boundaries have unit mass, no entropy and only a continuation coordinate',()=>{
  const boundary={kind:'boundary',name:'selection-complete'} as const;
  assert.deepEqual(generateProbability(boundary,1,noEntropy),{representation:'exact',outcomes:[{coordinate:0n,probability:1}]});
  validateCoordinate(boundary,0n);
  for(const value of [undefined,1n,-1n,{kind:'sample',value:0}])assert.throws(()=>validateCoordinate(boundary,value),/coordinate/);
  assert.throws(()=>generateProbability({kind:'boundary',name:''},1,noEntropy),/boundary/);
});
test('small spaces enumerate exact mass and omit zero-probability coordinates',()=>{
  assert.deepEqual(generateProbability({kind:'uniform',size:3n},8,noEntropy),{representation:'exact',outcomes:[0n,1n,2n].map(coordinate=>({coordinate,probability:1/3}))});
  assert.deepEqual(generateProbability({kind:'weighted',weights:[.2,0,.8]},2,noEntropy),{representation:'exact',outcomes:[{coordinate:0n,probability:.2},{coordinate:2n,probability:.8}]});
});
test('large spaces reject out-of-range entropy and retain duplicate sample mass',()=>{
  const words=[127,99,99,0];let calls=0;
  const result=generateProbability({kind:'uniform',size:100n},3,{check(){},word(){calls++;return words.shift()!;}});
  assert.equal(calls,4);
  assert.deepEqual(result,{representation:'particles',outcomes:[{coordinate:99n,probability:2/3},{coordinate:0n,probability:1/3}]});
});
test('wide discrete spaces keep bigint coordinates instead of rounding them to numbers',()=>{
  const words=[0xffffffff,0xfffffffe];
  assert.deepEqual(generateProbability({kind:'uniform',size:1n<<64n},1,{check(){},word:()=>words.shift()!}).outcomes,[{coordinate:(1n<<64n)-2n,probability:1}]);
});
test('sampling cancellation stops rejection loops without returning partial support',()=>{
  let checks=0;
  assert.throws(()=>generateProbability({kind:'uniform',size:100n},8,{word:()=>127,check(){if(++checks>10)throw Error('cancelled');}}),/cancelled/);
  assert.throws(()=>generateProbability({kind:'uniform',size:100n},1,{word:()=>-1,check(){}}),/entropy/);
});
test('invalid spaces cannot turn missing mass into a normalized distribution',()=>{
  for(const weights of [[.2,.3],[-1,2],[NaN,1],[Infinity],[]])assert.throws(()=>generateProbability({kind:'weighted',weights},8,noEntropy));
  assert.throws(()=>generateProbability({kind:'uniform',size:0n},8,noEntropy));
});
test('permutation coordinates cover every order and preserve positional multiplicity',()=>{
  assert.equal(permutationCount(3),6n);
  const orders=Array.from({length:6},(_,i)=>permutationAt(['a','b','c'],BigInt(i)).join(''));
  assert.equal(new Set(orders).size,6);
  const equal=Array.from({length:6},(_,i)=>permutationAt(['a','a','b'],BigInt(i)).join(''));
  assert.deepEqual([...new Set(equal)].map(order=>equal.filter(x=>x===order).length),[2,2,2]);
  assert.deepEqual(permutationAt([],0n),[]);
});

test('chance suspension shares the instruction loop and never repeats a committed prefix',()=>{
  type State={before:number;after:number};
  let initialized=0,normal=0,resolved=0;
  const draw=(scope:{state:State})=>{normal++;return 17;};
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:2n}),resolve:(_scope,c)=>{resolved++;return Number(c);}});
  const program=new CardProgram<State,void,{begin:{input:null;output:null};nested:{input:number;output:number}},number>({id:'chance-continuation',
    schemas:{setup:z.undefined(),result:z.number(),ports:{begin:{input:z.null(),output:z.null()},nested:{input:z.number(),output:z.number()}}},
    initialize:()=>{initialized++;return{before:0,after:0};},entry:'root',effects:[
      {id:'root',steps:[card.request(()=>({port:'begin',input:null})),card.operation(s=>{s.state.before++;}),card.invoke('inner',()=>8,'result'),card.return(s=>s.locals.result)]},
      {id:'inner',steps:[card.operation(draw,'random'),card.operation(s=>{s.state.after++;}),card.request(s=>({port:'nested',input:s.locals.random+s.input}),'reply'),card.return(s=>s.locals.reply+s.locals.random)]}
    ]});
  const parent=new CardMachine(program,plainCardStorage(program.initial(undefined)));
  assert.equal(parent.advance().kind,'call');
  assert.deepEqual(parent.advanceProbability(null),{kind:'chance',space:{kind:'uniform',size:2n}});
  const saved=structuredClone(parent.root);
  assert.deepEqual(parent.root.state,{before:1,after:0});
  assert.equal(normal,0);assert.equal(resolved,0);
  assert.throws(()=>parent.advanceProbability(2n),/coordinate/);assert.deepEqual(structuredClone(parent.root),saved);
  assert.throws(()=>parent.advance(),/probability continuation/);
  assert.throws(()=>parent.current(),/no public IO stop/);
  for(const coordinate of [0n,1n]) {
    const child=new CardMachine(program,plainCardStorage(structuredClone(saved)));
    assert.deepEqual(child.advanceProbability(coordinate),{kind:'call',call:{port:'nested',input:8+Number(coordinate)}});
    assert.deepEqual(child.root.state,{before:1,after:1});
    assert.deepEqual(child.advanceProbability(10),{kind:'done',result:10+Number(coordinate)});
    assert.equal(child.program,parent.program);
  }
  assert.deepEqual(structuredClone(parent.root),saved);assert.equal(initialized,1);assert.equal(normal,0);assert.equal(resolved,2);
});

test('probability atom proposals still use original ownership and schema validation before commit',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const counter=m.own(rules.defineComponent({schema:z.number().max(10),initial:()=>0}));
    const draw=m.atom({input:z.undefined(),output:z.number(),reads:[counter],writes:[counter],emits:[],run(){return{writes:[{entity:0,component:counter,value:1}],events:[],result:1};}});
    withProbability(draw,{space:()=>({kind:'uniform',size:2n}),run(_r,_i,c){return{writes:[{entity:0,component:counter,value:c===0n?2:11}],events:[],result:Number(c)};}});
    return{exports:{draw,counter:counter.public}};
  }});
  const entry=rules.defineEffect<void,number>(b=>{const value=b.local<number>();return rules.sequence(b.assign(value,rules.call(module.exports.draw,undefined)),b.return(value));});
  const definition=linkRules({id:'probability-proposal',schemas:{setup:z.undefined(),result:z.number(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,plainCardStorage(program.initial(undefined)));
  assert.equal(machine.advanceProbability().kind,'chance');
  const before=structuredClone(machine.root.state);
  assert.equal(machine.advanceProbability(1n).kind,'fault');
  assert.deepEqual(machine.root.state,before,'invalid proposal cannot partially change the Context');
});

test('generated distributions return labelled particles and cancel without publishing a partial sample batch',()=>{
  let generated=0;
  const entropy={word:()=>7,check(){}};
  const result=generateProbability({kind:'sampled'},3,entropy,source=>({value:source.word(),ordinal:++generated}));
  assert.equal(result.representation,'particles');assert.equal(generated,3);
  assert.deepEqual(result.outcomes,[1,2,3].map(ordinal=>({coordinate:{kind:'sample',value:{value:7,ordinal}},probability:1/3})));
  assert.throws(()=>generateProbability({kind:'sampled'},1,entropy),/Missing probability sampler/);
  let calls=0;
  assert.throws(()=>generateProbability({kind:'sampled'},3,entropy,()=>{if(++calls===2)throw Error('cancelled');return 1;}),/cancelled/);
  assert.equal(calls,2);
});

test('sampled atom commits use the original output checks and save no sampler code in the Context',()=>{
  let sampled=0,normal=0;
  const module=rules.defineRules({requires:[],build(m){
    const effect=withProbability(m.atom({input:z.number(),output:z.number().max(10),reads:[],writes:[],emits:[],run:(_r,input)=>{normal++;return{writes:[],events:[],result:input};}}),{
      space:()=>({kind:'sampled'}),run:()=>{throw Error('Not a discrete operation');},
      sample:(input,entropy)=>{sampled++;return input+entropy.word();},runSample:(_r,_i,value)=>({writes:[],events:[],result:value as number}),
    });return{exports:{effect}};
  }});
  const entry=rules.defineEffect<void,number>(b=>{const value=b.local<number>();return rules.sequence(b.assign(value,rules.call(module.exports.effect,3)),b.return(value));});
  const definition=linkRules({id:'sampled-atom',schemas:{setup:z.undefined(),result:z.number(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module]});
  const program=new CardProgram(definition),machine=new CardMachine(program,plainCardStorage(program.initial(undefined)));
  assert.deepEqual(machine.advanceProbability(),{kind:'chance',space:{kind:'sampled'}});
  const saved=structuredClone(machine.root),value=machine.sampleProbability({word:()=>2,check(){}});
  assert.equal(value,5);assert.deepEqual(structuredClone(machine.root),saved);assert.equal(sampled,1);assert.equal(normal,0);
  const child=new CardMachine(program,plainCardStorage(structuredClone(saved)));
  assert.deepEqual(child.advanceProbability({kind:'sample',value}),{kind:'done',result:5});
  assert.equal(sampled,1,'commit must not execute the generator again');
  assert.equal(machine.advanceProbability({kind:'sample',value:11}).kind,'fault');
  assert.deepEqual(structuredClone(machine.root.state),saved.state);
});

test('monotone images preserve every finite grid point and conditional partitions preserve both masses',async()=>{
  const {monotoneProbabilityImage,partitionProbabilityImage,satisfiesProbabilityConstraints}=await import('../src/probability-image.ts');
  const project=(coordinate:number)=>Math.floor((coordinate*3+5)/17),image=monotoneProbabilityImage(1024,project);
  let start=0;for(const row of image){for(let coordinate=start;coordinate<row.end;coordinate++)assert.equal(row.value,project(coordinate));start=row.end;}
  assert.equal(start,1024);assert.throws(()=>monotoneProbabilityImage(0,project),/grid/);
  const rows=[.1,.2,.3,.4].map((weight,index)=>({weight,constraints:[{name:'visible',values:[index<2?7:9]}]}));
  const hint=[{kind:'discrete-result',name:'visible',value:7}],partition=partitionProbabilityImage(rows,hint,4,{check(){},word:()=>0})!;
  assert.equal(partition.representation,'particles');
  assert.ok(Math.abs(partition.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
  assert.ok(Math.abs(partition.outcomes.filter(row=>Number(row.coordinate)<2).reduce((sum,row)=>sum+row.probability,0)-.3)<1e-12);
  assert.equal(satisfiesProbabilityConstraints(rows[2]!.constraints,hint),false);
  assert.equal(satisfiesProbabilityConstraints(rows[2]!.constraints,[]),true,'a missing public target must not invent an observation');
});
