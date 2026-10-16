import {parentPort,workerData} from 'node:worker_threads';
import {createContext,SourceTextModule,SyntheticModule,type Module} from 'node:vm';
import type {LinkModule,LinkRequest} from './module-link.ts';

if(!parentPort)throw Error('Native module linking requires its compiler worker');
const port=parentPort,context=createContext(),modules=new Map<string,Module>();
let next=0;
const requests=new Map<number,{resolve:(module:LinkModule)=>void;reject:(error:Error)=>void}>();
port.on('message',message=>{
  const request=requests.get(message.id);if(!request)return;
  requests.delete(message.id);
  if(message.error)request.reject(Error(message.error));else request.resolve(message.module);
});
function resolve(request:LinkRequest):Promise<LinkModule>{
  return new Promise((resolve,reject)=>{const id=next++;requests.set(id,{resolve,reject});port.postMessage({kind:'request',id,request});});
}
function instantiate(record:LinkModule):Module{
  const existing=modules.get(record.id);if(existing)return existing;
  const module='source' in record
    ?new SourceTextModule(record.source,{context,identifier:record.id})
    :new SyntheticModule(record.exports,()=>{throw Error('Link validation must never evaluate a module');},{context,identifier:record.id});
  modules.set(record.id,module);return module;
}
try{
  const entry=instantiate(workerData);
  await entry.link(async(specifier,referencing,extra)=>{
    const attributes:Record<string,string>=Object.create(null);
    for(const [key,value]of Object.entries(extra.attributes??{})){
      if(typeof value!=='string')throw Error('Native module linker returned a non-string import attribute');
      attributes[key]=value;
    }
    const record=await resolve({specifier,importer:referencing.identifier,attributes});
    if('json' in record&&record.json&&attributes.type!=='json')throw new TypeError('JSON imports require type: json');
    return instantiate(record);
  });
  port.postMessage({kind:'linked'});
}catch(error){
  // Source is never evaluated, so errors are V8/parser or compiler errors,
  // not author objects with custom getters or conversion callbacks.
  port.postMessage({kind:'failed',name:(error as Error).name,message:(error as Error).message});
}
