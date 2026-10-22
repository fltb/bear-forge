import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {ReferenceClient} from './reference/client.ts';
import {parseSeed,randomState,randomInt,randomLong,randomLongRange,randomFloat,randomBoolean,javaShuffle,rngView} from '../src/rng.ts';

test('all source RNG methods and Java shuffle match C++ values, calls and state at uint64 boundaries',async()=>{
  const ref=await ReferenceClient.create();
  try {
    for(const seed of ['0','1','130','9223372036854775808','18446744073709551615']) {
      const rng=randomState(parseSeed(seed));const steps:Record<string,unknown>[]=[],values:unknown[]=[];
      for(let i=0;i<32;i++) {
        const start=-i*7,end=i%2?2147483000:i;
        steps.push({kind:'int',start,end});values.push(randomInt(rng,start,end));
        steps.push({kind:'float'});values.push(randomFloat(rng));
        steps.push({kind:'float-range',start:-0.1,end:53.9});values.push(randomFloat(rng,-0.1,53.9));
        steps.push({kind:'long'});values.push(randomLong(rng).toString());
        steps.push({kind:'long-range',start:'-73453',end:'9174435384759'});values.push(randomLongRange(rng,-73453n,9174435384759n).toString());
        steps.push({kind:'bool'});values.push(randomBoolean(rng));
        steps.push({kind:'bool',chance:0.33});values.push(randomBoolean(rng,0.33));
        const size=i+2,xs=Array.from({length:size},(_,k)=>k);
        steps.push({kind:'shuffle',size});javaShuffle(xs,randomLong(rng));values.push(xs);
      }
      const actual=await ref.call<{values:unknown[];state:ReturnType<typeof rngView>}>({op:'random',seed,steps});
      assert.deepEqual(values,actual.values,`seed=${seed}`);assert.deepEqual(rngView(rng),actual.state,`seed=${seed} state`);
    }
  }finally{await ref.close();}
});

test('seed input is lossless and invalid ranges are rejected before consuming RNG',()=>{
  assert.equal(parseSeed('18446744073709551615'),0xffffffffffffffffn);
  for(const s of ['-1','1.2','18446744073709551616','0x80',''])assert.throws(()=>parseSeed(s));
  const r=randomState(1n),before=rngView(r);
  assert.throws(()=>randomInt(r,4,3));assert.deepEqual(rngView(r),before);
});
