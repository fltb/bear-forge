import {mkdir,readdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import type {Readable,Writable} from 'node:stream';
import type {InteractiveStatus,InteractiveCommand} from '../index.ts';
export async function runSts(args=process.argv.slice(2),input:Readable=process.stdin,output:Writable=process.stdout){
  if(args[0]==='search')return (await import('./sts-search.ts')).runStsSearch(args.slice(1),output);
  if(args[0]==='play')args=args.slice(1);
  const flags:Record<string,string>={};
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!key?.startsWith('--')||value===undefined||value.startsWith('--'))throw Error('Flags require explicit values');
    const name=key.slice(2)==='out'?'output':key.slice(2)==='mode'?'interface':key.slice(2);
    if(!['character','seed','output','interface','review','ascension'].includes(name))throw Error('Unknown flag --'+name);
    if(Object.hasOwn(flags,name))throw Error('Duplicate flag --'+name);
    flags[name]=value;
  }
  const character=flags.character??'volibear',seed=flags.seed??'130',mode=flags.interface??flags.mode??'jsonl';
  if(character!=='volibear'&&character!=='ironclad')throw Error('Invalid character');
  if(!/^\d+$/.test(seed)||BigInt(seed)>0xffffffffffffffffn)throw Error('Invalid seed');
  if(mode!=='jsonl'&&mode!=='terminal')throw Error('Invalid mode');
  if(flags.review!==undefined&&!['true','false'].includes(flags.review))throw Error('Invalid review flag');
  if(flags.ascension!==undefined&&flags.ascension!=='20')throw Error('Only ascension 20 is supported');
  const outputPath=flags.output??flags.out;if(!outputPath)throw Error('--output is required');const out=resolve(outputPath);
  await mkdir(out,{recursive:true});if((await readdir(out)).length)throw Error('Output directory must be empty');
  const sessionId=randomUUID(),startedAt=new Date().toISOString(),root=fileURLToPath(new URL('../../../../',import.meta.url));
  const git=(...a:string[])=>{try{return execFileSync('git',a,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});}catch{return null;}};
  const entrySources=['examples/sts/src/cli/sts.ts','examples/sts/src/index.ts','examples/sts/src/interactive-session.ts','examples/sts/src/interactive-session.types.ts','examples/sts/src/presentation.ts'].map(path=>({path,blob:git('rev-parse','HEAD:'+path)?.trim()??null}));
  const metadata={pid:process.pid,sessionId,character,seed,ascension:20,review:flags.review!=='false',mode,startedAt,engine:'controlled production BaseGame',entrySources,git:{commit:git('rev-parse','HEAD')?.trim()??null,status:git('status','--porcelain'),diff:git('diff','HEAD','--binary','--','examples/sts/src','examples/sts/package.json','examples/sts/tsconfig.json','packages','vendor','package.json','tsconfig.json'),untracked:git('ls-files','--others','--exclude-standard','--','examples/sts/src','packages','vendor')}};
  await writeFile(resolve(out,'run.json'),JSON.stringify({...metadata,status:'initializing'},null,2),{flag:'wx'});
  await Promise.all(['decisions.jsonl','events.jsonl'].map(f=>writeFile(resolve(out,f),'')));
  const emit=(v:unknown)=>{if(mode==='jsonl')output.write(JSON.stringify(v)+'\n');else output.write(JSON.stringify(v,null,2)+'\n');};
  let eventWrites=Promise.resolve();const maps=new Map<number,unknown>();let historyOffset=0,decisionCount=0,eventSeq=0;
  let session:Awaited<ReturnType<typeof import('../index.ts').createInteractiveSession>>|undefined;
  const route:unknown[]=[],changes:unknown[]=[],battles:{battle:number;startEventSeq:number;endEventSeq?:number;act?:number;floor?:number;enemies?:unknown;outcome?:unknown}[]=[];let lastObservation:import('../index.ts').Observation|null=null,currentDecision=0;
  let finalStatus:'aborted'|'death'|'heart-victory'|'act3-clear'|'fault'='aborted',termination='eof',result:unknown=null;
  const lines=createInterface({input,terminal:false});
  const commands=lines[Symbol.asyncIterator]();
  const interrupt=(signal:string)=>{termination=signal;lines.close();};
  const sigint=()=>interrupt('SIGINT'),sigterm=()=>interrupt('SIGTERM');process.on('SIGINT',sigint);process.on('SIGTERM',sigterm);
  try{
    try{
      if(Object.values(metadata.git).some(v=>v===null))throw Error('Git provenance unavailable');
      if(entrySources.some(source=>source.blob===null))throw Error('Git provenance unavailable for entry source');
      const sourcePaths=['examples/sts/src','examples/sts/package.json','examples/sts/tsconfig.json','packages','vendor','package.json','package-lock.json','tsconfig.json'];
      const diff=git('diff','HEAD','--binary','--',...sourcePaths),untracked=git('ls-files','--others','--exclude-standard','--',...sourcePaths);
      if(diff===null||untracked===null)throw Error('Git provenance unavailable');
      let patch='# STS review source archive\n# commit: '+(metadata.git.commit??'unknown')+'\n'+entrySources.map(source=>'# entry source: '+source.path+' '+source.blob).join('\n')+'\n';patch+=diff;
      const newSources=untracked.split('\n').filter(p=>/\.(ts|tsx|js|mjs|cjs|json|py|cpp|h)$/.test(p)&&!p.split('/').some(part=>['data','node_modules','.env','credentials','secrets'].includes(part)));
      for(const path of newSources){
        try{patch+=execFileSync('git',['diff','--no-index','--binary','--','/dev/null',path],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});}
        catch(error){if(error&&typeof error==='object'&&'status' in error&&error.status===1&&'stdout' in error&&typeof error.stdout==='string')patch+=error.stdout;else throw error;}
      }
      await writeFile(resolve(out,'source.patch'),patch);
    }catch(error){throw Error('Unable to record source provenance: '+String(error));}

    const {createInteractiveSession}=await import('../index.ts');
    const {presentDecision,formatDecision}=await import('../index.ts');
    session=await createInteractiveSession({character,seed,sessionId,review:metadata.review,onEvent:event=>{
      const seq=eventSeq++;
      if(event.kind==='detail'&&typeof event.data.battle==='number'){
        if(event.type==='battle-start')battles.push({battle:event.data.battle,startEventSeq:seq});
        if(event.type==='battle-end'){const battle=battles.findLast(b=>b.battle===event.data.battle);if(battle){battle.endEventSeq=seq;battle.outcome=event.data.outcome;}}
      }
      eventWrites=eventWrites.then(()=>appendFile(resolve(out,'events.jsonl'),JSON.stringify({sessionId,decision:currentDecision,seq,event})+'\n'));return eventWrites;
    }});
    async function publish(status:InteractiveStatus){
      const observation=status.kind==='decision'?status.record.observation:status.observation;maps.set(observation.game.act,observation.game.map);
      await writeFile(resolve(out,'maps.json'),JSON.stringify([...maps].map(([act,map])=>({act,map})),null,2));
      if(!lastObservation||lastObservation.game.floor!==observation.game.floor||lastObservation.game.act!==observation.game.act)route.push({decision:decisionCount,act:observation.game.act,floor:observation.game.floor,x:observation.game.x,y:observation.game.y,room:observation.game.room});
      if(!lastObservation||JSON.stringify([lastObservation.game.deck,lastObservation.game.relics,lastObservation.game.potions])!==JSON.stringify([observation.game.deck,observation.game.relics,observation.game.potions]))changes.push({decision:decisionCount,deck:observation.game.deck,relics:observation.game.relics,potions:observation.game.potions});
      if(observation.battle){const battle=battles.findLast(b=>b.endEventSeq===undefined);if(battle){battle.act=observation.game.act;battle.floor=observation.game.floor;battle.enemies=observation.battle.monsters;}}
      lastObservation=observation;
      if(status.kind==='ended'){result=status.result;finalStatus=status.result.outcome==='death'?'death':status.result.heartDefeated?'heart-victory':'act3-clear';termination='terminal';emit({kind:'ended',sessionId,...status.result});return;}
      const record=status.record;currentDecision=record.decision;
      await appendFile(resolve(out,'decisions.jsonl'),JSON.stringify({kind:'observation',...record})+'\n');
      const presentation=presentDecision(record.observation,record.actions);
      await appendFile(resolve(out,'decisions.jsonl'),JSON.stringify({kind:'presentation',sessionId,decision:record.decision,presentation})+'\n');
      const history=record.observation.history.slice(historyOffset);historyOffset=record.observation.history.length;
      if(mode==='jsonl')emit({kind:'decision',sessionId,decision:record.decision,observation:{...record.observation,history},historyTotal:historyOffset,presentation});
      else output.write(formatDecision(observation,presentation));
    }
    await publish(await session.observe());
    for await(const line of commands){
      await appendFile(resolve(out,'decisions.jsonl'),JSON.stringify({kind:'input',line})+'\n');
      let command:InteractiveCommand;try{if(mode==='terminal'){const match=/^(\d+)(?:\s+(.*))?$/.exec(line.trim());command=match?{op:'act',sessionId,decision:currentDecision,action:Number(match[1]),reason:match[2]??''}:{op:line.trim()} as InteractiveCommand;}else command=JSON.parse(line);}catch{emit({kind:'rejected',reason:'Invalid JSON'});continue;}
      if(!command||typeof command!=='object'){emit({kind:'rejected',reason:'Expected command object'});continue;}
      if(command.op==='quit'){termination='quit';break;}
      if(command.op==='observe'){await publish(await session.observe());continue;}
      if(command.op!=='act'){emit({kind:'rejected',reason:'Unknown command'});continue;}
      const response=await session.act(command);
      await appendFile(resolve(out,'decisions.jsonl'),JSON.stringify({kind:response.accepted?'accepted':'rejected',command,...(!response.accepted?{reason:response.reason}:{} )})+'\n');
      if(!response.accepted){emit({kind:'rejected',reason:response.reason});continue;}
      decisionCount++;await publish(response.status);if(response.status.kind==='ended')break;
    }
  }catch(error){finalStatus='fault';termination='program-fault';result={message:String(error),stack:error instanceof Error?error.stack:null};emit({kind:'fault',sessionId,error:result});process.exitCode=1;}
  finally{
    process.off('SIGINT',sigint);process.off('SIGTERM',sigterm);lines.close();try{await session?.close();await eventWrites;}catch(error){finalStatus='fault';termination='cleanup-fault';result={primary:result,cleanupError:String(error)};process.exitCode=1;}
    const summary={sessionId,status:finalStatus,termination,decisions:decisionCount,result,route,changes,battles,lastObservation,startedAt,endedAt:new Date().toISOString()};
    await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,2));await writeFile(resolve(out,'run.json'),JSON.stringify({...metadata,status:finalStatus,termination,endedAt:summary.endedAt},null,2));if(!maps.size)await writeFile(resolve(out,'maps.json'),'[]\n');emit({kind:'summary',...summary});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runSts().catch(error=>{console.error(error);process.exitCode=1;});
