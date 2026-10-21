import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules,CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {random} from '../src/rules/random.ts';
import {encounterPlans} from "../src/content/enemies/plans.ts";
import {productionDriver} from './production-driver.ts';
import {adventureView} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineEntity,defineEffect,sequence,call,query,spawnEntity}=rules;
const streamDefinition=defineEntity(random.exports.stream,undefined);
type EncounterSetup={seed:string;act:number;ascension:number};
const entry=defineEffect<EncounterSetup,unknown>(b=>{const stream=b.local<number>(),plan=b.local<Record<string,unknown>>();return sequence(b.assign(stream,spawnEntity({definition:streamDefinition,owner:null,scope:0,setup:b.read(v=>BigInt(v.input.seed))})),b.assign(plan,call(encounterPlans.exports.generate,{stream,act:b.read(v=>v.input.act),ascension:b.read(v=>v.input.ascension)})),b.return(b.read(v=>({...v.get(plan),rng:v.get(query(random.exports.current,v.get(stream)))}))));});
const encounterDefinition=linkRules({id:'sts/source-encounter-plans',schemas:{setup:z.object({seed:z.string(),act:z.number(),ascension:z.number()}),result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[encounterPlans]});
const program=new CardProgram(encounterDefinition);

test('normal A20 adventure matches the source including future encounter, relic and event pools',async()=>{
  const reference=await ReferenceClient.create();
  try{for(const seed of ['0','1','65','130','409','9223372036854775808','18446744073709551615']){
    const expected=await reference.call({op:'start',seed}),driver=productionDriver(seed);
    try{driver.frame();assertSameState(expected.game,adventureView(driver.machine.root.state),`normal opening seed=${seed}`);}finally{driver.close();}
  }}finally{await reference.close();}
});
test('all three acts preserve source weighted draws, repeat rejection and A20 second boss RNG',async()=>{
  const reference=await ReferenceClient.create();
  try{for(const seed of ['0','1','130','409','9223372036854775808','18446744073709551615'])for(const act of [1,2,3])for(const ascension of [0,20]){
    const expected=await reference.call({op:'encounters',seed,act,ascension}),machine=new CardMachine(program,plainCardStorage(program.initial({seed,act,ascension},1_000_000))),stop=machine.advance();
    assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Encounter generation did not finish');
    assertSameState(expected,stop.result,`encounters seed=${seed} act=${act} ascension=${ascension}`);
  }}finally{await reference.close();}
});
