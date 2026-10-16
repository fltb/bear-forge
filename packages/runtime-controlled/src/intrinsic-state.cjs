/* Internal slots of runtime intrinsics are not author-visible JS properties.
 * Their payload is nevertheless explicit Context data for copy/save/restore. */
module.exports=function intrinsicState(S,State){
 const records=new WeakMap(),identities=new WeakMap(),types=new Map(),descriptors=new Map(),cloners=new Map();
 const propertyKinds=new Set();
 let nextId=0;
 const storage=()=>State?.context.intrinsicSlots;
 function identity(value){let id=identities.get(value);if(id===undefined){id=nextId++;identities.set(value,id);}return id;}
 function record(value){const slots=storage();const id=identities.get(value);return slots?(id===undefined?undefined:slots.get(id,value)):records.get(value);}
 function put(value,payload){const slots=storage();if(slots){const id=identity(value);slots.register?.(id,value);slots.set(id,payload,value);}else records.set(value,payload);}

 function objectHeap(){return State?.context.objects??State?.context.memory?.objects;}
 function propertyStorage(value){const heap=objectHeap();return heap?.has(value)?heap:undefined;}
 function ownDescriptors(value){
  const heap=propertyStorage(value);if(!heap)return Object.getOwnPropertyDescriptors(value);
  const result={};for(const key of heap.ownKeys(value))Object.defineProperty(result,key,{value:heap.getOwnPropertyDescriptor(value,key),enumerable:true,configurable:true,writable:true});
  return result;
 }
 function initialize(value,kind,state){
  put(value,{kind,state});
  if(propertyKinds.has(kind)){const heap=objectHeap();if(heap&&!heap.has(value))heap.register(value);}
  if(descriptors.has(kind))S.setObjectDescriptor(value,descriptors.get(kind));return value;
 }
 // state/record are read-only when a Context selects intrinsicSlots. Writers
 // use edit for flat records or install for a complete replacement payload.
 function state(value){const payload=record(value);if(!payload)throw new TypeError('Incompatible intrinsic receiver');return payload.state;}
 function create(kind){return initialize(Object.create(types.get(kind).prototype),kind,undefined);}
 function register(Constructor,kind,clone,properties=false){
  if(clone)cloners.set(kind,clone);
  if(properties)propertyKinds.add(kind);
  types.set(kind,Constructor);
  S.regOpaqueObject(Constructor,'runtime.'+kind+'.class',{props:false});
  S.regOpaqueObject(Constructor.prototype,'runtime.'+kind+'.prototype',{props:false});
  const descriptor=S.regDescriptor({name:'runtime.'+kind,propertyStorage,ownDescriptors,create(){return create(kind);},
   write(ctx,value){const result={};result.state=ctx.step(state(value),result,'state');return result;},
   readContent(ctx,data,value){initialize(value,kind,ctx.step(data.state));}
  });
  descriptors.set(kind,descriptor);
 }
 // Runtime callers explicitly acquire a writable payload. Registered clone
 // functions may fork nested persistent roots, never recursively copy data.
 function edit(value){
  const payload=record(value);if(!payload)throw new TypeError('Incompatible intrinsic receiver');
  const slots=storage();
  return slots?slots.edit(identities.get(value),entry=>({kind:entry.kind,state:cloners.has(entry.kind)?cloners.get(entry.kind)(entry.state):{...entry.state}}),value).state:payload.state;
 }
 return {initialize,state,edit,register,cloneWith:(kind,clone)=>cloners.set(kind,clone),has:value=>record(value)!==undefined,record,create,
  install(value,payload){const previous=record(value);if(!previous)throw new TypeError('Incompatible intrinsic receiver');put(value,{kind:previous.kind,state:payload});}};
};
