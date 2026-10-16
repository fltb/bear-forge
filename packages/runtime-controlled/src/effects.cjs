/* Persistent effects device. Each loaded Program owns registries; each Context owns its jobs. */
const S=require('@effectful/serialization');
const D=require('@bear-forge/effectful-continuations/apiMin');
const State=require('@bear-forge/effectful-continuations/state');
const Persist=require('@bear-forge/effectful-continuations/persist');
const weakCollections=require('./weak-collections.cjs')(S,State);
const intrinsicState=require('./intrinsic-state.cjs')(S,State);
const {CowQueue}=require('./cow-queue.ts');
const {CowStore}=require('./cow-store.ts');
const {CowIdentityStore}=require('./cow-identities.ts');
const {CowCollections}=require('./cow-map.ts');
const {CowHeap}=require('./cow-heap.ts');
const {CowMemory}=require('./cow-memory.ts');
const {CowWeakCollections}=require('./cow-weak.ts');
function createContextRoots(){
 const objects=new CowHeap(undefined,tick);
 return {objects,memory:new CowMemory(undefined,objects),intrinsicSlots:new CowIdentityStore(),
  collectionMemory:new CowCollections(),weakMemory:new CowWeakCollections()};
}
S.regConstructor(CowQueue,{name:'runtime.JobQueue',props:false,
 create(){return new CowQueue();},
 write(ctx,queue){const out={};out.items=ctx.step([...queue],out,'items');return out;},
 readContent(ctx,data,queue){queue.clear();for(const job of ctx.step(data.items))queue.push(job);}});

const namespaces=require('../../runtime/src/module-namespace.ts').createNamespaceRegistry();
const nativeValues=require('./native-values.cjs')(S,namespaces,State,Persist,tick,intrinsicState);
weakCollections.installProperties(nativeValues);
const allocate=nativeValues.registerObject;
State.context.allocate=allocate;
const constructed=allocate;
State.context.allocateFunction=fn=>{
 const prototype=Object.getOwnPropertyDescriptor(fn,'prototype')?.value;
 if(prototype!==null&&(typeof prototype==='object'||typeof prototype==='function'))allocate(prototype);
 return allocate(fn);
};
State.context.prepareException=value=>{if(nativeValues.types.isNativeError(value))nativeValues.prepare(value);};
const stateOf=intrinsicState.state;
// Frame identity is stable while fixed control fields select the active root.
// Lexical arrays and referenced values remain separate identities; this does
// not recursively copy locals when a control field changes.
class ContextFrame{constructor(fields){intrinsicState.initialize(this,'ContextFrame',fields);}}
for(const key of ['$', 'id', 'closure', 'func', '$g', 'meta', 'state', 'goto', 'flags', 'parent', 'newTarget',
 'brk', 'next', 'caller', 'restoreEnabled', 'awaiting', 'stopReason', 'onReturn', 'onError', 'promise',
 'timestamp', 'result', 'error', 'self', 'args', 'sent', 'iter', 'queue', 'drainingQueue']){
 Object.defineProperty(ContextFrame.prototype,key,{get(){return (key==='queue'?intrinsicState.edit(this):intrinsicState.state(this))[key];},
  set(value){intrinsicState.edit(this)[key]=value;},configurable:false});
}
intrinsicState.register(ContextFrame,'ContextFrame',state=>({...state,queue:state.queue?.fork()}));
State.context.createQueue=()=>new CowQueue();
// Only compiler-proven flat synchronous activations use transient records.
// They have no escaping locals and finish before a resumable IO boundary.
State.context.createFrame=(fields,transient=false)=>State.context.intrinsicSlots&&!transient?new ContextFrame(fields):fields;
// Compiler-owned records use fixed accessors so all runtime consumers, including
// synchronous native adapters, select the same branch without exposing payloads.
const internalRecords=Object.create(null);
for(const [kind,keys]of [['LexicalBinding',['initialized','mutable','value']],['IteratorRecord',['iterator','next','done']]]){
 class InternalRecord{constructor(fields){intrinsicState.initialize(this,kind,fields);}}
 for(const key of keys)Object.defineProperty(InternalRecord.prototype,key,{
  get(){return intrinsicState.state(this)[key];},set(value){intrinsicState.edit(this)[key]=value;}
 });
 intrinsicState.register(InternalRecord,kind);
 internalRecords[kind]=InternalRecord;
}

const nativeIteratorNext={
 ArrayIterator:Object.getPrototypeOf([][Symbol.iterator]()).next,
 StringIterator:Object.getPrototypeOf(''[Symbol.iterator]()).next,
 MapIterator:Object.getPrototypeOf(new Map().keys()).next,
 SetIterator:Object.getPrototypeOf(new Set().keys()).next,
 RegExpStringIterator:Object.getPrototypeOf(/x/g[Symbol.matchAll]('')).next,
};
function iteratorState(receiver,kind){
 const record=intrinsicState.record(receiver);
 if(!record||record.kind!==kind){
  // Native cursors are excluded from admitted program values. On an invalid
  // borrowed receiver, V8 supplies the method-specific diagnostic without
  // reading author getters or entering an authored callback.
  Reflect.apply(nativeIteratorNext[kind],receiver,[]);
  throw new TypeError('Incompatible iterator receiver');
 }
 return intrinsicState.edit(receiver);
}
const {admitSchema:admitNativeSchema}=require('@bear-forge/boundary');
function admitSchema(schema){
 const ops=State.context.operations;
 // Keep the established native path until a Context selects object storage.
 if(!(State.context.objects??State.context.memory?.objects))return admitNativeSchema(schema);
 const iterate=function*(value){
  const record=ops.consumerIteratorOpen(value);
  try{while(!record.done){const item=ops.iteratorStep(record);if(!record.done)yield item;}}
  finally{ops.iteratorClose(record);}
 };
 return admitNativeSchema(schema,new Set(),{
  get:(value,key)=>ops.get(ops.ref(value,key)),has:(value,key)=>ops.has(key,value),
  values:value=>Array.from(iterate(ops.invoke(Object.values,Object,[value]))),iterate,
  invoke:(fn,receiver)=>ops.invoke(fn,receiver,[])
 });
}
S.regOpaqueObject(admitSchema,'runtime.admitSchema',{props:false});
const jobs=()=>State.context.jobs;
// Scope links are lexical arrays; variable cells preserve shared mutable bindings.
// A captured environment contains only compiler-declared cells, not a frame.
intrinsicState.cloneWith('LexicalGroup',state=>({slots:state.slots.fork()}));
class Cell{
 // Immutable addressing metadata belongs to the cell identity. Only the
 // group's values are mutable and must be resolved through the active Context.
 #group;
 #index;
 constructor(value,group,index,readonly=false){
  if(group){this.#group=group;this.#index=index;return;}
  // The compiler proves that no descendant rebinds this slot. Its owner
  // finishes synchronously before a snapshot; referenced objects remain COW.
  if(readonly){Object.defineProperty(this,'value',{value,writable:true,enumerable:true,configurable:true});return;}
  if(State.context.intrinsicSlots?.setIdentity)State.context.intrinsicSlots.setIdentity(this,value);
  else if(State.context.intrinsicSlots)intrinsicState.initialize(this,'LexicalCell',{value});
  else Object.defineProperty(this,'value',{value,writable:true,enumerable:true,configurable:true});
 }
 get value(){if(this.#group)return intrinsicState.state(this.#group).slots.get(this.#index);const slots=State.context.intrinsicSlots;return slots.getIdentity?slots.getIdentity(this):intrinsicState.state(this).value;}
 set value(value){if(this.#group)intrinsicState.edit(this.#group).slots.set(this.#index,value);else if(State.context.intrinsicSlots.writeIdentity)State.context.intrinsicSlots.writeIdentity(this,value);else intrinsicState.edit(this).value=value;}
}
S.regConstructor(Cell,{name:'lexical.cell',props:false,
 create(){return cell(undefined);},write(ctx,cell){const out={};out.v=ctx.step(cell.value,out,'v');return out;},
 readContent(ctx,data,cell){cell.value=ctx.step(data.v);}});
// Cells are private runtime values with a fixed prototype and shared codec.
// Only COW contexts register their values in the branch slot store.
function cell(value,readonly=false){return new Cell(value,undefined,undefined,readonly);}
const scopeDescriptor=S.regDescriptor({name:'lexical.scope',props:false,
 create(){return environment([]);},
 write(ctx,values){const out={length:values.length,slots:[]};for(const key of Object.keys(values)){const pair=[+key,null];out.slots.push(pair);pair[1]=ctx.step(values[key],pair,1);}return out;},
 readContent(ctx,data,values){values.length=data.length;for(const [key,value]of data.slots)values[key]=ctx.step(value);environment(values);}});
const environmentAccessors=new Map();
intrinsicState.cloneWith('LexicalScope',state=>({slots:state.slots.fork()}));
// Compiler-sized environments retain fixed keys/length after allocation.
// Copy/restore fills a new identity before installing its slot accessors.
function environment(values){
 if(State.context.intrinsicSlots){
  const slots=new CowStore();
  for(const key of Object.keys(values))slots.set(+key,values[key]);
  intrinsicState.initialize(values,'LexicalScope',{slots});
  for(const key of Object.keys(values)){
   let descriptor=environmentAccessors.get(key);
   if(!descriptor){const index=+key;descriptor={enumerable:true,configurable:true,
    get(){return intrinsicState.state(this).slots.get(index);},
    set(value){intrinsicState.edit(this).slots.set(index,value);}};environmentAccessors.set(key,descriptor);}
   Object.defineProperty(values,key,descriptor);
  }
 }
 S.setObjectDescriptor(values,scopeDescriptor);return values;
}
function scope(values,uncapturedLocals=false){
 if(uncapturedLocals?.transient){
  for(let i=1;i<values.length;i++){
   if(uncapturedLocals.cells.includes(i))values[i]=cell(values[i],uncapturedLocals.readonly?.includes(i));
   else if(!uncapturedLocals.direct)values[i]={value:values[i]};
  }
  return values;
 }
 if(uncapturedLocals==='values')return environment(values);
 if(Array.isArray(uncapturedLocals)){
  for(const index of uncapturedLocals)values[index]=cell(values[index]);
  return environment(values);
 }
 if(uncapturedLocals&&State.context.intrinsicSlots){
  const group={},slots=new CowStore();
  const captured=uncapturedLocals.cells;
  for(let i=1;i<values.length;i++){
   if(captured?.includes(i))values[i]=cell(values[i]);
   else{slots.set(i,values[i]);values[i]=new Cell(undefined,group,i);}
  }
  intrinsicState.initialize(group,'LexicalGroup',{slots});
 }else for(let i=1;i<values.length;i++)values[i]=cell(values[i]);
 return environment(values);
}
const captureCache=new WeakMap(),captureKeys=new WeakMap(),branchCaptureCaches=new WeakMap();
function activeCaptureCache(){
 const root=State.context.intrinsicSlots;
 if(!root)return captureCache;
 let cache=branchCaptureCaches.get(root);
 if(!cache){cache=new WeakMap();branchCaptureCaches.set(root,cache);}
 return cache;
}
// Projection containers are private lexical links. Reuse a common captured
// ancestor within this Context; the variable cells remain mutable and forked.
function captureLayout(paths){
 let layout=captureKeys.get(paths);if(layout)return layout;
 const groups=new Map();
 for(const path of paths){
  const key=path[0];
  if(path.length===1)groups.set(key,null);
  else{let tails=groups.get(key);if(!tails)groups.set(key,tails=[]);tails.push(path.slice(1));}
 }
 layout={key:JSON.stringify(paths),slots:[...groups].map(([key,tails])=>[key,tails&&captureLayout(tails)])};
 captureKeys.set(paths,layout);return layout;
}
function projectCapture(vars,layout){
 const captures=activeCaptureCache();
 let cache=vars&&captures.get(vars);
 if(vars&&!cache){cache=new Map();captures.set(vars,cache);}
 let projected=cache?.get(layout.key);if(projected)return projected;
 projected=[];
 for(const [key,child]of layout.slots)projected[key]=child?projectCapture(vars?.[key],child):vars?.[key]??cell(undefined);
 environment(projected);
 if(cache)cache.set(layout.key,projected);
 return projected;
}
function capture(parent,vars,paths,flags){
 const projected=paths.length?projectCapture(vars,captureLayout(paths)):undefined;
 const lexical=flags&4;
 const receiver=lexical&&(flags&24)?{...(flags&8?{self:parent?.self}:{}),...(flags&16?{args:parent?.args}:{})}:null;
 return {parent:receiver,vars:paths.length?projected:undefined};
}
function resolve(value){settle(this,1,value);}
function reject(value){settle(this,2,value);}
const {resolveOnce,rejectOnce}={
 resolveOnce(value){const state=intrinsicState.edit(this);if(state.done)return;state.done=true;settle(state.future,1,value);},
 rejectOnce(value){const state=intrinsicState.edit(this);if(state.done)return;state.done=true;settle(state.future,2,value);}
};
class ResolutionLock{constructor(future){intrinsicState.initialize(this,'ResolutionLock',{future,done:false});}}
intrinsicState.register(ResolutionLock,'ResolutionLock');
function resolving(future){const lock=new ResolutionLock(future);return [resolveOnce,rejectOnce].map(fn=>{
 const callback=Persist.defaultBind.call(fn,lock);
 Persist.defineFunctionProperties(callback,{name:{value:'',configurable:true},length:{value:1,configurable:true}});
 return callback;
});}
function futureConstructor(value){
 for(let current=value;current!==null;){
  const heap=nativeValues.objectStorage(current);
  const descriptor=heap?heap.getOwnPropertyDescriptor(current,'constructor'):Object.getOwnPropertyDescriptor(current,'constructor');
  current=heap?heap.getPrototypeOf(current):Object.getPrototypeOf(current);
  if(!descriptor)continue;
  if(!('value'in descriptor))throw new TypeError('Unsupported Promise constructor accessor');
  if(descriptor.value!==undefined&&descriptor.value!==Future)throw new TypeError('Unsupported Promise species');
  return descriptor.value;
 }
 return undefined;
}
function settle(future,status,value){
 const state=intrinsicState.edit(future);
 if(state.status)return;
 if(status===1&&value===future){status=2;value=new TypeError('Promise self resolution');}
 if(status===1&&value&&(typeof value==='object'||typeof value==='function')){
  let then;try{const operations=State.context.operations;then=operations.get(operations.ref(value,'then'));}catch(error){settle(future,2,error);return;}
  if(typeof then==='function'){jobs().push({adopt:true,future,value,then});return;}
 }
 if(status===2&&!State.context.__budgetExceeded)State.context.prepareException(value);
 state.status=status;state.value=value;
 // Listener links are immutable: adding one listener never copies the
 // existing list. Settlement visits the list once in registration order.
 const listeners=[];
 for(let link=state.listeners;link;link=link.previous){tick();listeners.push(link.listener);}
 state.listeners=null;
 for(let index=listeners.length-1;index>=0;index--){jobs().push({future,listener:listeners[index]});}
}
class Future{
 constructor(executor){intrinsicState.initialize(this,'Future',{status:0,value:undefined,listeners:null});if(executor){const callbacks=resolving(this);try{State.context.operations.invoke(executor,undefined,callbacks);}catch(e){callbacks[1](e);}}}
 then(yes,no){const state=intrinsicState.edit(this);futureConstructor(this);const child=new Future();const listener={yes,no,child};if(state.status)jobs().push({future:this,listener});else state.listeners={listener,previous:state.listeners};return child;}
 catch(no){const ops=State.context.operations;return ops.invoke(ops.get(ops.ref(this,'then')),this,[undefined,no]);}
 static resolve(value){if(this!==Future)throw new TypeError('Unsupported Promise constructor');if(intrinsicState.has(value)&&intrinsicState.record(value).kind==='Future'&&futureConstructor(value)===Future)return value;const f=new Future();resolve.call(f,value);return f;}
 static reject(value){if(this!==Future)throw new TypeError('Unsupported Promise constructor');const f=new Future();reject.call(f,value);return f;}
}
intrinsicState.register(Future,'Future',undefined,true);S.regOpaqueObject(resolve,'Future.resolve',{props:false});S.regOpaqueObject(reject,'Future.reject',{props:false});
S.regOpaqueObject(resolveOnce,'Future.resolveOnce',{props:false});S.regOpaqueObject(rejectOnce,'Future.rejectOnce',{props:false});
Object.defineProperty(Future,Symbol.species,{get(){return this;},configurable:true});
Object.defineProperty(Future.prototype,Symbol.toStringTag,{value:'Promise',configurable:true});
const promiseMethods=require('./promise-methods.cjs')(S,State,Persist,Future,resolving,futureConstructor,intrinsicState,tick);
Promise=Future;globalThis.Promise=Future;
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'length').get;
class ArrayIterator{
 constructor(array,mode='values',typed=false){
  if(array===null||array===undefined)throw new TypeError('Invalid array iterator receiver');
  if(typed&&!nativeValues.types.isTypedArray(array))throw new TypeError('Invalid typed array iterator receiver');
  intrinsicState.initialize(this,'ArrayIterator',{array:Object(array),index:0,mode,done:false,typed});
 }
 next(){return arrayNext(this,allocate);}
 [Symbol.iterator](){return this;}
}
function arrayNext(receiver,result){const state=iteratorState(receiver,'ArrayIterator');if(state.done)return result({done:true,value:undefined});
  const operations=State.context.operations;
  const number=state.typed?operations.invoke(typedLength,state.array,[])
   :operations.numericUnary('+',operations.get(operations.ref(state.array,'length')));
  const length=Number.isNaN(number)||number<=0?0:Math.min(Math.floor(number),Number.MAX_SAFE_INTEGER);
  if(state.index>=length){state.done=true;state.array=null;return result({done:true,value:undefined});}
  const index=state.index++;
  const value=state.mode==='keys'?index:operations.get(operations.ref(state.array,String(index)));
  return result({done:false,value:state.mode==='entries'?allocate([index,value]):value});
 }
intrinsicState.register(ArrayIterator,'ArrayIterator',undefined,true);
class StringIterator{
 constructor(value){if(value===null||value===undefined||typeof value==='symbol')throw new TypeError('Invalid string iterator receiver');intrinsicState.initialize(this,'StringIterator',{text:String(value),index:0});}
 next(){const state=iteratorState(this,'StringIterator'),text=state.text,index=state.index;if(index>=text.length)return allocate({done:true,value:undefined});
  const first=text.charCodeAt(index),second=text.charCodeAt(index+1);
  const width=first>=0xd800&&first<=0xdbff&&second>=0xdc00&&second<=0xdfff?2:1;
  state.index+=width;return allocate({done:false,value:text.slice(index,index+width)});
 }
 [Symbol.iterator](){return this;}
}
intrinsicState.register(StringIterator,'StringIterator',undefined,true);
class RegExpStringIterator{
 constructor(matcher,text,global,fullUnicode){
  intrinsicState.initialize(this,'RegExpStringIterator',{matcher,text,global,fullUnicode,done:false});
 }
 next(){
  const state=iteratorState(this,'RegExpStringIterator');
  if(state.done)return allocate({value:undefined,done:true});
  tick();
  const operations=State.context.operations;
  const exec=operations.get(operations.ref(state.matcher,'exec'));
  const match=operations.invoke(typeof exec==='function'?exec:RegExp.prototype.exec,state.matcher,[state.text]);
  if(match!==null&&(typeof match!=='object'&&typeof match!=='function'))throw new TypeError('Invalid RegExp exec result');
  if(match===null){state.done=true;return allocate({value:undefined,done:true});}
  if(!state.global){state.done=true;return allocate({value:match,done:false});}
  const item=operations.toPrimitive(operations.get(operations.ref(match,'0')),'string');
  if(typeof item==='symbol')throw new TypeError('Cannot convert a Symbol value to a string');
  if(String(item)===''){
   const raw=operations.numericUnary('+',operations.get(operations.ref(state.matcher,'lastIndex')));
   const index=Number.isNaN(raw)||raw<=0?0:Math.min(Math.trunc(raw),Number.MAX_SAFE_INTEGER);
   const first=state.text.charCodeAt(index),second=state.text.charCodeAt(index+1);
   const width=state.fullUnicode&&first>=0xd800&&first<=0xdbff&&second>=0xdc00&&second<=0xdfff?2:1;
   operations.set(operations.ref(state.matcher,'lastIndex'),index+width);
  }
  return allocate({value:match,done:false});
 }
}
Object.setPrototypeOf(RegExpStringIterator.prototype,Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())));
delete RegExpStringIterator.prototype.constructor;
Object.defineProperty(RegExpStringIterator.prototype,Symbol.toStringTag,{value:'RegExp String Iterator',configurable:true});
intrinsicState.register(RegExpStringIterator,'RegExpStringIterator',undefined,true);
const stringValues=function(){return new StringIterator(this);};
S.regOpaqueObject(stringValues,'StringIterator.values',{props:false});
const values=function values(){if(this==null)Reflect.apply(Array.prototype.values,this,[]);return new ArrayIterator(this);};
const keys=function keys(){if(this==null)Reflect.apply(Array.prototype.keys,this,[]);return new ArrayIterator(this,'keys');};
const entries=function entries(){if(this==null)Reflect.apply(Array.prototype.entries,this,[]);return new ArrayIterator(this,'entries');};
State.context.methods=new Map([[Array.prototype.values,values],[Array.prototype[Symbol.iterator],values],[Array.prototype.keys,keys],[Array.prototype.entries,entries],[Function.prototype.bind,Persist.defaultBind]]);
State.context.methods.set(String.prototype[Symbol.iterator],stringValues);
for(const mode of ['keys','values','entries']){
 const method=function(){if(!nativeValues.types.isTypedArray(this))Reflect.apply(typedArrayPrototype[mode],this,[]);return new ArrayIterator(this,mode,true);};
 State.context.methods.set(typedArrayPrototype[mode],method);S.regOpaqueObject(method,'TypedArrayIterator.'+mode,{props:false});
}
State.context.methods.set(typedArrayPrototype[Symbol.iterator],State.context.methods.get(typedArrayPrototype.values));
for(const [name,fn] of Object.entries({values,keys,entries}))S.regOpaqueObject(fn,'ArrayIterator.'+name,{props:false});
// Collection cursors retain insertion order including deletion/reinsertion.
// The journal is Context-owned, never attached as an observable property of a
// program Map/Set and never kept in a process-global mutable registry.
const mapGet=Map.prototype.get,mapHas=Map.prototype.has,mapSet=Map.prototype.set,mapDelete=Map.prototype.delete,mapClear=Map.prototype.clear;
const setHas=Set.prototype.has,setAdd=Set.prototype.add,setDelete=Set.prototype.delete,setClear=Set.prototype.clear;
function journal(table,isMap){
 let data=State.context.collections.get(table);
 if(!data){data={entries:[],positions:new Map()};
  // The first cursor discovers every existing entry. Charge that traversal
  // before publishing the journal so a budget fault leaves no partial index.
  for(const key of isMap?Map.prototype.keys.call(table):Set.prototype.values.call(table)){
   tick();const entry={key,live:true};data.entries.push(entry);data.positions.set(key,entry);
  }
  State.context.collections.set(table,data);
 }
 return data;
}
function collectionState(table,isMap,mode){
 if(!(isMap?nativeValues.types.isMap(table):nativeValues.types.isSet(table))){
  Reflect.apply((isMap?Map:Set).prototype[mode],table,[]);
  throw new TypeError('Incompatible collection receiver');
 }
 if(State.context.collectionMemory){State.context.collectionMemory.data(table,isMap,false,tick);return {table,isMap,mode,index:0,done:false};}
 return {table,isMap,mode,data:journal(table,isMap),index:0,done:false};
}
function collectionNext(receiver,kind,result=allocate){
 const state=iteratorState(receiver,kind);
 if(state.done)return result({done:true,value:undefined});
 if(State.context.collectionMemory){
  tick();const entry=State.context.collectionMemory.data(state.table,state.isMap,false,tick).next(state.index);
  if(!entry){state.done=true;state.table=null;return result({done:true,value:undefined});}
  state.index=entry.cursor;
  return result({done:false,value:state.mode==='entries'?allocate([entry.key,entry.value]):state.mode==='keys'?entry.key:entry.value});
 }
 while(state.index<state.data.entries.length){tick();const entry=state.data.entries[state.index++];if(!entry.live)continue;
  const key=entry.key,value=state.isMap?mapGet.call(state.table,key):key;
  return result({done:false,value:state.mode==='entries'?allocate([key,value]):state.mode==='keys'?key:value});
 }
 state.done=true;state.table=state.data=null;return result({done:true,value:undefined});
}
class MapIterator{
 constructor(table,mode){intrinsicState.initialize(this,'MapIterator',collectionState(table,true,mode));}
 next(){return collectionNext(this,'MapIterator');}
}
class SetIterator{
 constructor(table,mode){intrinsicState.initialize(this,'SetIterator',collectionState(table,false,mode));}
 next(){return collectionNext(this,'SetIterator');}
}
const arrayIteratorNext=ArrayIterator.prototype.next,mapIteratorNext=MapIterator.prototype.next,setIteratorNext=SetIterator.prototype.next;
const transientIteratorResult=value=>value;
intrinsicState.register(MapIterator,'MapIterator',undefined,true);
intrinsicState.register(SetIterator,'SetIterator',undefined,true);
for(const [type,isMap]of [[Map,true],[Set,false]]){
 const methods={
  keys:function(){return new (isMap?MapIterator:SetIterator)(this,'keys');},
  values:function(){return new (isMap?MapIterator:SetIterator)(this,'values');},
  entries:function(){return new (isMap?MapIterator:SetIterator)(this,'entries');},
  delete:function(key){if(State.context.collectionMemory)return State.context.collectionMemory.data(this,isMap,true,tick).delete(key,tick);const result=(isMap?mapDelete:setDelete).call(this,key);const data=State.context.collections.get(this);if(result&&data){data.positions.get(key).live=false;data.positions.delete(key);}return result;},
  clear:function(){if(State.context.collectionMemory){State.context.collectionMemory.data(this,isMap,true,tick).clear();return;}(isMap?mapClear:setClear).call(this);const data=State.context.collections.get(this);if(data){for(const entry of data.entries){tick();entry.live=false;}data.positions.clear();}},
 };
 methods[isMap?'set':'add']=function(key,value){if(State.context.collectionMemory){State.context.collectionMemory.data(this,isMap,true,tick).set(key,isMap?value:key===0?0:key,tick);return this;}const had=(isMap?mapHas:setHas).call(this,key);(isMap?mapSet:setAdd).call(this,key,value);const data=State.context.collections.get(this);if(!had&&data){const entry={key:key===0?0:key,live:true};data.entries.push(entry);data.positions.set(key,entry);}return this;};
 methods.has=function(key){return State.context.collectionMemory?State.context.collectionMemory.data(this,isMap,false,tick).has(key,tick):(isMap?mapHas:setHas).call(this,key);};
 if(isMap)methods.get=function(key){return State.context.collectionMemory?State.context.collectionMemory.data(this,true,false,tick).get(key,tick):mapGet.call(this,key);};
 const nativeForEach=type.prototype.forEach;
 methods.forEach=function(callback,receiver){
  if(!State.context.collectionMemory)return Reflect.apply(nativeForEach,this,[callback,receiver]);
  State.context.collectionMemory.data(this,isMap,false,tick);
  if(typeof callback!=='function')throw new TypeError('Invalid collection callback');
  let cursor=0;
  for(;;){tick();const entry=State.context.collectionMemory.data(this,isMap,false,tick).next(cursor);if(!entry)return;
   cursor=entry.cursor;State.context.operations.invoke(callback,receiver,[entry.value,entry.key,this]);}
 };
 const size=Object.getOwnPropertyDescriptor(type.prototype,'size').get;
 const getSize=function(){return State.context.collectionMemory?State.context.collectionMemory.data(this,isMap,false,tick).size:Reflect.apply(size,this,[]);};
 State.context.methods.set(size,getSize);S.regOpaqueObject(getSize,'Collection.'+type.name+'.size',{props:false});
 for(const [name,fn]of Object.entries(methods)){State.context.methods.set(type.prototype[name],fn);S.regOpaqueObject(fn,'Collection.'+type.name+'.'+name,{props:false});}
 State.context.methods.set(type.prototype[Symbol.iterator],methods[isMap?'entries':'values']);
}
S.regOpaqueRec(State.native.Promise,'builtin.NativePromise',{descriptor:{props:false}});
S.regOpaqueObject(globalThis,'Global',{props:false});
for(const key of ['Object','Array','Number','String','Boolean','Math','JSON','Map','Set','Symbol','Reflect','Error','TypeError','RangeError','Function','RegExp','Date','Uint8Array','ArrayBuffer','DataView','WeakMap','WeakSet']){const value=globalThis[key];S.regOpaqueRec(value,'builtin.'+key,{descriptor:{props:false}});if(value.prototype){S.regOpaqueObject(value.prototype,'prototype.'+key,{props:false});for(const name of Object.getOwnPropertyNames(value.prototype)){const d=Object.getOwnPropertyDescriptor(value.prototype,name);if(typeof d.value==='function')S.regOpaqueObject(d.value,'prototype.'+key+'.'+name,{props:false});}}}
S.regOpaqueObject(State.context,'effects.context',{props:false});
for(const name of ['undef','token','sideEffectToken','ctrlToken'])S.regOpaqueObject(State[name],'effects.sentinel.'+name,{props:false});
S.regConstructor(State.ForInIterator,{name:'ForInIterator'});
class Device{constructor(){intrinsicState.initialize(this,'Device',{});}call(call){const state=intrinsicState.edit(this);if(state.pending){state.fault='Overlapping IO';throw new Error(state.fault);}state.callData=call;state.pending=new Future();return state.pending;}}
intrinsicState.register(Device,'Device');
for(const type of [Device,Future,ArrayIterator,StringIterator,RegExpStringIterator,MapIterator,SetIterator])for(const [part,target]of [['static',type],['prototype',type.prototype]])for(const key of Reflect.ownKeys(target)){
 const d=Object.getOwnPropertyDescriptor(target,key);
 for(const [field,value]of Object.entries(d))if(typeof value==='function')S.regOpaqueObject(value,'runtime.'+type.name+'.'+part+'.'+String(key)+'.'+field,{props:false});
}
function drain(){let count=0;while(jobs().length){if(State.context.__budgetExceeded)throw new Error('budget exceeded');if(++count>1000000){State.context.__budgetExceeded=true;throw new Error('budget exceeded');}const job=jobs().shift(),{future,listener}=job;
 if(job.adopt){const callbacks=resolving(future);try{State.context.operations.invoke(job.then,job.value,callbacks);}catch(error){callbacks[1](error);}continue;}
 const state=stateOf(future),callback=state.status===1?listener.yes:listener.no;try{if(typeof callback==='function')resolve.call(listener.child,State.context.operations.invoke(callback,undefined,[state.value]));else settle(listener.child,state.status,state.value);}catch(e){reject.call(listener.child,e);}}}
const G=require("@bear-forge/effectful-continuations/generator");
const AG=require("@bear-forge/effectful-continuations/asyncGenerator");
class ForInCursor{
 constructor(value){intrinsicState.initialize(this,'ForInCursor',{object:Object(value),fields:State.context.operations.forInKeys(value),index:0});}
 next(){const state=intrinsicState.edit(this),ops=State.context.operations;
  // Only generated for-in machinery sees these immutable, primitive-only
  // results. Cursor progress remains in Context; results need no heap version.
  while(state.index<state.fields.length){tick();const key=state.fields[state.index++];if(ops.has(key,state.object))return {done:false,value:key};}
  return {done:true,value:undefined};
 }
}
intrinsicState.register(ForInCursor,'ForInCursor');
S.regOpaqueObject(ForInCursor.prototype.next,'runtime.ForInCursor.next',{props:false});
const iteration=require('./iteration.cjs')(S,State,Persist,Future,value=>
 (State.context.objects??State.context.memory?.objects)?new ForInCursor(value):D.forInIterator(value));
function yldDelegate(result){G.yld(undefined);return State.context.value=result;}
S.regOpaqueObject(yldDelegate,'runtime.yldDelegate',{props:false});
const iteratorBase=Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
const asyncIteratorBase=Object.getPrototypeOf(Object.getPrototypeOf((async function*(){}).prototype));
for(const [name,base,key]of [['Iterator',iteratorBase,Symbol.iterator],['AsyncIterator',asyncIteratorBase,Symbol.asyncIterator]]){
 S.regOpaqueObject(base,'runtime.'+name+'.prototype',{props:false});
 S.regOpaqueObject(base[key],'runtime.'+name+'.identity',{props:false});
}
for(const type of [ArrayIterator,StringIterator,MapIterator,SetIterator,G.Generator]){
 Object.setPrototypeOf(type.prototype,iteratorBase);
 delete type.prototype[Symbol.iterator];
}
for(const [type,tag]of [[ArrayIterator,'Array Iterator'],[StringIterator,'String Iterator'],[MapIterator,'Map Iterator'],[SetIterator,'Set Iterator']]){
 delete type.prototype.constructor;
 Object.defineProperty(type.prototype,Symbol.toStringTag,{value:tag,configurable:true});
}
Object.setPrototypeOf(AG.AsyncGenerator.prototype,asyncIteratorBase);
State.context.generatorState=intrinsicState;
for(const [kind,Constructor]of [['Generator',G.Generator],['AsyncGenerator',AG.AsyncGenerator]])intrinsicState.register(Constructor,kind,undefined,true);
for(const type of [G.Generator,G.IterableThis,AG.AsyncGenerator,AG.AsyncIterableThis]){
 S.regOpaqueObject(type.prototype,'runtime.'+type.name+'.prototype',{props:false});
 for(const key of Reflect.ownKeys(type.prototype)){
  const descriptor=Object.getOwnPropertyDescriptor(type.prototype,key);
  for(const [field,value]of Object.entries(descriptor))if(typeof value==='function')S.regOpaqueObject(value,'runtime.'+type.name+'.'+String(key)+'.'+field,{props:false});
 }
}
// Fork and internal value-domain checks use the same in-memory Context copier.
const prepareCopy=require('./copy-plan.cjs')(S,State,Persist,Cell,cell,environment,scopeDescriptor,weakCollections,intrinsicState,nativeValues,CowQueue);
// Explicit pairs describe runtime replacements of ECMAScript intrinsics.
// This table restores reflection only; it does not grant native-call permission.
const intrinsicSources=new Map();
const nativeRegExpStringIteratorPrototype=Object.getPrototypeOf(RegExp.prototype[Symbol.matchAll].call(/a/g,'a'));
for(const [replacement,native]of [[Future,State.native.Promise],[Future.prototype,State.native.Promise.prototype],
 [RegExpStringIterator.prototype,nativeRegExpStringIteratorPrototype],
 [weakCollections.WeakMap,WeakMap],[weakCollections.WeakMap.prototype,WeakMap.prototype],
 [weakCollections.WeakSet,WeakSet],[weakCollections.WeakSet.prototype,WeakSet.prototype]]){
 if(typeof replacement==='function')intrinsicSources.set(replacement,Function.prototype.toString.call(native));
 for(const key of Reflect.ownKeys(native)){
  const from=Object.getOwnPropertyDescriptor(native,key),to=Object.getOwnPropertyDescriptor(replacement,key);
  if(!to)continue;
  for(const field of ['value','get','set'])if(typeof from[field]==='function'&&typeof to[field]==='function')
   intrinsicSources.set(to[field],Function.prototype.toString.call(from[field]));
 }
}
function tick(){
 const context=State.context.active;
 if(!context)throw new Error('Program requires an active Context');
 if(--context.remaining<0){
  State.context.__budgetExceeded=true;
  throw new Error('budget exceeded');
 }
}
function installOperations(createOperations){const operations=createOperations({
 record:(kind,fields)=>State.context.intrinsicSlots?new internalRecords[kind](fields):fields,
 allocate:nativeValues.registerObject,
 iteratorResult(next,receiver){
  if(next===arrayIteratorNext)return arrayNext(receiver,transientIteratorResult);
  if(next===mapIteratorNext)return collectionNext(receiver,'MapIterator',transientIteratorResult);
  if(next===setIteratorNext)return collectionNext(receiver,'SetIterator',transientIteratorResult);
 },
 objects:()=>State.context.objects??State.context.memory?.objects,
 memory:()=>State.context.memory,
 global:()=>State.context.globals,
 tick,
 regexpStringIterator:(matcher,text,global,fullUnicode)=>new RegExpStringIterator(matcher,text,global,fullUnicode),
 violation(){State.context.__hostViolation=true;throw new TypeError('Ambient or dynamic execution is not admitted');},
 namespace:bindings=>{
  const table=Object.create(null),descriptors=nativeValues.ownDescriptors(bindings);
  for(const key of Object.keys(descriptors))table[key]=descriptors[key].value;
  return namespaces.create(table);
 },
 value:nativeValues.prepare,
 bind:(fn,self,args)=>Persist.defaultBind.apply(fn,[self,...args]),
 binding:fn=>State.binds.get(fn),
 compiled:fn=>State.closures.has(fn),
 functionSource(fn){
  const meta=State.closures.get(fn)?.[State.CLOSURE_META];
  return meta?.sourceRange && typeof meta.module.sourceText==='string'
   ? meta.module.sourceText.slice(meta.sourceRange[0],meta.sourceRange[1]) : intrinsicSources.get(fn);
 },
 construct(fn,args,newTarget){
  if(fn===Future&&(args.length===0||typeof args[0]!=='function'||newTarget!==Future))throw new TypeError('Unsupported Promise construction');
  if(State.context.objects&&State.closures.has(fn)){
   // Compiled constructors execute their bodies through explicit frames. Give
   // the instance a neutral native identity: a V8 construction map otherwise
   // retains the original constructor/prototype after logical replacement.
   const prototype=newTarget.prototype;
   const self=allocate(Object.create(null));
   State.context.objects.setPrototypeOf(self,prototype!==null&&(typeof prototype==='object'||typeof prototype==='function')?prototype:Object.prototype);
   const previous=State.context.takeConstructTarget;
   let pending=true;
   State.context.takeConstructTarget=target=>{
    if(pending&&target===fn){pending=false;return newTarget;}
    return undefined;
   };
   try{
    const result=Reflect.apply(fn,self,args);
    return result!==null&&(typeof result==='object'||typeof result==='function')?result:self;
   }finally{State.context.takeConstructTarget=previous;}
  }
  return Reflect.construct(fn,args,newTarget);
 },
 apply(fn,self,args){
  fn=State.context.methods?.get(fn)??fn;State.context.call=fn;
  return Reflect.apply(fn,self,args);
 }
});
S.regOpaqueRec(operations,'runtime.operations',{descriptor:{props:false}});
State.context.operations=operations;
return operations;}
// Public intrinsic metadata is independent of private serialization names and
// bundler-generated identifiers. Register shared code before exposing its names.
Object.defineProperty(Future,'name',{value:'Promise',configurable:true});
Object.defineProperty(Object.getOwnPropertyDescriptor(Future,Symbol.species).get,'name',{value:'get [Symbol.species]',configurable:true});
module.exports={createContextRoots,constructed,strictArguments:nativeValues.registerObject,CowCollections,CowQueue,globals:globalThis,...D,...G,...AG,...iteration,yldDelegate,Future,Device,S,State,drain,admitSchema,scope,capture,prepareCopy,installOperations,stateOf,tick,
 WeakMap:weakCollections.WeakMap,WeakSet:weakCollections.WeakSet,
 intrinsics:[D.AsyncFunctionPrototype,Device,Future,ArrayIterator,StringIterator,RegExpStringIterator,MapIterator,SetIterator,G.Generator,G.IterableThis,AG.AsyncGenerator,AG.AsyncIterableThis,weakCollections.WeakMap,weakCollections.WeakSet,State.ForInIterator,...nativeValues.intrinsics,...promiseMethods,...iteration.intrinsics,yldDelegate,resolve,reject,resolveOnce,rejectOnce],
// Registration is shared per loaded Program; source initialization belongs to start.
moduleExports(){D.compileModule();},
initialize(){
 State.context.moduleId=null;
 const top=D.getCurModule().topLevel,completion=top.func(null)();
 // Ordinary module statement completion values are not async evaluation tasks.
 return top.flags&State.Flag.ASYNC_FUNCTION?completion:undefined;
},
reply(io,value){const state=intrinsicState.edit(io),waiting=state.pending;state.pending=null;resolve.call(waiting,value);drain();}};
