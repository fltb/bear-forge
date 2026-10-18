import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentFiles } from '@bear-forge/forge-duel/experiment/execution';
import { createEvidenceServer } from '../src/server.ts';
test('readonly evidence API separates private player packets and audit facts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bear-view-')),
    files = new ExperimentFiles(dir);
  await files.commit('test', {
    id: 'test',
    input: {
      id: 'test', phase: 'discovery', block: 0, seed: 1,
      seat: '0', policy: 'first', opponent: 'last', replacement: 0, support: 0,
      decks: { '0': [], '1': [] }
    },
    attempt: 1,
    policy: {},
    cost: { milliseconds: 0, steps: 0 },
    status: 'ended',
    decisions: [],
    result: {
      scores: {
        '0': 1,
        '1': 0
      }
    },
    packets: [{
      player: '0',
      value: 'private0'
    }, {
      player: '1',
      value: 'private1'
    }],
    facts: [{
      secret: 'audit'
    }]
  });
  const server = createEvidenceServer(dir);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const addr = server.address() as any,
      base = 'http://127.0.0.1:' + addr.port;
    const p = await (await fetch(base + '/api/evidence?task=test&player=0')).json();
    assert.deepEqual(p.values, [{
      player: '0',
      value: 'private0'
    }]);
    const audit = await (await fetch(base + '/api/evidence?task=test&player=audit')).json();
    assert.equal(audit.scope, 'analysis-audit');
    assert.equal((await fetch(base + '/api/evidence?task=test&player=unknown')).status, 400);
    assert.equal((await fetch(base + '/api/tasks', {
      method: 'POST'
    })).status, 405);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test('task and evidence pages are complete, bounded and retain only the selected player', async () => {
  const {rm} = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'bear-view-pages-'));
  const files = new ExperimentFiles(dir);
  for (let i = 0; i < 201; i++) {
    const id = String(i).padStart(3,'0');
    await files.commit(id, {
      id,input:{id,seat:'0'},attempt:1,policy:{},status:'ended',result:{scores:{'0':1,'1':0}},
      cost:{milliseconds:0,steps:0},
      facts:i ? [] : Array.from({length:205},(_,index)=>({key:String(index),index})),
      packets:i ? [] : Array.from({length:205},(_,index)=>[
        {player:'0',value:{index}},{player:'1',value:{secret:index}}
      ]).flat(),
      decisions:i ? [] : Array.from({length:205},(_,index)=>({
        step:index,accepted:{player:'0',reply:{requestId:String(index),type:'action',action:{index}}},
        proposal:{policyVersion:'first',encoderVersion:'json',logProbability:0}
      }))
    } as any);
  }
  const server = createEvidenceServer(dir);
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  const read = async (path: string) => {
    const response = await fetch(base+path);
    assert.equal(response.status,200);
    return response.json();
  };
  try {
    const first = await read('/api/tasks'), last = await read('/api/tasks?after=200');
    assert.equal(first.values.length,200);assert.equal(first.next,200);
    assert.equal(last.values.length,1);assert.equal(last.next,null);
    assert.deepEqual([...first.values,...last.values].map((row: any)=>row.id),
      Array.from({length:201},(_,i)=>String(i).padStart(3,'0')));
    const packets: unknown[] = [], transitions: any[] = [], facts: unknown[] = [];
    for (const offset of [0,100,200]) {
      const page = await read('/api/evidence?task=000&player=0&after='+offset);
      assert.equal(page.values.length,offset===200?5:100);
      assert.deepEqual(page.trajectory.packets,page.values);
      assert.equal(page.trajectory.transitions.length,page.values.length);
      assert.ok(page.values.every((p: any)=>p.player==='0'&&!('secret' in p.value)));
      assert.equal(page.next,offset===200?null:offset+100);
      packets.push(...page.values);transitions.push(...page.trajectory.transitions);
      const audit = await read('/api/evidence?task=000&player=audit&after='+offset);
      assert.equal(audit.trajectory,null);assert.equal(audit.scope,'analysis-audit');facts.push(...audit.values);
    }
    assert.equal(packets.length,205);assert.equal(facts.length,205);
    assert.deepEqual(transitions.map(t=>t.action.index),Array.from({length:205},(_,i)=>i));
    assert.equal(transitions.filter(t=>t.terminal).length,1);
    assert.equal(transitions.at(-1).reward,1);
    for (const offset of ['-1','0.5','NaN','9007199254740992']) {
      assert.equal((await fetch(base+'/api/tasks?after='+offset)).status,400);
      assert.equal((await fetch(base+'/api/evidence?task=000&player=0&after='+offset)).status,400);
    }
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(dir,{recursive:true,force:true});
  }
});
test('evaluation API reports planned batch tasks and condition-specific evidence through existing endpoints',async()=>{
  const {rm}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'bear-evaluation-view-'));
  const files=new ExperimentFiles(dir);
  const report={experimentId:'evaluation',stage:'confirmation',plannedGames:512,maxGames:1024,trainingSamples:0,reason:'candidates-frozen',matrix:[{variant:'candidate',policy:'rule',opponent:'control',score:0.6}],relations:[]};
  await files.write('registration',{config:{id:'evaluation',policies:['rule'],opponents:[{id:'control',policy:'rule'}]},tasks:[]});
  await files.write('analysis',report);
  await files.write('evaluation-state',{pending:{phase:'confirmation'}});
  const server=createEvidenceServer(dir);
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
    const base='http://127.0.0.1:'+(server.address() as any).port;
    const progress=await(await fetch(base+'/api/experiment')).json();
    assert.equal(progress.total,512);assert.equal(progress.evaluation,true);assert.equal(progress.completed,0);
    assert.deepEqual(await(await fetch(base+'/api/relations')).json(),report);
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
