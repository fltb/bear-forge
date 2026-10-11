/* Persistent effects device. Each Instance owns registries and jobs in the main runtime. */
const S=require('@effectful/serialization');
const D=require('@bear-forge/effectful-continuations/apiMin');
const State=require('@bear-forge/effectful-continuations/state');
const Persist=require('@bear-forge/effectful-continuations/persist');
const {admitSchema}=require('@bear-forge/boundary');
S.regOpaqueObject(admitSchema,'runtime.admitSchema',{props:false});
const jobs=[];
function resolve(value){settle(this,1,value);}
function reject(value){settle(this,2,value);}
function settle(future,status,value){
 if(future.status)return;
 if(value===future)throw new TypeError('Promise self resolution');
 if(status===1&&value&&typeof value.then==='function'){value.then(Persist.defaultBind.call(resolve,future),Persist.defaultBind.call(reject,future));return;}
 future.status=status;future.value=value;
 for(const listener of future.listeners)jobs.push({future,listener});future.listeners=[];
}
class Future{
 constructor(executor){this.status=0;this.value=undefined;this.listeners=[];if(executor)try{executor(Persist.defaultBind.call(resolve,this),Persist.defaultBind.call(reject,this));}catch(e){reject.call(this,e);}}
 then(yes,no){const child=new Future();const listener={yes,no,child};if(this.status)jobs.push({future:this,listener});else this.listeners.push(listener);return child;}
 catch(no){return this.then(undefined,no);}
 static resolve(value){const f=new Future();resolve.call(f,value);return f;}
 static reject(value){const f=new Future();reject.call(f,value);return f;}
}
S.regOpaqueObject(Future,'Future.class',{props:false});S.regConstructor(Future,{name:'Future'});S.regOpaqueObject(resolve,'Future.resolve',{props:false});S.regOpaqueObject(reject,'Future.reject',{props:false});
Promise=Future;globalThis.Promise=Future;
class ArrayIterator{constructor(array,mode='values'){this.array=array;this.index=0;this.mode=mode;}next(){if(this.index>=this.array.length)return {done:true,value:undefined};const index=this.index++;return {done:false,value:this.mode==='keys'?index:this.mode==='entries'?[index,this.array[index]]:this.array[index]};}[Symbol.iterator](){return this;}}
S.regOpaqueObject(ArrayIterator,'ArrayIterator.class',{props:false});S.regConstructor(ArrayIterator,{name:'ArrayIterator'});
const values=function values(){return new ArrayIterator(this);};
const keys=function keys(){return new ArrayIterator(this,'keys');};
const entries=function entries(){return new ArrayIterator(this,'entries');};
State.context.methods=new Map([[Array.prototype.values,values],[Array.prototype[Symbol.iterator],values],[Array.prototype.keys,keys],[Array.prototype.entries,entries],[Function.prototype.bind,Persist.defaultBind]]);
for(const [name,fn] of Object.entries({values,keys,entries}))S.regOpaqueObject(fn,'ArrayIterator.'+name,{props:false});
S.regOpaqueRec(State.native.Promise,'builtin.NativePromise',{descriptor:{props:false}});
S.regOpaqueObject(globalThis,'Global',{props:false});
for(const key of ['Object','Array','Number','String','Boolean','Math','JSON','Map','Set','Symbol','Reflect','Error','TypeError','RangeError','Function','RegExp','Date','Uint8Array','ArrayBuffer','DataView','WeakMap','WeakSet']){const value=globalThis[key];S.regOpaqueRec(value,'builtin.'+key,{descriptor:{props:false}});if(value.prototype){S.regOpaqueObject(value.prototype,'prototype.'+key,{props:false});for(const name of Object.getOwnPropertyNames(value.prototype)){const d=Object.getOwnPropertyDescriptor(value.prototype,name);if(typeof d.value==='function')S.regOpaqueObject(d.value,'prototype.'+key+'.'+name,{props:false});}}}
S.regOpaqueObject(State.context,'effects.context',{props:false});
for(const name of ['undef','token','sideEffectToken','ctrlToken'])S.regOpaqueObject(State[name],'effects.sentinel.'+name,{props:false});
S.regConstructor(State.ForInIterator,{name:'ForInIterator'});
class Device{call(call){if(this.pending){this.fault='Overlapping IO';throw new Error(this.fault);}this.callData=call;this.pending=new Future();return this.pending;}}
S.regOpaqueObject(Device,'Device.class',{props:false});S.regConstructor(Device,{name:'Device'});
function drain(){let count=0;while(jobs.length){if(++count>1000000)throw new Error('budget exceeded');const {future,listener}=jobs.shift();const callback=future.status===1?listener.yes:listener.no;try{if(typeof callback==='function')resolve.call(listener.child,callback(future.value));else settle(listener.child,future.status,future.value);}catch(e){reject.call(listener.child,e);}}}
const G=require("@bear-forge/effectful-continuations/generator");
const AG=require("@bear-forge/effectful-continuations/asyncGenerator");
module.exports={globals:globalThis,...D,...G,...AG,Future,Device,S,State,drain,jobs,admitSchema,reply(io,value){const waiting=io.pending;io.pending=null;resolve.call(waiting,value);drain();}};
