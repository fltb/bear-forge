import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {random} from '../src/rules/random.ts';
import {parseSeed} from '../src/rng.ts';
import {randomViewSchema} from '../src/rules/random.schemas.ts';
import {ReferenceClient} from './reference/client.ts';
const {defineEffect,defineEntity,sequence,spawnEntity,forEach,call,query}=rules;
const stream=defineEntity(random.exports.stream,undefined);
const entry=defineEffect<string,{values:unknown[];state:z.infer<typeof randomViewSchema>}>(b=>{
  const rng=b.local<number>(),values=b.local<unknown[]>(),integer=b.local<number>(),float=b.local<number>(),floatRange=b.local<number>(),long=b.local<bigint>(),longRange=b.local<bigint>(),boolean=b.local<boolean>(),chance=b.local<boolean>(),shuffled=b.local<readonly number[]>();
  return sequence(b.assign(rng,spawnEntity({definition:stream,owner:null,scope:0,setup:b.read(v=>parseSeed(v.input))})),b.assign(values,[]),
    forEach(Array.from({length:32},(_,i)=>i),i=>sequence(
      b.assign(integer,call(random.exports.int,{stream:rng,start:b.read(v=>-v.get(i)*7),end:b.read(v=>v.get(i)%2?2147483000:v.get(i))})),
      b.assign(float,call(random.exports.float,{stream:rng})),b.assign(floatRange,call(random.exports.floatRange,{stream:rng,start:-0.1,end:53.9})),
      b.assign(long,call(random.exports.long,{stream:rng})),b.assign(longRange,call(random.exports.longRange,{stream:rng,start:-73453n,end:9174435384759n})),
      b.assign(boolean,call(random.exports.boolean,{stream:rng})),b.assign(chance,call(random.exports.chance,{stream:rng,chance:0.33})),
      b.assign(shuffled,random.exports.shuffle({stream:rng,items:b.read(v=>Array.from({length:v.get(i)+2},(_,n)=>n))})),
      b.assign(values,b.read(v=>[...v.get(values),v.get(integer),v.get(float),v.get(floatRange),v.get(long).toString(),v.get(longRange).toString(),v.get(boolean),v.get(chance),v.get(shuffled)])),
    )),b.return({values,state:query(random.exports.current,rng)}),
  );
});
const definition=linkRules({id:'sts/random-rules-1',schemas:{setup:z.string(),result:z.object({values:z.array(z.unknown()),state:randomViewSchema}),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[random]});
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('owned RNG streams and shuffle match every C++ sample and final stream state through both Instance modes',async()=>{
  const reference=await ReferenceClient.create(),steps:Record<string,unknown>[]=[];
  for(let i=0;i<32;i++)steps.push({kind:'int',start:-i*7,end:i%2?2147483000:i},{kind:'float'},{kind:'float-range',start:-0.1,end:53.9},
    {kind:'long'},{kind:'long-range',start:'-73453',end:'9174435384759'},{kind:'bool'},{kind:'bool',chance:0.33},{kind:'shuffle',size:i+2});
  try{
    for(const controlled of [false,true]){
      const loaded=unwrap(await createCardLoader({controlled}).load(definition));
      for(const seed of ['0','1','130','9223372036854775808','18446744073709551615']){
        const expected=await reference.call({op:'random',seed,steps}),instance=unwrap(await loaded.core.start(seed));
        try{const stop=unwrap(await instance.inspect());assert.deepEqual(stop.kind==='done'?stop.result:stop,expected,`seed=${seed} controlled=${controlled}`);}
        finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
      }
    }
  }finally{await reference.close();}
});
