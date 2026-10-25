import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchAccounting,randomInt} from '../src/index.ts';
import {searchEntropyWord} from '../src/search/entropy.ts';

test('search entropy mixes low bits while retaining one exact restorable cursor step per word',()=>{
  let cursor={state:18273,position:0};const bits:number[]=[],saved={...cursor};
  for(let i=0;i<64;i++){const before={...cursor},word=searchEntropyWord(cursor),raw=randomInt(cursor,2**32);assert.deepEqual(cursor,before);assert.deepEqual(word.random,raw.random);assert.ok(Number.isInteger(word.value)&&word.value>=0&&word.value<2**32);bits.push(word.value&1);cursor=word.random;}
  assert.ok(bits.some((bit,i)=>i>0&&bit===bits[i-1]),'small choices must not inherit the LCG alternating low bit');
  assert.ok(bits.includes(0)&&bits.includes(1));assert.equal(cursor.position,64);
  const a=searchEntropyWord(saved),b=searchEntropyWord({...saved});assert.deepEqual(a,b);
});


test('search accounting includes failed work and cleanup without imposing a search allowance',async()=>{
  let time=0,rss=100;const accounting=new SearchAccounting(()=>time,()=>rss);
  assert.equal(await accounting.measure(async()=>{time+=7;rss=200;return 3;},'current'),3);
  await assert.rejects(accounting.measure(async()=>{time+=2;throw Error('original-rule-fault');},'advance'),/original-rule-fault/);
  accounting.measureSync(()=>{time+=3;rss=80;},'cleanup');
  assert.deepEqual(accounting.cost(),{milliseconds:12,peakRssBytes:200,longestSegmentMilliseconds:7,
    phases:{current:{calls:1,milliseconds:7},advance:{calls:1,milliseconds:2},cleanup:{calls:1,milliseconds:3}}});
  time+=120_000;
  assert.equal(accounting.measureSync(()=>41,'advance'),41,'old cumulative timing thresholds have no control over execution');
  assert.equal(accounting.cost().milliseconds,120_012);
});

test('accounting snapshots are detached and nested phase times are not summed into total cost',()=>{
  let time=0;const accounting=new SearchAccounting(()=>time,()=>1);
  accounting.measureSync(()=>{time++;accounting.measureSync(()=>{time+=2;},'inner');time++;},'outer');
  const before=accounting.cost();assert.equal(before.milliseconds,4);assert.equal(before.phases.outer!.milliseconds,4);assert.equal(before.phases.inner!.milliseconds,2);
  before.phases.outer!.milliseconds=0;assert.equal(accounting.cost().phases.outer!.milliseconds,4);
  assert.throws(()=>accounting.measureSync(()=>{time+=5;throw Error('sync failure');},'inner'),/sync failure/);
  assert.equal(accounting.cost().phases.inner!.calls,2);assert.equal(accounting.cost().phases.inner!.milliseconds,7);
});
