import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {rules} from '../src/rules/execution.ts';
import {zones} from '../src/rules/zones.ts';
import {random} from '../src/rules/random.ts';
import {randomState,randomInt,randomLong,javaShuffle,rngView} from '../src/rng.ts';

const {defineRules,defineEntity,defineEffect,sequence,call,query,forEach,spawnEntity}=rules;
const items=defineRules({requires:[zones,random],build:m=>({exports:{kind:m.kind({config:z.undefined(),components:[zones.exports.member]})}})});
const item=defineEntity(items.exports.kind,undefined),zone=defineEntity(zones.exports.kind,{capacity:null}),stream=defineEntity(random.exports.stream,undefined);
const pause=ruleModules.portEffect<unknown,null>('pause');
const entry=defineEffect<number,unknown>(b=>{
  const pile=b.local<number>(),rng=b.local<number>(),cards=b.local<number[]>(),made=b.local<number>(),at=b.local<number>(),order=b.local<readonly number[]>();
  const snapshot=b.read(v=>({members:[...v.query(zones.exports.members,v.get(pile))],cards:[...v.get(cards)],knowledge:v.query(zones.exports.orderKnowledge,v.get(pile)),rng:v.query(random.exports.current,v.get(rng))}));
  const resolve=()=>call(zones.exports.resolveOrder,b.read(v=>({zone:v.get(pile),keys:v.get(cards).map((entity,key)=>({entity,key}))})));
  return sequence(b.assign(pile,spawnEntity({definition:zone,owner:null,scope:0})),b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:1701n})),b.assign(cards,[]),call(pause,null),
    forEach([0,1,2,3,4,5,6,7,8,9,10,11],()=>sequence(
      b.assign(made,spawnEntity({definition:item,owner:null,scope:0})),b.assign(cards,b.read(v=>[...v.get(cards),v.get(made)])),
      call(zones.exports.move,{entity:made,from:null,to:pile,index:b.read(v=>v.query(zones.exports.members,v.get(pile)).length)}),
    )),
    b.assign(order,random.exports.shuffle({stream:rng,items:query(zones.exports.members,pile)})),call(zones.exports.reorder,{zone:pile,order}),
    call(zones.exports.conceal,{zone:pile,blocks:[order],unsupported:false}),call(pause,snapshot),
    forEach(b.read(v=>Array.from({length:v.input})),()=>sequence(
      resolve(),b.assign(made,spawnEntity({definition:item,owner:null,scope:0})),b.assign(cards,b.read(v=>[...v.get(cards),v.get(made)])),
      b.assign(at,call(random.exports.int,{stream:rng,start:0,end:b.read(v=>v.query(zones.exports.members,v.get(pile)).length-1)})),
      call(zones.exports.move,{entity:made,from:null,to:pile,index:at}),
      call(zones.exports.obscure,{zone:pile,entity:made,slots:b.read(v=>v.query(zones.exports.members,v.get(pile)).length-1)}),call(pause,snapshot),
    )),resolve(),call(zones.exports.reveal,{zone:pile,count:2,keys:b.read(v=>v.get(cards).map((entity,key)=>({entity,key})))}),
    forEach(query(zones.exports.members,pile),entity=>call(zones.exports.move,{entity,from:pile,to:null,index:0})),b.return(snapshot),
  );
});
const definition=linkRules({id:'sts/zones-execution-cost',schemas:{setup:z.number(),result:z.unknown(),ports:{pause:{input:z.unknown(),output:z.null()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[items]});
function fresh(count:number){const p=new CardProgram(definition),m=new CardMachine(p,privateCardGraph(p.initial(count)));assert.equal(m.advance().kind,'call');return new ProbabilityCurrent(m);}
function ordinaryLaw(value:any){assert.deepEqual(value.knowledge,{blocks:[],resolved:false,unsupported:true},'ordinary execution must not accumulate a probability language');}

test('ordinary shuffle, repeated non-top random insertions and cleanup never build a hidden-order law',()=>{
  const current=fresh(80),rng=randomState(1701n),expected=Array.from({length:12},(_,i)=>i);javaShuffle(expected,randomLong(rng));
  try{
    for(let step=0;step<=80;step++){
      const stop=current.machine.advance(null);assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('Missing insertion boundary');
      const value=stop.call.input as any;ordinaryLaw(value);
      if(step>0)expected.splice(randomInt(rng,0,expected.length-1),0,11+step);
      assert.deepEqual(value.members.map((id:number)=>value.cards.indexOf(id)),expected,'original RNG and real membership ordering must remain unchanged');
      assert.deepEqual(value.rng,rngView(rng));
    }
    const done=current.machine.advance(null);assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Cleanup did not complete');ordinaryLaw(done.result);assert.deepEqual((done.result as any).members,[]);
  }finally{current.close();}
});

test('probability entry from an ordinary hidden pile stops as unavailable before inspecting its real order',()=>{
  const current=fresh(1);assert.equal(current.machine.advance(null).kind,'call');
  const before=current.machine.storage.export(current.machine.root),branch=current.fork();
  try{
    let stop=branch.advance(null);
    while(stop.kind==='chance'&&stop.space.kind==='uniform'&&stop.space.size===1n)stop=branch.advance(0n);
    assert.deepEqual(stop,{kind:'chance',space:{kind:'unavailable',reason:'Ordinary STS sessions do not retain a hidden-order probability law'}});
    assert.deepEqual(current.machine.storage.export(current.machine.root),before);
    assert.equal(current.machine.advance(null).kind,'call','the actual current state still advances normally');
  }finally{branch.close();current.close();}
});

test('a fresh probability branch retains its original shuffle outcome without reopening hidden permutations',()=>{
  const current=fresh(3);
  try{
    let stop=current.advance(null),shuffles=0,insertions=0,pauses=0;
    while(stop.kind!=='done'){
      if(stop.kind==='chance'){
        assert.equal(stop.space.kind,'uniform');if(stop.space.kind!=='uniform')throw Error('Unexpected probability space');
        if(stop.space.size===479001600n)shuffles++;
        else if(stop.space.size>1n){assert.equal(stop.space.size,BigInt(12+insertions));insertions++;}
        stop=current.advance(0n);
      }else{
        assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('Expected probability continuation');
        const value=stop.call.input as any;assert.equal(value.knowledge.resolved,true);assert.equal(value.knowledge.unsupported,false);pauses++;stop=current.advance(null);
      }
    }
    assert.equal(shuffles,1);assert.equal(insertions,3);assert.equal(pauses,4);assert.deepEqual((stop.result as any).members,[]);
  }finally{current.close();}
});
