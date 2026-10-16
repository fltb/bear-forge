import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

const pureMathMethods = [Math.abs,Math.acos,Math.acosh,Math.asin,Math.asinh,Math.atan,Math.atanh,
  Math.atan2,Math.cbrt,Math.ceil,Math.clz32,Math.cos,Math.cosh,Math.exp,Math.expm1,
  Math.floor,Math.fround,Math.hypot,Math.imul,Math.log,Math.log1p,Math.log2,Math.log10,
  Math.max,Math.min,Math.pow,Math.round,Math.sign,Math.sin,Math.sinh,Math.sqrt,Math.tan,Math.tanh,Math.trunc];

test('materialized BigInt and string arithmetic results consume proportional budget',()=>{
  const text='x'.repeat(204800),otherText=text.slice(0,-1)+'a',big=1n<<204800n,marker=Error('budget');
  const cases:[string,(op:ReturnType<typeof createOperations>)=>unknown][]=[
    ['BigInt.asUintN',op=>op.invoke(BigInt.asUintN,BigInt,[409600,-1n])],
    ['BigInt coercion input',op=>op.invoke(BigInt.asIntN,BigInt,[1,{[Symbol.toPrimitive](){return big;}}])],
    ['BigInt exponentiation',op=>op.numericBinary('**',2n,409600n)],
    ['BigInt shift',op=>op.numericBinary('<<',1n,409600n)],
    ['BigInt addition',op=>op.add(big,big)],
    ['BigInt equality',op=>op.compare('==',big,big+1n)],
    ['BigInt strict equality',op=>op.compare('===',big,big+1n)],
    ['BigInt ordering',op=>op.compare('<',big,big+1n)],
    ['Object.is BigInt',op=>op.invoke(Object.is,Object,[big,big+1n])],
    ['Array.includes BigInt',op=>op.invoke(Array.prototype.includes,[big],[big+1n])],
    ['Map.has BigInt',op=>op.invoke(Map.prototype.has,new Map([[big,1]]),[big+1n])],
    ['Set.has BigInt',op=>op.invoke(Set.prototype.has,new Set([big]),[big+1n])],
    ['string strict equality',op=>op.compare('===',text,otherText)],
    ['string loose equality',op=>op.compare('==',text,otherText)],
    ['Object.is string',op=>op.invoke(Object.is,Object,[text,otherText])],
    ['Array.includes string',op=>op.invoke(Array.prototype.includes,[text],[otherText])],
    ['Map.has string',op=>op.invoke(Map.prototype.has,new Map([[text,1]]),[otherText])],
    ['Set.has string',op=>op.invoke(Set.prototype.has,new Set([text]),[otherText])],
    ['default string sort',op=>op.invoke(Array.prototype.sort,[otherText,text],[])],
    ['default string toSorted',op=>op.invoke(Array.prototype.toSorted,[otherText,text],[])],
    ['string addition',op=>op.add(text,text)],
  ];
  for(const [name,run] of cases){
    let ticks=0;const limited=createOperations({tick(){if(++ticks===20)throw marker;}});
    assert.throws(()=>run(limited),error=>error===marker,name);
    assert.equal(ticks,20,name);
  }
});

test('native symbols and errors charge retained primitive text',()=>{
  const value='x'.repeat(204800),marker=Error('budget');
  const cases:[string,(op:ReturnType<typeof createOperations>)=>unknown][]=[
    ['Symbol',op=>op.invoke(Symbol,undefined,[value])],
    ['Symbol.for',op=>op.invoke(Symbol.for,Symbol,[value])],
    ['Error',op=>op.invoke(Error,undefined,[value])],
    ['TypeError',op=>op.invoke(TypeError,undefined,[value])],
    ['new Error',op=>op.construct(Error,[value])],
    ['AggregateError',op=>op.invoke(AggregateError,undefined,[[],value])],
  ];
  for(const [name,run] of cases){
    let ticks=0;const op=createOperations({tick(){if(++ticks===20)throw marker;}});
    assert.throws(()=>run(op),error=>error===marker,name);
    assert.equal(ticks,20,name);
  }
});

test('numeric conversion charges long string operands and native arguments',()=>{
  const text='0'.repeat(409600),marker=Error('budget');
  const cases:[string,(op:ReturnType<typeof createOperations>)=>unknown][]=[
    ['Number',op=>op.invoke(Number,undefined,[text])],
    ['BigInt',op=>op.invoke(BigInt,undefined,[text])],
    ['parseInt',op=>op.invoke(Number.parseInt,Number,[text])],
    ['parseFloat',op=>op.invoke(Number.parseFloat,Number,[text])],
    ['Math.abs primitive',op=>op.invoke(Math.abs,Math,[text])],
    ['Math.abs object',op=>op.invoke(Math.abs,Math,[{[Symbol.toPrimitive](){return text;}}])],
    ['unary plus',op=>op.numericUnary('+',text)],
    ['binary subtraction',op=>op.numericBinary('-',text,0)],
    ['relational comparison',op=>op.compare('<',text,1)],
    ['equality comparison',op=>op.compare('==',text,0)],
    ['boolean equality',op=>op.compare('==',text,true)],
    ['array index',op=>op.invoke(Array.prototype.at,[7],[text])],
    ['numeric formatting',op=>op.invoke(Number.prototype.toFixed,1,[text])],
    ['buffer slice index',op=>op.invoke(ArrayBuffer.prototype.slice,new ArrayBuffer(1),[text,1])],
    ['increment',op=>{const holder={value:text};return op.update(op.ref(holder,'value'),1,true);} ],
  ];
  for(const [name,run] of cases){
    let ticks=0;
    const op=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>run(op),error=>error===marker,name);
    assert.equal(ticks,100,name);
  }
});

test('binary-view constructors, indices and element writes charge numeric text conversion',()=>{
  const value='0'.repeat(409600),marker=Error('budget');
  const cases:[string,(op:ReturnType<typeof createOperations>)=>unknown][]=[
    ['typed length',op=>op.construct(Uint8Array,[value])],
    ['typed index',op=>op.invoke(Uint8Array.prototype.at,new Uint8Array([7]),[value])],
    ['typed of',op=>op.invoke(Uint8Array.of,Uint8Array,[value])],
    ['typed from',op=>op.invoke(Uint8Array.from,Uint8Array,[[value]])],
    ['typed constructor element',op=>op.construct(Uint8Array,[[value]])],
    ['typed set element',op=>op.invoke(Uint8Array.prototype.set,new Uint8Array(1),[[value]])],
    ['typed fill element',op=>op.invoke(Uint8Array.prototype.fill,new Uint8Array(1),[value])],
    ['DataView offset',op=>op.invoke(DataView.prototype.getUint8,new DataView(new ArrayBuffer(1)),[value])],
    ['DataView value',op=>op.invoke(DataView.prototype.setUint8,new DataView(new ArrayBuffer(1)),[0,value])],
  ];
  for(const [name,run] of cases){
    let ticks=0;const op=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>run(op),error=>error===marker,name);
    assert.equal(ticks,100,name);
  }
});

test('native higher-order numeric consumers charge callback result conversion',()=>{
  const value='0'.repeat(409600),marker=Error('budget');
  const cases:[string,(op:ReturnType<typeof createOperations>)=>unknown][]=[
    ['typed map',op=>op.invoke(Uint8Array.prototype.map,new Uint8Array([1]),[()=>value])],
    ['typed from',op=>op.invoke(Uint8Array.from,Uint8Array,[[1],()=>value])],
    ['array sort',op=>op.invoke(Array.prototype.sort,[2,1],[()=>value])],
    ['array toSorted',op=>op.invoke(Array.prototype.toSorted,[2,1],[()=>value])],
    ['typed sort',op=>op.invoke(Uint8Array.prototype.sort,new Uint8Array([2,1]),[()=>value])],
  ];
  for(const [name,run]of cases){
    let ticks=0;const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>run(limited),error=>error===marker,name);
    assert.equal(ticks,100,name);
  }
});

test('numeric operators match V8 conversions, abrupt order and BigInt rules through guarded calls', () => {
  const binary = ['-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^'] as const;
  const values = [7, -0, NaN, Infinity, '3', null, undefined, 2n, 0n, Symbol('value')];
  const outcome = (run: () => unknown) => {try {return {value:run()};} catch (e) {return {error:(e as Error).name};}};
  for (const operator of binary) for (const left of values) for (const right of values) {
    const native = new Function('left', 'right', `return left ${operator} right;`);
    function run(guarded: boolean) {
      const trace: string[] = [];
      const wrap = (value: unknown, label: string) => ({[Symbol.toPrimitive](hint: string) {trace.push(label + ':' + hint);return value;}});
      const a = wrap(left, 'left'), b = wrap(right, 'right');
      const op = createOperations();
      return {outcome:outcome(() => guarded ? op.numericBinary(operator, a, b) : native(a, b)), trace};
    }
    assert.deepEqual(run(true), run(false), operator);
  }
  for (const operator of ['+', '-', '~'] as const) for (const value of values) {
    const native = new Function('value', `return ${operator}value;`);
    assert.deepEqual(outcome(() => createOperations().numericUnary(operator, value)), outcome(() => native(value)));
  }
  const invoked: Function[] = [];
  const op = createOperations({apply(fn, self, args) {invoked.push(fn);return Reflect.apply(fn, self, args);}});
  const left = {valueOf() {return 9;}}, right = {valueOf() {return 2;}};
  assert.equal(op.numericBinary('-', left, right), 7);
  assert.deepEqual(invoked, [left.valueOf, right.valueOf]);
  assert.throws(() => op.numericUnary('-', {[Symbol.toPrimitive]: Object.keys.bind(Object)}), /not whitelisted/);
  for(const left of [NaN,0,-0,1n,'1',null,{}])for(const right of [NaN,0,-0,1n,'1',null,{}]){
    assert.equal(createOperations().compare('===',left,right),left===right);
    assert.equal(createOperations().compare('!==',left,right),left!==right);
  }
});

test('Math preserves native conversion order while dispatching object conversions through the guard', () => {
  for (const method of pureMathMethods) for (const values of [[],[7],[NaN,3],[Infinity,2],[7,2,3],[2n,7],[Symbol('x'),7]]) {
    function run(guarded: boolean) {
      const trace: unknown[] = [];
      const args = values.map((value,index) => {
        const object = Object.freeze({get [Symbol.toPrimitive]() {
          trace.push(['get',index]);
          return function(this: unknown,hint: string) {trace.push(['call',index,hint,this===object]);return value;};
        }});
        return object;
      });
      try {return {value:guarded?createOperations().invoke(method,Math,args):Reflect.apply(method,Math,args),trace};}
      catch (error) {return {error:(error as Error).name,trace};}
    }
    assert.deepEqual(run(true),run(false),method.name);
  }
  const calls: Function[] = [];
  const op = createOperations({apply(fn,self,args) {calls.push(fn);return Reflect.apply(fn,self,args);}});
  const value = {valueOf() {return -7;}};
  assert.equal(op.invoke(Math.abs,Math,[value]),7);
  assert.deepEqual(calls,[Math.abs,value.valueOf]);
  assert.throws(() => op.invoke(Math.abs,Math,[{valueOf:Object.keys.bind(Object)}]),/not whitelisted/);
  const budget = new Error('budget');
  let ticks = 0;
  const bounded = createOperations({tick() {if (++ticks > 3) throw budget;}});
  assert.throws(() => bounded.invoke(Math.abs,Math,[{length:100,valueOf:Array.prototype.join}]),error=>error===budget);
});

test('primitive-only math and character constructors keep native results and the apply hook', () => {
  const methods = [...pureMathMethods, String.fromCharCode, String.fromCodePoint];
  const inputs: unknown[][] = [[], [0], [-0], [2, 3], ['4', true], [NaN, Infinity], [2n], [Symbol('x')]];
  const result = (run: () => unknown) => {
    try { return { value: run() }; }
    catch (error) { return { error: (error as Error).name }; }
  };
  for (const method of methods) for (const args of inputs) {
    const self = { ignored: true };
    assert.deepEqual(result(() => createOperations().invoke(method, self, args)),
      result(() => Reflect.apply(method, self, args)), method.name);
  }
  const calls: Function[] = [], values: unknown[] = [];
  const operations = createOperations({ value(item) { values.push(item); }, apply(fn, self, args) {
    calls.push(fn);
    return Reflect.apply(fn, self, args);
  } });
  assert.equal(operations.invoke(Math.imul, Math, [2, 3]), 6);
  assert.deepEqual(calls, [Math.imul]);
  assert.deepEqual(values, [2, 3, 6]);
  assert.throws(() => createOperations({apply() {return Number.prototype.toLocaleString;}})
    .invoke(Math.imul, Math, [2, 3]), /not whitelisted/);
});

test('numeric formatting, BigInt narrowing and code point construction retain lazy argument conversion', () => {
  const cases: [Function,unknown,unknown[]][] = [];
  for (const method of [Number.prototype.toFixed,Number.prototype.toExponential,Number.prototype.toPrecision,Number.prototype.toString]) {
    for (const receiver of [7,NaN,Infinity,new Number(7),{},7n])
      for (const args of [[],[undefined],[2],[0],[101],[2n],[Symbol('radix')]]) cases.push([method,receiver,args]);
  }
  for (const receiver of [7n,Object(7n),7,{}])
    for (const radix of [2,10,37,2n,Symbol('radix')]) cases.push([BigInt.prototype.toString,receiver,[radix]]);
  for (const method of [BigInt.asIntN,BigInt.asUintN])
    for (const bits of [0,8,-1,2n,Symbol('bits')])
      for (const value of [257n,'257',true,257,Symbol('value')]) cases.push([method,BigInt,[bits,value]]);
  for (const method of [String.fromCharCode,String.fromCodePoint])
    for (const args of [[],[65,0x1f600],[NaN,66],[-1,66],[0x110000,66],[2n,66],[Symbol('point'),66]]) cases.push([method,String,args]);
  for (const [method,receiver,values] of cases) {
    function run(guarded: boolean) {
      const trace: unknown[] = [], dispatched: Function[] = [];
      const args = values.map((value,index) => {
        // Keep undefined primitive: optional formatting parameters distinguish
        // omission/undefined from an object converting to undefined.
        if (value === undefined) return value;
        const object = Object.freeze({[Symbol.toPrimitive](hint: string) {
          trace.push([index,hint,this===object]);return value;
        }});
        return object;
      });
      const op = createOperations({apply(fn,self,args) {dispatched.push(fn);return Reflect.apply(fn,self,args);}});
      let result: unknown;
      try {result = {value:guarded?op.invoke(method,receiver,args):Reflect.apply(method,receiver,args)};}
      catch (error) {result = {error:(error as Error).name};}
      if (guarded) assert.equal(dispatched.length,trace.length+1,method.name);
      return {result,trace};
    }
    assert.deepEqual(run(true),run(false),method.name);
  }
});
