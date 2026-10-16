import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

type Driver={invoke:(fn:Function,self:unknown,args:any[])=>any;construct:(fn:Function,args:any[],target?:Function)=>any};
const native:Driver={invoke:(fn,self,args)=>Reflect.apply(fn,self,args),construct:(fn,args,target=fn)=>Reflect.construct(fn,args,target)};
function outcome(action:()=>unknown){try{return {value:action()};}catch(error){return {error:(error as Error).name};}}
function convertible(trace:unknown[],name:string,value:unknown,fail?:string){
  const object={get [Symbol.toPrimitive](){
    trace.push([name,'get']);if(fail===name+'-get')throw new RangeError();
    return function(this:unknown,hint:string){
      trace.push([name,hint,this===object]);if(fail===name)throw new SyntaxError();return value;
    };
  }};
  return object;
}

test('split limits and noncallable replacement values retain guarded conversion and native order',()=>{
  for(const method of [String.prototype.split,String.prototype.replace,String.prototype.replaceAll])
  for(const search of ['x','missing',''])for(const value of [0,2,-1,2n,Symbol('value'),'[$&]'])
  for(const fail of [undefined,'receiver','search','argument']){
    function run(driver:Driver){
      const trace:unknown[]=[];
      const receiver=convertible(trace,'receiver','xx',fail),pattern=convertible(trace,'search',search,fail),argument=convertible(trace,'argument',value,fail);
      return {result:outcome(()=>driver.invoke(method,receiver,[pattern,argument])),trace};
    }
    assert.deepEqual(run(createOperations()),run(native),method.name+':'+search+':'+String(value)+':'+fail);
  }
  for(const method of [String.prototype.split,String.prototype.replace,String.prototype.replaceAll]){
    const calls:Function[]=[];
    const op=createOperations({apply(fn,self,args){calls.push(fn);return Reflect.apply(fn,self,args);}});
    const value={valueOf(){return 2;},toString(){return 'replacement';}};
    op.invoke(method,'no match',['x',value]);
    assert.ok(calls.includes(method===String.prototype.split?value.valueOf:value.toString));
  }
  const op=createOperations(),replacement={};
  for(const [method,symbol]of [[String.prototype.replace,Symbol.replace],[String.prototype.replaceAll,Symbol.replace],[String.prototype.split,Symbol.split]] as const){
    const pattern={[symbol](receiver:unknown,argument:unknown){assert.equal(receiver,replacement);assert.equal(argument,replacement);return replacement;}};
    assert.equal(op.invoke(method,replacement,[pattern,replacement]),replacement);
  }
});

test('padding keeps lazy coercion, original receivers, hints and abrupt completion order',()=>{
  for(const method of [String.prototype.padStart,String.prototype.padEnd])
  for(const length of [0,2,6,NaN,Infinity])
  for(const fail of [undefined,'receiver-get','receiver','length','fill-get','fill']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const receiver=convertible(trace,'receiver','ab',fail),size=convertible(trace,'length',length,fail),fill=convertible(trace,'fill','xy',fail);
      return {result:outcome(()=>driver.invoke(method,receiver,[size,fill])),trace};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
  const operations=createOperations();
  for(const receiver of [null,undefined,Symbol('x')])assert.throws(()=>operations.invoke(String.prototype.padEnd,receiver,[3]),TypeError);
});

test('string and error construction preserve conversion/prototype/cause/iterator order',()=>{
  for(const Constructor of [String,Error,TypeError,RangeError,SyntaxError,ReferenceError,EvalError,URIError,AggregateError])
  for(const call of [false,true])for(const fail of [undefined,'message','cause','iterator']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const message=convertible(trace,'message','text',fail);
      const options={get cause(){trace.push('cause');if(fail==='cause')throw new SyntaxError();return 7;}};
      const errors={get [Symbol.iterator](){trace.push('iterator');if(fail==='iterator')throw new RangeError();return function*(){yield 9;};}};
      const args=Constructor===AggregateError?[errors,message,options]:[message,options];
      const target=driver.invoke(Function.prototype.bind,function(){},[null]);
      Object.defineProperty(target,'prototype',{get(){trace.push('prototype');return Constructor.prototype;}});
      const result=outcome(()=>{
        const value=call?driver.invoke(Constructor,undefined,args):driver.construct(Constructor,args,target);
        if(Constructor===String)return typeof value==='string'?value:value.valueOf();
        return [value.name,value.message,value.cause,value.errors,Object.hasOwn(value,'message')];
      });
      return {result,trace};
    };
    assert.deepEqual(run(createOperations()),run(native),`${Constructor.name} call=${call} fail=${fail}`);
  }
  const operations=createOperations();
  assert.throws(()=>operations.construct(String,[Symbol('x')]),TypeError);
  assert.equal(operations.invoke(String,undefined,[Symbol('x')]),'Symbol(x)');
});

test('native coercion reports a noncallable exotic method with original access order', () => {
  const operations = createOperations();
  const constructors = [Number, String, RegExp, Error, TypeError, RangeError,
    SyntaxError, ReferenceError, EvalError, URIError, ArrayBuffer];
  class NamedValue { get [Symbol.toPrimitive]() { return 1 as any; } }
  const makers = [
    (trace: string[]) => ({get [Symbol.toPrimitive]() { trace.push('exotic'); return 1; }}),
    (trace: string[]) => Object.defineProperty(new NamedValue(), Symbol.toPrimitive,
      {get() { trace.push('exotic'); return 1; }}),
  ];
  const completion = (run: (value: object) => unknown, make: (trace: string[]) => object) => {
    const trace: string[] = [];
    try { run(make(trace)); return {kind: 'return', trace}; }
    catch (error) { return {kind: 'throw', name: (error as Error).name, message: (error as Error).message, trace}; }
  };
  for (const constructor of constructors) for (const make of makers) {
    assert.deepEqual(completion(value => operations.construct(constructor, [value]), make),
      completion(value => Reflect.construct(constructor, [value]), make), constructor.name);
  }
});

test('language coercion rejects noncallable exotic methods with V8 completion', () => {
  const operations = createOperations();
  const actions: [string, (value: any) => unknown, (value: any) => unknown][] = [
    ['unary', value => +value, value => operations.numericUnary('+', value)],
    ['add', value => value + 0, value => operations.add(value, 0)],
    ['compare', value => value < 2, value => operations.compare('<', value, 2)],
    ['key', value => ({[value]: 1}), value => operations.propertyKey(value)],
  ];
  const completion = (run: (value: object) => unknown, exotic: unknown) => {
    const trace: string[] = [];
    const value = {get [Symbol.toPrimitive]() { trace.push('exotic'); return exotic; }};
    try { run(value); return {kind: 'return', trace}; }
    catch (error) { return {kind: 'throw', name: (error as Error).name, message: (error as Error).message, trace}; }
  };
  for (const [name, native, guarded] of actions) for (const exotic of [0, 'x', false, {}, Symbol('s')]) {
    assert.deepEqual(completion(guarded, exotic), completion(native, exotic), name);
  }
});

test('RegExp protocol facades preserve identity, read-once getters and allocation/coercion order',()=>{
  for(const match of [undefined,false,true])for(const shortcut of [false,true])
  for(const call of [false,true])for(const explicitFlags of [false,true])
  for(const fail of [undefined,'match','source-get','pattern','flags-get','flags']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const pattern=convertible(trace,'pattern','x',fail),flags=convertible(trace,'flags','i',fail);
      const input={
        get [Symbol.match](){trace.push(['match',this===input]);if(fail==='match')throw new TypeError();return match;},
        get constructor(){trace.push(['constructor',this===input]);return shortcut?RegExp:Object;},
        get source(){trace.push(['source',this===input]);if(fail==='source-get')throw new SyntaxError();return pattern;},
        get flags(){trace.push(['flags',this===input]);if(fail==='flags-get')throw new SyntaxError();return flags;},
        get [Symbol.toPrimitive](){return Reflect.get(pattern,Symbol.toPrimitive);},
      };
      Object.freeze(input);
      const target=driver.invoke(Function.prototype.bind,function(){},[null]);
      Object.defineProperty(target,'prototype',{get(){trace.push('prototype');return RegExp.prototype;}});
      const result=outcome(()=>{
        const args=explicitFlags?[input,flags]:[input];
        const value=call?driver.invoke(RegExp,undefined,args):driver.construct(RegExp,args,target);
        return value===input?'original':[value.source,value.flags,value.lastIndex];
      });
      return {result,trace};
    };
    assert.deepEqual(run(createOperations()),run(native),JSON.stringify({match,shortcut,call,explicitFlags,fail}));
  }
});

test('genuine RegExp patterns retain internal slots despite overridden public source and flags',()=>{
  for(const match of [undefined,false,true])for(const call of [false,true])for(const explicitFlags of [false,true]){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];const input=/a\/b/gi;
      Object.defineProperties(input,{
        [Symbol.match]:{get(){trace.push('match');return match;}},
        source:{get(){throw Error('source must use internal slot');}},
        flags:{get(){throw Error('flags must use internal slot');}},
      });
      const flags=convertible(trace,'flags','m');
      const args=explicitFlags?[input,flags]:[input];
      const value=call?driver.invoke(RegExp,undefined,args):driver.construct(RegExp,args);
      const read=(key:string)=>Reflect.apply(Object.getOwnPropertyDescriptor(RegExp.prototype,key)!.get!,value,[]);
      return {same:value===input,source:read('source'),ignoreCase:read('ignoreCase'),global:read('global'),multiline:read('multiline'),trace};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
});

test('generic string inputs keep primitive conversion order and search predicate RegExp checks',()=>{
  for(const name of ['at','charAt','charCodeAt','codePointAt','repeat','normalize','indexOf','lastIndexOf','slice','substring',
    'isWellFormed','toWellFormed','toLowerCase','toUpperCase','trim','trimEnd','trimStart','startsWith','endsWith','includes']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const receiver=convertible(trace,'receiver',' abc '),first=convertible(trace,'first',name==='normalize'?'NFC':2),second=convertible(trace,'second',4);
      Object.defineProperty(first,Symbol.match,{get(){trace.push('match');return false;}});
      return {result:outcome(()=>driver.invoke((String.prototype as any)[name],receiver,[first,second])),trace};
    };
    assert.deepEqual(run(createOperations()),run(native),name);
  }
  for(const method of [String.prototype.startsWith,String.prototype.endsWith,String.prototype.includes])
  for(const actual of [false,true])for(const match of [undefined,false,true]){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];const input=actual?/x/:{};
      Object.defineProperties(input,{
        [Symbol.match]:{get(){trace.push(['match',this===input]);return match;}},
        toString:{value(){trace.push(['convert',this===input]);return 'x';}},
      });
      return {result:outcome(()=>driver.invoke(method,'xx',[input])),trace};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
});

test('error and RegExp formatting read and convert fields in native order',()=>{
  for(const method of [Error.prototype.toString,RegExp.prototype.toString])for(const fail of [undefined,'first','second']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const first=convertible(trace,'first','value',fail),second=convertible(trace,'second','detail',fail);
      const receiver=Object.defineProperties({},Object.fromEntries((method===Error.prototype.toString?['name','message']:['source','flags']).map((key,index)=>
        [key,{get(){trace.push([key,this===receiver]);return index===0?first:second;}}])));
      return {result:outcome(()=>driver.invoke(method,receiver,[])),trace};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
});

test('replacement results are coerced once after each callback with their original receiver',()=>{
  for(const method of [String.prototype.replace,String.prototype.replaceAll,RegExp.prototype[Symbol.replace]])
  for(const fail of [undefined,'replacement-get','replacement']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];const result=convertible(trace,'replacement','value',fail);
      function callback(...args:unknown[]){trace.push(['callback',...args]);return result;}
      const regex=/x/g;
      const self=method===RegExp.prototype[Symbol.replace]?regex:'xx';
      const search=method===RegExp.prototype[Symbol.replace]?'xx':'x';
      return {result:outcome(()=>driver.invoke(method,self,[search,callback])),trace};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
});

test('default array sorting preserves coercion, undefined/hole handling and original element identities',()=>{
  for(const method of [Array.prototype.sort,Array.prototype.toSorted])for(const fail of [undefined,'left','right']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const left=convertible(trace,'left','z',fail),right=convertible(trace,'right','a',fail);
      const values=[left,undefined,,right,left];
      const result=outcome(()=>{
        const sorted=driver.invoke(method,values,[]);
        return {same:sorted===values,keys:Object.keys(sorted),items:Array.from(sorted,value=>value===left?'left':value===right?'right':value)};
      });
      return {result,trace,keys:Object.keys(values),items:Array.from(values,value=>value===left?'left':value===right?'right':value)};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
  const operations=createOperations();
  for(const method of [Array.prototype.sort,Array.prototype.toSorted]){
    assert.throws(()=>operations.invoke(method,[],[null]),TypeError);
    assert.throws(()=>operations.invoke(method,[Symbol('x'),'a'],[]),TypeError);
  }
});

test('String.raw retains lazy indexed reads, cached length and substitution interleaving',()=>{
  for(const length of [0,1,3])for(const count of [0,1,2,4])for(const fail of [undefined,'literal','substitution']){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];
      const literal=convertible(trace,'literal','L',fail),substitution=convertible(trace,'substitution','S',fail);
      const raw={get length(){trace.push(['length',this===raw]);return length;}};
      for(let index=0;index<3;index++)Object.defineProperty(raw,String(index),{get(){trace.push([index,this===raw]);return literal;}});
      const template={get raw(){trace.push(['raw',this===template]);return raw;}};
      return {result:outcome(()=>driver.invoke(String.raw,undefined,[template,...Array(count).fill(substitution)])),trace};
    };
    assert.deepEqual(run(createOperations()),run(native));
  }
  const operations=createOperations();
  for(const template of [null,undefined,{}, {raw:null}])assert.throws(()=>operations.invoke(String.raw,undefined,[template]),TypeError);
  assert.equal(operations.invoke(String.raw,undefined,[{raw:['a','b']},undefined]),'aundefinedb');
  assert.equal(operations.invoke(String.raw,undefined,[{raw:['a','b']}]),'ab');
});

test('comparison operators preserve primitive rules, conversion order and no-conversion identity cases',()=>{
  const nativeCompare={
    '==':(a:any,b:any)=>a==b,'!=':(a:any,b:any)=>a!=b,
    '<':(a:any,b:any)=>a<b,'<=':(a:any,b:any)=>a<=b,'>':(a:any,b:any)=>a>b,'>=':(a:any,b:any)=>a>=b,
  };
  const operations=createOperations();
  const values=[null,undefined,false,true,0,-0,1,NaN,Infinity,0n,1n,'','0','1','bad',Symbol('x')];
  for(const operator of Object.keys(nativeCompare) as (keyof typeof nativeCompare)[]){
    for(const left of values)for(const right of values)
      assert.deepEqual(outcome(()=>operations.compare(operator,left,right)),outcome(()=>nativeCompare[operator](left,right)));
    for(const primitive of values)for(const shape of ['left','right','both','same'] as const)
    for(const fail of [undefined,'left','left-get','right','right-get']){
      const run=(controlled:boolean)=>{
        const trace:unknown[]=[];
        const a=convertible(trace,'left',primitive,fail),b=convertible(trace,'right',primitive,fail);
        const left=shape==='right'?primitive:a,right=shape==='left'?primitive:shape==='same'?a:b;
        return {result:outcome(()=>controlled?operations.compare(operator,left,right):nativeCompare[operator](left,right)),trace};
      };
      assert.deepEqual(run(true),run(false),`${operator} ${shape} ${String(primitive)} ${fail}`);
    }
  }
});

test('property queries retain key conversion timing and reject invalid in targets before coercion',()=>{
  const operations=createOperations();
  for(const method of [Object.getOwnPropertyDescriptor,Object.hasOwn,Reflect.has,Reflect.deleteProperty,
    Object.prototype.hasOwnProperty,Object.prototype.propertyIsEnumerable,
    (Object.prototype as any).__lookupGetter__,(Object.prototype as any).__lookupSetter__])
  for(const invalid of [false,true]){
    const run=(driver:Driver)=>{
      const trace:unknown[]=[];const key=convertible(trace,'key','field');
      const target=invalid?null:{field:7};
      const prototypeMethod=Reflect.ownKeys(Object.prototype).some(k=>Object.getOwnPropertyDescriptor(Object.prototype,k)?.value===method);
      const result=outcome(()=>driver.invoke(method,prototypeMethod?target:undefined,prototypeMethod?[key]:[target,key]));
      return {result,trace,target};
    };
    assert.deepEqual(run(operations),run(native));
  }
  for(const target of [null,undefined,0,'field',true,Symbol('x')]){
    const trace:unknown[]=[];const key=convertible(trace,'key','field');
    assert.throws(()=>operations.has(key,target),TypeError);assert.deepEqual(trace,[]);
  }
  const symbol=Symbol('key'),key={[Symbol.toPrimitive](){return symbol;}};
  assert.equal(operations.has(key,{[symbol]:7}),true);
});

test('RegExp exec converts object lastIndex through guarded calls and preserves native writes',()=>{
  for(const flags of ['', 'g','y','dgu','dg','dgy'])for(const text of ['ba','none','😀a'])
  for(const value of [0,1,2,100,-1,Infinity,2n,Symbol('index')])for(const mode of ['normal','freeze','mutate','throw','freeze-during']){
    function run(driver:Driver){
      const trace:unknown[]=[],regexp=new RegExp('(?<letter>a)',flags);
      const index={valueOf(){trace.push(['index',this===index,regexp.lastIndex===index as any]);
        if(mode==='mutate')regexp.lastIndex=27;
        if(mode==='freeze-during')Object.freeze(regexp);
        if(mode==='throw')throw new RangeError();
        return value;
      }};
      regexp.lastIndex=index as any;
      if(mode==='freeze')Object.freeze(regexp);
      // Public source/flags properties must not override the matcher slots.
      Object.defineProperty(index,'toString',{value(){throw Error('unexpected fallback');}});
      const input={toString(){trace.push('input');return text;}};
      const result=outcome(()=>driver.invoke(RegExp.prototype.exec,regexp,[input]));
      return {trace,result,index:regexp.lastIndex===index as any?'original':regexp.lastIndex};
    }
    assert.deepEqual(run(createOperations()),run(native),flags+':'+text+':'+String(value)+':'+mode);
  }
  const calls:Function[]=[],op=createOperations({apply(fn,self,args){calls.push(fn);return Reflect.apply(fn,self,args);}});
  const regexp=/a/g,index={valueOf(){return 0;}};regexp.lastIndex=index as any;
  Object.defineProperties(regexp,{source:{get(){throw Error('source');}},flags:{get(){throw Error('flags');}}});
  assert.equal(op.invoke(RegExp.prototype.exec,regexp,['a'])[0],'a');assert.ok(calls.includes(index.valueOf));
  const forbidden=/a/g;forbidden.lastIndex={valueOf:Date.now} as any;
  assert.throws(()=>op.invoke(RegExp.prototype.exec,forbidden,['a']),/Ambient|not whitelisted/);
  let touched=false;
  assert.throws(()=>op.invoke(RegExp.prototype.exec,{},[{toString(){touched=true;return 'a';}}]),TypeError);
  assert.equal(touched,false);
});
