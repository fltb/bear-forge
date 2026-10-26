import {open,type FileHandle} from 'node:fs/promises';
import type {EventBatch,SimulatorView,SimulatorCommand} from './simulator.types.ts';
import {describeAction} from './presentation.ts';

/** Host-only observer. Never receives a Context, instance, query or RNG. */
export type SimulatorTrace={write:(record:Record<string,unknown>)=>void|Promise<void>;close?:()=>void|Promise<void>};
export function observeTrace(sink:SimulatorTrace|undefined){
  let error:string|null=null,records=0,milliseconds=0,closed=false;
  async function attempt(work:()=>void|Promise<void>){
    if(error!==null)return;
    const start=performance.now();
    try{await work();}catch(cause){error=String(cause);}finally{milliseconds+=performance.now()-start;}
  }
  return {
    async write(make:()=>Record<string,unknown>){if(!sink)return;await attempt(async()=>{await sink.write(structuredClone({...make(),traceSequence:records+1,recordedAt:new Date().toISOString()}));records++;});},
    async close(){if(!sink||closed)return;closed=true; // Close even after a failed write; never affect gameplay.
      try{await sink.close?.();}catch(cause){error??=String(cause);}
    },
    status:()=>({enabled:!!sink,failed:error!==null,error,records,milliseconds}),
  };
}

/** New file only: cannot truncate a save or append to an unrelated/incomplete log. */
export async function openJsonlTrace(path:string):Promise<SimulatorTrace>{
  const file=await open(path,'wx',0o600);
  return jsonlFile(file);
}
function jsonlFile(file:FileHandle):SimulatorTrace{
  return {async write(record){await file.writeFile(JSON.stringify(record)+'\n');},async close(){try{await file.sync();}finally{await file.close();}}};
}

export const traceCoverage={
  source:'existing public decision boundaries and ordered display events; no extra game queries',
  hiddenDrawOrder:'unavailable unless already public (Frozen Eye)',
  rng:'not exposed; committed Context SHA-256 covers saved RNG without decoding or querying it',
  cause:'actionId is exact; damage source/target is from original events; nested power/card cause is unavailable when original event omits it',
  domainBenefit:'domain/effects before and after plus actual events; hypothetical prevented effects/damage are unavailable, never inferred as fact',
  initialSeedOnResume:'unavailable in legacy public save; use the original trace header, do not substitute CLI default seed',
  durability:'best effort independent of save; incomplete trailing line and missing sequences mean a trace gap, never replay gameplay to repair it',
};
export function traceState(state:SimulatorView){
  // History is already represented by per-command records; omit the growing prefix.
  const {history:_history,...observation}=state.observation;
  const request=state.request?{...state.request,observation}:null;
  return {...state,observation,request};
}
export function traceCommand(command:SimulatorCommand,before:SimulatorView){
  const bits=(command.action as {bits:number}).bits;
  return {...command,meaning:describeAction(before.observation,bits),before:traceState(before)};
}
export function traceBoundary(batch:EventBatch){
  return {fromRevision:batch.fromRevision,revision:batch.revision,actionId:batch.actionId,cursor:batch.cursor,identities:batch.identities,state:traceState(batch.state)};
}
/** Text rendering consumes log data only, and never touches the game. */
export function traceText(record:Record<string,unknown>):string{return JSON.stringify(record,null,2);}
