import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {chooseTuiSave} from '../../src/cli/sts-tui-start.ts';

function terminal(){
  const input=new PassThrough() as unknown as NodeJS.ReadStream,output=new PassThrough() as unknown as NodeJS.WriteStream;
  input.setRawMode=()=>input;Object.assign(output,{columns:100,rows:24});
  let text='';output.on('data',chunk=>{text+=chunk;});
  return {input,output,text:()=>text,key:(name:string)=>input.emit('keypress','',{name})};
}
test('launcher resumes the chosen save, refuses unavailable entries, and cleans up its terminal',async()=>{
  const t=terminal();let settled=false;
  const choice=chooseTuiSave([
    {directory:'/good',label:'继续 · 沃利贝尔 · 第2幕',available:true,savedAt:'2026-10-29',status:'playing'},
    {directory:'/bad',label:'执行中断',available:false,savedAt:'2026-10-28',status:'interrupted'},
  ],t.input,t.output).then(value=>{settled=true;return value;});
  t.key('down');t.key('return');await Promise.resolve();assert.equal(settled,false);assert.match(t.text(),/不可继续.*执行中断/);
  t.key('up');t.key('return');assert.deepEqual(await choice,{resume:'/good'});
  assert.equal(t.input.listenerCount('keypress'),0);assert.equal(t.output.listenerCount('resize'),0);
});
test('launcher offers both latest-rule characters and can exit before creating a game',async()=>{
  const first=terminal(),selected=chooseTuiSave([],first.input,first.output);first.key('return');assert.deepEqual(await selected,{character:'volibear'});
  const second=terminal(),ironclad=chooseTuiSave([],second.input,second.output);second.key('down');second.key('return');assert.deepEqual(await ironclad,{character:'ironclad'});
  const third=terminal(),cancel=chooseTuiSave([],third.input,third.output);third.key('q');assert.equal(await cancel,null);
});
