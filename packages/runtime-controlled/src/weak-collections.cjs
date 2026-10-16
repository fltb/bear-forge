/* Native weak storage plus a weak key index. Index entries do not keep keys
 * alive. Only the runtime can enumerate this index, for fork and persistence. */
module.exports=function weakCollections(S,State){
 let properties;
 const NativeMap=WeakMap,NativeSet=WeakSet;
 const metadata=new NativeMap();
 const nativeSet=NativeMap.prototype.set,nativeAdd=NativeSet.prototype.add;
 const nativeHasMap=NativeMap.prototype.has,nativeGet=NativeMap.prototype.get,nativeHasSet=NativeSet.prototype.has;
 function remember(table,key,isMap){
  let data=metadata.get(table);
  if(!data){data={isMap,keys:[],known:new NativeSet()};metadata.set(table,data);}
  if(!data.known.has(key)){data.known.add(key);data.keys.push(new WeakRef(key));}
 }
 function items(table){
  if(State.context.weakMemory)return Array.from(State.context.weakMemory.items(table));
  const data=metadata.get(table);if(!data)throw Error('Unindexed weak collection');
  const result=[],live=[];
  for(const reference of data.keys){const key=reference.deref();if(key===undefined)continue;live.push(reference);
   if((data.isMap?nativeHasMap:nativeHasSet).call(table,key))result.push([key,data.isMap?nativeGet.call(table,key):true]);
  }
  data.keys=live;return result;
 }
 function shared(key){
  const state=S.getState();
  return typeof key==='symbol'?state.byValue.has(key):state.byObject.get(key)?.value===key||state.byPrototype.has(key);
 }
 function make(name,Native,isMap){
  let descriptor;
  const Constructor={ [name]:function(iterable){
   if(!new.target)throw new TypeError(name+' requires new');
   const heap=State.context.objects??State.context.memory?.objects;
   // Keep the native weak brand without embedding an authored subclass
   // prototype in V8's initial allocation map.
   const prototype=heap?new.target.prototype:undefined;
   const table=Reflect.construct(Native,[],heap?Constructor:new.target);
   metadata.set(table,{isMap,keys:[],known:new NativeSet()});
   State.context.weakMemory?.create(table);
   properties?.registerObject(table);
   if(heap)heap.setPrototypeOf(table,prototype!==null&&(typeof prototype==='object'||typeof prototype==='function')?prototype:Native.prototype);
   if(descriptor)S.setObjectDescriptor(table,descriptor);
   if(iterable!=null)State.context.operations.collectionInitialize(table,iterable,isMap);
   return table;
  }}[name];
  const descriptors=Object.getOwnPropertyDescriptors(Native.prototype);
  descriptors.constructor.value=Constructor;
  const methods={set(key,value){if(State.context.weakMemory){nativeHasMap.call(this,key);State.context.weakMemory.set(this,key,value);return this;}nativeSet.call(this,key,value);remember(this,key,true);return this;},add(key){if(State.context.weakMemory){nativeHasSet.call(this,key);State.context.weakMemory.set(this,key,true);return this;}nativeAdd.call(this,key);remember(this,key,false);return this;}};
  descriptors[isMap?'set':'add'].value=methods[isMap?'set':'add'];
  for(const name of isMap?['get','has','delete']:['has','delete']){
   const original=descriptors[name].value;
   descriptors[name].value=function(key){
    if(!State.context.weakMemory)return Reflect.apply(original,this,[key]);
    (isMap?nativeHasMap:nativeHasSet).call(this,key);
    return State.context.weakMemory[name](this,key);
   };
  }

  Object.defineProperty(Constructor,'length',{value:0});
  Object.defineProperty(Constructor,'prototype',{value:Object.create(Object.prototype,descriptors),writable:false});
  S.regOpaqueObject(Constructor,'runtime.'+name+'.constructor',{props:false});
  S.regOpaqueObject(Constructor.prototype,'runtime.'+name+'.prototype',{props:false});
  for(const key of Reflect.ownKeys(Constructor.prototype)){
   const value=Object.getOwnPropertyDescriptor(Constructor.prototype,key).value;
   if(typeof value==='function')S.regOpaqueObject(value,'runtime.'+name+'.'+String(key),{props:false});
  }
  descriptor=S.regDescriptor({name:'runtime.'+name,
   propertyStorage:value=>properties?.objectStorage(value),
   ownDescriptors:value=>properties?properties.ownDescriptors(value):Object.getOwnPropertyDescriptors(value),
   create(){return new Constructor();},
   write(ctx,table){
    const result={entries:[]};
    for(const [key,value]of items(table))ctx.weakEntries.add(key,()=>{
     const pair=[];result.entries.push(pair);pair[0]=ctx.step(key,pair,0);if(isMap)pair[1]=ctx.step(value,pair,1);
    },shared(key)||ctx.sharedRefsMap.has(key)||ctx.knownSyms.has(key));
    return result;
   },
   readContent(ctx,data,table){for(const pair of data.entries)Reflect.apply(Constructor.prototype[isMap?'set':'add'],table,[ctx.step(pair[0]),isMap?ctx.step(pair[1]):undefined]);}
  });
  return Constructor;
 }
 const TrackedMap=make('WeakMap',NativeMap,true),TrackedSet=make('WeakSet',NativeSet,false);
 return {installProperties:hooks=>{properties=hooks;},WeakMap:TrackedMap,WeakSet:TrackedSet,has:value=>metadata.has(value),items,shared,
  constructorFor(value){return metadata.get(value).isMap?TrackedMap:TrackedSet;},
  create(value){return new (metadata.get(value).isMap?TrackedMap:TrackedSet)();},
  put(table,key,value){Reflect.apply(metadata.get(table).isMap?TrackedMap.prototype.set:TrackedSet.prototype.add,table,[key,value]);}
 };
};
