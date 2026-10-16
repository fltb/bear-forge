/* Iterator records belong to Context. next is captured at acquisition;
 * return and throw are looked up at their respective completions. */
module.exports=function iteration(S,State,Persist,Future,forIn){
 const read=(object,key)=>State.context.operations.get(State.context.operations.ref(object,key));
 const invoke=(fn,self,args)=>State.context.operations.invoke(fn,self,args);
 const bind=(fn,self)=>Persist.defaultBind.call(fn,self);
 function object(value){if(value===null||typeof value!=='object'&&typeof value!=='function')throw new TypeError('Iterator result is not an object');return value;}
 function method(value,key){const fn=read(value,key);if(fn==null)return undefined;if(typeof fn!=='function')throw new TypeError('Iterator method is not callable');return fn;}
 function record(value,async,fromSync){object(value);return {iterator:value,next:read(value,'next'),async,fromSync};}
 function iterator(value){return record(invoke(method(value,Symbol.iterator),value,[]),false,false);}
 function iteratorM(value){const fn=method(value,Symbol.asyncIterator);return fn===undefined
  ?record(invoke(method(value,Symbol.iterator),value,[]),true,true):record(invoke(fn,value,[]),true,false);}
 function forInIterator(value){return record(forIn(value),false,false);}
 function resultValue(value){return State.context.allocate({value,done:this.done});}
 function closeRejected(reason){
  if(!this.done&&this.close){try{const fn=method(this.record.iterator,'return');if(fn)invoke(fn,this.record.iterator,[]);}catch{}}
  throw reason;
 }
 function fromSync(record,result,close){
  object(result);const done=!!read(result,'done'),value=read(result,'value');
  const state={record,done,close};let promise;
  try{promise=Future.resolve(value);}catch(error){return closeRejected.call(state,error);}
  return Future.prototype.then.call(promise,bind(resultValue,state),bind(closeRejected,state));
 }
 function iterNext(record,...args){
  try{const result=invoke(record.next,record.iterator,args);return record.fromSync?fromSync(record,result,true):result;}
  catch(error){if(record.async)return Future.reject(error);throw error;}
 }
 function missingThrow(){throw new TypeError("The iterator does not provide a 'throw' method.");}
 function rejectAfterClose(result){object(result);return missingThrow();}
 function iterErr(record,reason){
  try{
   const fn=method(record.iterator,'throw');
   if(fn){const result=invoke(fn,record.iterator,[reason]);return record.fromSync?fromSync(record,result,true):result;}
   const close=method(record.iterator,'return');
   if(close){const result=invoke(close,record.iterator,[]);
    if(record.async&&!record.fromSync)return Future.prototype.then.call(Future.resolve(result),rejectAfterClose);
    object(result);
   }
   return missingThrow();
  }catch(error){if(record.async)return Future.reject(error);throw error;}
 }
 function iterFin(record,...args){
  try{
   const fn=method(record.iterator,'return');
   if(!fn)return State.context.allocate({value:args[0],done:true});
   const result=invoke(fn,record.iterator,args);return record.fromSync?fromSync(record,result,false):result;
  }catch(error){if(record.async)return Future.reject(error);throw error;}
 }
 function iterResult(value){return object(value);}
 function iterDone(value){return read(value,'done');}
 function iterValue(value){return read(value,'value');}
 const functions={iterator,iteratorM,forInIterator,iterNext,iterErr,iterFin,iterResult,iterDone,iterValue,resultValue,closeRejected,rejectAfterClose};
 for(const [key,fn]of Object.entries(functions))S.regOpaqueObject(fn,'runtime.iteration.'+key,{props:false});
 return {iterator,iteratorM,forInIterator,iterNext,iterErr,iterFin,iterResult,iterDone,iterValue,intrinsics:Object.values(functions)};
};
