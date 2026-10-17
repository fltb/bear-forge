import test from 'node:test';
import assert from 'node:assert/strict';
import { categorical } from '../src/policy.ts';
import { acceptedSamples } from '../src/trajectory.ts';

test('categorical samples represented weights reproducibly and records their actual probability',()=>{
  const logits=[0,Math.log(2),Math.log(4)];let random={state:7,position:0};const counts=[0,0,0];
  for(let i=0;i<20000;i++){
    const a=categorical(logits,random),b=categorical(logits,random);assert.deepEqual(a,b);
    counts[a.index]!++;assert.ok(Math.abs(a.logProbability-Math.log([1/7,2/7,4/7][a.index]!))<1e-12);random=a.random;
  }
  counts.forEach((n,i)=>assert.ok(Math.abs(n/20000-[1/7,2/7,4/7][i]!)<.015,JSON.stringify(counts)));
  assert.deepEqual(categorical(logits,random,false),{index:2,random,logProbability:0});
});

test('trajectory consumes accepted player observations exactly once and rejects stale/missing probabilities',()=>{
  const id={instanceId:'one',callId:'two',key:'three'};
  const row:any={status:'ended',packets:[{kind:'request',value:{id,player:'0',observation:{phase:'bidding'},options:{kind:'exact',values:[{kind:'bid',value:1}]}}}],
    decisions:[{accepted:{player:'0',reply:{requestId:id,action:{kind:'bid',value:1}}},proposal:{policyVersion:'ppo:version',encoderVersion:'card-features-v1',logProbability:0}}]};
  const encode=()=>({tokens:[[1]],actions:[[2]]});
  const samples=acceptedSamples(row,['0'],'version',encode,{'0':1},o=>o.phase);
  assert.equal(samples.length,1);assert.equal(samples[0]!.return,1);assert.equal(samples[0]!.phase,'bidding');
  assert.deepEqual(acceptedSamples({...row,status:'truncated'},['0'],'version',encode,{'0':1},o=>o.phase),[]);
  assert.throws(()=>acceptedSamples({...row,decisions:[...row.decisions,...row.decisions]},['0'],'version',encode,{'0':1},o=>o.phase),/duplicate/);
  assert.throws(()=>acceptedSamples(row,['0'],'old',encode,{'0':1},o=>o.phase),/Mixed/);
  row.decisions[0].proposal.logProbability=null;
  assert.throws(()=>acceptedSamples(row,['0'],'version',encode,{'0':1},o=>o.phase),/probability/);
});
