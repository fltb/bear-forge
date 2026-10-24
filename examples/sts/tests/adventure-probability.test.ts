import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {ProbabilityCurrent,nextProbability} from '../../../packages/runtime-card/src/probability.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import type {AdventureState} from '../src/rules/adventures.types.ts';
import {relics,type RelicDefinition} from '../src/rules/relics.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {encounterPlans,nextEncounterChoices,secondBossChoices} from '../src/content/enemies/plans.ts';
import {float24Choices,float24Index,permutationNextChoices} from '../src/rules/ordering.ts';
import {random} from '../src/rules/random.ts';
import type {MonsterPlan} from '../src/encounters.types.ts';
import {encounterId as e} from '../src/identifiers.ts';
import {programSchemas,type Ports} from '../src/game.schemas.ts';

const {defineEffect,sequence,call,query,when}=rules;
const setup=z.object({mode:z.enum(['monster','elite','relic','acquisition'])});
const result=z.object({encounter:z.number(),relic:z.string(),remaining:z.number(),history:z.array(z.number())});
type Result=z.infer<typeof result>;
const pause=ruleModules.portEffect<number,null>('pause'),seen=ruleModules.portEffect<Result,null>('seen');
const fixture=rules.defineRules({requires:[adventureStart,adventureContent.cards,adventureContent.acquisition],build(){
  const runDefinition=rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions});
  const entry=defineEffect<z.infer<typeof setup>,Result>(b=>{
    const run=b.local<number>(),encounter=b.local<number>(),relic=b.local<RelicDefinition>(),name=b.local<string>();
    const choose=()=>sequence(b.assign(encounter,-1),b.assign(name,''),when(b.read(v=>v.input.mode==='relic'||v.input.mode==='acquisition'),sequence(
      when(b.read(v=>v.input.mode==='acquisition'),b.assign(relic,call(adventureContent.acquisition.exports.draw,{run,tier:'common',front:true,shop:false,screenless:false})),b.assign(relic,call(adventures.exports.takeRelic,{run,tier:'common',front:true}))),b.assign(name,query(relics.exports.definitionId,relic)),
    ),b.assign(encounter,call(adventures.exports.takeEncounter,{run,elite:b.read(v=>v.input.mode==='elite'),choices:b.read(v=>{
      const plan=v.query(adventures.exports.plan,v.get(run)),elite=v.input.mode==='elite';return nextEncounterChoices(1,elite,(elite?plan.eliteList:plan.monsterList).slice(0,elite?plan.eliteOffset:plan.monsterOffset));
    })}))));
    const snapshot=()=>b.read(v=>{const plan=v.query(adventures.exports.plan,v.get(run)),elite=v.input.mode==='elite';return{encounter:v.get(encounter),relic:v.get(name),remaining:v.query(adventures.exports.pools,v.get(run)).relicPools.common.length,history:[...(elite?plan.eliteList:plan.monsterList).slice(0,elite?plan.eliteOffset:plan.monsterOffset)]};});
    return sequence(b.assign(run,call(adventureStart.exports.initialize,{setup:{seed:'130'},definition:runDefinition})),when(b.read(v=>v.input.mode==='acquisition'),call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id:'ANCHOR'})})),call(pause,run),choose(),call(seen,snapshot()),choose(),b.return(snapshot()));
  });return{exports:{entry}};
}});
const definition=linkRules<{},z.infer<typeof setup>,Ports&{pause:{input:number;output:null};seen:{input:Result;output:null}},Result>({id:'sts/adventure-probability',schemas:{setup,result,ports:{...programSchemas.ports,pause:{input:z.number(),output:z.null()},seen:{input:result,output:z.null()}}},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry,pause,seen],modules:[fixture]});
const entropy={word(){throw Error('Small support must enumerate');},check(){}};
function source(mode:z.infer<typeof setup>['mode']){
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({mode})));
  const stop=machine.advance();if(stop.kind!=='call'||stop.call.port!=='pause')throw Error('Expected actual current root');
  const run=stop.call.input;
  const inspect=<I,O>(q:rules.Query<I,O>,input:I)=>inspectRuleQuery(definition,machine.root.state,q,input);
  const components=stateOf(machine.root.state).entities[run]!.components;
  const key=Object.entries(components).find(([,value])=>value&&typeof value==='object'&&'relicPools' in value)![0];
  const pool=inspect(adventures.exports.pools,run);
  const names=['ANCHOR','BAG_OF_MARBLES','VAJRA'];
  components[Number(key)]=machine.storage.own({...pool,relicPools:{...pool.relicPools,common:names.map(id=>inspect(adventures.exports.relic,{run,id}))}});
  return{current:new ProbabilityCurrent(machine),run};
}
function alterFuture(current:ReturnType<typeof source>['current'],run:number){
  const components=stateOf(current.machine.root.state).entities[run]!.components;
  for(const [key,value] of Object.entries(components)){
    if(!value||typeof value!=='object')continue;
    if('relicPools' in value){const s=value as Pick<AdventureState,'relicPools'>;components[Number(key)]=current.machine.storage.own({...s,relicPools:{...s.relicPools,common:[...s.relicPools.common].reverse()}});}
    if('monsterList' in value){const s=value as Pick<AdventureState,'monsterList'|'eliteList'>;components[Number(key)]=current.machine.storage.own({...s,monsterList:s.monsterList.map(()=>e.LARGE_SLIME),eliteList:s.eliteList.map(()=>e.NEMESIS)});}
  }
}

for(const mode of ['monster','elite','relic'] as const)test(`actual ${mode} futures ignore cached hidden order, preserve parents and continue without replacement`,()=>{
  const root=source(mode),other=root.current.fork();alterFuture(other,root.run);
  const before=root.current.machine.storage.export(root.current.machine.root),initial=CardProgram.prototype.initial;
  const plan=inspectRuleQuery(definition,root.current.machine.root.state,adventures.exports.plan,root.run),expected=mode==='elite'?plan.eliteList[0]:plan.monsterList[0];
  CardProgram.prototype.initial=function(){throw Error('No initialization during next(current)');};
  try{
    const a=nextProbability(root.current,null,{maximum:8,entropy}),b=nextProbability(other,null,{maximum:8,entropy});
    try{
      const read=(o:typeof a.outcomes[number])=>{const stop=o.current.inspect();if(stop.kind!=='call'||stop.call.port!=='seen')throw Error('Expected observed successor');return{probability:o.probability,result:stop.call.input};};
      assert.deepEqual(a.outcomes.map(read),b.outcomes.map(read));assert.equal(a.representation,'exact');assert.equal(a.outcomes.length,mode==='monster'?4:3);
      for(const outcome of a.outcomes){
        const first=read(outcome).result,next=nextProbability(outcome.current,null,{maximum:8,entropy});
        try{for(const child of next.outcomes){const stop=child.current.inspect();if(stop.kind!=='done')throw Error('Expected terminal successor');
          if(mode==='relic'){assert.notEqual(stop.result.relic,first.relic);assert.equal(first.remaining,2);assert.equal(stop.result.remaining,1);}
          else{assert.notEqual(stop.result.encounter,first.encounter);assert.deepEqual(stop.result.history,[first.encounter,stop.result.encounter]);}
        }}finally{for(const child of next.outcomes)child.current.close();}
      }
      assert.deepEqual(root.current.machine.storage.export(root.current.machine.root),before);
    }finally{for(const child of [...a.outcomes,...b.outcomes])child.current.close();}
    const normal=root.current.machine.advance(null);if(normal.kind!=='call'||normal.call.port!=='seen')throw Error('Expected normal successor');
    if(mode==='relic')assert.equal(normal.call.input.relic,'ANCHOR');else assert.equal(normal.call.input.encounter,expected);
  }finally{CardProgram.prototype.initial=initial;root.current.close();other.close();}
});

test('encounter probability uses float24 masses and original boundary rejection rules',()=>{
  const elites=nextEncounterChoices(1,true,[]),grid=2**24;
  assert.deepEqual(elites.map(c=>c.weight),[5592406/grid,5592405/grid,5592405/grid]);
  const after=nextEncounterChoices(1,true,[e.GREMLIN_NOB]);assert.ok(after.every(c=>c.value!==e.GREMLIN_NOB));assert.equal(after.reduce((sum,c)=>sum+c.weight,0),1);
  const firstStrong=nextEncounterChoices(1,false,[e.CULTIST,e.JAW_WORM,e.SMALL_SLIMES]);
  assert.ok(firstStrong.every(c=>c.value!==e.LARGE_SLIME&&c.value!==e.LOTS_OF_SLIMES));
  const actThreeBoundary=nextEncounterChoices(3,false,[e.ORB_WALKER,e.THREE_DARKLINGS]);
  assert.ok(actThreeBoundary.some(c=>c.value===e.THREE_DARKLINGS),'first strong encounter does not have the later two-entry rejection');
  const next=nextEncounterChoices(3,false,[e.ORB_WALKER,e.THREE_DARKLINGS,e.THREE_DARKLINGS]);assert.ok(next.every(c=>c.value!==e.THREE_DARKLINGS));
  assert.deepEqual(secondBossChoices(e.TIME_EATER).map(c=>c.weight),[.5,.5]);assert.ok(secondBossChoices(e.TIME_EATER).every(c=>c.value!==e.TIME_EATER));
});

test('threshold probability is the pushforward of the original operation, including rejection and coincident values',()=>{
  // Every cutoff lies on a sixteenth of the float24 grid, so the sixteen
  // equally sized cells are an exact independent finite counting oracle.
  for(const bounds of [[.25,.5,.75],[-.25,.5,1.25],[.5,.25,.75],[0,0,.5]]){
    for(const accepted of [[true,true,true,true],[true,false,false,true]]){
      const selection={values:[7,3,7,9],bounds,accepted},counts=new Map<number,number>();let total=0;
      for(let cell=0;cell<16;cell++){
        const index=float24Index(selection,cell/16);
        if(accepted[index]){const value=selection.values[index]!;counts.set(value,(counts.get(value)??0)+1);total++;}
      }
      if(total===0)assert.throws(()=>float24Choices(selection),/Empty accepted/);
      else assert.deepEqual(float24Choices(selection),[...counts].map(([value,count])=>({key:String(value),value,weight:count/total})));
    }
  }
  const grid=2**24,cutoff=Math.fround(1/3),selection={values:[1,2],bounds:[cutoff],accepted:[true,true]};
  assert.equal(float24Index(selection,(5592406-1)/grid),0);assert.equal(float24Index(selection,5592406/grid),1);
  assert.deepEqual(float24Choices(selection).map(c=>c.weight),[5592406/grid,1-5592406/grid]);
  assert.throws(()=>float24Choices({...selection,accepted:[false,false]}),/Empty accepted/);
  assert.throws(()=>float24Choices({...selection,bounds:[NaN]}),/Invalid/);
  assert.deepEqual(permutationNextChoices([4,8,9],[8]),[{key:'4',value:4,weight:.5},{key:'9',value:9,weight:.5}]);
  assert.throws(()=>permutationNextChoices([4,8,9],[8,8]),/Invalid/);
});

test('the original encounter generator executes rejection and all stages through the same selection definition',()=>{
  const stream=rules.defineEntity(random.exports.stream,undefined);
  const entry=defineEffect<number,MonsterPlan>(b=>{
    const rng=b.local<number>(),plan=b.local<MonsterPlan>();
    return sequence(b.assign(rng,rules.spawnEntity({definition:stream,owner:null,scope:0,setup:130n})),
      b.assign(plan,call(encounterPlans.exports.generate,{stream:rng,act:b.input,ascension:20})),b.return(plan));
  });
  const planSchema=z.object({monsterList:z.array(z.number()),eliteList:z.array(z.number()),boss:z.number(),secondBoss:z.number()});
  const definition=linkRules({id:'sts/original-encounter-selection',schemas:{setup:z.number(),result:planSchema,ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[encounterPlans]});
  const program=new CardProgram(definition);
  for(const act of [1,2,3]){
    const machine=new CardMachine(program,privateCardGraph(program.initial(act)));
    const initialize=CardProgram.prototype.initial;
    try{
      CardProgram.prototype.initial=function(){throw Error('A forward generation cannot restart');};
      let stop=machine.advanceProbability(),draws=0;
      // First two coordinates coincide: the second must be rejected by the
      // original loop. Later coordinates traverse the remaining stages.
      while(stop.kind==='chance'){
        assert.ok(++draws<80,'original rejection loop must finish');
        assert.equal(stop.space.kind,'uniform');if(stop.space.kind!=='uniform')throw Error('Expected original random primitive');
        const coordinate=stop.space.size===6n?0n:draws<=2?0n:BigInt(Math.floor(([.4,.8,0] as const)[(draws-3)%3]!*2**24));
        stop=machine.advanceProbability(coordinate);
      }
      assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected original plan');
      assert.equal(stop.result.monsterList.length,act===1?16:15);assert.equal(stop.result.eliteList.length,10);
      assert.ok(draws>=stop.result.monsterList.length+stop.result.eliteList.length+2,'the rejected draw is consumed');
      for(const [elite,list] of [[false,stop.result.monsterList],[true,stop.result.eliteList]] as const){
        for(let i=0;i<list.length;i++)assert.ok(nextEncounterChoices(act,elite,list.slice(0,i)).some(c=>c.value===list[i]),`act ${act}, elite ${elite}, index ${i}`);
      }
      if(act===3)assert.ok(secondBossChoices(stop.result.boss).some(c=>c.value===stop.result.secondBoss));
      else assert.equal(stop.result.secondBoss,e.INVALID);
    }finally{CardProgram.prototype.initial=initialize;machine.storage.close?.();}
  }
});

test('probability selection continues the original relic eligibility loop, including rejected pool removals',()=>{
  const root=source('acquisition'),result=nextProbability(root.current,null,{maximum:8,entropy});
  try{
    assert.equal(result.representation,'exact');assert.equal(result.outcomes.length,4);
    const mass=new Map<string,number>(),sizes=new Set<number>();
    for(const child of result.outcomes){const stop=child.current.inspect();if(stop.kind!=='call'||stop.call.port!=='seen')throw Error('Expected acquisition result');
      assert.notEqual(stop.call.input.relic,'ANCHOR');sizes.add(stop.call.input.remaining);mass.set(stop.call.input.relic,(mass.get(stop.call.input.relic)??0)+child.probability);
    }
    assert.deepEqual(mass,new Map([['BAG_OF_MARBLES',.5],['VAJRA',.5]]));assert.deepEqual([...sizes].sort(),[1,2]);
    const normal=root.current.machine.advance(null);if(normal.kind!=='call'||normal.call.port!=='seen')throw Error('Expected normal acquisition');
    assert.equal(normal.call.input.relic,'VAJRA');assert.equal(normal.call.input.remaining,1);
  }finally{for(const child of result.outcomes)child.current.close();root.current.close();}
});

test('original question-room declarations contain only the resolved public room and event',async()=>{
  const {eventSamplingFixture}=await import('./adventure-case-fixture.ts');
  for(const owned of [[],['TINY_CHEST','JUZU_BRACELET']] as import('../src/identifiers.ts').RelicId[][]){
    const definition=eventSamplingFixture(owned,[false,true,false,false,false,true,false,false]),program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130'})));
    const declarations:{name:string;value:unknown}[]=[];
    try{
      let stop=machine.advance();declarations.push(...machine.takeProbabilityPublications() as {name:string;value:unknown}[]);
      while(stop.kind==='call'&&stop.call.port==='event'){stop=machine.advance(null);declarations.push(...machine.takeProbabilityPublications() as {name:string;value:unknown}[]);}
      assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected original room samples');
      assert.deepEqual(declarations.filter(row=>row.name==='resolved-room').map(row=>row.value),stop.result.outcomes.map(row=>row.room));
      assert.deepEqual(declarations.filter(row=>row.name==='resolved-event').map(row=>row.value),stop.result.outcomes.filter(row=>row.room==='EVENT').map(row=>row.event));
      if(owned.length){assert.ok(stop.result.outcomes.every(row=>row.room!=='MONSTER'));assert.equal(stop.result.outcomes[3]!.room,'TREASURE');assert.equal(stop.result.outcomes[7]!.room,'TREASURE');}
    }finally{machine.storage.close?.();}
  }
});
