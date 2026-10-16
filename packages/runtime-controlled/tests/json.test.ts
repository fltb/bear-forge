import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution,decode} from '../src/execution.ts';

test('JSON.parse input-work budget survives IO, fork and restore even if parse error is caught',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    if(setup.method==='noop')return setup.source.length>0;
    try{return JSON.parse(setup.source);}catch{return 'caught';}
  }};`).content);
  for(const source of [' '.repeat(409600)+'null',' '.repeat(409600)+'?']){
    const baseline=new ProgramExecution(artifact,1_000_000);
    baseline.start({method:'noop',source});baseline.resume(null);
    assert.equal(baseline.result.status,1);
    const allowance=1_000_000-(baseline as any).context.remaining+100;
    baseline.dispose();
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method:'parse',source});
    assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});
test('JSON.stringify hidden-key enumeration budget survives IO, fork and restore',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const hidden={};
    for(let index=0;index<4096;index++)Object.defineProperty(hidden,'k'+index,{value:index});
    if(setup==='noop')return true;
    try{return JSON.stringify(hidden);}catch{return 'caught';}
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start('noop');baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+64;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start('stringify');
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});
test('JSON.parse reviver replacement-key budget survives IO, fork and restore',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const hidden={};
    for(let index=0;index<2048;index++)Object.defineProperty(hidden,'k'+index,{value:index});
    if(setup==='noop')return true;
    try{return JSON.parse('{"a":1,"b":{}}',function(key,value){if(key==='a')this.b=hidden;return value;});}
    catch{return 'caught';}
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start('noop');baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+64;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start('parse');assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('JSON BigInt failure text matches V8 after IO, fork and restore',()=>{
  const expressions=['JSON.stringify(2n)','JSON.stringify({value:2n})',
    'JSON.stringify([2n])','JSON.stringify({toJSON(){return 2n;}})','JSON.stringify(Object(2n))'];
  const expected=expressions.map(expression=>{
    try{Function(expression)();return null;}
    catch(error){return [(error as Error).name,(error as Error).message];}
  });
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});const errors=[];
    ${expressions.map(expression=>`try{${expression}}catch(error){errors.push([error.name,error.message])}`).join(';')}
    return errors;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const current of [parent,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,expected);
  }
});

test('JSON circular error path matches V8 after IO, fork and restore',async()=>{
  async function run(_setup:unknown,io:any){
    const parent:any={child:{}};
    let reads=0;
    Object.defineProperty(parent.child,'back',{enumerable:true,get(){reads++;return parent;}});
    const marker=await io.call({port:'step',input:null});
    try{JSON.stringify(parent);return null;}
    catch(error){return {marker,reads,name:(error as Error).name,message:(error as Error).message};}
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,current] of [parent,fork,restored].entries()){
    const marker=index+1,expected=await run(null,{call:async()=>marker});
    current.resume(marker);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,expected);
  }
});

test('JSON hooks and captured root holders remain ordinary program state across IO/fork/restore',async()=>{
  async function run(_setup:unknown,io:any){
    const trace:unknown[]=[];
    let count=2,holder:any;
    const source={toJSON(key:string){
      trace.push(['toJSON',key,this===source]);
      return {get answer(){trace.push('answer');return count;},array:[count,undefined],boxed:new Number(count)};
    }};
    function replacer(this:any,key:string,value:unknown){if(key==='')holder=this;trace.push(['replace',key]);return value;}
    const spacing=new Number(2);spacing.valueOf=()=>{trace.push('spacing');return 2;};
    const before=JSON.stringify(source,replacer,spacing as any);
    const savedHolder=holder;
    count=await io.call({port:'step',input:before});
    const alias=savedHolder['']===source;
    const after=JSON.stringify(source,replacer,spacing as any);
    const filtered=JSON.stringify(source,['answer','boxed'],spacing as any);
    return {before,after,filtered,alias,trace};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
  for(const [index,instance]of[parent,fork,restored].entries()){
    const reply=index+5,expected=await run(null,{call:async()=>reply});
    instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

test('parsed values, source contexts and retained reviver holders preserve aliases across IO/fork/restore',async()=>{
  async function run(_setup:unknown,io:any){
    const trace:unknown[]=[],contexts:any[]=[];
    let holder:any;
    const parsed=JSON.parse('{"a":0,"b":{"x":1e2},"c":{"x":1e2}}',function(this:any,key:string,value:any,context?:any){
      trace.push([key,context]);contexts.push(context);
      if(key==='a')this.b=this.c;
      if(key==='')holder=this;
      return value;
    });
    const reply=await io.call({port:'step',input:trace});
    parsed.c.x=reply;
    return {trace,contexts,parsed,holderAlias:holder['']===parsed,shared:parsed.b===parsed.c};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
  for(const [index,instance]of[parent,fork,restored].entries()){
    const reply=index+5,expected=await run(null,{call:async()=>reply});instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);
  }
});

test('toJSON intrinsic iterator calls use the resumable adapters before invoking replacers',async()=>{
  for(const expression of ['[1,2]','new Map([[1,2],[3,4]])','new Set([1,2])']){
    const body=`let cursor; const source=${expression}; source.toJSON=source[Symbol.iterator];
      const text=JSON.stringify(source,(key,value)=>{if(key==='')cursor=value;return value;});
      const first=cursor.next(); await io.call({port:'step',input:first});
      return {text,first,second:cursor.next(),last:cursor.next()};`;
    const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){${body}}};`).content);
    const parent=new ProgramExecution(artifact);parent.start(null);
    assert.equal(parent.result.status,0,String(parent.result.value));
    const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
    const native=new Function(`"use strict";return async function(_,io){${body}}`)();
    const expected=await native(null,{call:async()=>null});
    for(const instance of [parent,fork,restored]){
      instance.resume(null);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);
    }
  }
});
