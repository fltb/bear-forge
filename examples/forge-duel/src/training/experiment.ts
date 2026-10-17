import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ProcessClient, transformerPolicy } from '@bear-forge/training';
import { implementationIdentity } from '@bear-forge/experiments';
import { createForgeRunner } from '../experiment/execution.ts';
import { RegistrationSchema } from '../experiment/registration.schemas.ts';
import { policy } from '../experiment/policy.ts';
import { encodeForge } from './features.ts';

export async function runWithModels(basic:ReturnType<typeof createForgeRunner>['runExperiment'],args:Parameters<typeof basic>, registered:unknown) {
  const [directory,input,onProgress,hooks]=args;
  const config=RegistrationSchema.parse(registered);
  if(!config?.models||!Object.keys(config.models).length)return basic(...args);
  const clients:ProcessClient[]=[];
  try{
    const bindings=new Map<string,{client:ProcessClient;version:string}>(), identities:Record<string,unknown>={};
    for(const [name,path] of Object.entries(config.models)){
      const client=new ProcessClient();clients.push(client);
      const status=await client.request({command:'load',path});
      if(status.metadata.game!=='forge-duel'||status.metadata.encoder!=='card-features-v1')throw Error('Model is not a Forge checkpoint');
      bindings.set(name,{client,version:status.version});
      identities[name]={version:status.version,fileDigest:createHash('sha256').update(await readFile(path)).digest('hex'),implementationDigest:status.implementationDigest};
    }
    const select=(name:string)=>{
      const model=bindings.get(name);
      return model?transformerPolicy(model.client,model.version,encodeForge,false):policy(name as 'first');
    };
    const runner=createForgeRunner({
      policies:task=>({'0':select(task.seat==='0'?task.policy:task.opponent),'1':select(task.seat==='1'?task.policy:task.opponent)}),
      identity:()=>implementationIdentity(['examples/forge-duel/src','packages/training/src'],{rule:'forge-duel-v1',models:identities,encoder:'card-features-v1'})
    });
    return await runner.runExperiment(directory,input,onProgress,hooks);
  }finally{await Promise.all(clients.map(c=>c.close()));}
}
