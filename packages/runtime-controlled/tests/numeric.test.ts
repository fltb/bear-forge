import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution, decode} from '../src/execution.ts';

test('large primitive arithmetic work exhausts budget after IO, fork and restore',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(method,io){
    const text='x'.repeat(204800),otherText=text.slice(0,-1)+'a',big=1n<<204800n,other=big+1n;
    const list=[big],map=new Map([[big,1]]),set=new Set([big]);
    const textList=[text],textMap=new Map([[text,1]]),textSet=new Set([text]);
    await io.call({port:'step',input:null});
    if(method==='noop')return true;
    if(method==='asUintN')BigInt.asUintN(409600,-1n);
    if(method==='pow')2n**409600n;
    if(method==='shift')1n<<409600n;
    if(method==='addBig')big+big;
    if(method==='addText')text+text;
    if(method==='template')\`\${text}\${text}\`;
    if(method==='compare')big===other;
    if(method==='objectIs')Object.is(big,other);
    if(method==='includes')list.includes(other);
    if(method==='mapHas')map.has(other);
    if(method==='setHas')set.has(other);
    if(method==='compareText')text===otherText;
    if(method==='looseText')text==otherText;
    if(method==='objectIsText')Object.is(text,otherText);
    if(method==='includesText')textList.includes(otherText);
    if(method==='mapHasText')textMap.has(otherText);
    if(method==='setHasText')textSet.has(otherText);
    if(method==='sortText')[otherText,text].sort();
    if(method==='toSortedText')[otherText,text].toSorted();
    if(method==='propertyKey')({})[big];
    if(method==='switchBig'){switch(big){case other:return false;default:break;}}
    if(method==='switchText'){switch(text){case otherText:return false;default:break;}}
    return true;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start('noop');baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+20;
  baseline.dispose();
  for(const method of ['asUintN','pow','shift','addBig','addText','template','compare',
    'objectIs','includes','mapHas','setHas','compareText','looseText','objectIsText','includesText','mapHasText','setHasText',
    'sortText','toSortedText','propertyKey','switchBig','switchText']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start(method);assert.equal(parent.result.status,0,method);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,method);
      assert.notEqual(instance.result.status,1,method);
      instance.dispose();
    }
  }
});

test('switch matching preserves V8 case evaluation, fallthrough and object identity after IO',()=>{
  const select=(kind:string)=>{
    const trace:string[]=[];
    const discriminant=kind==='identity'?{[Symbol.toPrimitive](){trace.push('coerce');return 2;}}:
      kind==='firstMatch'?1:kind==='match'?2:kind==='lateMatch'?7:8;
    const same=kind==='identity'?discriminant:2;
    switch(discriminant){
      case (trace.push('first'),1):trace.push('A');
      case (trace.push('second'),same):trace.push('B');break;
      default:trace.push('D');
      case (trace.push('third'),7):trace.push('C');
    }
    return trace;
  };
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(kind,io){
    const trace=[];
    const discriminant=kind==='identity'?{[Symbol.toPrimitive](){trace.push('coerce');return 2;}}:
      kind==='firstMatch'?1:kind==='match'?2:kind==='lateMatch'?7:8;
    const same=kind==='identity'?discriminant:2;
    await io.call({port:'step',input:null});
    switch(discriminant){
      case (trace.push('first'),1):trace.push('A');
      case (trace.push('second'),same):trace.push('B');break;
      default:trace.push('D');
      case (trace.push('third'),7):trace.push('C');
    }
    return trace;
  }};`).content);
  for(const kind of ['identity','firstMatch','match','lateMatch','noMatch']){
    const parent=new ProgramExecution(artifact,100_000);
    parent.start(kind);assert.equal(parent.result.status,0,kind);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      instance.resume(null);
      assert.equal(instance.result.status,1,kind);
      assert.deepEqual(instance.result.value,select(kind),kind);
      instance.dispose();
    }
  }
});

test('native symbol and error text consumes budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(method,io){
    const text='x'.repeat(204800);
    await io.call({port:'step',input:null});
    if(method==='noop')return true;
    if(method==='Symbol')Symbol(text);
    if(method==='Symbol.for')Symbol.for(text);
    if(method==='Error')Error(text);
    if(method==='new Error')new Error(text);
    if(method==='AggregateError')AggregateError([],text);
    return true;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start('noop');baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+20;
  baseline.dispose();
  for(const method of ['Symbol','Symbol.for','Error','new Error','AggregateError']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start(method);assert.equal(parent.result.status,0,method);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,method);
      assert.notEqual(instance.result.status,1,method);
      instance.dispose();
    }
  }
});

test('native numeric callback results exhaust budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const value=setup.value;
    if(setup.method==='noop')return value.length>0;
    if(setup.method==='map')return new Uint8Array([1]).map(()=>value)[0];
    if(setup.method==='from')return Uint8Array.from([1],()=>value)[0];
    if(setup.method==='sort')return [2,1].sort(()=>value)[0];
    return new Uint8Array([2,1]).sort(()=>value)[0];
  }};`).content);
  const value='0'.repeat(409600);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop',value});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['map','from','sort','typedSort']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method,value});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,method);
      assert.notEqual(instance.result.status,1,method);
      instance.dispose();
    }
  }
});

test('numeric text conversion exhausts the budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const value=setup.value;
    if(setup.method==='noop')return value.length>0;
    if(setup.method==='Number')return Number(value);
    if(setup.method==='BigInt')return BigInt(value)===0n;
    if(setup.method==='parseInt')return Number.parseInt(value);
    if(setup.method==='parseFloat')return Number.parseFloat(value);
    if(setup.method==='Math')return Math.abs(value);
    if(setup.method==='unary')return +value;
    if(setup.method==='binary')return value-0;
    if(setup.method==='array')return [7].at(value);
    if(setup.method==='format')return (1).toFixed(value);
    if(setup.method==='buffer')return new ArrayBuffer(1).slice(value,1).byteLength;
    if(setup.method==='increment'){let current=value;return ++current;}
    if(setup.method==='typedLength')return new Uint8Array(value).length;
    if(setup.method==='typedIndex')return new Uint8Array([7]).at(value);
    if(setup.method==='typedElement')return new Uint8Array([value])[0];
    if(setup.method==='typedFrom')return Uint8Array.from([value])[0];
    if(setup.method==='typedOf')return Uint8Array.of(value)[0];
    if(setup.method==='typedSet'){const target=new Uint8Array(1);target.set([value]);return target[0];}
    if(setup.method==='dataView')return new DataView(new ArrayBuffer(1)).getUint8(value);
    return value==0;
  }};`).content);
  const value='0'.repeat(409600);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop',value});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['Number','BigInt','parseInt','parseFloat','Math','unary','binary','array','format','buffer','increment',
    'typedLength','typedIndex','typedElement','typedFrom','typedOf','typedSet','dataView','equality']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method,value});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,method);
      assert.notEqual(instance.result.status,1,method);
      instance.dispose();
    }
  }
});

test('numeric conversion occurs after operand evaluation and survives IO, fork and restoration', async () => {
  async function run(_input: unknown, io: any) {
    const trace: string[] = [];
    let value = 9;
    const left = {valueOf() {trace.push('left');return value;}};
    const first = (left as any) - await io.call({port:'step', input:trace.slice()});
    value = first;
    const right = {[Symbol.toPrimitive](hint: string) {trace.push('right:' + hint);return 2;}};
    const a: any = left, b: any = right;
    const results = [a-b,a*b,a/b,a%b,a**b,a<<b,a>>b,a>>>b,a&b,a|b,a^b,+a,-a,~a];
    const math = [Math.abs(a),Math.pow(a,b),Math.hypot(a,b),Math.max(a,b),Math.min(a,b),Math.imul(a,b)];
    const integer: any = {[Symbol.toPrimitive](hint: string) {trace.push('bigint:' + hint);return 257n;}};
    const formats = [Number.prototype.toFixed.call(first,b),Number.prototype.toString.call(first,b),
      BigInt.prototype.toString.call(9n,b),String.fromCharCode(a,b),String.fromCodePoint(a,b),
      BigInt.asIntN(a,integer).toString(),BigInt.asUintN(a,integer).toString()];
    const bytes = new Uint8Array(4);
    bytes.set({0:a,1:b,length:2},b);
    const typed = [new Uint8Array([a,b]),Uint8Array.from([a,b]),Uint8Array.from([a,b],value=>value),
      Uint8Array.of(a,b),bytes,new Uint8Array(bytes.buffer,b,b)].map(value=>Array.from(value));
    const viewLength = new DataView(bytes.buffer,b,b).byteLength;
    const stored = {tag:first},array:any[]=[stored,1,2];
    array.fill(stored,b,a);
    const indexes = [array.indexOf(stored,b),array.includes(stored,b),array.at(b)===stored,
      array.with(b,stored)[2]===stored,array.toSpliced(b,b,stored)[2]===stored];
    const slice = new Uint8Array([1,2,3,4]).subarray(b,a);
    const buffer = new ArrayBuffer(a),data = new DataView(buffer);
    data.setInt16(b,a,true);
    const memory = [data.getInt16(b,true),Array.from(new Uint8Array(buffer.slice(b,a))),Array.from(slice)];
    const replacement = {toString(){trace.push('replacement');return String(first);}};
    const strings = ['x,x,x'.split(',',b),'xx'.replace('x',replacement as any),
      'xx'.replaceAll('x',replacement as any),'xx'.replace('missing',replacement as any)];
    let local: any = left;
    local *= b;
    const holder: any = {value:left};
    holder.value >>= b;
    try { const invalid: any = Symbol(); results.push(invalid * b); } catch {trace.push('symbol-error');}
    return {first,results,math,formats,typed,viewLength,indexes,memory,strings,local,field:holder.value,trace};
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const snapshot = parent.snapshot(), fork = parent.fork(), restored = parent.fresh();
  restored.restore(snapshot);
  for (const [index, instance] of [parent, fork, restored].entries()) {
    const reply = index + 2;
    const expected = await run(null, {call:async ({input}: any) => {assert.deepEqual(input, []);return reply;}});
    instance.resume(reply);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
  }
});
