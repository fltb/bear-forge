import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';
const withResolvers=Object.getOwnPropertyDescriptor(Promise,'withResolvers')!.value;

test('native Promise resolution can invoke thenables outside the operations guard', async () => {
  for (const ingress of ['resolve', 'constructor resolver', 'withResolvers resolver', 'then callback'] as const) {
    const operations = createOperations();
    const thenable = { get then() { return Function; } };
    let result: Promise<unknown>;
    if (ingress === 'resolve') {
      result = operations.invoke(Promise.resolve, Promise, [thenable]);
    } else if (ingress === 'constructor resolver') {
      let resolve!: Function;
      result = operations.construct(Promise, [function(yes: Function) { resolve = yes; }]);
      operations.invoke(resolve, undefined, [thenable]);
    } else if (ingress === 'withResolvers resolver') {
      const capability = operations.invoke(withResolvers, Promise, []);
      result = capability.promise;
      operations.invoke(capability.resolve, undefined, [thenable]);
    } else {
      const source = operations.invoke(Promise.resolve, Promise, [1]);
      result = operations.invoke(Promise.prototype.then, source, [() => thenable]);
    }
    await assert.rejects(result, error => error instanceof SyntaxError, ingress);
  }
});

test('generic Promise.catch forwards its hidden then invocation through the guard', () => {
  const calls: string[]=[];
  const rejected=()=>0;
  const then=function(this: unknown, yes: unknown, no: unknown) {
    assert.equal(this, receiver);
    assert.equal(yes, undefined);
    assert.equal(no, rejected);
    calls.push('then');
    return 7;
  };
  const receiver=Object.freeze({get then(){calls.push('get');return then;}});
  const op=createOperations({apply(fn,self,args){if(fn===then)calls.push('guarded');return Reflect.apply(fn,self,args);}});
  assert.equal(op.invoke(Promise.prototype.catch,receiver,[rejected]),7);
  assert.deepEqual(calls,['get','guarded','then']);
  assert.throws(()=>op.invoke(Promise.prototype.catch,{then:Function},[rejected]),/not admitted/);
});

test('native Promise executor resolvers retain identity and guarded call/bind semantics', async () => {
  const op=createOperations();let resolve!:Function,reject!:Function,receiver:unknown='unset';
  const promise=op.construct(Promise,[function(this:unknown,yes:Function,no:Function){receiver=this;resolve=yes;reject=no;}]);
  assert.equal(receiver,undefined);
  const holder={resolve,reject};
  assert.equal(op.get(op.ref(holder,'resolve')),resolve);
  assert.equal(resolve.name,'');assert.equal(resolve.length,1);
  assert.equal(Object.hasOwn(resolve,'prototype'),false);
  const bound=op.invoke(Function.prototype.bind,resolve,[null]);
  assert.equal(op.invoke(Function.prototype.call,bound,[null,7]),undefined);
  op.invoke(reject,undefined,[Error('ignored after resolution')]);
  assert.equal(await promise,7);
  assert.throws(()=>op.construct(resolve,[]),TypeError);
});

test('native Promise capabilities cover rejection, executor throws and resolver accessors', async () => {
  const op=createOperations(),marker=Error('marker');
  const first=op.invoke(withResolvers,Promise,[]);
  const reject=op.get(op.ref(first,'reject'));
  op.invoke(Reflect.apply,Reflect,[reject,null,[marker]]);
  await assert.rejects(first.promise,error=>error===marker);
  await assert.rejects(op.construct(Promise,[()=>{throw marker;}]),error=>error===marker);
  const second=op.invoke(withResolvers,Promise,[]);
  const object={};
  op.invoke(Object.defineProperty,Object,[object,'answer',{set:op.get(op.ref(second,'resolve'))}]);
  op.set(op.ref(object,'answer'),9);
  assert.equal(await second.promise,9);
  const third=op.invoke(withResolvers,Promise,[]);
  op.invoke(Object.defineProperty,Object,[object,'empty',{get:op.get(op.ref(third,'resolve'))}]);
  assert.equal(op.get(op.ref(object,'empty')),undefined);
  assert.equal(await third.promise,undefined);
});

test('resolver provenance never admits unrelated native callbacks or crosses operations', async () => {
  const op=createOperations(),other=createOperations();
  const own=op.invoke(withResolvers,Promise,[]),external:any=Reflect.apply(withResolvers,Promise,[]);
  for(const fn of [external.resolve,external.reject,Object.keys.bind(Object)]){
    assert.throws(()=>op.invoke(fn,undefined,[]),/not whitelisted/);
    assert.throws(()=>op.get(op.ref({fn},'fn')),/not whitelisted/);
  }
  assert.throws(()=>other.invoke(own.resolve,undefined,[7]),/not whitelisted/);
  assert.throws(()=>op.invoke(withResolvers,function Custom(){},[]),/Unsupported Promise constructor/);
  op.invoke(own.resolve,undefined,[7]);
  assert.equal(await own.promise,7);
});

test('native finally callback handoff preserves original receivers, frozen methods and callback identity', async () => {
  const op=createOperations(),other=createOperations();
  for(const rejected of [false,true]) {
    const trace:string[]=[],marker={value:7};
    let captured!:Function[];
    const receiver=Object.freeze({constructor:undefined,get then(){
      assert.equal(this,receiver);trace.push('get');
      return function(this:unknown,yes:Function,no:Function){
        assert.equal(this,receiver);trace.push('then');captured=[yes,no];
        return op.invoke(rejected?no:yes,undefined,[marker]);
      };
    }});
    const result=op.invoke(Promise.prototype.finally,receiver,[function(this:unknown){assert.equal(this,undefined);trace.push('finally');}]);
    if(rejected) await assert.rejects(result,error=>error===marker);
    else assert.equal(await result,marker);
    assert.deepEqual(trace,['get','then','finally']);
    for(const fn of captured) {
      assert.equal(op.get(op.ref({fn},'fn')),fn);
      assert.equal(fn.name,'');assert.equal(fn.length,1);
      assert.throws(()=>other.invoke(fn,undefined,[1]),/not whitelisted/);
      assert.throws(()=>op.construct(fn,[]),TypeError);
    }
    const dataReceiver=Object.freeze({constructor:undefined,then(yes:Function){return op.invoke(yes,undefined,[9]);}});
    assert.equal(await op.invoke(Promise.prototype.finally,dataReceiver,[()=>undefined]),9);
  }
});

test('native finally retains V8 results, abrupt completion and noncallable finalizer arguments', async () => {
  for(const mode of ['fulfill','reject','throw-finalizer','throw-getter','throw-then','noncallable','return-receiver'] as const) {
    async function run(guarded:boolean) {
      const op=createOperations(),trace:string[]=[],marker={marker:true};
      const call=(fn:Function,self:unknown,args:unknown[])=>guarded?op.invoke(fn,self,args):Reflect.apply(fn,self,args);
      const receiver={constructor:undefined,get then(){
        trace.push('get');if(mode==='throw-getter')throw marker;
        return function(this:unknown,yes:Function,no:Function){
          trace.push('then');assert.equal(this,receiver);
          if(mode==='throw-then')throw marker;
          if(mode==='return-receiver')return this;
          if(mode==='noncallable'){assert.equal(yes,marker);assert.equal(no,marker);return 12;}
          return call(mode==='reject'?no:yes,undefined,[7]);
        };
      }};
      const finalizer=mode==='noncallable'?marker:()=>{trace.push('finally');if(mode==='throw-finalizer')throw marker;};
      try {
        const result=call(Promise.prototype.finally,receiver,[finalizer]);
        if(result===receiver)return {trace,result:'receiver'};
        return {trace,result:await result};
      } catch(error){assert.equal(error,mode==='reject'?7:marker);return {trace,result:mode==='reject'?'rejected':'marker'};}
    }
    assert.deepEqual(await run(true),await run(false),mode);
  }
});

test('native finally preserves real Promise settlement and cleanup microtask ordering', async () => {
  for(const rejectSource of [false,true]) for(const rejectCleanup of [false,true]) {
    async function run(guarded:boolean) {
      const op=createOperations(),trace:string[]=[];
      const call=(fn:Function,self:unknown,args:unknown[])=>guarded?op.invoke(fn,self,args):Reflect.apply(fn,self,args);
      const source=call(rejectSource?Promise.reject:Promise.resolve,Promise,[7]);
      const result=call(Promise.prototype.finally,source,[()=>{
        trace.push('cleanup');
        const cleanup=call(Promise.resolve,Promise,[]);
        return call(Promise.prototype.then,cleanup,[()=>{trace.push('cleanup-job');if(rejectCleanup)throw 9;}]);
      }]);
      Promise.resolve().then(()=>trace.push('other-job'));
      try {trace.push('value:'+await result);}catch(error){trace.push('error:'+error);}
      return trace;
    }
    assert.deepEqual(await run(true),await run(false));
  }
});

test('native combinators preserve callback origins, receivers and one-shot element behavior', async () => {
  for(const method of ['all','allSettled','any','race'] as const) for(const rejected of [false,true]) {
    async function run(guarded:boolean) {
      const op=createOperations(),other=createOperations(),trace:string[]=[];
      const callbacks:Function[]=[];
      const call=(fn:Function,self:unknown,args:unknown[])=>guarded?op.invoke(fn,self,args):Reflect.apply(fn,self,args);
      const inputs=[3,7].map(value=>{
        const promise=Promise.resolve(value);
        Object.defineProperty(promise,'then',{get(){
          assert.equal(this,promise);trace.push('get:'+value);
          return function(this:unknown,yes:Function,no:Function){
            assert.equal(this,promise);trace.push('then:'+value);callbacks.push(yes,no);
            call(rejected?no:yes,undefined,[value]);
            call(rejected?no:yes,undefined,[value+100]);
            return this;
          };
        }});
        return Object.freeze(promise);
      });
      const result=call(Promise[method],Promise,[inputs]);
      assert.equal(Object.getPrototypeOf(result),Promise.prototype);
      assert.equal(result.constructor,Promise);
      for(const fn of callbacks)if(guarded){
        assert.equal(op.get(op.ref({fn},'fn')),fn);
        assert.throws(()=>other.get(other.ref({fn},'fn')),/not whitelisted/);
      }
      try {return {trace,status:'fulfilled',value:await result};}
      catch(error){return {trace,status:'rejected',value:error instanceof AggregateError?error.errors:error};}
    }
    assert.deepEqual(await run(true),await run(false),method+':'+rejected);
  }
});

test('native combinators preserve microtask order, empty inputs and abrupt then handoffs', async () => {
  for(const method of ['all','allSettled','any','race'] as const)for(const mode of ['values','empty','getter','method']){
    async function run(guarded:boolean){
      const op=createOperations(),trace:string[]=[],marker={};
      const promise=Promise.resolve(3);
      if(mode==='getter'||mode==='method')Object.defineProperty(promise,'then',{get(){
        trace.push('get');if(mode==='getter')throw marker;
        return function(){trace.push('then');throw marker;};
      }});
      const inputs=mode==='empty'?[]:[promise,7];
      const result=guarded?op.invoke(Promise[method],Promise,[inputs]):Reflect.apply(Promise[method],Promise,[inputs]);
      let status='pending';
      result.then((value:unknown)=>{status='fulfilled';trace.push(JSON.stringify(value));},(error:unknown)=>{
        status='rejected';trace.push(error===marker?'marker':error instanceof AggregateError?JSON.stringify(error.errors):String(error));
      });
      Promise.resolve().then(()=>trace.push('other-job'));
      if(mode!=='empty'||method!=='race')await result.catch(()=>{});
      else {await Promise.resolve();await Promise.resolve();}
      return {status,trace};
    }
    assert.deepEqual(await run(true),await run(false),method+':'+mode);
  }
});

test('compiler callback ingress cannot authorize a function supplied through an ordinary guarded call',async()=>{
  const op=createOperations(),other=createOperations();
  const external:any=Reflect.apply(withResolvers,Promise,[]);
  const source=op.rememberSource(function(this:any,value:any){op.nativeEntry(arguments);return op.invoke(value,undefined,[7]);},'function source(){}',0,19);
  for(const fn of [external.resolve,external.reject,Object.keys.bind(Object),Date.now]){
    assert.throws(()=>op.invoke(source,undefined,[fn]),/not whitelisted|Ambient/);
    assert.throws(()=>op.construct(source,[fn]),/not whitelisted|Ambient/);
  }
  assert.throws(()=>op.nativeEntry([Date.now]),/Ambient/);
  assert.throws(()=>op.nativeEntry([Number.prototype.toLocaleString]),/not whitelisted/);
  let captured!:Function;
  const result=await Promise.resolve({then(resolve:Function,reject:Function){
    op.nativeEntry(arguments);captured=resolve;
    op.invoke(resolve,undefined,[7]);op.invoke(reject,undefined,[8]);
  }} as any);
  assert.equal(result,7);
  assert.throws(()=>other.invoke(captured,undefined,[9]),/not whitelisted/);
  assert.equal(op.invoke(captured,undefined,[9]),undefined);
});

test('native classification does not mistake authored comments or strings for engine callbacks',()=>{
  const op=createOperations();
  const ordinary=function ordinary(){return 7; // { [native code]
  };
  const arrow=()=>{return 7; // { [native code]
  };
  const method={method(){return 7; // { [native code]
  }}.method;
  const text=function text(){return 'function () { [native code] }';};
  for(const fn of [ordinary,arrow,method,text]){
    assert.equal(op.invoke(fn,undefined,[]),fn());
    assert.equal(op.get(op.ref({fn},'fn')),fn);
  }
  const nativeBound=Object.keys.bind(Object);
  Object.defineProperty(nativeBound,'toString',{value:()=>ordinary.toString()});
  assert.throws(()=>op.invoke(nativeBound,undefined,[{}]),/not whitelisted/);
});
test('native then validates its receiver before inspecting constructor', () => {
  for (const receiver of [
    Object.defineProperty({}, 'constructor', {get() { throw Error('constructor read'); }}),
    Object.defineProperty(function() {}, 'constructor', {get() { throw Error('constructor read'); }}),
  ]) {
    const observed = (run: () => unknown) => {
      try { run(); return null; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    assert.deepEqual(observed(() => createOperations().invoke(Promise.prototype.then, receiver, [() => 1])),
      observed(() => Reflect.apply(Promise.prototype.then, receiver, [() => 1])));
  }
});
