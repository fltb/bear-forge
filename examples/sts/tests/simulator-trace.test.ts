import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deserialize} from 'node:v8';
function gameplayContext(bytes:Uint8Array){const value=deserialize(bytes);if(value.state.kind==='call'){assert.equal(typeof value.state.callId,'string');value.state.callId='<independent-host-call-id>';}return value;}
import {createSimulator} from '../src/simulator.ts';
import {openSimulatorStore} from '../src/simulator-store.ts';
import {openJsonlTrace,observeTrace,traceText,type SimulatorTrace} from '../src/simulator-trace.ts';
import {describeAction} from '../src/presentation.ts';

test('production trace on/off: every committed Context (including RNG), public state and real death identical',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sts-trace-'));
  const path=join(root,'run.jsonl'),sink=await openJsonlTrace(path);
  const stores=await Promise.all(['off','on'].map(n=>openSimulatorStore(join(root,n),'new')));
  const sessions=await Promise.all(stores.map((store,i)=>createSimulator({store,setup:{seed:'574853884',character:'volibear'},...(i?{trace:sink}:{})})));
  try{
    let steps=0;
    for(;;){
      const [a,b]=await Promise.all(sessions.map(s=>s.observe()));
      assert.deepEqual(a!.state.observation,b!.state.observation);
      assert.deepEqual(a!.state.result,b!.state.result);
      const saves=await Promise.all(stores.map(s=>s.read()));
      // Full saved graph comparison covers hidden order, RNG and continuation;
      // only the independently assigned outer host call UUID is normalized,
      // not merely equal player HP or coincidentally equal visible outcomes.
      assert.deepEqual(gameplayContext(saves[0]!.context),gameplayContext(saves[1]!.context));
      assert.deepEqual(a!.events.map(e=>e.event),b!.events.map(e=>e.event));
      if(!a!.state.request){assert.equal(a!.state.termination,'death');break;}
      assert.ok(steps<40,'isolated fixture must actually terminate');
      const request=a!.state.request;assert.equal(request.options.kind,'exact');if(request.options.kind!=='exact')throw Error('exact');
      const o=a!.state.observation;
      const kind=o.battle?'end-turn':o.game.screen==='REWARDS'?'leave':o.game.screen==='MAP_SCREEN'?'travel':'neow';
      const attack=o.battle&&o.battle.turn<=3?request.options.values.find(v=>describeAction(o,(v as {bits:number}).bits).kind==='play-card'):undefined;
      const action=attack??request.options.values.find(v=>describeAction(o,(v as {bits:number}).bits).kind===kind);assert.ok(action);
      for(const [i,session] of sessions.entries()){
        const batch=i?b!:a!;
        const command:import('../src/simulator.types.ts').SimulatorCommand={id:'paired-'+steps,sessionId:batch.state.sessionId,revision:batch.revision,action};
        const response=await session.act(command);assert.ok(response.accepted&&response.saved);
        if(i===1){assert.ok((await session.act(command)).accepted);assert.equal((await session.observe()).revision,batch.revision+1);}
      }
      steps++;
    }
    const terminal=await sessions[1]!.observe();
    await sessions[1]!.close();
    const rows=(await readFile(path,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
    assert.equal(rows[0].kind,'header');assert.equal(rows[0].setup.seed,'574853884');
    assert.equal(rows.filter(r=>r.kind==='command').length,steps,'duplicate retry is not a second execution');
    assert.equal(rows.filter(r=>r.kind==='boundary').length,steps+1);
    const events=rows.filter(r=>r.kind==='event');
    assert.equal(events.length,terminal.cursor);
    assert.deepEqual(events.map(e=>e.sequence),Array.from({length:events.length},(_,i)=>i+1));
    const committed=rows.filter(r=>r.kind==='commit').at(-1);
    assert.equal(committed.contextSha256,createHash('sha256').update((await stores[0]!.read()).context).digest('hex'));
    assert.ok(events.some(r=>r.event.type==='card-play'));assert.ok(events.some(r=>r.event.type==='damage'));assert.ok(events.some(r=>r.event.type==='draw'));
    assert.ok(traceText(committed).includes('contextSha256'));
    await assert.rejects(openJsonlTrace(path),/EEXIST/,'never overwrite a trace or a save');
    // Resume only the latest saved fixture; no replay or original initialization.
    const resumedRows:Record<string,unknown>[]=[];
    const resumed=await createSimulator({store:await openSimulatorStore(join(root,'on'),'resume'),resume:true,trace:{write:r=>{resumedRows.push(r);}}});
    try{assert.deepEqual((await resumed.observe()).state.observation,terminal.state.observation);assert.equal(resumedRows[0]!.setup,null);assert.equal(resumedRows[1]!.kind,'resume-boundary');assert.equal(resumedRows.some(r=>r.kind==='event'),false);}finally{await resumed.close();}
  }finally{for(const s of sessions)await s.close();await rm(root,{recursive:true,force:true});}
});

test('sink write/close failures and hostile mutation cannot alter gameplay or saved Context',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sts-trace-failure-'));
  let calls=0,closed=0;
  const sink:SimulatorTrace={write(record){calls++;record.kind='mutated';if(calls===3)throw Error('disk full');},close(){closed++;throw Error('close failed');}};
  const stores=await Promise.all(['off','on'].map(n=>openSimulatorStore(join(root,n),'new')));
  const sessions=await Promise.all(stores.map((store,i)=>createSimulator({store,setup:{seed:'130'},...(i?{trace:sink}:{})})));
  try{
    for(let n=0;n<3;n++){
      const a=await sessions[0]!.observe(),b=await sessions[1]!.observe();assert.deepEqual(a.state.observation,b.state.observation);
      const request=a.state.request!;if(request.options.kind!=='exact')throw Error('exact');
      for(const [i,s] of sessions.entries()){const v=i?b:a;assert.ok((await s.act({id:'step'+n,sessionId:v.state.sessionId,revision:v.revision,action:request.options.values[0]})).accepted);}
      assert.deepEqual(gameplayContext((await stores[0]!.read()).context),gameplayContext((await stores[1]!.read()).context));
    }
    assert.equal(calls,3);assert.match(sessions[1]!.traceStatus().error!,/disk full/);
  }finally{for(const s of sessions)await s.close();assert.equal(closed,1);await rm(root,{recursive:true,force:true});}
});

test('disabled observer does not even build a record',async()=>{
  const trace=observeTrace(undefined);await trace.write(()=>{throw Error('must not be read');});assert.equal(trace.status().records,0);
});
