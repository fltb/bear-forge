import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedMean,effectStatus} from '../src/index.ts';
test('bounded blocks retain uncertainty for all wins and constant paired effects',()=>{
  const small=boundedMean(Array(64).fill(0),-1,1);
  assert.ok(small.interval![0]<0&&small.interval![1]>0);
  assert.equal(effectStatus(small.interval,0.03),'unknown');
  assert.equal(effectStatus(boundedMean(Array(2048).fill(0),-1,1).interval,0.03),'equivalent');
  assert.equal(effectStatus(boundedMean(Array(2048).fill(1),-1,1).interval,0.03),'positive');
  assert.equal(effectStatus(boundedMean(Array(2048).fill(-1),-1,1).interval,0.03),'negative');
  assert.equal(effectStatus(boundedMean(Array(2048).fill(1),-1,1).interval,0.03,1),'unknown');
  assert.throws(()=>boundedMean([2],-1,1));
  assert.throws(()=>boundedMean([NaN],-1,1));
});
test('family correction widens bounds and paired variance uses n-1',()=>{
  const a=boundedMean([-1,1],-1,1);
  assert.equal(a.variance,2);
  const values=Array.from({length:1000},(_,i)=>i%2?0.5:0);
  const single=boundedMean(values,-1,1,0.05),family=boundedMean(values,-1,1,0.005);
  assert.ok(family.interval![0]<single.interval![0]);
  assert.ok(family.interval![1]>single.interval![1]);
});
