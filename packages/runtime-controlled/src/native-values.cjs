/* Brand checks and internal-slot reads must not execute user valueOf/toString. */
module.exports=function nativeValues(S,namespaces,State,Persist,tick,intrinsicState){
 const types=require('node:util').types;
 // Native operations can raise every standard error family, independently of
 // which constructor names the author's global environment exposes. Their
 // immutable constructors/prototypes are code references, not Context objects.
 const errorConstructors={Error,EvalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,AggregateError,...(typeof SuppressedError==='function'?{SuppressedError}:{})};
 for(const [name,Constructor]of Object.entries(errorConstructors)){
  S.regOpaqueRec(Constructor,'runtime.nativeError.'+name,{descriptor:{props:false}});
  for(const [part,value]of [['constructor',Constructor],['prototype',Constructor.prototype]]){
   for(const [index,key]of Reflect.ownKeys(value).entries()){
    const label='runtime.nativeError.'+name+'.'+part+'.'+index;
    if(typeof key==='symbol')S.regOpaquePrim(key,label+'.key');
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    for(const field of ['value','get','set'])if(typeof descriptor[field]==='function')
     S.regOpaqueObject(descriptor[field],label+'.'+field,{props:false});
   }
  }
 }
 const nativeCursorPrototypes=new Set([
  Object.getPrototypeOf([][Symbol.iterator]()),Object.getPrototypeOf(''[Symbol.iterator]())
 ]);
 const errors=new WeakMap();
 function isError(value){return types.isNativeError(value);}
 function createError(){const value=new Error();prepare(value);return value;}

 const stack=Object.getOwnPropertyDescriptor(new Error(),'stack');
 function readErrorState(value){return State.context.intrinsicSlots?intrinsicState.state(value):errors.get(value);}
 function writeErrorState(value,state){
  if(State.context.intrinsicSlots){if(intrinsicState.has(value))intrinsicState.install(value,state);else intrinsicState.initialize(value,'NativeErrorState',state);}
  else errors.set(value,state);
 }
 function stackGet(){
  if(!isError(this))return Reflect.apply(stack.get,this,[]);
  const state=readErrorState(this);if(state?.assigned)return state.value;throw new TypeError('Unsupported default Error.stack: native debug frames are not resumable program state');
 }
 function stackSet(value){
  if(!isError(this))return Reflect.apply(stack.set,this,[value]);
  if(!State.context.intrinsicSlots)Reflect.apply(stack.set,this,[value]);
  writeErrorState(this,{assigned:true,value});
 }
 function prepare(value){
  // Only objects can carry native Error/iterator slots. Primitive values and
  // functions need no slot preparation; callable admission is handled by ops.
  if(value===null||typeof value!=='object')return;
  if(nativeCursorPrototypes.has(Object.getPrototypeOf(value))){
   throw new TypeError('Unsupported native iterator crossing into program state');
  }
  // Array identity is intrinsic and cannot also carry any of the native
  // slots below. Check its current prototype first: prototype changes must
  // still trigger iterator rejection, even after an earlier successful read.
  if(Array.isArray(value))return;
  const heap=State.context.objects??State.context.memory?.objects;
  if(heap?.nativePreparationUnneeded(value))return;
  if(types.isMapIterator(value)||types.isSetIterator(value))throw new TypeError('Unsupported native iterator crossing into program state');
  const map=types.isMap(value);
  if(map||types.isSet(value)){
   if(State.context.collectionMemory)State.context.collectionMemory.data(value,map,false,tick);
   registerObject(value);return;
  }
  if(types.isRegExp(value)||types.isBoxedPrimitive(value)){registerObject(value);return;}
  if(types.isArrayBuffer(value)){State.context.memory?.adoptBuffer(value);return;}
  if(types.isArrayBufferView(value)){State.context.memory?.adoptView(value);return;}
  if(!isError(value)){heap?.nativePreparationUnneeded(value,true);return;}
  const d=Object.getOwnPropertyDescriptor(value,'stack');
  if(d&&d.get===stack?.get&&d.set===stack?.set&&typeof stack.set==='function'){
   // Native debug frames can retain constructor closures and their old
   // prototypes. The controlled accessor rejects this non-resumable stack,
   // so discard its native backing before installing the logical accessor.
   Reflect.apply(stack.set,value,[undefined]);
   Object.defineProperty(value,'stack',{...d,get:stackGet,set:stackSet});
  }
  registerObject(value);
  if(State.context.intrinsicSlots?!intrinsicState.has(value):!errors.has(value))writeErrorState(value,{assigned:false});
 }
 if(stack?.get)S.regOpaqueObject(stack.get,'runtime.Error.stack.get',{props:false});
 if(stack?.set)S.regOpaqueObject(stack.set,'runtime.Error.stack.nativeSet',{props:false});
 S.regOpaqueObject(stackSet,'runtime.Error.stack.set',{props:false});
 S.regOpaqueObject(stackGet,'runtime.Error.stack.getControlled',{props:false});
 function errorState(value){if(!isError(value))return undefined;prepare(value);return readErrorState(value);}
 function installError(value,state){prepare(value);writeErrorState(value,state);if(state.assigned&&!State.context.intrinsicSlots)Reflect.apply(stack.set,value,[state.value]);}
 const values=[['number',types.isNumberObject,Number.prototype.valueOf],['string',types.isStringObject,String.prototype.valueOf],
  ['boolean',types.isBooleanObject,Boolean.prototype.valueOf],['bigint',types.isBigIntObject,BigInt.prototype.valueOf],['symbol',types.isSymbolObject,Symbol.prototype.valueOf]];
 function boxed(value){if(!types.isBoxedPrimitive(value))return undefined;for(const [kind,test,read]of values)if(test(value))return {kind,value:Reflect.apply(read,value,[])};}
 const descriptor=S.regDescriptor({name:'runtime.BoxedPrimitive',
  propertyStorage:objectStorage,ownDescriptors,
  create(ctx,json){return registerObject(Object(ctx.step(json.primitive)));},
  write(ctx,value){const result={};result.primitive=ctx.step(boxed(value).value,result,'primitive');return result;}
 });
 const errorDescriptor=S.regDescriptor({name:'runtime.Error',completeOwnProperties:true,
  propertyStorage:objectStorage,ownDescriptors,
  create(){return createError();},
  write(ctx,value){const state=errorState(value),result={};result.state=ctx.step(state,result,'state');return result;},
  readContent(ctx,json,value){installError(value,ctx.step(json.state));}
 });
 // Read internal slots through intrinsics. Neither prototypes nor author
 // iterators/getters identify a native value or participate in its snapshot.
 const mapEntries=Map.prototype.entries,mapSet=Map.prototype.set;
 const setValues=Set.prototype.values,setAdd=Set.prototype.add;
 function collectionSnapshot(value,isMap){
  if(State.context.collectionMemory)return State.context.collectionMemory.data(value,isMap).snapshot();
  const entries=[];let order=0;
  for(const [key,item]of isMap?mapEntries.call(value):Set.prototype.entries.call(value))entries.push([order++,key,item]);
  return {sequence:order,entries};
 }
 function installCollection(value,isMap,entries,sequence){
  if(State.context.collectionMemory){State.context.collectionMemory.data(value,isMap,true).restore(entries,sequence);return;}
  for(const [,key,item]of entries)if(isMap)mapSet.call(value,key,item);else setAdd.call(value,key);
 }
 const mapDescriptor=S.regDescriptor({name:'runtime.Map',
  propertyStorage:objectStorage,ownDescriptors,
  create(){return registerObject(new Map());},
  write(ctx,value){const keys=[],values=[],orders=[],snapshot=collectionSnapshot(value,true);
   for(const [order,key,item]of snapshot.entries){orders.push(order);keys.push(ctx.step(key,keys,keys.length));values.push(ctx.step(item,values,values.length));}
   return State.context.collectionMemory?{keys,values,orders,sequence:snapshot.sequence}:{keys,values};},
  readContent(ctx,json,value){installCollection(value,true,json.keys.map((key,i)=>[json.orders?.[i]??i,ctx.step(key),ctx.step(json.values[i])]),json.sequence??json.keys.length);}
 });
 const setDescriptor=S.regDescriptor({name:'runtime.Set',
  propertyStorage:objectStorage,ownDescriptors,
  create(){return registerObject(new Set());},
  write(ctx,value){const items=[],orders=[],snapshot=collectionSnapshot(value,false);
   for(const [order,key]of snapshot.entries){orders.push(order);items.push(ctx.step(key,items,items.length));}
   return State.context.collectionMemory?{items,orders,sequence:snapshot.sequence}:{items};},
  readContent(ctx,json,value){installCollection(value,false,json.items.map((item,i)=>{const key=ctx.step(item);return [json.orders?.[i]??i,key,key];}),json.sequence??json.items.length);}
 });
 const source=Object.getOwnPropertyDescriptor(RegExp.prototype,'source').get;
 const flagReaders=[['hasIndices','d'],['global','g'],['ignoreCase','i'],['multiline','m'],['dotAll','s'],['unicode','u'],['unicodeSets','v'],['sticky','y']]
  .map(([key,flag])=>[Object.getOwnPropertyDescriptor(RegExp.prototype,key)?.get,flag]);
 const regexpDescriptor=S.regDescriptor({name:'runtime.RegExp',
  propertyStorage:objectStorage,ownDescriptors,
  create(ctx,json){return registerObject(new RegExp(json.source,json.flags));},
  write(ctx,value){return {source:source.call(value),flags:flagReaders.filter(([get])=>get&&get.call(value)).map(([,flag])=>flag).join('')};}
 });
 const Buffer=require('node:buffer').Buffer;
 const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
 const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
 const typedGet=Object.fromEntries(['buffer','byteOffset','length'].map(key=>[key,Object.getOwnPropertyDescriptor(typedPrototype,key).get]));
 const viewGet=Object.fromEntries(['buffer','byteOffset','byteLength'].map(key=>[key,Object.getOwnPropertyDescriptor(DataView.prototype,key).get]));
 const typedName=Object.getOwnPropertyDescriptor(typedPrototype,Symbol.toStringTag).get;
 const constructors={Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array};
 function bufferSnapshot(value){
  const bytes=new Uint8Array(bufferLength.call(value));
  if(State.context.memory?.has(value))State.context.memory.readBytes(value,0,bytes);
  else bytes.set(new Uint8Array(value));
  return bytes;
 }
 function createBuffer(bytes){
  const buffer=new ArrayBuffer(bytes.length);new Uint8Array(buffer).set(bytes);
  return State.context.memory?State.context.memory.adoptBuffer(buffer):buffer;
 }
 function adoptView(value){return State.context.memory?State.context.memory.adoptView(value):value;}
 function objectStorage(value){const storage=State.context.objects??State.context.memory?.objects;return storage?.has(value)?storage:undefined;}
 function ownDescriptors(value){
  const storage=objectStorage(value);if(!storage)return Object.getOwnPropertyDescriptors(value);
  const descriptors={};for(const key of storage.ownKeys(value))Object.defineProperty(descriptors,key,{value:storage.getOwnPropertyDescriptor(value,key),enumerable:true,configurable:true,writable:true});
  return descriptors;
 }
 function registerObject(value){const storage=State.context.objects??State.context.memory?.objects;if(storage&&!storage.has(value))storage.register(value);return value;}
 function createArguments(){return registerObject((function(){'use strict';return arguments;})());}
 const argumentsPoison=Object.getOwnPropertyDescriptor((function(){'use strict';return arguments;})(),'callee').get;
 S.regOpaqueObject(argumentsPoison,'runtime.arguments.throwTypeError',{props:false});
 const argumentsDescriptor=S.regDescriptor({name:'runtime.Arguments',propertyStorage:objectStorage,ownDescriptors,
  create:createArguments,write(){return {};}
 });
 const objectDescriptor=S.regDescriptor({name:'runtime.HeapObject',propertyStorage:objectStorage,ownDescriptors,
  create(){return registerObject(Object.create(null));},write(){return {};}
 });
 const heapArrayDescriptor=S.regDescriptor({name:'runtime.HeapArray',propertyStorage:objectStorage,ownDescriptors,
  create(){return registerObject([]);},write(){return {};}
 });
 const bufferDescriptor=S.regDescriptor({name:'runtime.ArrayBuffer',
  propertyStorage:objectStorage,ownDescriptors,
  write(ctx,value){return {bytes:Buffer.from(bufferSnapshot(value)).toString('base64')};},
  create(ctx,json){return createBuffer(Buffer.from(json.bytes,'base64'));}
 });
 function viewOwnDescriptors(value){
  const storage=objectStorage(value);if(storage)return ownDescriptors(value);
  const descriptors={},length=types.isTypedArray(value)?typedGet.length.call(value):0;
  for(const key of Reflect.ownKeys(value)){
   if(typeof key==='string'&&String(Number(key))===key&&Number.isInteger(Number(key))&&Number(key)>=0&&Number(key)<length)continue;
   Object.defineProperty(descriptors,key,{value:Object.getOwnPropertyDescriptor(value,key),enumerable:true,configurable:true,writable:true});
  }
  return descriptors;
 }
 const viewDescriptor=S.regDescriptor({name:'runtime.ArrayBufferView',
  propertyStorage:objectStorage,
  ownDescriptors:viewOwnDescriptors,
  write(ctx,value){const data=types.isDataView(value),get=data?viewGet:typedGet;
   const result={kind:data?'DataView':typedName.call(value),offset:get.byteOffset.call(value),length:get[data?'byteLength':'length'].call(value)};
   result.buffer=ctx.step(get.buffer.call(value),result,'buffer');return result;
  },
  create(ctx,json){const Constructor=json.kind==='DataView'?DataView:constructors[json.kind];
   if(!Constructor)throw new TypeError('Unsupported buffer view');return adoptView(new Constructor(ctx.step(json.buffer),json.offset,json.length));
  }
 });
 const namespaceDescriptor=S.regDescriptor({name:'runtime.ModuleNamespace',props:false,
  create(ctx,json){return namespaces.allocate(json.names);},
  write(ctx,value){const record=namespaces.record(value),result={names:record.names};result.readers=ctx.step(record.readers,result,'readers');return result;},
  readContent(ctx,json,value){namespaces.install(value,ctx.step(json.readers));}
 });
 const arrayDescriptor=S.getState().byPrototype.get(Array.prototype);
 const nativePrototypes=new Set([Object,Array,Number,String,Boolean,BigInt,Symbol,Map,Set,WeakMap,WeakSet,
  RegExp,...Object.values(errorConstructors),Function,ArrayBuffer,DataView,...Object.values(constructors)].map(Constructor=>Constructor.prototype));
 S.regObjectDescriptorGetter(value=>{
  const own=S.getState().byObject.get(value);if(own)return own;
  if(typeof value==='function'&&State.closures.has(value))return Persist.FunctionDescriptor;
  return namespaces.record(value)?namespaceDescriptor:types.isBoxedPrimitive(value)?descriptor:isError(value)?errorDescriptor
   :types.isMap(value)?mapDescriptor:types.isSet(value)?setDescriptor:types.isRegExp(value)?regexpDescriptor
   :types.isArrayBuffer(value)?bufferDescriptor:types.isArrayBufferView(value)?viewDescriptor
   :types.isArgumentsObject(value)?argumentsDescriptor:Array.isArray(value)?objectStorage(value)?heapArrayDescriptor:arrayDescriptor:typeof value!=='function'&&objectStorage(value)?objectDescriptor:nativePrototypes.has(Object.getPrototypeOf(value))?undefined
   :S.getState().byPrototype.get(Object.getPrototypeOf(value));
 });
 return {registerObject,createArguments,objectStorage,ownDescriptors,viewOwnDescriptors,bufferSnapshot,createBuffer,adoptView,collectionSnapshot,installCollection,namespaces,types,boxed,prepare,errorState,createError,installError,intrinsics:[argumentsPoison,stack?.get,stack?.set,stackGet,stackSet].filter(Boolean)};
};
