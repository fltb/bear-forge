import type {EventEmitter} from 'node:events';

/** All catchable terminal shutdowns enter the same asynchronous save queue. */
export function bindTuiShutdown(input:EventEmitter,output:EventEmitter,request:(disconnected:boolean)=>void){
  const signal=()=>request(false),disconnect=()=>request(true);
  for(const name of ['SIGINT','SIGTERM'] as const)process.on(name,signal);
  process.on('SIGHUP',disconnect);
  input.on('end',disconnect);input.on('close',disconnect);input.on('error',disconnect);output.on('error',disconnect);
  return ()=>{
    for(const name of ['SIGINT','SIGTERM'] as const)process.off(name,signal);
    process.off('SIGHUP',disconnect);
    input.off('end',disconnect);input.off('close',disconnect);input.off('error',disconnect);output.off('error',disconnect);
  };
}
