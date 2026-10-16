/* A paused Context is immutable until execution/validation resumes. Prepare its
 * copy layout once, then allocate and fill independent graphs without repeating
 * property discovery for every sibling. This is a data-copy plan, not execution
 * history and not a second program interpreter. */
module.exports=function copyPlans(S,State,Persist,Cell,cell,environment,scopeDescriptor,weakCollections,intrinsicState,nativeValues,CowQueue){
 const mapEntries=Map.prototype.entries,setValues=Set.prototype.values;
 const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
 const typedProto=Object.getPrototypeOf(Uint8Array.prototype);
 const typedGet=Object.fromEntries(['buffer','byteOffset','length'].map(k=>[k,Object.getOwnPropertyDescriptor(typedProto,k).get]));
 const viewGet=Object.fromEntries(['buffer','byteOffset','byteLength'].map(k=>[k,Object.getOwnPropertyDescriptor(DataView.prototype,k).get]));
 const typedName=Object.getOwnPropertyDescriptor(typedProto,Symbol.toStringTag).get;
 const typedConstructors={Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,...(typeof Float16Array==='function'?{Float16Array}:{})};
 const regexpSource=Object.getOwnPropertyDescriptor(RegExp.prototype,'source').get;
 const flags=[['hasIndices','d'],['global','g'],['ignoreCase','i'],['multiline','m'],['dotAll','s'],['unicode','u'],['unicodeSets','v'],['sticky','y']].map(([key,flag])=>[Object.getOwnPropertyDescriptor(RegExp.prototype,key)?.get,flag]);
 // Keep the returned copier outside discovery's lexical environment. Pending
 // weak entries and source-reference indexes must not survive in its closure.
 function makeCopy(nodes,rootRef){
  return function copy(){
   const targets=new Array(nodes.length),prototypes=new Array(nodes.length);
   function resolve(ref){
    if('index'in ref)return allocate(ref.index);
    if('prototype'in ref){
     const index=ref.prototype;
     if(prototypes[index]===undefined){
      const fn=allocate(index),candidate=Object.getOwnPropertyDescriptor(fn,'prototype')?.value;
      const descriptor=candidate&&Object.getOwnPropertyDescriptor(candidate,'constructor');
      if(candidate&&Object.getPrototypeOf(candidate)===Object.prototype&&Object.isExtensible(candidate)
       &&Reflect.ownKeys(candidate).length===1&&descriptor?.value===fn&&descriptor.writable&&descriptor.configurable&&!descriptor.enumerable)prototypes[index]=candidate;
      else {
       const prototype={};
       Object.defineProperty(prototype,'constructor',{value:fn,writable:true,configurable:true});
       prototypes[index]=prototype;
      }
     }
     return prototypes[index];
    }
    return ref.value;
   }
   function allocate(index){
    if(targets[index]!==undefined)return targets[index];
    const node=nodes[index];let target;
    switch(node.kind){
     case 'namespace':target=nativeValues.namespaces.allocate(node.names);break;
     case 'cell':target=cell(undefined);break;
     case 'intrinsic':target=intrinsicState.create(node.intrinsic);break;
     case 'scope':target=environment([]);break;
     case 'boxed':target=Object(node.primitive);break;
     case 'error':target=nativeValues.createError();break;
     case 'closure':target=node.meta.func(null,undefined,true);break;
     case 'bound':target=Persist.makeBind(node.constructable);break;
     case 'array':target=[];break;
     case 'arguments':target=nativeValues.createArguments();break;
     case 'queue':target=new CowQueue();break;
     case 'map':target=new Map();break;
     case 'set':target=new Set();break;
     case 'weak':target=new node.weakConstructor();break;
     case 'buffer':target=nativeValues.createBuffer(node.bytes);break;
     case 'view':target=nativeValues.adoptView(new node.constructor(resolve(node.buffer),node.offset,node.length));break;
     case 'regexp':target=new RegExp(node.pattern,node.flags);break;
     default:target=node.prototype.value===Object.prototype?{}:Object.create(null);
    }
    if(node.managed)nativeValues.registerObject(target);
    targets[index]=target;return target;
   }
   for(let i=0;i<nodes.length;i++)allocate(i);
   for(let i=0;i<nodes.length;i++){
    const node=nodes[i],target=targets[i];
    if(node.kind==='queue'){for(const item of node.entries)target.push(resolve(item));continue;}
    if(node.kind==='namespace'){nativeValues.namespaces.install(target,resolve(node.readers));continue;}
    if(node.kind==='cell'){target.value=resolve(node.value);continue;}
    if(node.kind==='scope'){target.length=node.length;for(const [key,value]of node.slots)target[key]=resolve(value);environment(target);continue;}
    if(node.kind==='closure'){const binding=State.closures.get(target);binding[State.CLOSURE_PARENT]=resolve(node.captures[0]);binding[State.CLOSURE_VARS]=resolve(node.captures[1]);}
    else if(node.kind==='bound'){const binding=State.binds.get(target);binding.fun=resolve(node.captures[0]);binding.self=resolve(node.captures[1]);binding.args=resolve(node.captures[2]);}
    else if(node.kind==='intrinsic')intrinsicState.install(target,resolve(node.state));
    else if(node.kind==='map'||node.kind==='set')nativeValues.installCollection(target,node.kind==='map',node.entries.map(([order,key,value])=>[order,resolve(key),resolve(value)]),node.sequence);
    else if(node.kind==='weak')for(const [key,value]of node.entries)weakCollections.put(target,resolve(key),resolve(value));
    const storage=nativeValues.objectStorage(target),prototype=resolve(node.prototype);
    if(storage){if(!storage.setPrototypeOf(target,prototype))throw new TypeError('Cannot copy prototype');}
    else if(Object.getPrototypeOf(target)!==prototype)Object.setPrototypeOf(target,prototype);
    // Ordinary objects are allocated without own properties. Other kinds can
    // have allocation-time keys (function name/length, Error stack, etc.).
    if(node.kind!=='object')S.prepareOwnKeys(target,node.keys,storage);
    for(const [key,d]of node.properties){
     if(storage){
      const descriptor='value'in d?{value:resolve(d.value),writable:d.writable,enumerable:d.enumerable,configurable:d.configurable}
       :{get:resolve(d.get),set:resolve(d.set),enumerable:d.enumerable,configurable:d.configurable};
      if(!storage.defineProperty(target,key,descriptor))throw new TypeError('Cannot copy property');
      continue;
     }
     if('value'in d){const value=resolve(d.value);
      if(d.writable&&d.enumerable&&d.configurable&&prototype===Object.prototype&&!Object.hasOwn(Object.prototype,key))target[key]=value;
      else Object.defineProperty(target,key,{value,writable:d.writable,enumerable:d.enumerable,configurable:d.configurable});
     }else Object.defineProperty(target,key,{get:resolve(d.get),set:resolve(d.set),enumerable:d.enumerable,configurable:d.configurable});
    }
    if(node.registration&&node.kind!=='closure'&&node.kind!=='bound')S.setObjectDescriptor(target,node.registration);
    if(!node.extensible){if(storage)storage.preventExtensions(target);else Object.preventExtensions(target);}
   }
   for(let i=0;i<nodes.length;i++)if(nodes[i].kind==='error')nativeValues.installError(targets[i],resolve(nodes[i].error));
   return resolve(rootRef);
  };
 }
 return function prepare(root,namespaceKeys,namespaceDescriptor){
  const nodes=[],seen=new Map(),weak=new S.WeakEntryQueue(),registrations=S.getState().byObject;
  const scalar=value=>({value});
  function reference(value){
   weak.mark(value);
   if(value===null||typeof value!=='object'&&typeof value!=='function')return scalar(value);
   if(seen.has(value))return seen.get(value);
   const registration=registrations.get(value);
   if(registration?.value===value||S.getState().byPrototype.has(value))return scalar(value);
   const index=nodes.length,ref={index},node={source:value,registration,kind:'object',properties:[]};
   const boxed=typeof value==='object'?nativeValues.boxed(value):undefined;
   const error=typeof value==='object'?nativeValues.errorState(value):undefined;
   nodes.push(node);seen.set(value,ref);
   if(typeof value==='function'){
    const closure=State.closures.get(value),bound=State.binds.get(value);
    if(closure){node.kind='closure';node.meta=closure[State.CLOSURE_META];node.binding=closure;}
    else if(bound){node.kind='bound';node.binding=bound;node.constructable=bound.constructable;}
    else throw new TypeError('Unregistered function in copy plan');
   }else if(nativeValues.namespaces.record(value)){node.kind='namespace';const record=nativeValues.namespaces.record(value);node.names=[...record.names];node.readers=reference(record.readers);}
   else if(CowQueue&&value instanceof CowQueue)node.kind='queue';
   else if(value instanceof Cell)node.kind='cell';
   else if(registration===scopeDescriptor)node.kind='scope';
   else if(error){node.kind='error';node.error=reference(error);}
   else if(intrinsicState.has(value)){node.kind='intrinsic';const record=intrinsicState.record(value);node.intrinsic=record.kind;node.state=reference(record.state);}
   else if(boxed){node.kind='boxed';node.primitive=boxed.value;weak.mark(boxed.value);}
   else if(weakCollections.has(value)){node.kind='weak';node.weakConstructor=weakCollections.constructorFor(value);}
   else if(Array.isArray(value))node.kind='array';
   else if(nativeValues.types.isArgumentsObject(value))node.kind='arguments';
   else if(nativeValues.types.isMap(value))node.kind='map';
   else if(nativeValues.types.isSet(value))node.kind='set';
   else if(nativeValues.types.isWeakMap(value)||nativeValues.types.isWeakSet(value))throw new TypeError('Weak collection has no copy index');
   else if(nativeValues.types.isArrayBuffer(value)){node.kind='buffer';node.bytes=nativeValues.bufferSnapshot(value);}
   else if(ArrayBuffer.isView(value)){
    node.kind='view';const data=nativeValues.types.isDataView(value),get=data?viewGet:typedGet;
    node.buffer=reference(get.buffer.call(value));node.offset=get.byteOffset.call(value);node.length=get[data?'byteLength':'length'].call(value);
    node.constructor=data?DataView:typedConstructors[typedName.call(value)];
   }else if(nativeValues.types.isRegExp(value)){node.kind='regexp';node.pattern=regexpSource.call(value);node.flags=flags.filter(([get])=>get&&get.call(value)).map(([,flag])=>flag).join('');}
   if(node.kind==='closure'&&!nativeValues.objectStorage(value)){
    const proto=Object.getOwnPropertyDescriptor(value,'prototype')?.value;
    if(proto&&!nativeValues.objectStorage(proto)&&!seen.has(proto)&&Object.getPrototypeOf(proto)===Object.prototype&&Object.isExtensible(proto)){
     const keys=Reflect.ownKeys(proto),d=Object.getOwnPropertyDescriptor(proto,'constructor');
     if(keys.length===1&&keys[0]==='constructor'&&d.value===value&&d.writable&&d.configurable&&!d.enumerable)seen.set(proto,{prototype:index});
    }
   }
   return ref;
  }
  const rootRef=reference(root);
  let scanned=0;
  for(;;){
  for(;scanned<nodes.length;scanned++){
   const i=scanned;
   const node=nodes[i],value=node.source;
   if(node.kind==='queue'){node.entries=Array.from(value,reference);continue;}
   if(node.kind==='namespace')continue;
   if(node.kind==='cell'){node.value=reference(value.value);continue;}
   if(node.kind==='scope'){node.length=value.length;node.slots=Object.keys(value).map(key=>[key,reference(value[key])]);continue;}
   if(node.kind==='closure')node.captures=[reference(node.binding[State.CLOSURE_PARENT]),reference(node.binding[State.CLOSURE_VARS])];
   if(node.kind==='bound')node.captures=[reference(node.binding.fun),reference(node.binding.self),reference(node.binding.args)];
   if(node.kind==='map'||node.kind==='set'){const snapshot=nativeValues.collectionSnapshot(value,node.kind==='map');node.sequence=snapshot.sequence;node.entries=snapshot.entries.map(([order,key,item])=>[order,reference(key),reference(item)]);}
   if(node.kind==='weak'){node.entries=[];for(const [key,item]of weakCollections.items(value))weak.add(key,()=>node.entries.push([reference(key),reference(item)]),weakCollections.shared(key));}
   const storage=nativeValues.objectStorage(value);
   node.managed=!!storage&&['object','array','map','set','regexp','boxed','closure','bound'].includes(node.kind);
   node.prototype=reference(storage?storage.getPrototypeOf(value):Object.getPrototypeOf(value));node.extensible=storage?storage.isExtensible(value):Object.isExtensible(value);
   const viewDescriptors=node.kind==='view'?nativeValues.viewOwnDescriptors(value):storage?nativeValues.ownDescriptors(value):null;
   for(const key of Reflect.ownKeys(viewDescriptors||value)){
    if(key===S.descriptorSymbol)continue;
    weak.mark(key);
    if(namespaceDescriptor&&node.registration===namespaceDescriptor&&namespaceKeys&&!namespaceKeys.includes(key))continue;
    const d=viewDescriptors?viewDescriptors[key]:Object.getOwnPropertyDescriptor(value,key);
    node.properties.push([key,'value'in d
     ? {value:reference(d.value),writable:d.writable,enumerable:d.enumerable,configurable:d.configurable}
     : {get:reference(d.get),set:reference(d.set),enumerable:d.enumerable,configurable:d.configurable}]);
   }
   delete node.binding;
  }
  if(!weak.drain()&&scanned===nodes.length)break;
  }
  // The layout stores frozen values for this boundary; it is invalidated before
  // any program execution. Source objects are unnecessary after discovery.
  for(const node of nodes){node.keys=node.properties.map(([key])=>key);delete node.source;}
  return makeCopy(nodes,rootRef);
 };
};
