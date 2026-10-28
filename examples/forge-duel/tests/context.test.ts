import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileEntry } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '@bear-forge/runtime-controlled/execution';
import { baseDeck } from '../src/index.ts';

test('real game snapshots exclude dependency initialization frames and forks reuse loaded code', async t => {
  const artifact=decode((await compileEntry(fileURLToPath(new URL('./generic/module.ts',import.meta.url)),'program')).content);
  const instance=new ProgramExecution(artifact);
  instance.start({profile:'forge-duel-v1',seed:9,first:'0',decks:{'0':baseDeck,'1':baseDeck}});
  const serializer=instance.loaded.effects.S, write=serializer.write;
  const visited=new Map();
  const retainedFunctions: string[] = [];
  let snapshot: string;
  try {
    serializer.write=(root: unknown)=>{
      const encoded=write(root,{sharedRefsMap:visited});
      for(const value of visited.keys()) if(value&&typeof value==='object'
        &&serializer.getObjectDescriptor(value)?.name==='runtime.ContextFrame') {
        retainedFunctions.push(instance.loaded.effects.stateOf(value).meta.origName);
      }
      return encoded;
    };
    snapshot=instance.snapshot();
  } finally {serializer.write=write;}
  const frames=[...visited.keys()].filter(value=>value&&typeof value==='object'
    &&serializer.getObjectDescriptor(value)?.name==='runtime.ContextFrame');
  // Only the live entry → invoke → game → repeat → invoke → decision →
  // invoke → publish → request chain may survive. Module/dependency setup
  // activations must not appear; an arbitrary larger frame cap would hide them.
  assert.deepEqual(retainedFunctions.sort(), ['invoke','invoke','invoke','repeat','request','publishEvents','decisionTurn','resolveGame','runGame'].sort());
  assert.ok(Buffer.byteLength(snapshot)<1_500_000,'dependency initialization graph must not return');
  const initializations=instance.loaded.statistics.initializations;
  const samples: Record<string,number[]>={fork:[],save:[],restore:[]};
  for(let i=0;i<9;i++){
    let begin=performance.now();const branch=instance.fork();samples.fork!.push(performance.now()-begin);
    begin=performance.now();const saved=instance.snapshot();samples.save!.push(performance.now()-begin);
    const restored=instance.fresh();begin=performance.now();restored.restore(saved);samples.restore!.push(performance.now()-begin);
    assert.strictEqual(branch.loaded,instance.loaded);
    assert.strictEqual(restored.loaded,instance.loaded);
    branch.resume(null);restored.resume(null);
    assert.deepEqual(branch.io.callData,restored.io.callData);
    branch.dispose();restored.dispose();
  }
  assert.equal(instance.loaded.statistics.initializations,initializations);
  const medians=Object.fromEntries(Object.entries(samples).map(([name,values])=>[name,values.slice(2).sort((a,b)=>a-b)[3]]));
  t.diagnostic(JSON.stringify({snapshotBytes:Buffer.byteLength(snapshot),retainedFrames:frames.length,warmMedianMs:medians}));
  instance.dispose();
});
