import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once,EventEmitter} from 'node:events';
import {deserialize} from 'node:v8';
import {bindTuiShutdown} from '../../src/cli/sts-tui-lifecycle.ts';
import type {SimulatorSave} from '../../src/simulator.types.ts';

test('shutdown bindings route terminal transport and signals and remove all listeners',()=>{
  const input=new EventEmitter(),output=new EventEmitter(),calls:boolean[]=[];
  const previous=process.listenerCount('SIGHUP'),cleanup=bindTuiShutdown(input,output,lost=>calls.push(lost));
  input.emit('end');input.emit('close');input.emit('error',Error('gone'));output.emit('error',Error('pipe'));
  process.emit('SIGHUP','SIGHUP');process.emit('SIGTERM','SIGTERM');process.emit('SIGINT','SIGINT');
  assert.deepEqual(calls,[true,true,true,true,true,false,false]);cleanup();
  assert.equal(process.listenerCount('SIGHUP'),previous);assert.equal(input.listenerCount('close'),0);assert.equal(output.listenerCount('error'),0);
});

for(const exit of ['q','ctrl-c','SIGTERM','SIGHUP','EOF','during-action','during-save','save-failure','startup-hangup'] as const)test(`real TUI ${exit} commits and releases its save directory`,{timeout:30000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-tui-exit-'));
  const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./tui-lifecycle-fixture.ts',import.meta.url)),dir,...(exit.startsWith('during-')?['busy-quit']:exit==='startup-hangup'?['startup-hangup']:[])],{stdio:['pipe','pipe','pipe','ipc']});
  let output='',errors='';child.stdout!.on('data',chunk=>{output+=chunk;});child.stderr!.on('data',chunk=>{errors+=chunk;});
  try{
    const closed=once(child,'close');
    const [ready]=await once(child,'message');assert.equal(ready,exit==='startup-hangup'?'startup':'ready');
    if(exit==='q')child.stdin!.write('q');
    else if(exit==='ctrl-c')child.stdin!.write('\x03');
    else if(exit==='EOF')child.stdin!.end();
    else if(exit==='startup-hangup')child.kill('SIGHUP');
    else if(exit==='during-action')child.stdin!.write('\r');
    else if(exit==='during-save')child.stdin!.write('s');
    else if(exit==='save-failure'){
      await rename(join(dir,'current.sts'),join(dir,'original.sts'));await mkdir(join(dir,'current.sts'));
      const failed=once(child,'message');child.stdin!.write('q');
      const [message]=await failed;assert.equal(message,'save-failed');assert.equal(child.exitCode,null);
      await rm(join(dir,'current.sts'),{recursive:true});await rename(join(dir,'original.sts'),join(dir,'current.sts'));
      child.stdin!.write('q');
    }
    else child.kill(exit);
    const [code,signal]=await closed;assert.equal(code,0,errors);assert.equal(signal,null);
    const save=deserialize(await readFile(join(dir,'current.sts'))) as SimulatorSave;
    const pending=JSON.parse(await readFile(join(dir,'pending.json'),'utf8'));
    assert.equal(save.format,2);assert.equal(save.revision,pending.revision);assert.equal(save.sessionId,pending.sessionId);
    if(exit==='during-action')assert.equal(save.revision,1);
    await assert.rejects(readFile(join(dir,'owner.lock')),/ENOENT/);
    if(exit!=='SIGHUP'&&exit!=='EOF'&&exit!=='startup-hangup')assert.match(output,/已保存退出/);
  }finally{child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
