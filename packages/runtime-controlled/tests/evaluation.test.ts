import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript, compileTypeScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

async function compare(source: string, preamble = '') {
  // Native execution is the independent oracle; no Bear Forge lowering runs here.
  const native = Function(`"use strict";return (${source})`)();
  const artifact = decode(compileJavaScript(`${preamble}export const program={schemas:{},run:${source}}`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const [index, initial] of [parent, parent.fork(), restored].entries()) {
    let instance = initial;
    const reply = index + 3;
    let calls = 0;
    const expected = await native(null, { call: async () => { calls++; return reply; } });
    for (let call = 0; call < calls; call++) {
      assert.equal(instance.result.status, 0, String(instance.result.value));
      if (call && index === 1) instance = instance.fork();
      if (call && index === 2) {
        const next = instance.fresh(); next.restore(instance.snapshot()); instance = next;
      }
      instance.resume(reply);
    }
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected, source);
  }
}

test('author string directives cannot disable controlled continuation compilation', async () => {
  for (const directive of ['no-debug', 'no-ctrl']) {
    await compare(`async function run(input,io){
      '${directive}';
      let value=1; const next=()=>++value;
      await io.call({port:'step',input:next()});
      return next();
    }`, `'${directive}';`);
  }
});

test('for-in RHS retains its uninitialized lexical head across escaped closures', async () => {
  await compare(`async function run(input,io){
    const trace=[]; let key='outer'; let read;
    try { for (let key in key) trace.push('wrong'); }
    catch(error){trace.push(error.name);}
    for (let key in (read=()=>key,{a:1,b:2})) trace.push(key);
    await io.call({port:'step',input:null});
    try { read(); } catch(error){trace.push(error.name);}
    return [trace,key];
  }`);
});

test('named function expression bindings stay immutable through suspended assignments', async () => {
  await compare(`async function run(input,io){
    'use strict';
    const trace=[];
    const f=async function self(){
      const original=self;
      const write=async ()=>{try{self=(trace.push('rhs'),await io.call({port:'step',input:null}));}
        catch(error){trace.push(error.name);}};
      await write();
      try{self++;}catch(error){trace.push(error.name);}
      return [trace,self===original,self===f];
    };
    return await f();
  }`);
});

test('function-name writes respect class strictness and ordinary shadowing bindings', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class Box { method(){ const f=function self(){self=1;};try{f();}catch(error){trace.push(error.name);} } }
    new Box().method();
    const parameter=function self(self){return ()=>++self;};
    const local=function self(){var self=4;return ++self;};
    const uninitialized=function self(){var self;return typeof self;};
    const increment=parameter(1);
    await io.call({port:'step',input:null});
    return [trace,increment(),local(),uninitialized()];
  }`);
});

test('parameter defaults preserve uninitialized reads writes and escaped parameter bindings', async () => {
  await compare(`async function run(input,io){
    const trace=[]; let escaped;
    function read(a=b,b=1){return a;}
    function write(a=(b=(trace.push('rhs'),3)),b=1){return a;}
    function self(a=typeof a){return a;}
    function capture(a=(escaped=()=>b,0),b=7){return a;}
    for(const f of [read,write,self]){try{f();trace.push('wrong');}catch(error){trace.push(error.name);}}
    capture();
    await io.call({port:'step',input:null});
    return [trace,escaped()];
  }`);
});

test('parameter closures retain their environment independently of body var declarations', async () => {
  await compare(`async function run(input,io){
    let x='outer';
    function build(value=1,read=()=>value,outer=()=>x){
      var value=9,x='body';
      return [()=>++value,read,outer];
    }
    const [increment,read,outer]=build();
    await io.call({port:'step',input:null});
    return [increment(),read(),outer()];
  }`);
});

test('generator parameter initialization happens at call while body execution waits for next', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    function* sync(a=(trace.push('sync-default'),3)){trace.push('sync-body');yield a;}
    async function* asyncGen(a=(trace.push('async-default'),4)){trace.push('async-body');yield a;}
    function* failing(a=(()=>{throw new Error('default');})()){trace.push('wrong');}
    async function* asyncFail(a=(()=>{throw new Error('async-default');})()){trace.push('wrong');}
    const a=sync(),b=asyncGen();
    for(const f of [failing,asyncFail]){try{f();trace.push('wrong');}catch(error){trace.push(error.message);}}
    const before=trace.slice();
    await io.call({port:'step',input:null});
    return [before,a.next(),await b.next(),trace];
  }`);
});

test('class self names stay immutable and distinct from reassigned outer class variables', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class C{
      static read(){return C;}
      static change(value){C=(trace.push('rhs'),value);}
    }
    const original=C;C=9;
    await io.call({port:'step',input:null});
    try{original.change(3);}catch(error){trace.push(error.name);}
    return [original.read()===original,C,trace];
  }`);
});

test('class field closures preserve readonly names for assignment update and destructuring', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class C {
      static read=()=>C;
      static assign=v=>C=(trace.push('rhs'),v);
      static update=()=>C++;
      static pattern=v=>([C]=[v]);
      instance=v=>({value:C}={value:v});
    }
    const original=C,object=new C();C=9;
    await io.call({port:'step',input:null});
    for(const f of [original.assign,original.update,original.pattern,object.instance]){
      try{f(3);trace.push('wrong');}catch(error){trace.push(error.name);}
    }
    return [trace,C,original.read()===original];
  }`);
});

test('class computed-key closures observe initialization rather than a permanent TDZ', async () => {
  await compare(`async function run(input,io){
    let read;const trace=[];
    class C{[(read=()=>C,(()=>{try{read();}catch(error){trace.push(error.name);}})(),'field')]=1;}
    await io.call({port:'step',input:null});
    return [trace,read()===C,new C().field];
  }`);
});

test('expression values retain source order across mutations and suspension', async () => {
  for (const left of ['x', '!x', '-x', 'typeof x', 'x + 1', '[x]', '({x})', 'x ? x : 9', 'x && x', 'x ?? 9']) {
    for (const right of ['(x = 8)', '++x', '(x = await io.call({port:"step",input:x}))']) {
      const body = `let x=2;const result=[${left},${right}];${right.includes('await') ? '' : 'await io.call({port:"step",input:null});'}return [result,x];`;
      await compare(`async function run(input,io){${body}}`);
    }
  }
});

test('compound and short-circuit assignments read once and skip untaken operands', async () => {
  await compare(`async function run(input,io){
    let x=1, y=0, z=null; const trace=[];
    const a=(x+=(x=4)), b=(y&&=(trace.push('wrong'),8));
    x||=(trace.push('wrong'),9);
    z??=await io.call({port:'step',input:null});
    y||=(trace.push('right'),z); z??=(trace.push('wrong'),12);
    return [a,b,x,y,z,trace];
  }`);
});

test('calls retain selected function and earlier arguments when later arguments mutate bindings', async () => {
  await compare(`async function run(input,io){
    let f=function(a,b){return ['first',a,b]},x=2;
    const result=f(x,(f=function(){return ['second']},x=await io.call({port:'step',input:null})));
    return [result,f(),x];
  }`);
});

test('switch case side effects run in order and stop after a matching case', async () => {
  await compare(`async function run(input,io){
    let x=0;const trace=[];const choice=await io.call({port:'step',input:null});
    switch(choice){case (trace.push('a'),++x):trace.push('one');break;
      case (trace.push('b'),x+=2):trace.push('three');break;
      default:trace.push('default');case (trace.push('c'),x+=2):trace.push('tail');}
    return [x,trace];
  }`);
});

test('admitted global constants retain JavaScript values and descriptors through branches', async () => {
  await compare(`async function run(input,io){
    const keys=['undefined','NaN','Infinity'];
    const before=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
    await io.call({port:'step',input:null});
    return [before,keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key)),
      globalThis.undefined===undefined,Number.isNaN(globalThis.NaN),globalThis.Infinity===Infinity];
  }`);
});

test('slice retains length, holes and coercion order when its bounds mutate the receiver', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[],values=[1,2,3];
    values.constructor={};
    const start={valueOf(){trace.push('start');values.length=1;values.constructor=Array;return 0;}};
    const end={valueOf(){trace.push('end');return 3;}};
    const result=values.slice(start,end);
    const generic={0:'a',2:'c',get length(){trace.push('length');return 3;}};
    const other=Array.prototype.slice.call(generic,-3,Infinity);
    return [result,result.length,Object.keys(result),other,trace];
  }`);
});

test('splice and flat preserve mutations and sparse results in every restored branch', async () => {
  await compare(`async function run(input,io){
    const values=[1,,3,4],nested=[[1],,[2,[3]]],trace=[];
    await io.call({port:'step',input:null});
    const start={valueOf(){trace.push('start');values.length=2;return 1;}};
    const count={valueOf(){trace.push('count');return 2;}};
    const deleted=values.splice(start,count,7,8,9);
    const depth={valueOf(){trace.push('depth');nested.push([99]);return 2;}};
    const flattened=nested.flat(depth);
    return [values,deleted,Object.keys(deleted),flattened,trace];
  }`);
});

test('accessor literals keep the enclosing this and arguments through suspension', async () => {
  await compare(`async function run(input,io){
    function build(value){return {owner:this,argument:arguments[0],get answer(){return this.argument;}};}
    const receiver={tag:'outer'},value=build.call(receiver,7);
    await io.call({port:'step',input:null});
    return [value.owner===receiver,value.argument,value.answer];
  }`);
});

test('await inside an accessor literal stays in its original async function', async () => {
  await compare(`async function run(input,io){
    const value={x:await io.call({port:'step',input:null}),get answer(){return this.x;}};
    return [value.x,value.answer];
  }`);
});

test('accessor literals coerce computed keys before suspended values and preserve literal prototypes', async () => {
  await compare(`async function run(input,io){
    const trace=[],parent={inherited:17};
    const key={ [Symbol.toPrimitive](hint){trace.push(hint);return 'field';} };
    const object={__proto__:parent,[key]:(trace.push('value'),await io.call({port:'step',input:null})),
      get answer(){return this.field+this.inherited;}};
    const nullProto={__proto__:null,get answer(){return 3;}};
    const ignored={__proto__:12,get answer(){return 4;}};
    const ordinary={['__proto__']:5,get answer(){return 6;}};
    return [trace,object.answer,Object.getPrototypeOf(object)===parent,
      Object.hasOwn(object,'__proto__'),Object.getPrototypeOf(nullProto)===null,
      Object.getPrototypeOf(ignored)===Object.prototype,ordinary.__proto__];
  }`);
});

test('object super keeps each defining object across repeated construction and restored calls', async () => {
  await compare(`async function run(input,io){
    const objects=[];
    for(let n=1;n<=2;n++)objects.push({__proto__:{value:n,read(){return this.extra;}},extra:10,
      get answer(){return super.value+this.extra;},read(){return super.value;},
      invoke(){return super.read();},make(){return ()=>super.value+this.extra;},
      write(value){super.field=value;return this.field;}});
    const arrow=objects[1].make();
    await io.call({port:'step',input:null});
    Object.setPrototypeOf(objects[0],{value:7});
    const receiver={extra:20};
    return [objects[0].answer,objects[1].answer,objects[0].read.call(receiver),
      objects[1].read.call(receiver),objects[0].write.call(receiver,5),receiver.field,
      objects[1].invoke.call(receiver),arrow()];
  }`);
});

test('async and arrow functions stay nonconstructable after fork and restore', async () => {
  await compare(`async function run(input,io){
    const arrow=()=>3,asyncArrow=async()=>4;async function asyncFunction(){return 5;}
    function ordinary(){this.value=7;}
    await io.call({port:'step',input:null});
    const result=[];
    for(const fn of [arrow,asyncArrow,asyncFunction]){
      let constructable=true;try{Reflect.construct(ordinary,[],fn);}catch(e){constructable=false;}
      result.push([constructable,Object.hasOwn(fn,'prototype')]);
    }
    result.push(new ordinary().value);
    return result;
  }`);
});

test('binding preserves target constructability through both fork copies and persistence', async () => {
  await compare(`async function run(input,io){
    const arrow=()=>3;async function asyncFunction(){return 5;}
    function ordinary(value){this.value=value;}
    const functions=[arrow.bind(null),asyncFunction.bind(null),ordinary.bind(null,7)];
    await io.call({port:'step',input:null});
    const result=[];
    for(const fn of functions){
      let constructable=true;try{Reflect.construct(ordinary,[],fn);}catch(e){constructable=false;}
      result.push([constructable,Object.hasOwn(fn,'prototype')]);
    }
    result.push(new functions[2]().value);
    return result;
  }`);
});

test('bound metadata follows guarded reads and retains its prototype across restoration', async () => {
  await compare(`async function run(input,io){
    const trace=[],prototype={tag:'bound-parent'};
    function target(a,b,c){return [a,b,c];}
    Object.defineProperty(target,'length',{get(){trace.push('length');return 3.8;},configurable:true});
    Object.defineProperty(target,'name',{get(){trace.push('name');return 'chosen';},configurable:true});
    Object.setPrototypeOf(target,prototype);
    const bound=Function.prototype.bind.call(target,null,1);
    const before=[bound.name,bound.length,Object.getPrototypeOf(bound)===prototype,trace.slice()];
    await io.call({port:'step',input:null});
    return [before,bound.name,bound.length,Object.getPrototypeOf(bound)===prototype,bound(2,3),trace];
  }`);
});

test('bound metadata handles nonnumeric lengths, null prototypes and author prototype properties', async () => {
  await compare(`async function run(input,io){
    const functions=[];
    for(const length of [Infinity,-Infinity,NaN,3.8,-2,'4',null]){
      function target(){return 9;}
      Object.defineProperty(target,'length',{value:length,configurable:true});
      Object.defineProperty(target,'name',{value:12,configurable:true});
      Object.setPrototypeOf(target,null);
      const bound=Function.prototype.bind.call(target,null,1);
      const prototype={};
      Object.defineProperty(prototype,'constructor',{value:bound,writable:true,configurable:true});
      bound.prototype=prototype;
      functions.push(bound);
    }
    await io.call({port:'step',input:null});
    return functions.map(bound=>[bound.name,bound.length,Object.getPrototypeOf(bound)===null,
      bound.prototype.constructor===bound,bound()]);
  }`);
});

test('generator functions are nonconstructable while retaining their own prototype descriptor', async () => {
  await compare(`async function run(input,io){
    function* sync(){yield 3;}async function* asynchronous(){yield 4;}
    function ordinary(){}
    await io.call({port:'step',input:null});
    const result=[];
    for(const fn of [sync,asynchronous]){
      let constructable=true;try{Reflect.construct(ordinary,[],fn);}catch(e){constructable=false;}
      const descriptor=Object.getOwnPropertyDescriptor(fn,'prototype');
      result.push([constructable,descriptor.writable,descriptor.enumerable,descriptor.configurable,
        Object.hasOwn(fn.prototype,'constructor')]);
    }
    result.push(sync().next().value,(await asynchronous().next()).value);
    return result;
  }`);
});

test('generator instances use the current object prototype or the intrinsic fallback', async () => {
  await compare(`async function run(input,io){
    function* sync(){yield 3;}async function* asynchronous(){yield 4;}
    const syncNext=sync().next,asyncNext=asynchronous().next;
    const syncBase=Object.getPrototypeOf(sync.prototype);
    const asyncBase=Object.getPrototypeOf(asynchronous.prototype);
    const custom={tag:7};
    sync.prototype=custom;asynchronous.prototype=custom;
    const first=sync(),second=asynchronous();
    await io.call({port:'step',input:null});
    const result=[Object.getPrototypeOf(first)===custom,Object.getPrototypeOf(second)===custom,
      syncNext.call(first).value,(await asyncNext.call(second)).value];
    for(const value of [null,undefined,3,'x']){
      sync.prototype=value;asynchronous.prototype=value;
      const a=sync(),b=asynchronous();
      result.push([Object.getPrototypeOf(a)===syncBase,Object.getPrototypeOf(b)===asyncBase,
        syncNext.call(a).value,(await asyncNext.call(b)).value]);
    }
    return result;
  }`);
});

test('object methods and accessors retain nonconstructability across restoration', async () => {
  await compare(`async function run(input,io){
    const ordinary={method(){return this.value;},value:3};
    const accessors={get value(){return 4;},set value(v){this.saved=v;},method(){return this.value;}};
    const derived={__proto__:ordinary,method(){return super.method();},value:5};
    const descriptor=Object.getOwnPropertyDescriptor(accessors,'value');
    const methods=[ordinary.method,accessors.method,descriptor.get,descriptor.set,derived.method];
    await io.call({port:'step',input:null});
    const result=[];
    for(const method of methods){let constructable=true;try{Reflect.construct(function(){},[],method);}catch(e){constructable=false;}
      result.push([constructable,Object.hasOwn(method,'prototype')]);}
    accessors.value=8;
    result.push(ordinary.method(),accessors.method(),derived.method(),accessors.saved);
    return result;
  }`);
});

test('method and shorthand proto keys remain ordinary own properties', async () => {
  await compare(`async function run(input,io){
    const __proto__=7,shorthand={__proto__},method={__proto__(){return 8;}};
    const quoted={'__proto__'(){return 9;}};
    await io.call({port:'step',input:null});
    return [Object.hasOwn(shorthand,'__proto__'),shorthand.__proto__,
      Object.getPrototypeOf(shorthand)===Object.prototype,
      Object.hasOwn(method,'__proto__'),method.__proto__(),
      Object.getPrototypeOf(method)===Object.prototype,quoted.__proto__()];
  }`);
});

test('method names follow property keys and accessor prefixes across restoration', async () => {
  await compare(`async function run(input,io){
    const symbol=Symbol('key'),anonymous=Symbol(),trace=[];
    const key={toString(){trace.push('key');return 'chosen';}};
    const value={plain(){},[key](){},[symbol](){},[anonymous](){},
      get answer(){return 3;},set answer(v){},7(){}};
    await io.call({port:'step',input:null});
    const d=Object.getOwnPropertyDescriptor(value,'answer');
    return [[value.plain,value.chosen,value[symbol],value[anonymous],d.get,d.set,value[7]].map(fn=>{
      const name=Object.getOwnPropertyDescriptor(fn,'name');
      return [name.value,name.writable,name.enumerable,name.configurable];
    }),trace];
  }`);
});

test('function names and lengths survive internal renaming and parameter lowering', async () => {
  await compare(`async function run(input,io){
    function same(same,tail){return same+tail;}
    function defaults(first,second=2,third){return first+second;}
    function rest(first,...remaining){return remaining.length;}
    const named=function explicit(a,b){return a+b;};
    const arrow=(a,b)=>a+b;
    const anonymous=(0,function(a){});
    await io.call({port:'step',input:null});
    return [same,defaults,rest,named,arrow,anonymous].map(fn=>[fn.name,fn.length]);
  }`);
});

test('anonymous property functions receive key names without changing explicit names or function kinds', async () => {
  await compare(`async function run(input,io){
    const symbol=Symbol('named'),key='computed',trace=[];
    const object={ordinary:function(v){this.value=v;},arrow:()=>3,[key]:function(){},
      [symbol]:async()=>4,named:function explicit(){},nested:{inner:()=>5}};
    const special={__proto__:function(){}};
    await io.call({port:'step',input:null});
    const names=[object.ordinary.name,object.arrow.name,object[key].name,object[symbol].name,
      object.named.name,object.nested.inner.name,Object.getPrototypeOf(special).name];
    let arrowConstructable=true;try{new object.arrow();}catch(e){arrowConstructable=false;}
    return [names,new object.ordinary(8).value,arrowConstructable,await object[symbol]()];
  }`);
});

test('default bindings name functions before parameters and destructuring are lowered', async () => {
  await compare(`async function run(input,io){
    function defaults(fn=()=>3,{item=function(){}}={}){return [fn,item];}
    const {first=()=>4,renamed:second=function(){}}={};
    const [third=async()=>5]=[];
    let assigned;assigned=()=>6;
    const functions=[...defaults(),first,second,third,assigned];
    await io.call({port:'step',input:null});
    return functions.map(fn=>fn.name);
  }`);
});

test('generator function and iterator prototypes have standard object shapes and tags', async () => {
  await compare(`async function run(input,io){
    function* sync(){yield 1;}async function* asynchronous(){yield 2;}
    await io.call({port:'step',input:null});
    const result=[];
    for(const fn of [sync,asynchronous]){
      const functions=Object.getPrototypeOf(fn),iterators=Object.getPrototypeOf(fn.prototype);
      const link=Object.getOwnPropertyDescriptor(functions,'prototype');
      const tag=Object.getOwnPropertyDescriptor(functions,Symbol.toStringTag);
      result.push([typeof functions,Object.getPrototypeOf(functions)===Function.prototype,
        link&&link.value===iterators,link&&link.writable,link&&link.enumerable,link&&link.configurable,
        tag&&tag.value,tag&&tag.writable,tag&&tag.enumerable,tag&&tag.configurable,
        Object.prototype.toString.call(fn),Object.prototype.toString.call(fn())]);
    }
    return result;
  }`);
});

test('reflective calls validate targets before observing argument lists', async () => {
  await compare(`async function run(input,io){
    const trace=[],args={get length(){trace.push('length');return 0;}};
    const arrow=()=>3;function ordinary(){return 4;}
    await io.call({port:'step',input:null});
    const results=[];
    for(const attempt of [()=>Reflect.construct(arrow,args),
      ()=>Reflect.construct(ordinary,args,undefined),()=>Reflect.construct(ordinary,args,arrow),
      ()=>Reflect.apply({},null,args),()=>Function.prototype.apply.call({},null,args)]){
      try{attempt();results.push('accepted');}catch(e){results.push(e.name);}
    }
    return [results,trace];
  }`);
});

test('async functions and arrows share their own intrinsic prototype across restoration', async () => {
  await compare(`async function run(input,io){
    async function named(){return 3;}const arrow=async()=>4;
    const prototype=Object.getPrototypeOf(named);
    await io.call({port:'step',input:null});
    const tag=Object.getOwnPropertyDescriptor(prototype,Symbol.toStringTag);
    return [typeof prototype,prototype===Object.getPrototypeOf(arrow),
      Object.getPrototypeOf(prototype)===Function.prototype,Object.hasOwn(prototype,'prototype'),
      tag&&[tag.value,tag.writable,tag.enumerable,tag.configurable],
      Object.prototype.toString.call(named),Object.prototype.toString.call(arrow),await named(),await arrow()];
  }`);
});

test('generator protocol methods expose standard names lengths and descriptors', async () => {
  await compare(`async function run(input,io){
    function* sync(){}async function* asynchronous(){}
    await io.call({port:'step',input:null});
    const result=[];
    for(const fn of [sync,asynchronous]){
      const prototype=Object.getPrototypeOf(fn.prototype);
      for(const key of ['next','return','throw']){
        const d=Object.getOwnPropertyDescriptor(prototype,key);
        let constructable=true;try{Reflect.construct(function(){},[],d.value);}catch(e){constructable=false;}
        result.push([key,d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,
          Object.hasOwn(d.value,'prototype'),constructable]);
      }
    }
    return result;
  }`);
});

test('standard synchronous iterators share the same base iterator prototype', async () => {
  await compare(`async function run(input,io){
    function* values(){yield 1;}
    const iterators=[[1][Symbol.iterator](),'x'[Symbol.iterator](),new Map([[1,2]]).entries(),new Set([1]).values(),values()];
    await io.call({port:'step',input:null});
    const base=Object.getPrototypeOf(Object.getPrototypeOf(iterators[0]));
    return iterators.map((iterator,index)=>{
      const prototype=index===4?Object.getPrototypeOf(Object.getPrototypeOf(iterator)):Object.getPrototypeOf(iterator);
      const root=Object.getPrototypeOf(prototype);
      return [root===base,Object.hasOwn(prototype,Symbol.iterator),iterator[Symbol.iterator]()===iterator];
    });
  }`);
});

test('iterator next methods reject other cursor brands without advancing them', async () => {
  await compare(`async function run(input,io){
    const iterators=[[7].values(),'x'[Symbol.iterator](),new Map([[1,2]]).entries(),new Set([3]).values()];
    const methods=iterators.map(iterator=>iterator.next);
    await io.call({port:'step',input:null});
    const errors=[];
    for(let method=0;method<methods.length;method++)for(let target=0;target<iterators.length;target++){
      if(method===target)continue;
      try{methods[method].call(iterators[target]);errors.push('accepted');}catch(e){errors.push(e.name);}
    }
    return [errors,iterators.map(iterator=>iterator.next()),methods[2]===methods[3]];
  }`);
});

test('managed cursor prototypes expose standard tags without internal constructors', async () => {
  await compare(`async function run(input,io){
    const cursors=[[1].values(),'x'[Symbol.iterator](),new Map().entries(),new Set().values()];
    await io.call({port:'step',input:null});
    return cursors.map(cursor=>{
      const prototype=Object.getPrototypeOf(cursor),tag=Object.getOwnPropertyDescriptor(prototype,Symbol.toStringTag);
      return [Object.prototype.toString.call(cursor),Object.hasOwn(prototype,'constructor'),
        tag&&[tag.value,tag.writable,tag.enumerable,tag.configurable]];
    });
  }`);
});

test('borrowed iterator producers reject nullish receivers before creating cursors', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const results=[];
    for(const receiver of [null,undefined])for(const method of [Array.prototype.values,Array.prototype.keys,Array.prototype.entries,String.prototype[Symbol.iterator]]){
      try{method.call(receiver);results.push('accepted');}catch(e){results.push(e.name);}
    }
    return results;
  }`);
});

test('borrowed collection producers validate receiver brands even when a journal exists', async () => {
  await compare(`async function run(input,io){
    const map=new Map([[1,2]]),set=new Set([3]);
    const mapIterator=map.entries(),setIterator=set.values();
    await io.call({port:'step',input:null});
    const errors=[];
    for(const [prototype,receiver] of [[Map.prototype,set],[Set.prototype,map]])for(const key of ['keys','values','entries']){
      try{prototype[key].call(receiver);errors.push('accepted');}catch(e){errors.push(e.name);}
    }
    return [errors,mapIterator.next(),setIterator.next()];
  }`);
});

test('class methods retain callable kind and constructors reject ordinary invocation', async () => {
  await compare(`async function run(input,io){
    class Base {
      constructor(value){this.value=value;}
      method(){return this.value;}
      static method(){return 4;}
      get amount(){return this.value;}
      set amount(value){this.value=value;}
    }
    const instance=new Base(2);
    await io.call({port:'step',input:null});
    const getter=Object.getOwnPropertyDescriptor(Base.prototype,'amount').get;
    const setter=Object.getOwnPropertyDescriptor(Base.prototype,'amount').set;
    const methods=[Base.prototype.method,Base.method,getter,setter];
    const shapes=methods.map(function(fn){
      let constructable;
      try{Reflect.construct(function(){},[],fn);constructable=true;}catch(error){constructable=error.name;}
      return [fn.name,fn.length,Object.hasOwn(fn,'prototype'),constructable];
    });
    let callResult;
    try{Base.call(instance,9);callResult='accepted';}catch(error){callResult=error.name;}
    return [shapes,callResult,instance.method(),Base.method()];
  }`);
});

test('class keys, method lexical bindings and inherited construction survive IO', async () => {
  await compare(`async function run(input,io){
    const trace=[], symbol=Symbol('amount'); let method=7;
    const key={ [Symbol.toPrimitive](hint){trace.push(hint);return symbol;} };
    class Base {
      constructor(value=2){this.value=value;}
      method(){return [method,this.value];}
      get [key](){return this.value;}
      set [key](value){this.value=value;}
    }
    class Child extends Base {
      method(){return super.method();}
      async update(){this[symbol]=await io.call({port:'step',input:null});return this.method();}
    }
    const child=new Child();
    const result=await child.update();
    const descriptor=Object.getOwnPropertyDescriptor(Base.prototype,symbol);
    return [trace,result,descriptor.get.name,descriptor.set.name,Object.hasOwn(Child.prototype.method,'prototype'),child instanceof Base];
  }`);
});

test('class construction checks precede parameter effects and allow alternate newTarget', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class Base { constructor(value=(trace.push('default'),2)){this.value=value;} }
    class Child extends Base {}
    function Alternate(){}
    await io.call({port:'step',input:null});
    const receiver=Object.create(Base.prototype), failures=[];
    for(const C of [Base,Child]){
      try{C.call(receiver);failures.push('accepted');}catch(error){failures.push(error.name);}
    }
    const result=Reflect.construct(Base,[8],Alternate);
    return [failures,trace,result.value,Object.getPrototypeOf(result)===Alternate.prototype,Object.hasOwn(receiver,'value')];
  }`);
});

test('arrows capture lexical new.target without acquiring constructor return semantics', async () => {
  await compare(`async function run(input,io){
    function Build(){
      this.read=()=>new.target;
      this.nested=()=>()=>new.target;
      this.zero=()=>0;
      this.asyncRead=async()=>new.target;
    }
    function Alternate(){}
    const ordinary=new Build(),alternate=Reflect.construct(Build,[],Alternate);
    function called(){return ()=>new.target;}
    const plain=called();
    await io.call({port:'step',input:null});
    return [ordinary.read()===Build,ordinary.nested()()===Build,ordinary.zero(),
      await ordinary.asyncRead()===Build,alternate.read()===Alternate,alternate.nested()()===Alternate,
      await alternate.asyncRead()===Alternate,plain()===undefined];
  }`);
});

test('lexical new.target is initialized before parameter defaults and stops at ordinary functions', async () => {
  await compare(`async function run(input,io){
    function Build(read=()=>new.target,value=read()){
      this.value=value;this.read=read;
      this.method=function(){return ()=>new.target;};
      this.check=()=>[new.target,0];
    }
    class Box { constructor(read=()=>new.target){this.read=read;} }
    const first=new Build(),box=new Box();
    const methodRead=first.method();
    await io.call({port:'step',input:null});
    return [first.value===Build,first.read()===Build,box.read()===Box,
      methodRead()===undefined,first.check()[0]===Build,first.check()[1]];
  }`);
});

test('super forwards actual new.target without reading prototype constructor properties', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class Base { constructor(value){this.value=value;this.target=new.target;} }
    class Child extends Base { constructor(value){super(value);} }
    function Alternate(){}
    Object.defineProperty(Child.prototype,'constructor',{get(){trace.push('child');return Alternate;},configurable:true});
    Object.defineProperty(Alternate.prototype,'constructor',{get(){trace.push('alternate');return Base;},configurable:true});
    await io.call({port:'step',input:null});
    const child=new Child(3),alternate=Reflect.construct(Child,[5],Alternate);
    return [trace,child.value,child.target===Child,Object.getPrototypeOf(child)===Child.prototype,
      alternate.value,alternate.target===Alternate,Object.getPrototypeOf(alternate)===Alternate.prototype];
  }`);
});

test('super parent selection follows native argument evaluation order', async () => {
  await compare(`async function run(input,io){
    class First { constructor(value){this.kind='first';this.value=value;this.target=new.target;} }
    class Second { constructor(value){this.kind='second';this.value=value;this.target=new.target;} }
    class Child extends First {
      constructor(value){super((Object.setPrototypeOf(Child,Second),value));}
    }
    class ArrowChild extends First {
      constructor(value){const initialize=()=>super(value);initialize();}
    }
    await io.call({port:'step',input:null});
    const a=new Child(3),b=new Child(4),c=new ArrowChild(5);
    return [a.kind,a.value,a.target===Child,b.kind,b.value,b.target===Child,c.kind,c.value,c.target===ArrowChild];
  }`);
});

test('derived this binds once after successful super construction and before instance fields', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class Base { constructor(value){trace.push('base:'+value);if(value===0)throw new Error('retry');this.value=value;} }
    class Child extends Base {
      field=(trace.push('field'),1);
      constructor(){
        try{super(0);}catch(error){trace.push(error.name);}
        super(1);
        try{super(2);}catch(error){trace.push(error.name);}
      }
    }
    await io.call({port:'step',input:null});
    const value=new Child();return [trace,value.value,value.field];
  }`);
});

test('escaped super arrows retain initialized this binding across branches', async () => {
  await compare(`async function run(input,io){
    const trace=[];let again;
    class Base { constructor(value){trace.push(value);this.value=value;} }
    class Child extends Base { constructor(){super(1);again=()=>super(2);} }
    const first=new Child();
    await io.call({port:'step',input:null});
    let errorName;try{again();}catch(error){errorName=error.name;}
    return [trace,errorName,first.value];
  }`);
});

test('spread consumes custom array and arguments iterators without consulting callee apply', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    const values=[1,2];
    values[Symbol.iterator]=function*(){trace.push('iterate');yield 7;yield 8;};
    function receive(){return Array.from(arguments);}
    receive.apply=function(){throw new Error('wrong apply');};
    function Build(a,b){this.values=[a,b];}
    await io.call({port:'step',input:null});
    const array=[0,...values,(trace.push('tail'),9)],call=receive(...values),built=new Build(...values);
    function fromArguments(){arguments[Symbol.iterator]=values[Symbol.iterator];return receive(...arguments);}
    return [array,call,built.values,fromArguments(1,2),trace];
  }`);
});

test('explicit super spread uses the arguments iterator rather than the argument list', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class Base { constructor(...values){this.values=values;} }
    class Child extends Base {
      constructor(){
        arguments[Symbol.iterator]=function*(){trace.push('iterate');yield 7;yield 8;};
        super(...arguments);
      }
    }
    await io.call({port:'step',input:null});
    return [new Child(1,2).values,trace];
  }`);
});

test('spread preserves holes, iterator order and partially built arrays across IO', async () => {
  await compare(`async function run(input,io){
    const trace=[],values=[1,2];
    values[Symbol.isConcatSpreadable]=false;
    Object.defineProperty(values,'constructor',{get(){throw new Error('unexpected constructor');}});
    const array=[,...values,(trace.push('before'),await io.call({port:'step',input:null})),,...values];
    const object={ method(...args){return [this===object,args];} };
    const call=object.method(...values,(object.method=function(){return 'wrong'},9));
    return [array,0 in array,4 in array,call,trace];
  }`);
});

test('spread caches next and propagates iterator failures without extra closing', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    const iterable={ get [Symbol.iterator](){trace.push('iterator');return function(){let index=0;
      return {get next(){trace.push('next');return function(){trace.push('step');
        return {get done(){trace.push('done');return false;},get value(){trace.push('value');if(index++)throw new Error('stop');return 7;}};};},
        return(){trace.push('close');return {done:true};}};};} };
    await io.call({port:'step',input:null});
    let errorName;try{const values=[...iterable];}catch(error){errorName=error.name;}
    return [trace,errorName];
  }`);
});

test('optional member calls do not consult callee call or bind properties', async () => {
  await compare(`async function run(input,io){
    const trace=[];const object={value:7,method(...args){return [this.value,args];}};
    Object.defineProperty(object.method,'call',{get(){trace.push('call');throw new Error('wrong call');}});
    Object.defineProperty(object.method,'bind',{get(){trace.push('bind');throw new Error('wrong bind');}});
    const absent=null;
    await io.call({port:'step',input:null});
    const one=object.method?.(1),two=(object?.method)(2);
    const three=absent?.method?.(trace.push('wrong'));
    return [one,two,three===undefined,trace];
  }`);
});

test('optional calls retain selected receiver and function across suspended arguments', async () => {
  await compare(`async function run(input,io){
    const trace=[];let object={value:7,get method(){trace.push('get');return function(...args){return [this.value,args];};}};
    const result=object.method?.(await io.call({port:'step',input:null}),(object={value:9,method(){return 'wrong'}},2));
    return [result,trace,object.value];
  }`);
});

test('parenthesized optional members evaluate arguments before invalid-call errors', async () => {
  await compare(`async function run(input,io){
    const trace=[],errors=[];
    await io.call({port:'step',input:null});
    for(const value of [null,{method:null},{method:7}]){
      try{(value?.method)(trace.push('argument'));}catch(error){errors.push(error.name);}
    }
    const value=null;value?.method(trace.push('skipped'));
    return [trace,errors];
  }`);
});

test('optional lowering preserves authored call and bind properties and nested chains', async () => {
  await compare(`async function run(input,io){
    const trace=[];function fn(){return 'wrong';}
    fn.call=function(value){trace.push('authored-call');return [this===fn,value];};
    fn.bind=function(value){trace.push('authored-bind');return [this===fn,value];};
    const object={make(){return {value:8,read(){return this.value;}};}};
    await io.call({port:'step',input:null});
    return [fn.call?.(3),(fn?.bind)(4),(object?.make?.().read)(5),object.make?.()?.read?.(),trace];
  }`);
});

test('super method calls do not consult overridden apply properties', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    class Base { method(value){return [this.value,value];} }
    Object.defineProperty(Base.prototype.method,'apply',{get(){trace.push('apply');throw new Error('wrong apply');}});
    class Child extends Base {
      constructor(){super();this.value=7;}
      direct(){return super.method(1);}
      optional(){return super.method?.(2);}
    }
    const child=new Child();
    await io.call({port:'step',input:null});
    return [child.direct(),child.optional(),trace];
  }`);
});

test('super invocation retains the selected method and receiver while arguments await IO', async () => {
  await compare(`async function run(input,io){
    const trace=[];let method=function(...args){return [this.value,args];};
    Object.defineProperty(method,'apply',{get(){throw new Error('wrong apply');}});
    const base={get read(){trace.push('get');return method;}};
    const object={__proto__:base,value:7,async execute(){
      return super.read(await io.call({port:'step',input:null}),(method=function(){return 'wrong'},9));
    }};
    const result=await object.execute();return [result,trace];
  }`);
});

test('instance and static super calls consume spread iterators through the same call boundary', async () => {
  await compare(`async function run(input,io){
    const trace=[],values=[1,2];
    values[Symbol.iterator]=function*(){trace.push('iterate');yield 7;yield 8;};
    class Base {method(...args){return [this.value,args];} static method(...args){return [this===Child,args];}}
    class Child extends Base {
      constructor(){super();this.value=3;}
      direct(){return super.method(...values);}
      optional(){return super.method?.(...values);}
      static direct(){return super.method(...values);}
    }
    for(const method of [Base.prototype.method,Base.method])Object.defineProperty(method,'apply',{get(){throw new Error('wrong apply');}});
    const child=new Child();await io.call({port:'step',input:null});
    return [child.direct(),child.optional(),Child.direct(),trace];
  }`);
});

test('compiler property-key helpers invoke coercion without reading its call property', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    function convert(hint){trace.push(hint);return 'field';}
    Object.defineProperty(convert,'call',{get(){trace.push('call');throw new Error('wrong call');}});
    const key={ [Symbol.toPrimitive]:convert };
    await io.call({port:'step',input:null});
    class Box { [key]=7; }
    const object={field:3,other:4};const {[key]:picked,...rest}=object;
    return [new Box().field,picked,rest,trace];
  }`);
});

test('computed class field keys convert at definition once for all instances', async () => {
  await compare(`async function run(input,io){
    const trace=[];let field='first';
    const key={toString(){trace.push(field);return field;}};
    class Box{[key]=7;static [key]=8;}
    field='second';
    await io.call({port:'step',input:null});
    const a=new Box(),b=new Box();
    return [Object.keys(a),Object.keys(b),Box.first,trace];
  }`);
});

test('TypeScript bundling preserves computed fields for the shared semantic lowering', async () => {
  const compiled = await compileTypeScript(`export const program={schemas:{},async run(input:null,io:{call:(request:unknown)=>Promise<number>}){
    const trace:string[]=[];
    const key=({[Symbol.toPrimitive](hint:string){trace.push(hint);return 'field';}}) as unknown as 'field';
    class Box{[key]=7;}
    await io.call({port:'step',input:null});
    const a=new Box(),b=new Box();
    return [a.field,b.field,trace];
  }};`);
  const parent = new ProgramExecution(decode(compiled.content));
  parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const instance of [parent, parent.fork(), restored]) {
    instance.resume(3);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, [7, 7, ['string']]);
  }
});

test('TypeScript bundling preserves module lexical initialization before entry runs', async () => {
  const compiled = await compileTypeScript(`
    const trace:string[]=[];
    function read(){return value;}
    try{read();trace.push('wrong');}catch(error){trace.push((error as Error).name);}
    let value=7;
    export const program={schemas:{},async run(input:null,io:{call:(request:unknown)=>Promise<number>}){
      await io.call({port:'step',input:null});
      return [trace,read()];
    }};
  `);
  const parent = new ProgramExecution(decode(compiled.content)); parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const instance of [parent, parent.fork(), restored]) {
    instance.resume(3);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, [['ReferenceError'], 7]);
  }
});

test('object patterns interleave key conversion, reads and defaults on captured RHS', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    let source={get a(){trace.push('get-a');return undefined;},get b(){trace.push('get-b');return 2;},c:3};
    const keyA={toString(){trace.push('key-a');source={a:10,b:20,c:30};return 'a';}};
    const keyB={toString(){trace.push('key-b');return 'b';}};
    await io.call({port:'step',input:null});
    const {[keyA]:a=(trace.push('default-a'),1),[keyB]:b,...rest}=source;
    let caught='';try{const {[keyA]:bad}=null;}catch(error){caught=error.name;}
    return [a,b,rest,trace,caught];
  }`);
});

test('object pattern key conversion works in assignments, parameters and loop bindings', async () => {
  await compare(`async function run(input,io){
    const trace=[];const key={toString(){trace.push('key');return 'a';}};
    function read({[key]:value,...rest}){return [value,rest];}
    await io.call({port:'step',input:null});
    let value,rest;({[key]:value,...rest}={a:1,b:2});
    const results=[[value,rest],read({a:3,b:4})];
    for(const {[key]:value,...rest} of [{a:5,b:6}])results.push([value,rest]);
    return [results,trace];
  }`);
});

test('object rest creates own data properties and snapshots keys before getters', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const symbol=Symbol('late'),trace=[];
    function source(){
      const object={skip:0,get first(){trace.push('first');object[symbol]=9;return 1;}};
      Object.defineProperty(object,'__proto__',{value:{hidden:3},enumerable:true});
      return object;
    }
    const {...all}=source();const {skip,...rest}=source();
    return [all.first,rest.first,Object.hasOwn(all,'__proto__'),Object.hasOwn(rest,'__proto__'),
      Object.getPrototypeOf(all)===Object.prototype,Object.getPrototypeOf(rest)===Object.prototype,
      Object.getOwnPropertySymbols(all).length,Object.getOwnPropertySymbols(rest).length,trace];
  }`);
});

test('object rest checks current descriptors, skips excluded getters and preserves symbols', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[],symbol=Symbol('kept');
    const source={get first(){trace.push('first');delete source.deleted;
      Object.defineProperty(source,'hidden',{enumerable:true});
      Object.defineProperty(source,'later',{enumerable:false});return 1;},
      deleted:2,later:3,[symbol]:4};
    Object.defineProperty(source,'hidden',{value:5,enumerable:false,configurable:true});
    const {...all}=source;
    const {first,...rest}=source;
    const {length,...characters}='ab';
    const {...number}=7;
    return [Object.keys(all),all.hidden,Object.keys(rest),rest[symbol],Object.getOwnPropertyDescriptor(rest,symbol),characters,number,trace];
  }`);
});

test('object rest retains copied aliases across IO and fork', async () => {
  await compare(`async function run(input,io){
    const value={count:1};const {skip,...rest}={skip:0,left:value,right:value};
    const reply=await io.call({port:'step',input:null});
    rest.left.count=reply;
    return [rest.left===rest.right,rest.right.count,value.count];
  }`);
});

test('object spread runs getters before later property and spread expressions', async () => {
  await compare(`async function run(input,io){
    const trace=[];let value=1;
    const first={get x(){trace.push('getter');value=2;return value;}};
    const result={...first,[(trace.push('key'), 'y')]:(trace.push('value'),value),
      ...(trace.push('spread'),{z:value}),reply:await io.call({port:'step',input:null})};
    return [result,trace];
  }`);
});

test('object spread checks symbol enumerability after earlier getters and retains literal prototype', async () => {
  await compare(`async function run(input,io){
    const symbol=Symbol('value');
    const source={get first(){Object.defineProperty(source,symbol,{enumerable:true});return 1;}};
    Object.defineProperty(source,symbol,{value:2,enumerable:false,configurable:true});
    const parent={answer:7};
    const result={...source,__proto__:parent,method(){return super.answer;}};
    await io.call({port:'step',input:null});
    return [result[symbol],Object.getPrototypeOf(result)===parent,result.method(),result.answer];
  }`);
});

test('object spread preserves one method home, data descriptors and primitive source semantics', async () => {
  await compare(`async function run(input,io){
    const trace=[],parent={answer:1,set x(value){trace.push('setter');}};
    const result={__proto__:parent,method(){return super.answer;},get x(){return 9;},
      ...null,...undefined,...7,...'ab',...{x:2}};
    const reply=await io.call({port:'step',input:null});
    Object.setPrototypeOf(result,{answer:reply});
    return [result.method(),Object.getOwnPropertyDescriptor(result,'x'),result[0],result[1],trace];
  }`);
});

test('array destructuring interleaves iterator steps with defaults and closes after bindings', async () => {
  await compare(`async function run(input,io){
    const trace=[];let value=1;
    const iterable={ [Symbol.iterator](){let index=0;return {
      next(){trace.push('next-'+index);return {value:index++===0?undefined:value,done:false};},
      return(){trace.push('return');return {};}
    };} };
    const [first=(trace.push('default'),value=await io.call({port:'step',input:null})),second]=iterable;
    return [first,second,trace];
  }`);
});

test('array destructuring respects overridden array iterators and empty-pattern close', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[],array=[1,2];
    array[Symbol.iterator]=function(){let index=0;trace.push('open');return {
      next(){trace.push('next');return {value:7+index++,done:false};},
      return(){trace.push('close');return {};}
    };};
    const [first]=array;const []=array;
    return [first,trace];
  }`);
});

test('array destructuring closes on a failing default before the enclosing catch runs', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[];
    const iterable={ [Symbol.iterator](){return {
      next(){trace.push('next');return {value:undefined,done:false};},
      return(){trace.push('close');throw new Error('close');}
    };} };
    function fail(){trace.push('default');throw new Error('default');}
    try{const [value=fail()]=iterable;}catch(error){trace.push(error.message);}
    return trace;
  }`);
});

test('array destructuring closes nested iterators inside-out before catch and finally', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[];
    function iterable(name,value){return {[Symbol.iterator](){return {
      next(){trace.push(name+'-next');return {value,done:false};},
      return(){trace.push(name+'-close');throw new Error(name);}
    };}};}
    function fail(){throw new Error('default');}
    try{const [[value=fail()]]=iterable('outer',iterable('inner',undefined));}
    catch(error){trace.push(error.message);}finally{trace.push('finally');}
    return trace;
  }`);
});

test('array destructuring keeps outer lexical captures and loop binding scopes', async () => {
  await compare(`async function run(input,io){
    function earlier(){return value;}
    const [value=await io.call({port:'step',input:null})]=[undefined];
    const functions=[];
    for(const [item] of [[1],[2]])functions.push(()=>item);
    let total=0;for(let [index]=[0];index<2;index++)total+=index;
    return [earlier(),functions.map(fn=>fn()),total];
  }`);
});

test('array destructuring generator return closes before author finally across IO', async () => {
  await compare(`async function run(input,io){
    const trace=[];const iterable={ [Symbol.iterator](){return {
      next(){trace.push('next');return {done:false,value:undefined};},
      return(){trace.push('close');return {};}
    };} };
    function* generate(){try{const [value=yield 'pause']=iterable;return value;}finally{trace.push('finally');}}
    const iterator=generate(),first=iterator.next();
    const reply=await io.call({port:'step',input:null});
    return [first,iterator.return(reply),trace];
  }`);
});

test('array destructuring handles elisions, rest, assignment and parameter bindings', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[];
    function source(){return {[Symbol.iterator](){let index=0;return {
      next(){const n=index++;return {done:n>=3,get value(){trace.push(n);return n;}};},
      return(){trace.push('close');return {};}
    };}};}
    function take([,value,...rest]){return [value,rest];}
    let value,rest;const assignment=([,value,...rest]=source());
    return [value,rest,take(source()),assignment!==undefined,trace];
  }`);
});

test('array destructuring evaluates assignment references before stepping and defaulting', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[],target={};
    function object(){trace.push('reference');return target;}
    const iterable={ [Symbol.iterator](){return {
      next(){trace.push('next');return {value:undefined,done:false};},
      return(){trace.push('close');return {};}
    };} };
    [object().value=(trace.push('default'),3)]=iterable;
    return [target.value,trace];
  }`);
});

test('for-of caches next and invokes iterator methods without reading call', async () => {
  await compare(`async function run(input,io){
    const trace=[];let index=0;
    const iterator={get next(){trace.push('next-get');return ()=>({value:index++,done:false});},
      get return(){trace.push('return-get');return ()=>{trace.push('close');return {};};}};
    function acquire(){trace.push('open');return iterator;}
    Object.defineProperty(acquire,'call',{get(){throw new Error('wrong call');}});
    const values=[];
    for(const value of {[Symbol.iterator]:acquire}){
      values.push(value);if(value===0)await io.call({port:'step',input:null});else break;
    }
    return [values,trace];
  }`);
});

test('for-of rejects missing iterators and primitive close results', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const outcomes=[];const array=[1];array[Symbol.iterator]=null;
    for(const source of [array,{'@@iterator'(){return {next(){return {done:true};}};}},
      {[Symbol.iterator](){return {next(){return {done:false,value:1};},return(){return 7;}};}}]){
      try{for(const value of source){break;}outcomes.push('ok');}catch(error){outcomes.push(error.name);}
    }
    return outcomes;
  }`);
});

test('for-of primitive close diagnostics match native V8 after IO and branches', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const result=[];
    for(const value of [0,null,undefined,1n,Symbol('s')]){
      const source={[Symbol.iterator](){return {
        next(){return {done:false,value:1};},return(){return value;}
      };}};
      try{for(const item of source)break;result.push(null);}
      catch(error){result.push([error.name,error.message]);}
    }
    return result;
  }`);
});

test('for-of labelled continue and break close only the exited iterations', async () => {
  await compare(`async function run(input,io){
    const trace=[],closures=[];
    function iterable(name){return {[Symbol.iterator](){let index=0;return {
      next(){return {value:index++,done:index>3};},return(){trace.push(name);return {};}
    };}};}
    outer:alias:for(const x of iterable('outer')){
      closures.push(()=>x);
      for(const y of iterable('inner')){
        if(x===0)continue outer;
        await io.call({port:'step',input:null});
        break alias;
      }
    }
    return [trace,closures.map(fn=>fn())];
  }`);
});

test('for-of preserves body errors over close errors without closing failed next', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[];
    for(const mode of ['body','next','value']){
      const source={ [Symbol.iterator](){return {
        next(){if(mode==='next')throw new Error('next');return {done:false,get value(){
          if(mode==='value')throw new Error('value');return 1;}};},
        return(){trace.push('close');throw new Error('return');}
      };} };
      try{for(const x of source){throw new Error('body');}}catch(error){trace.push(error.message);}
    }
    return trace;
  }`);
});

test('labelled continue preserves per-iteration closures in ordinary for loops', async () => {
  await compare(`async function run(input,io){
    const functions=[],trace=[];
    outer:alias:for(let index=0;index<3;index++){
      functions.push(()=>index);
      try{continue outer;}finally{trace.push(index);}
    }
    await io.call({port:'step',input:null});
    return [functions.map(fn=>fn()),trace];
  }`);
});

test('for-of loop-head bindings shadow outer names during RHS evaluation', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const outcomes=[];let value=[1];
    try{for(let value of value){}outcomes.push('ok');}catch(error){outcomes.push(error.name);}
    try{for(const value of (typeof value,[])){}outcomes.push('ok');}catch(error){outcomes.push(error.name);}
    return outcomes;
  }`);
});

test('for-of RHS closures retain uninitialized head bindings and writes keep evaluation order', async () => {
  await compare(`async function run(input,io){
    const trace=[];let read;
    for(const {value} of (read=()=>value,[])){}
    const reply=await io.call({port:'step',input:null});
    try{read();}catch(error){trace.push(error.name);}
    try{for(let value of (value=(trace.push(reply),[]))){} }catch(error){trace.push(error.name);}
    for(const value of ((value)=>value)([3]))trace.push(value);
    return trace;
  }`);
});

test('for-await preserves body rejection over close rejection and does not close failed next', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});
    const trace=[];
    for(const mode of ['body','next','done','value']){
      const source={ [Symbol.asyncIterator](){return {
        async next(){if(mode==='next')throw new Error('next');return {
          get done(){if(mode==='done')throw new Error('done');return false;},
          get value(){if(mode==='value')throw new Error('value');return 1;}};},
        async return(){trace.push('close');throw new Error('close');}
      };} };
      try{for await(const value of source){throw new Error('body');}}catch(error){trace.push(error.message);}
    }
    return trace;
  }`);
});

test('for-await sync adaptation closes on rejected yielded values with original rejection', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});const trace=[];
    const source={ [Symbol.iterator](){return {
      next(){return {value:Promise.reject(new Error('value')),done:false};},
      return(){trace.push('close');throw new Error('close');}
    };} };
    try{for await(const value of source){trace.push(value);}}catch(error){trace.push(error.message);}
    return trace;
  }`);
});

test('for-await close preserves completion kind through suspended return and nested loops', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    function source(name){return { [Symbol.asyncIterator](){return {
      next(){return Promise.resolve({done:false,value:1});},
      async return(){trace.push(name);await io.call({port:'step',input:null});throw new Error(name);}
    };} };}
    await io.call({port:'step',input:null});
    try{for await(const value of source('undefined')){throw undefined;}}catch(error){trace.push(error===undefined);}
    try{for await(const value of source('break')){break;}}catch(error){trace.push(error.message);}
    async function finish(){for await(const value of source('return')){return 9;}}
    try{await finish();}catch(error){trace.push(error.message);}
    try{for await(const outer of source('outer')){for await(const inner of source('inner')){throw new Error('body');}}}
    catch(error){trace.push(error.message);}
    return trace;
  }`);
});

test('for-await closes after assignment failure and preserves repeated loop completion state', async () => {
  await compare(`async function run(input,io){
    await io.call({port:'step',input:null});const trace=[];
    function source(){return { [Symbol.asyncIterator](){let n=0;return {
      async next(){return {done:n++>0,value:7};},
      get return(){trace.push('get return');throw new Error('close');}
    };} };}
    for(let pass=0;pass<3;pass++){
      try{for await(const item of source()){if(pass===0)throw undefined;if(pass===1)break;}}
      catch(error){trace.push(error===undefined?'undefined':error.message);}
    }
    const target={set value(v){trace.push(v);throw new Error('set');}};
    try{for await(target.value of source()){} }catch(error){trace.push(error.message);}
    return trace;
  }`);
});

test('for-await lexical head is uninitialized while acquiring RHS including retained closures', async () => {
  await compare(`async function run(input,io){
    const trace=[];let value=[1],read;
    try{for await(let value of value){trace.push('body');}}catch(error){trace.push(error.name);}
    try{for await(let value of (trace.push(typeof value),[])){} }catch(error){trace.push(error.name);}
    for await(const {value} of (read=()=>value,[])){}
    await io.call({port:'step',input:null});
    try{read();}catch(error){trace.push(error.name);}
    try{for await(let value of (value=(trace.push('rhs'),[]))){} }catch(error){trace.push(error.name);}
    for await(const value of ((value)=>value)([4]))trace.push(value);
    return trace;
  }`);
});

test('for-await labelled continue preserves iteration cells and break closes through finally', async () => {
  await compare(`async function run(input,io){
    const trace=[],reads=[];
    const source={ [Symbol.asyncIterator](){let n=0;return {
      async next(){return {done:n>=3,value:++n};},
      async return(){trace.push('close');return {done:true};}
    };} };
    outer: inner: for await(let value of source){
      reads.push(()=>value);
      try{await io.call({port:'step',input:null});if(value<3)continue outer;break inner;}
      finally{trace.push(value);}
    }
    return [trace,reads.map(read=>read())];
  }`);
});

test('implicit native exceptions preserve prototype and aliases through persistence', async () => {
  await compare(`async function run(input,io){
    const errors=[];
    for(const operation of [()=>JSON.parse('{'),()=>Number(1).toFixed(999),()=>null.value]){
      try{operation();}catch(error){errors.push(error);}
    }
    try{for await(let value of value){} }catch(error){errors.push(error);}
    const constructors=errors.map(error=>Object.getPrototypeOf(error).constructor);
    await io.call({port:'step',input:null});
    return errors.map((error,index)=>[error.name,error instanceof constructors[index],
      Object.getPrototypeOf(error)===constructors[index].prototype]);
  }`);
});

test('for-await normal iteration and same-loop continue do not close but outer continue does', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    function source(){return { [Symbol.asyncIterator](){let n=0;return {
      async next(){return {done:n>=2,value:++n};},
      async return(){trace.push('close');return {done:true};}
    };} };}
    await io.call({port:'step',input:null});
    for await(var value of source()){trace.push(value);continue;}
    for await(const value of source()){trace.push(value);}
    outer:for(let i=0;i<2;i++){for await(const value of source()){trace.push(value);continue outer;}}
    return trace;
  }`);
});

// Derived regressions, not an unmodified Test262 execution. Reference baseline:
// tc39/test262@2e0a56762801e275a9fdf96dc49d90ba0cddcf63,
// language/statements/let/{function,block}-local-closure-{get,set}-before-initialization.
test('lexical bindings preserve TDZ reads writes and typeof through captured closures', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    function read(){return value;}
    function write(){value=(trace.push('rhs'),7);}
    for(const operation of [read,write,()=>typeof value]){
      try{operation();}catch(error){trace.push(error.name);}
    }
    await io.call({port:'step',input:null});
    try{read();}catch(error){trace.push(error.name);}
    let value=4;trace.push(read());write();trace.push(read());
    {try{trace.push(local);}catch(error){trace.push(error.name);}let local=9;trace.push(local);}
    return trace;
  }`);
});

test('constant assignment evaluates RHS and throws without mutating captured binding', async () => {
  await compare(`async function run(input,io){
    const trace=[],value=3;
    function write(){value=(trace.push('rhs'),7);}
    await io.call({port:'step',input:null});
    for(const operation of [write,()=>++value,()=>value+=2]){
      try{operation();}catch(error){trace.push(error.name);}
      trace.push(value);
    }
    return trace;
  }`);
});

test('lexical environments reset at block entry and distinguish loop initializer captures', async () => {
  await compare(`async function run(input,io){
    const trace=[],reads=[];let initRead;
    for(let value=(initRead=()=>value,0);value<3;value++){
      reads.push(()=>value);
      await io.call({port:'step',input:null});
      try{trace.push(local);}catch(error){trace.push(error.name);}
      let local=value;reads.push(()=>local);
      if(value===1)continue;
    }
    trace.push(initRead(),reads.map(read=>read()));
    const outer=3;
    switch(outer){case 3:try{trace.push(inner);}catch(error){trace.push(error.name);}let inner=8;trace.push(inner);break;}
    return trace;
  }`);
});

test('lexical binding initialization handles self defaults and const logical writes', async () => {
  await compare(`async function run(input,io){
    const trace=[];
    try{let value=value;}catch(error){trace.push(error.name);}
    try{const [value=value]=[];}catch(error){trace.push(error.name);}
    const zero=0,one=1,empty=null;
    await io.call({port:'step',input:null});
    for(const operation of [()=>zero&&=(trace.push('wrong'),2),()=>one||=(trace.push('wrong'),2),
      ()=>one??=(trace.push('wrong'),2),()=>empty??=(trace.push('rhs'),2)]){
      try{trace.push(operation());}catch(error){trace.push(error.name);}
    }
    return trace;
  }`);
});

test('iteration assignments use lexical writes and close after a rejected constant write', async () => {
  await compare(`async function run(input,io){
    const trace=[];let value=0;const fixed=1;
    await io.call({port:'step',input:null});
    for(value of [2,3])trace.push(value);
    for(value in {a:1,b:2})trace.push(value);
    const source={ [Symbol.asyncIterator](){return {
      async next(){return {done:false,value:5};},async return(){trace.push('close');return {done:true};}
    };} };
    try{for await(fixed of source){} }catch(error){trace.push(error.name);}
    trace.push(fixed,value);return trace;
  }`);
});


test('class name cells belong to each repeated evaluation and field activation', async () => {
  await compare(`async function run(input,io){
    const classes=[],readers=[];
    for(let i=0;i<3;i++) classes.push(class C{static read=()=>C;});
    let i=0;
    while((readers.push(class W{static read=()=>W;}),i++<2)){}
    do {i--;} while((readers.push(class D{static read=()=>D;}),i>0));
    for(let j=0;(readers.push(class T{static read=()=>T;}),j<2);j++,readers.push(class U{static read=()=>U;})){}
    class Outer{inner=class I{static read=()=>I;};}
    classes.push(new Outer().inner,new Outer().inner);
    const make=(C=class P{static read=()=>P;})=>C;
    classes.push(make(),make());
    await io.call({port:'step',input:null});
    return [classes.map(C=>C.read()===C),readers.map(C=>C.read()===C),classes[3]!==classes[4]];
  }`);
});

test('class name initialization survives later static failure but not heritage failure', async () => {
  await compare(`async function run(input,io){
    let early,late;const trace=[];
    try{const C=class C extends (early=()=>C,3){};}catch(error){trace.push(error.name);}
    try{const C=class C{static read=(late=()=>C);static fail=(()=>{throw 1;})();};}catch(error){trace.push(error);}
    await io.call({port:'step',input:null});
    try{early();}catch(error){trace.push(error.name);}
    return [trace,late().read===late];
  }`);
});


test('class binding allocation preserves labelled nested loop control and suspended keys', async () => {
  await compare(`async function run(input,io){
    const values=[];let i=0;
    outer:while((values.push(class O{static self=()=>O;}),i++<2)){
      for(var j=0;(values.push(class V{static self=()=>V;}),j<2);j++){
        if(j===1)continue outer;
      }
    }
    for(const once=1;(values.push(class K{static self=()=>K;}),false);){}
    let read;
    class C{[(read=()=>C,await io.call({port:'step',input:null}))](){return C;}}
    return [values.map(C=>C.self()===C),read()===C,new C()[Object.getOwnPropertyNames(C.prototype).find(key=>key!=="constructor")]()===C];
  }`);
});

test('member updates match native property key conversion across fork and restore', async () => {
  for (const expression of ['++base[key]', 'base[key]++', '--base[key]', 'base[key]--']) {
    await compare(`async function run(input,io){
      let conversions=0;
      const base={x:'3'};
      const key={toString(){conversions++;return 'x';}};
      await io.call({port:'step',input:null});
      const result=${expression};
      return {conversions,result,value:base.x};
    }`);
  }
});

test('compound member references retain raw keys and receivers across suspended RHS', async () => {
  for(const operator of ['+=','&&=','||=','??=']) {
    await compare(`async function run(input,io){
      let conversions=0;const trace=[];
      let object={first:${operator==='||='?'0':operator==='??='?'null':'2'},second:10};
      const original=object;
      const key={toString(){trace.push('key');return ++conversions===1?'first':'second';}};
      const value=object[key]${operator}await io.call({port:'step',input:null});
      object={first:99};
      return [value,original.first,original.second,conversions,trace];
    }`);
  }
});

test('inferred function names need not be legal function declaration identifiers', async () => {
  await compare(`async function run(input,io){
    const functions={
      default:function(){return 1;}, class:function(){return 2;},
      null:function(){return 3;}, true:function(){return 4;},
      return:function(){return 5;}, enum:function(){return 6;},
      implements:function(){return 7;}, await:function(){return 8;},
      yield:function(){return 9;}, '123':function(){return 10;},
      'has space':function(){return 11;}, λ:function(){return 12;}
    };
    await io.call({port:'step',input:null});
    return Object.keys(functions).map(key=>[key,functions[key].name,functions[key]()]);
  }`);
});

test('author-created function prototype objects retain aliases for nonconstructable functions', async () => {
  await compare(`async function run(input,io){
    const arrow=()=>1;
    const asynchronous=async function(){return 2;};
    const method={run(){return 3;}}.run;
    const generator=function*(){yield 4;};
    const functions=[arrow,asynchronous,method,generator];
    const prototypes=functions.map(fn=>{
      const prototype={};
      Object.defineProperty(prototype,'constructor',{value:fn,writable:true,configurable:true});
      fn.prototype=prototype;
      return prototype;
    });
    const amount=await io.call({port:'step',input:null});
    const previous=prototypes[0].marker??null;
    prototypes[0].marker=amount;
    return [previous,prototypes[0].marker,functions.map((fn,index)=>[
      fn.prototype===prototypes[index],
      prototypes[index].constructor===fn,
      Object.getPrototypeOf(prototypes[index])===Object.prototype
    ])];
  }`);
});

test('deleted and reinserted function properties keep their absence and key order after copying', async () => {
  await compare(`async function run(input,io){
    const removed=()=>1;
    delete removed.name;delete removed.length;
    const functions=[function original(a,b){return a;},()=>2,async function(){return 3;},{method(){return 4;}}.method];
    for(const fn of functions){
      delete fn.name;delete fn.length;
      fn.extra='extra';
      Object.defineProperty(fn,'name',{value:'renamed',configurable:true});
      Object.defineProperty(fn,'length',{value:9,configurable:true});
    }
    await io.call({port:'step',input:null});
    return [Object.getOwnPropertyNames(removed),functions.map(fn=>[Object.getOwnPropertyNames(fn),fn.name,fn.length])];
  }`);
});

test('error own properties retain deletion and insertion order across fork and restore', async () => {
  await compare(`async function run(input,io){
    const removed=new Error('gone');delete removed.stack;delete removed.message;
    const reordered=new TypeError('old');delete reordered.stack;delete reordered.message;
    reordered.extra='extra';reordered.message='new';reordered.stack='assigned';
    Object.seal(reordered);
    await io.call({port:'step',input:null});
    return [Object.getOwnPropertyNames(removed),Object.getOwnPropertyNames(reordered),reordered.message,reordered.stack,Object.isSealed(reordered)];
  }`);
});

test('host-only globals stay absent across IO, fork and restore', () => {
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(input,io){
    const names=['URL','File','atob','btoa'];
    const before=names.map(name=>[name,name in globalThis]);
    const reply=await io.call({port:'step',input:before});
    const after=names.map(name=>[name,name in globalThis]);
    return {before,after,reply};
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const absent=['URL','File','atob','btoa'].map(name=>[name,false]);
  assert.deepEqual(parent.io.callData.input,absent);
  const restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance] of [parent,parent.fork(),restored].entries()){
    instance.resume(index);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,{before:absent,after:absent,reply:index});
  }
});

test('literal prototypes preserve evaluation order, property forms and super across IO', async () => {
  await compare(`async function(_,io){
    const trace=[];
    async function choose(){trace.push('choose');const mark=await io.call({port:'step',input:null});return {mark};}
    const value={before:(trace.push('before'),1),__proto__:(trace.push('prototype'),await choose()),
      [trace.push('key')&&'after']:(trace.push('after'),2)};
    const prototype=Object.getPrototypeOf(value);
    const __proto__=prototype;
    const shorthand={__proto__},computed={['__proto__']:prototype},quoted={'__proto__':null};
    const ignored={__proto__:7};
    const home={__proto__:prototype,read(){return super.mark;}};
    const before=home.read();
    const reply=await io.call({port:'step',input:null});
    Object.setPrototypeOf(home,{mark:reply+10});
    return [trace,value.mark,Object.keys(value),Object.hasOwn(value,'__proto__'),
      shorthand.__proto__===prototype,computed.__proto__===prototype,
      Object.hasOwn(shorthand,'__proto__'),Object.hasOwn(computed,'__proto__'),
      Object.getPrototypeOf(quoted)===null,Object.getPrototypeOf(ignored)===Object.prototype,
      before,home.read()];
  }`);
});

test('literal initialization does not resolve generated intrinsics through author bindings', async () => {
  await compare(`async function(_,io){
    const Object=null;
    const value={__proto__:null,answer:await io.call({port:'step',input:null})};
    const other={answer:value.answer,read(){return this.answer;}};
    return [value.answer,other.read(),Object];
  }`);
});

test('direct internal operations preserve suspended operands, coercion order and thrown reads',async()=>{
  await compare(`async function run(_,io){
    const trace=[];
    const key={ [Symbol.toPrimitive](){trace.push('key');return 'x';} };
    const object={get x(){trace.push('get');return 3;}};
    const value=object[(trace.push('before'),await io.call({port:'step',input:0}),key)];
    const equal=value===await io.call({port:'step',input:1});
    const array=[await io.call({port:'step',input:2})];
    const record={value:await io.call({port:'step',input:3})};
    try{null[await io.call({port:'step',input:4})];}catch(error){trace.push(error.name);}
    const converted={valueOf(){trace.push('convert');return 3;}};
    const loose=converted==3;
    await io.call({port:'step',input:5});
    return [equal,loose,value,array[0],record.value,trace];
  }`);
});

test('private call vectors and suspended spread builders preserve arguments across fork and restore',async()=>{
  await compare(`async function run(_,io){
    const trace=[];
    function take(a,b,c){arguments[0]='changed';return [a,b,c,arguments[0]];}
    class Box{constructor(a,b){this.values=[a,b];}}
    const held={value:1};
    const first=take((trace.push('first'),held),await io.call({port:'step',input:0}),
      (held.value++,await io.call({port:'step',input:1})));
    const second=take(...[held],await io.call({port:'step',input:2}),...[held.value]);
    const box=new Box(await io.call({port:'step',input:3}),held);
    await io.call({port:'step',input:4});
    return [first,second,box.values,first[0]===second[0],box.values[1]===held,trace];
  }`);
});

test('internal iterator results preserve cached next methods and exposed result isolation',async()=>{
  await compare(`async function run(_,io){
    const trace=[],cursor=[2,4].values(),next=cursor.next;
    const exposed=[8,9].values().next();
    exposed.value=await io.call({port:'step',input:0});
    Object.defineProperty(cursor,'next',{configurable:true,get(){trace.push('get-next');return next;}});
    for(const value of {[Symbol.iterator](){return cursor;}}){
      trace.push(value);
      Object.defineProperty(cursor,'next',{configurable:true,value(){trace.push('replacement');return {done:true};}});
      await io.call({port:'step',input:value});
    }
    const pairs=[];
    for(const pair of new Map([['a',1],['b',2]])){
      pair[1]+=await io.call({port:'step',input:pair[1]});pairs.push(pair);
    }
    const values=[];for(const value of new Set([3,5]))values.push(value);
    await io.call({port:'step',input:1});
    return [exposed,trace,pairs,values];
  }`);
});

test('synchronous captured bindings distinguish reads from transitive writes across branches', async () => {
  await compare(`async function(_,io){
    function create(seed){
      let value=seed; const object={value:seed};
      const read=()=>[value,object.value];
      const nested=()=>()=>{value+=2;object.value+=3;return read();};
      const before=read(); value+=1;
      return {read,nested,before};
    }
    function readonly(seed){
      let value=seed;
      const read=()=>value;
      const early=read(); value+=5;
      const object={value};
      return {read,early,object,mutate:delta=>object.value+=delta};
    }
    function parameter(value){
      return {read:()=>value, make:()=>delta=>{value+=delta;return value;},
        assign:next=>{[value]=[next];return value;},
        iterate:next=>{for(value of [next,next+1]){}return value;}};
    }
    const param=parameter(100),change=param.make();
    const a=create(1),b=create(10),c=readonly(20);
    const write=a.nested();
    const first=await io.call({port:'step',input:null});
    const one=[write(),b.read(),c.read(),c.mutate(first),c.early,change(first),param.assign(first+10)];
    const second=await io.call({port:'step',input:null});
    return [one,write(),b.nested()(),c.mutate(second),a.before,c.read(),change(second),param.read(),param.iterate(second)];
  }`);
});

test('captured loop scopes retain independent reads and transitive writes after synchronous return', async () => {
  await compare(`async function(_,io){
    function create(seed){
      const reads=[],writes=[],objects=[];
      for(let i=0;i<3;i++){
        let value=seed+i; const object={value}; objects.push(object);
        reads.push(()=>[i,value,object.value]);
        writes.push(()=>delta=>{value+=delta;seed+=delta;object.value+=delta;});
      }
      return {reads,writes,objects,seed:()=>seed};
    }
    function readers(seed){
      const reads=[];
      for(let i=0;i<3;i++){const object={value:seed+i};reads.push(()=>[i,object]);}
      return reads;
    }
    const a=create(5),b=create(50),read=readers(100),write=a.writes[1]();
    const first=await io.call({port:'step',input:null});
    write(first);read[0]()[1].value+=first;
    const before=[a.reads.map(fn=>fn()),b.reads.map(fn=>fn()),read.map(fn=>fn())];
    const second=await io.call({port:'step',input:null});
    a.writes[0]()(second);read[1]()[1].value+=second;
    return [before,a.reads.map(fn=>fn()),a.seed(),b.seed(),read.map(fn=>fn())];
  }`);
});

test('fixed missing reads observe later insertion, accessors and prototype replacement across IO', async () => {
  await compare(`async function(_,io){
    const object={};const read=()=>object.optional;
    const trace=[];
    for(let i=0;i<4;i++)trace.push(read()===undefined);
    const first=await io.call({port:'step',input:null});
    object.optional=first;trace.push(read());
    delete object.optional;trace.push(read()===undefined);
    const second=await io.call({port:'step',input:null});
    Object.defineProperty(object,'optional',{get(){return second*2;},configurable:true});
    trace.push(read());delete object.optional;
    const prototype={optional:second*3};Object.setPrototypeOf(object,prototype);
    trace.push(read());delete prototype.optional;trace.push(read()===undefined);
    prototype.optional=second*4;trace.push(read());
    return trace;
  }`);
});
