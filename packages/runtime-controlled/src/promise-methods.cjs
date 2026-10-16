/* Promise combinators keep their complete pending state in bound callback
 * receivers. No JS closure or host job queue owns instance state. */
module.exports=function promiseMethods(S,State,Persist,Future,resolving,futureConstructor,intrinsicState,tick){
 const bind=(fn,receiver)=>{
  const callback=Persist.defaultBind.call(fn,receiver);
  Persist.defineFunctionProperties(callback,{name:{value:'',configurable:true},length:{value:fn.length,configurable:true}});
  return callback;
 };
 const invoke=(fn,receiver,args)=>State.context.operations.invoke(fn,receiver,args);
 const read=(value,key)=>State.context.operations.get(State.context.operations.ref(value,key));
 const allocate=value=>State.context.allocate(value);
 class PromiseGroup{constructor(kind,resolve,reject){intrinsicState.initialize(this,'PromiseGroup',{kind,resolve,reject,last:null,length:0,remaining:1});}}
 class PromiseSlot{constructor(group,index){intrinsicState.initialize(this,'PromiseSlot',{group,index,done:false,value:undefined});}}
 intrinsicState.register(PromiseGroup,'PromiseGroup');intrinsicState.register(PromiseSlot,'PromiseSlot');
 function finish(identity){
  const group=intrinsicState.edit(identity);
  if(--group.remaining!==0)return;
  // Results become author-visible only on completion. Pending slots are
  // separately versioned; one settlement never copies all other results.
  const values=new Array(group.length);
  for(let link=group.last;link;link=link.previous){
   tick();
   const slot=intrinsicState.state(link.slot);values[slot.index]=slot.value;
  }
  group.last=null;
  if(group.kind==='any'){
   const error=new AggregateError(values,'All promises were rejected');allocate(error.errors);group.reject(error);
  }else group.resolve(allocate(values));
 }
 const {fulfilled,rejected}={fulfilled(value){
  const slot=intrinsicState.edit(this),group=intrinsicState.state(slot.group);
  if(group.kind==='race'||group.kind==='any'){group.resolve(value);return;}
  if(slot.done)return;slot.done=true;
  slot.value=group.kind==='allSettled'?allocate({status:'fulfilled',value}):value;
  finish(slot.group);
 },rejected(reason){
  const slot=intrinsicState.edit(this),group=intrinsicState.state(slot.group);
  if(group.kind==='race'||group.kind==='all'){group.reject(reason);return;}
  if(slot.done)return;slot.done=true;
  slot.value=group.kind==='allSettled'?allocate({status:'rejected',reason}):reason;
  finish(slot.group);
 }};
 function combine(constructor,iterable,kind){
  if(constructor!==Future)throw new TypeError('Unsupported Promise constructor');
  const promise=new Future(),[resolve,reject]=resolving(promise);
  const group=new PromiseGroup(kind,resolve,reject);
  let iterator;
  try{
   const resolveElement=read(constructor,'resolve');
   if(typeof resolveElement!=='function')throw new TypeError('Promise resolve is not callable');
   iterator=State.context.operations.consumerIteratorOpen(iterable);
   let index=0;
   while(true){
    const value=State.context.operations.iteratorStep(iterator);
    if(iterator.done)break;
    const slot=new PromiseSlot(group,index++),state=intrinsicState.edit(group);
    state.last={slot,previous:state.last};state.length++;state.remaining++;
    const item=invoke(resolveElement,constructor,[value]);
    invoke(read(item,'then'),item,[bind(fulfilled,slot),bind(rejected,slot)]);
   }
   if(kind!=='race')finish(group);
  }catch(error){if(iterator)State.context.operations.iteratorClose(iterator,true);reject(error);}
  return promise;
 }
 const {all,allSettled,any,race,withResolvers}={
  all(iterable){return combine(this,iterable,'all');},
  allSettled(iterable){return combine(this,iterable,'allSettled');},
  any(iterable){return combine(this,iterable,'any');},
  race(iterable){return combine(this,iterable,'race');},
  withResolvers(){if(this!==Future)throw new TypeError('Unsupported Promise constructor');const promise=new Future(),[resolve,reject]=resolving(promise);return allocate({promise,resolve,reject});}
 };
 const {preserve,rethrow,finallyFulfilled,finallyRejected}={
  preserve(){return this.value;},rethrow(){throw this.value;},
  finallyFulfilled(value){const completion=invoke(this.callback,undefined,[]);return Future.resolve(completion).then(bind(preserve,{value}));},
  finallyRejected(value){const completion=invoke(this.callback,undefined,[]);return Future.resolve(completion).then(bind(rethrow,{value}));}
 };
 const finallyMethod={finally(callback){
  futureConstructor(this);
  return invoke(read(this,'then'),this,typeof callback==='function'
   ?[bind(finallyFulfilled,{callback}),bind(finallyRejected,{callback})]:[callback,callback]);
 }}.finally;
 for(const [key,value]of Object.entries({all,allSettled,any,race,withResolvers}))Object.defineProperty(Future,key,{value,writable:true,configurable:true});
 Object.defineProperty(Future.prototype,'finally',{value:finallyMethod,writable:true,configurable:true});
 const functions={fulfilled,rejected,preserve,rethrow,finallyFulfilled,finallyRejected,all,allSettled,any,race,withResolvers,finallyMethod};
 for(const [name,fn]of Object.entries(functions))S.regOpaqueObject(fn,'Future.method.'+name,{props:false});
 return Object.values(functions);
};
