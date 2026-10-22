import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSts} from '../src/sts.ts';
import {createInteractiveSession} from '../../../examples/sts/src/interactive-session.ts';

test('interactive decisions reject stale/illegal actions and observe never advances',async()=>{
  const session=await createInteractiveSession({character:'volibear',seed:'130',sessionId:'fixture',review:true,onEvent:()=>{}});
  try{
    const before=await session.observe();assert.equal(before.kind,'decision');if(before.kind!=='decision')throw Error('Expected initial decision');
    const action=0;
    for(const command of [
      {op:'act' as const,sessionId:'wrong',decision:0,action,reason:'fixture'},
      {op:'act' as const,sessionId:'fixture',decision:1,action,reason:'fixture'},
      {op:'act' as const,sessionId:'fixture',decision:0,action:0xffffffff,reason:'fixture'},
      {op:'act' as const,sessionId:'fixture',decision:0,action,reason:''},
    ])assert.equal((await session.act(command)).accepted,false);
    assert.deepEqual(await session.observe(),before);
    const accepted=await session.act({op:'act',sessionId:'fixture',decision:0,action:1,reason:'Fixed acceptance fixture: choose Neow max HP; no strategy evaluation'});
    assert.equal(accepted.accepted,true);
    const after=await session.observe();assert.equal(after.kind,'decision');
    if(after.kind==='decision'){assert.equal(after.record.decision,1);assert.equal(after.record.observation.game.screen,'MAP_SCREEN');}
  }finally{await session.close();}
});

for(const character of ['volibear','ironclad'])test(`CLI ${character} initial observation and quit archive as aborted`,async()=>{
  const out=await mkdtemp(join(tmpdir(),'sts-cli-'));let text='';
  const output=new Writable({write(chunk,_encoding,callback){text+=String(chunk);callback();}});
  try{
    await runSts(['--character',character,'--seed','130','--out',out],Readable.from(['{"op":"observe"}\n{"op":"quit"}\n']),output);
    const records=text.trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(records[0].kind,'decision');assert.equal(records[0].observation.game.ascension,20);
    assert.equal(records[1].decision,0);assert.deepEqual(records[0].presentation.actions,records[1].presentation.actions);
    const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(summary.status,'aborted');assert.equal(summary.termination,'quit');assert.equal(summary.decisions,0);
    for(const file of ['run.json','decisions.jsonl','events.jsonl','maps.json'])await readFile(join(out,file));
    await assert.rejects(runSts(['--out',out],Readable.from([]),output),/empty/);
  }finally{await rm(out,{recursive:true,force:true});}
});

test('CLI EOF is an abort rather than a death',async()=>{
  const out=await mkdtemp(join(tmpdir(),'sts-eof-'));
  try{
    await runSts(['--out',out],Readable.from([]),new Writable({write(_c,_e,done){done();}}));
    const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(summary.status,'aborted');assert.equal(summary.termination,'eof');
  }finally{await rm(out,{recursive:true,force:true});}
});

test('terminal numeric choice uses the same session and requires a reason',async()=>{
  const out=await mkdtemp(join(tmpdir(),'sts-terminal-'));let text='';
  try{
    await runSts(['play','--character','volibear','--ascension','20','--seed','130','--output',out,'--interface','terminal'],Readable.from(['1\n1 Fixed Neow max HP fixture\nquit\n']),new Writable({write(c,_e,done){text+=String(c);done();}}));
    assert.match(text,/nonempty reason/);assert.match(text,/MAP_SCREEN/);
    const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(summary.decisions,1);assert.equal(summary.status,'aborted');
    const run=JSON.parse(await readFile(join(out,'run.json'),'utf8'));assert.equal(run.status,'aborted');assert.equal(run.termination,'quit');
    assert.ok((await readFile(join(out,'source.patch'),'utf8')).includes('interactive-session'));
  }finally{await rm(out,{recursive:true,force:true});}
});

test('CLI signal archives an interrupted session without a death',async()=>{
  const out=await mkdtemp(join(tmpdir(),'sts-signal-'));
  const child=spawn(process.execPath,['--experimental-strip-types','packages/cli/src/sts.ts','play','--character','volibear','--ascension','20','--seed','130','--output',out,'--interface','jsonl'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),stdio:['pipe','pipe','pipe']});
  try{
    let text='';await new Promise<void>((done,reject)=>{
      child.stdout.on('data',chunk=>{text+=String(chunk);if(text.includes('"kind":"decision"'))done();});child.once('error',reject);child.once('exit',code=>reject(Error('Unexpected early exit '+code)));
    });
    const exited=new Promise<number|null>(done=>child.once('exit',done));child.kill('SIGTERM');assert.equal(await exited,0);
    const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(summary.status,'aborted');assert.equal(summary.termination,'SIGTERM');assert.equal(summary.decisions,0);
  }finally{child.kill('SIGKILL');await rm(out,{recursive:true,force:true});}
});

test('CLI rejects duplicate aliases and missing flag values',async()=>{
  const output=new Writable({write(_c,_e,done){done();}});
  for(const args of [['--seed','1','--seed','2'],['--output','x','--out','y'],['--interface','jsonl','--mode','terminal'],['--seed'],['--seed','--output','x']])await assert.rejects(runSts(args,Readable.from([]),output),/Duplicate|explicit values/);
});

test('non-review terminal permits an explicit numeric choice without reason',async()=>{
  const out=await mkdtemp(join(tmpdir(),'sts-casual-'));
  try{
    await runSts(['play','--output',out,'--interface','terminal','--review','false'],Readable.from(['1\nquit\n']),new Writable({write(_c,_e,done){done();}}));
    const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(summary.decisions,1);assert.equal(summary.status,'aborted');
  }finally{await rm(out,{recursive:true,force:true});}
});

test('source provenance failure is archived as fault before loading a game',async()=>{
  const out=await mkdtemp(join(tmpdir(),'sts-provenance-')),bin=await mkdtemp(join(tmpdir(),'sts-fakegit-'));
  const previousPath=process.env.PATH,previousExitCode=process.exitCode;
  try{
    await writeFile(join(bin,'git'),'#!/bin/sh\nexit 1\n',{mode:0o755});process.env.PATH=bin+':'+previousPath;
    await runSts(['play','--output',out],Readable.from([]),new Writable({write(_c,_e,done){done();}}));
    const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(summary.status,'fault');assert.equal(summary.decisions,0);assert.match(summary.result.message,/source provenance/);
    assert.equal(JSON.parse(await readFile(join(out,'run.json'),'utf8')).status,'fault');
  }finally{if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;process.exitCode=previousExitCode;await rm(out,{recursive:true,force:true});await rm(bin,{recursive:true,force:true});}
});
