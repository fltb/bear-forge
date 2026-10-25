import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Transfer ownership to a cold process, advance its current IO once using a
 * fresh reply to that IO, and return its new snapshot. The caller must close
 * the old owner first. No past/future input sequence is accepted. */
export async function advanceRestoredProcess(directory:string,definition:URL,snapshot:unknown,
  reply:(call:any)=>unknown|Promise<unknown>):Promise<{snapshot:any;stop:any}>{
  const payload=join(directory,'current.json');await writeFile(payload,JSON.stringify(snapshot));
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',`
      import {readFile} from 'node:fs/promises';
      import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
      import {cardDefinition} from ${JSON.stringify(definition.href)};
      const u=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value};
      const snapshot=JSON.parse(await readFile(process.argv[2],'utf8'));
      const def={...cardDefinition,initialize(){throw Error('restore called initialization')}};
      const loaded=u(await createCardLoader({recordCore:true,snapshots:fileSnapshotStore(process.argv[1])}).load(def));
      const instance=u(await loaded.persistence.restore(snapshot));
      try{
        const stop=u(await instance.inspect());if(stop.kind!=='call')throw Error('Expected current IO');
        const pending=new Promise(resolve=>process.once('message',resolve));
        process.send({kind:'current',call:stop.call});
        const message=await pending;if(message.kind!=='reply')throw Error('Expected fresh reply');
        u(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:message.value})}));
        if(!u(await instance.run()).accepted)throw Error('Reply was not accepted');
        const next=u(await loaded.persistence.save(instance)),current=u(await instance.inspect());
        process.send({kind:'saved',snapshot:next,stop:current});
      }finally{u(await instance.close());u(await loaded.capture.release(instance.id));process.disconnect();}
    `,directory,payload],{stdio:['ignore','ignore','pipe','ipc'],serialization:'advanced'});
    let stderr='',result:{snapshot:any;stop:any}|undefined,failure:unknown,answered=false;
    child.stderr!.setEncoding('utf8');child.stderr!.on('data',chunk=>{stderr+=chunk;});
    child.on('error',reject);
    child.on('message',(message:any)=>{
      if(message.kind==='saved'){result={snapshot:message.snapshot,stop:message.stop};return;}
      if(message.kind!=='current'||answered){failure=Error('Unexpected cold-process message');child.kill();return;}
      answered=true;
      void Promise.resolve().then(()=>reply(message.call)).then(value=>{
        child.send({kind:'reply',value},error=>{if(error){failure=error;child.kill();}});
      }).catch(error=>{failure=error;child.kill();});
    });
    child.on('close',(code,signal)=>{
      if(failure)reject(failure);
      else if(code!==0||!result)reject(Error(`Cold continuation failed (${code??signal}): ${stderr}`));
      else resolve(result);
    });
  });
}
