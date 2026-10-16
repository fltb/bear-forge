import {Worker} from 'node:worker_threads';

export type LinkModule={id:string;source:string}|{id:string;exports:string[];json?:boolean};
export type LinkRequest={specifier:string;importer:string;attributes:Record<string,string>};
const nativeLinkFailure=Symbol('native module link failure');
export function isNativeModuleLinkError(error:unknown):error is Error{
  return error instanceof Error&&(error as any)[nativeLinkFailure]===true;
}

/** Target V8 is the module-linking oracle. The worker only constructs records
 * and links them: no source evaluation, filesystem loading or author callbacks.
 * Resolution uses the compiler's already admitted, closed dependency graph. */
export async function validateModuleLink(entry:LinkModule,resolve:(request:LinkRequest)=>Promise<LinkModule>):Promise<void>{
  const worker=new Worker(new URL('./module-link-worker.ts',import.meta.url),{
    workerData:entry,execArgv:['--experimental-strip-types','--experimental-vm-modules'],stderr:true,
  });
  let diagnostic='';
  worker.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-4096);});
  try{
    await new Promise<void>((accept,reject)=>{
      let settled=false;
      const fail=(error:unknown)=>{if(!settled){settled=true;reject(error);}};
      worker.on('message',message=>{
        if(settled)return;
        if(message.kind==='request'){
          void Promise.resolve().then(()=>resolve(message.request)).then(module=>{
            if(!settled)worker.postMessage({id:message.id,module});
          }).catch(fail);
        }else if(message.kind==='linked'){settled=true;accept();}
        else if(message.kind==='failed'){
          const constructor=message.name==='SyntaxError'?SyntaxError:message.name==='TypeError'?TypeError:Error;
          const failure=new constructor(message.message);
          Object.defineProperty(failure,nativeLinkFailure,{value:true});
          fail(failure);
        }else fail(Error('Unknown native module-link response'));
      });
      worker.once('error',fail);
      worker.once('exit',code=>fail(Error(`Native module-link worker exited without a result (${code}): ${diagnostic}`)));
    });
  }finally{await worker.terminate();}
}
