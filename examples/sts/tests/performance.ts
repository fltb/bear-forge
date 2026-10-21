import {fork,spawn,execFile} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {PerformanceObserver} from 'node:perf_hooks';
import {Session,type Profiler} from 'node:inspector';
import type {Outcome} from '@bear-forge/contracts/instance';
import type {Trace} from './reference/play.ts';
import {buildRawBenchmark,revision,root} from './reference/build.ts';
const unwrap=<T,E>(result:Outcome<T,E>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]!;};
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]!;
const average=(values:number[])=>values.reduce((sum,n)=>sum+n,0)/values.length;
const fixtures=new URL('./reference/fixtures/',import.meta.url);
type Batch={kind:'batch';batch:number;samples:number[];checksum:number;gcMs:number;gcCount:number;rssBytes:number;peakRssBytes:number};
type Sample={kind:'sample';batch:number;ms:number;checksum:number;initializeMs:number;closeMs:number};
type Message=Batch|Sample|{kind:'ready';loadMs:number}|{kind:'warm';count:number;first:{ms:number;checksum:number;initializeMs:number;closeMs:number}}|{kind:'profile'|'counts';data:unknown}|{kind:'error';message:string};
function summarizeProfile(profile:Profiler.Profile){
  const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map<number,number>();
  for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id);
  const functions=new Map<string,{function:string;path:string;line:number;selfMs:number;inclusiveMs:number}>(),files=new Map<string,{selfMs:number;inclusiveMs:number}>();
  let totalMs=0;
  const label=(node:Profiler.ProfileNode)=>{const f=node.callFrame;return f.url||f.functionName||'(native)';};
  for(let index=0;index<(profile.samples?.length??0);index++){
    const ms=(profile.timeDeltas?.[index]??0)/1000;totalMs+=ms;
    let id:number|undefined=profile.samples![index];const seenFunctions=new Set<string>(),seenFiles=new Set<string>();let first=true;
    while(id!==undefined){
      const node=nodes.get(id)!;const path=label(node),key=path+':'+node.callFrame.lineNumber+':'+node.callFrame.functionName;
      let fn=functions.get(key);if(!fn){fn={function:node.callFrame.functionName||'(anonymous)',path,line:node.callFrame.lineNumber+1,selfMs:0,inclusiveMs:0};functions.set(key,fn);}
      let file=files.get(path);if(!file){file={selfMs:0,inclusiveMs:0};files.set(path,file);}
      if(first){fn.selfMs+=ms;file.selfMs+=ms;first=false;}
      if(!seenFunctions.has(key)){fn.inclusiveMs+=ms;seenFunctions.add(key);}
      if(!seenFiles.has(path)){file.inclusiveMs+=ms;seenFiles.add(path);}
      id=parents.get(id);
    }
  }
  return{totalMs,functions:[...functions.values()].sort((a,b)=>b.selfMs-a.selfMs).slice(0,30),files:[...files].map(([path,cost])=>({path,...cost})).sort((a,b)=>b.selfMs-a.selfMs).slice(0,30)};
}

// Parent drives one command at a time, alternating the two normal modes. The
// deadline is enforced outside the worker so a synchronous step cannot evade it.
if(process.argv[2]==='worker'){
  const controlled=process.argv[3]==='controlled',trace=JSON.parse(await readFile(process.argv[4]!,'utf8')) as Trace;
  const work=process.argv[5]==='counts'?(await import('./performance-counts.ts')).installWorkCounters():null;
  const loadAt=performance.now();
  const [{createCardLoader},{createGameBinder},{cardDefinition},{contract}]=await Promise.all([
    import('@bear-forge/runtime-card'),import('@bear-forge/game-host'),import('../src/card.ts'),import('../src/contract.ts'),
  ]);
  const loaded=unwrap(await createCardLoader({controlled}).load(cardDefinition));
  let gcMs=0,gcCount=0;
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){gcMs+=entry.duration;gcCount++;}});observer.observe({entryTypes:['gc']});
  async function run():Promise<{ms:number;checksum:number;initializeMs:number;closeMs:number}>{
    const at=performance.now();let decisions=0,events=0,checksum=0;
    const instance=unwrap(await loaded.core.start({seed:trace.seed}));
    const game=unwrap(await createGameBinder().bind({instance,contract,...(loaded.persistence?{persistence:loaded.persistence}:{})}));
    const initializeMs=performance.now()-at;let closeMs=0;
    work?.phase('play');
    try{
      unwrap(await game.bind({player:'0',onRequest:async request=>{
        const move=trace.actions[decisions++];if(!move)throw Error('Extra decision');
        if(request.options.kind!=='exact'||!request.options.values.some(value=>value.bits===move.bits))throw Error('Trajectory action is not offered');
        checksum=(checksum+move.bits)>>>0;
        return{kind:'reply',value:{bits:move.bits}};
      },onEvent:async delivery=>{const expected=trace.actions[events++];if(!expected||delivery.event.kind!==expected.kind||delivery.event.bits!==expected.bits)throw Error('Event sequence mismatch');return{kind:'reply',value:null};}}));
      for(;;){const result=unwrap(await game.run());if(result.state.kind==='ended'){
        if(!result.state.result.heartDefeated||result.state.result.outcome!=='victory'||decisions!==trace.actions.length||events!==trace.actions.length)throw Error('Incomplete Heart game');
        if(trace.final&&result.state.result.hp!==trace.final.game.hp)throw Error('Final HP mismatch');
        checksum=(checksum+result.state.result.hp)>>>0;break;
      }if(result.state.kind==='fault')throw Error(JSON.stringify(result.state.error));if(result.pause!==null)throw Error(JSON.stringify(result.pause));}
    }finally{work?.phase('close');const closing=performance.now();unwrap(await game.close());if(loaded.capture)unwrap(await loaded.capture.release(instance.id));closeMs=performance.now()-closing;}
    return{ms:performance.now()-at,checksum,initializeMs,closeMs};
  }
  process.send?.({kind:'ready',loadMs:performance.now()-loadAt} satisfies Message);
  process.on('message',async command=>{
    try{
      const instruction=command as {kind:'warm'|'batch'|'profile'|'counts';batch?:number};
      if(instruction.kind==='counts'){
        if(!work)throw Error('Counters were not installed before loading');
        work.begin();const result=await run();const sites=work.finish();
        process.send?.({kind:'counts',data:{seed:trace.seed,mode:controlled?'controlled':'native',actions:trace.actions.length,checksum:result.checksum,sites}} satisfies Message);return;
      }
      if(instruction.kind==='profile'){
        const warm=await run(),session=new Session();session.connect();
        const post=(method:string)=>new Promise<any>((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)));
        try{
          await post('Profiler.enable');await post('Profiler.start');const measured=await run();const {profile}=await post('Profiler.stop');
          await new Promise<void>(resolve=>setImmediate(resolve));
          process.send?.({kind:'profile',data:{seed:trace.seed,mode:controlled?'controlled':'native',warm,measured,...summarizeProfile(profile),rssBytes:process.memoryUsage().rss,peakRssBytes:process.resourceUsage().maxRSS*1024,gcMs,gcCount}} satisfies Message);
        }finally{session.disconnect();}
        return;
      }
      if(instruction.kind==='warm'){const first=await run();for(let n=1;n<5;n++)await run();process.send?.({kind:'warm',count:5,first} satisfies Message);return;}
      const samples:number[]=[];let checksum=0;const initialGc=gcMs,initialCount=gcCount;
      for(let n=0;n<16;n++){const result=await run();samples.push(result.ms);process.send?.({kind:'sample',batch:instruction.batch!,...result} satisfies Sample);checksum=(checksum+result.checksum)>>>0;}
      await new Promise<void>(resolve=>setImmediate(resolve));
      process.send?.({kind:'batch',batch:instruction.batch!,samples,checksum,gcMs:gcMs-initialGc,gcCount:gcCount-initialCount,rssBytes:process.memoryUsage().rss,peakRssBytes:process.resourceUsage().maxRSS*1024} satisfies Message);
    }catch(error){process.send?.({kind:'error',message:String(error)} satisfies Message);}
  });
}else if(process.argv[2]==='counts'){
  const self=fileURLToPath(import.meta.url),file=fileURLToPath(new URL('ironclad-a20-heart-130.json',fixtures));
  for(const mode of ['native','controlled']){
    const child=fork(self,['worker',mode,file,'counts'],{execArgv:['--experimental-strip-types'],stdio:['ignore','inherit','inherit','ipc']});
    try{await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Work count exceeded 60 seconds'));},60000);
      child.on('message',message=>{const value=message as Message;if(value.kind==='ready')child.send({kind:'counts'});else if(value.kind==='counts'){clearTimeout(timer);console.log(JSON.stringify(value));resolve();}else if(value.kind==='error'){clearTimeout(timer);reject(Error(value.message));}});
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Work counter exited '+code));});
    });}finally{child.kill();}
  }
  console.log(JSON.stringify({kind:'cpp-counts',data:await(await import('./performance-counts.ts')).countReferenceWork(file)}));
}else if(process.argv[2]==='diagnose'){
  // Final-failure diagnosis only: the exact same run(), defaults and callbacks.
  // Sampling is not an acceptance score, and no profile/report file is retained.
  const self=fileURLToPath(import.meta.url),file=fileURLToPath(new URL('ironclad-a20-heart-130.json',fixtures));
  for(const mode of ['native','controlled']){
    const child=fork(self,['worker',mode,file],{execArgv:['--experimental-strip-types'],stdio:['ignore','inherit','inherit','ipc']});
    try{await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Diagnostic exceeded 60 seconds'));},60000);
      child.on('message',message=>{const value=message as Message;if(value.kind==='ready')child.send({kind:'profile'});else if(value.kind==='profile'){clearTimeout(timer);console.log(JSON.stringify(value));resolve();}else if(value.kind==='error'){clearTimeout(timer);reject(Error(value.message));}});
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Diagnostic exited '+code));});
    });}finally{child.kill();}
  }
}else{
  const binary=await buildRawBenchmark(),self=fileURLToPath(import.meta.url),exec=promisify(execFile);
  console.log(JSON.stringify({kind:'environment',node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,reference:revision,ruleRevision:(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),dirty:(await exec('git',['status','--porcelain'],{cwd:root})).stdout.length>0,compiler:(await exec(process.env.CXX??'clang++',['--version'])).stdout.split('\n')[0],flags:['-std=c++17','-O2','-ffp-contract=off','no LTO'],cppIncludes:'fresh run, action validation, transitions, terminal checks, destruction; excludes JSON/IPC/publication',tsIncludes:'fresh Context, complete GameHost, legality, observations, events, default trace/records, close/release'}));
  const paths=(await readdir(fixtures)).filter(name=>/^ironclad-a20-heart-(130|2410|936)\.json$/.test(name)).sort();if(paths.length!==3)throw Error('Missing acceptance fixture');let failed=false;
  for(const name of paths){
    const file=fileURLToPath(new URL(name,fixtures)),trace=JSON.parse(await readFile(file,'utf8')) as Trace;
    const raw:number[]=[];
    try{await new Promise<void>((resolve,reject)=>{
      const child=spawn(binary,[file],{stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('C++ sampling exceeded 60 seconds'));},60000);let pending='',errors='';
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{pending+=chunk;for(;;){const newline=pending.indexOf('\n');if(newline<0)break;const line=pending.slice(0,newline);pending=pending.slice(newline+1);let sample:{msPerRun:number;hp:number;runs:number;actions:number};try{sample=JSON.parse(line);if(sample.runs!==10000||sample.actions!==trace.actions.length||trace.final&&sample.hp!==trace.final.game.hp)throw Error('C++ sample mismatch');}catch(error){child.kill('SIGKILL');clearTimeout(timer);reject(error);return;}raw.push(sample.msPerRun);console.log(JSON.stringify({kind:'cpp',seed:trace.seed,...sample}));}});
      child.stderr.on('data',chunk=>errors+=chunk);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(errors||'C++ exited '+code));});
    });}catch(error){failed=true;console.log(JSON.stringify({kind:'failure',seed:trace.seed,mode:'cpp',reason:String(error),samples:raw}));}
    const workers=[];
    for(const mode of ['native','controlled'] as const){
      const child=fork(self,['worker',mode,file],{execArgv:['--experimental-strip-types'],stdio:['ignore','inherit','inherit','ipc']});
      let pending:((value:Message)=>void)|undefined,ready:Message|undefined;const completed:Sample[]=[];
      child.on('message',message=>{const value=message as Message;if(value.kind==='sample'){completed.push(value);return;}if(pending){const receive=pending;pending=undefined;receive(value);}else ready=value;});
      child.on('exit',code=>{pending?.({kind:'error',message:'Worker exited '+code});pending=undefined;});
      const worker={mode,child,completed,elapsed:0,started:0,failed:false,batches:[] as Batch[],loadMs:0,async command(command?:object):Promise<Message>{
        if(worker.failed)throw Error('Worker already stopped');const at=performance.now(),remaining=worker.started?60000-(performance.now()-worker.started):60000;
        if(remaining<=0){child.kill('SIGKILL');throw Error('Sampling exceeded 60 seconds');}
        try{return await new Promise<Message>((resolve,reject)=>{
          const timer=setTimeout(()=>{pending=undefined;child.kill('SIGKILL');reject(Error('Sampling exceeded 60 seconds'));},remaining);
          const receive=(message:Message)=>{clearTimeout(timer);message.kind==='error'?reject(Error(message.message)):resolve(message);};
          if(ready){const message=ready;ready=undefined;receive(message);}else pending=receive;
          if(command)child.send(command);
        });}finally{worker.elapsed+=performance.now()-at;}
      }};workers.push(worker);
      try{const ready=await worker.command();if(ready.kind!=='ready')throw Error('Invalid worker start');worker.loadMs=ready.loadMs;console.log(JSON.stringify({kind:'load',seed:trace.seed,mode,ms:worker.loadMs}));worker.elapsed=0;worker.started=performance.now();const warm=await worker.command({kind:'warm'});console.log(JSON.stringify({seed:trace.seed,mode,...warm}));}
      catch(error){worker.failed=true;child.kill('SIGKILL');failed=true;console.log(JSON.stringify({kind:'failure',seed:trace.seed,mode,reason:String(error)}));}
    }
    for(let batch=0;batch<7;batch++)for(const worker of batch%2?[...workers].reverse():workers){
      if(worker.failed)continue;
      try{const result=await worker.command({kind:'batch',batch});if(result.kind!=='batch')throw Error('Invalid batch reply');worker.batches.push(result);console.log(JSON.stringify({seed:trace.seed,mode:worker.mode,...result,meanMs:average(result.samples)}));}
      catch(error){worker.failed=true;failed=true;worker.child.kill('SIGKILL');console.log(JSON.stringify({kind:'failure',seed:trace.seed,mode:worker.mode,reason:String(error),completedBatches:worker.batches.length,completedSamples:worker.completed}));}
    }
    for(const worker of workers){worker.child.kill();const samples=worker.batches.flatMap(b=>b.samples),ms=median(worker.batches.map(b=>average(b.samples))),ratio=ms/median(raw);const consistent=worker.completed.every(s=>s.checksum===worker.completed[0]?.checksum);const passed=!worker.failed&&consistent&&raw.length===7&&worker.batches.length===7&&worker.completed.length===112&&ratio<=50;failed ||= !passed;
      console.log(JSON.stringify({kind:'result',seed:trace.seed,mode:worker.mode,passed,aspirationMet:passed&&ratio<=20,medianMs:ms,p95Ms:percentile(samples,.95),cppMedianMs:median(raw),ratio,totalMs:worker.elapsed,wallMs:performance.now()-worker.started,completedRuns:worker.completed.length,initializeMedianMs:median(worker.completed.map(s=>s.initializeMs)),closeMedianMs:median(worker.completed.map(s=>s.closeMs)),checksum:worker.completed[0]?.checksum,warmupRuns:5,actionsPerRun:trace.actions.length,loadMs:worker.loadMs,rssBytes:worker.batches.at(-1)?.rssBytes,peakRssBytes:Math.max(0,...worker.batches.map(b=>b.peakRssBytes)),gcMs:worker.batches.reduce((n,b)=>n+b.gcMs,0),gcCount:worker.batches.reduce((n,b)=>n+b.gcCount,0)}));
    }
  }
  if(failed)process.exitCode=1;
}
