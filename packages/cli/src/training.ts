import { readFile, mkdir, access, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProcessClient } from '@bear-forge/training';
import { ExperimentFiles, withWriter } from '@bear-forge/experiments';
import { bootstrap } from '@bear-forge/analysis';
import { createOwnDoudizhu } from '../../../examples/doudizhu/src/training/own.ts';
import { createOwnForge } from '../../../examples/forge-duel/src/training/own.ts';
import { LearnerClient } from '../../../examples/doudizhu/src/training/client.ts';
import { OwnTrainingSchema } from './training.schemas.ts';

export async function trainingMain(args=process.argv.slice(2)) {
  const [command,path,...rest]=args;
  if(!path||rest.length||!['train','resume','eval'].includes(command??''))throw Error('Usage: npm run training -- train|resume|eval CONFIG.json');
  const config=OwnTrainingSchema.parse(JSON.parse(await readFile(path,'utf8')));
  if(command!=='train'&&!config.checkpoint)throw Error('resume/eval requires checkpoint');
  if(command==='train'&&config.checkpoint)throw Error('Use resume to continue');
  if(config.game==='forge-duel'&&config.teacherCheckpoint)throw Error('Forge uses the rule teacher, not a DDZ checkpoint');
  if(config.game==='doudizhu'&&config.teacher&&!config.teacherCheckpoint)throw Error('DDZ teacher requires WP checkpoint');
  await mkdir(config.output,{recursive:true});
  return withWriter(resolve(config.output),async()=>{
    const target=resolve(config.output,'model.pt');
    if(command==='train'){
      try{await access(target);throw Error('Output model exists; use resume or a new directory');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    const client=new ProcessClient(config.seed);
    let teacherClient:LearnerClient|undefined,previous:ProcessClient|undefined;
    let stopping=false;const stop=()=>{stopping=true;};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    const started=performance.now();
    const files=config.engine==='controlled'?new ExperimentFiles(join(config.output,'episodes'),(r:any)=>({id:r.id,status:r.status})):undefined;
    try{
      let status=await client.request({command:'status'});
      let metadata:any={game:config.game,encoder:'card-features-v1',initialSeed:config.seed,nextSeed:config.seed,
        episodes:0,truncated:0,teacherVersion:null,config:{reward:config.reward,teacher:config.teacher,
          opponentEvery:config.opponentEvery,maxSteps:config.maxSteps,engine:config.engine,learner:config.learner}};
      if(config.checkpoint){
        status=await client.request({command:'load',path:resolve(config.checkpoint)});metadata=status.metadata;
        if(metadata.game!==config.game||metadata.encoder!=='card-features-v1')throw Error('Wrong game or feature checkpoint');
        if(command==='resume'&&JSON.stringify(metadata.config)!==JSON.stringify({reward:config.reward,teacher:config.teacher,
          opponentEvery:config.opponentEvery,maxSteps:config.maxSteps,engine:config.engine,learner:config.learner}))throw Error('Resume must preserve learner/sampling configuration');
      }else status=await client.request({command:'configure',settings:config.learner,seed:config.seed});
      let teacher:any;
      if(config.teacherCheckpoint){teacherClient=new LearnerClient();teacher=await teacherClient.request({command:'load',path:resolve(config.teacherCheckpoint)});}
      if(command==='resume'&&(metadata.teacherVersion??null)!==(teacher?.version??null))throw Error('Resume teacher changed');
      if(command==='train')metadata.teacherVersion=teacher?.version??null;
      const adapter=config.game==='doudizhu'?createOwnDoudizhu(client,teacher?{client:teacherClient!,version:teacher.version}:undefined):createOwnForge(client);
      const initialSamples=status.samples,initialSteps=status.optimizerSteps;
      if(command==='eval'){
        const overlap=(m:any)=>config.seed<m.nextSeed&&config.seed+config.evaluationSeeds>m.initialSeed;
        if(overlap(metadata))throw Error('Evaluation overlaps training seeds');
        let previousStatus:any;
        if(config.previousCheckpoint){
          previous=new ProcessClient();previousStatus=await previous.request({command:'load',path:resolve(config.previousCheckpoint)});
          if(previousStatus.metadata.game!==config.game||overlap(previousStatus.metadata)||previousStatus.version===status.version)throw Error('Invalid previous model evaluation');
        }
        const opponents=config.game==='doudizhu'?['first','last','random',...(teacher?['wp']:[]),...(previous?['previous']:[])]:['first','last','random','rule',...(previous?['previous']:[])];
        const results:{opponent:string;scope:string;group:string;seed:number;win:number;score:number;role:string}[]=[];
        const counts={ended:0,truncated:0,fault:0};
        for(const opponent of opponents){
          for(let offset=0;offset<config.evaluationSeeds&&!stopping;offset++){
            const seed=config.seed+offset;
            const groups=config.game==='forge-duel'
              ?adapter.players.map(p=>({scope:'all',players:[p],group:p}))
              :[...(config.evaluationScope!=='playing'?adapter.players.map(p=>({scope:'all',players:[p],group:p})):[]),
                ...(config.evaluationScope!=='all'?[{scope:'playing',players:['2'],group:'landlord'},{scope:'playing',players:['0','1'],group:'peasants'}]:[])];
            for(const group of groups){
              if(stopping)break;
              const runAdapter=opponent==='previous'
                ?config.game==='doudizhu'?createOwnDoudizhu(client,teacher?{client:teacherClient!,version:teacher.version}:undefined,{client:previous!,version:previousStatus.version})
                  :createOwnForge(client,{client:previous!,version:previousStatus.version})
                :adapter;
              const row=await runAdapter.run(seed,status.version,group.players,false,opponent,config.maxSteps,config.engine,files,group.scope==='playing');
              consume(row,group,opponent,seed);
            }
          }
          console.log(JSON.stringify({event:'own-evaluation-progress',opponent,...counts}));
        }
        function consume(row:any,group:{scope:string;players:string[];group:string},opponent:string,seed:number){
          counts[row.status as keyof typeof counts]++;
          if(row.status==='fault')throw Error(row.error??'Own evaluation fault');
          if(row.status!=='ended')return;
          const player=group.players[0]!;
          const win=config.game==='doudizhu'?Number((row.result.winningSide==='landlord')===(row.result.landlord===player)):row.result.scores[player];
          const role=config.game==='doudizhu'?(row.result.landlord===player?'landlord':'peasants'):'player';
          results.push({opponent,scope:group.scope,group:group.group,seed,win,role,score:group.players.reduce((s,p)=>s+row.result.scores[p],0)});
        }
        const summaries=[];
        for(const opponent of opponents)for(const scope of ['all','playing']){
          const all=results.filter(r=>r.opponent===opponent&&r.scope===scope);
          for(const group of [...new Set(all.map(r=>r.group)),'overall']){
            const rows=group==='overall'?all:all.filter(r=>r.group===group);if(!rows.length)continue;
            const clusters=new Map<number,number[]>();for(const r of rows)clusters.set(r.seed,[...(clusters.get(r.seed)??[]),r.win]);
            const means=[...clusters.values()].map(v=>v.reduce((a,b)=>a+b,0)/v.length);
            summaries.push({opponent,scope,group,games:rows.length,seeds:means.length,winRate:means.reduce((a,b)=>a+b,0)/means.length,
              interval:means.length>1?bootstrap(means,config.seed,2000,.025):null,meanScore:rows.reduce((s,r)=>s+r.score,0)/rows.length});
          }
        }
        const after=await client.request({command:'status'});
        if(after.optimizerSteps!==initialSteps)throw Error('Evaluation updated model');
        console.log(JSON.stringify({event:'own-evaluation-complete',game:config.game,...counts,stopped:stopping,summaries,
          version:status.version,milliseconds:performance.now()-started,learner:after.metrics}));
      }else{
        const rotate=async(from:string,to:string)=>{try{await copyFile(from,to);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}};
        const save=async()=>{
          await rotate(resolve(config.output,'previous-1.pt'),resolve(config.output,'previous-2.pt'));
          await rotate(target,resolve(config.output,'previous-1.pt'));
          await client.request({command:'save',path:target,metadata});
        };
        await save();
        while(!stopping&&status.samples-initialSamples<config.samples&&performance.now()-started<config.minutes*60000){
          if(metadata.nextSeed>4294967295)throw Error('Training seeds exhausted');
          const vsOpponent=metadata.episodes%config.opponentEvery===config.opponentEvery-1;
          const players=vsOpponent?[adapter.players[Math.floor(metadata.episodes/config.opponentEvery)%adapter.players.length]!]:[...adapter.players];
          const opponent=config.game==='doudizhu'&&teacher?'wp':config.game==='forge-duel'?'rule':'random';
          const row=await adapter.run(metadata.nextSeed,status.version,players,true,opponent,config.maxSteps,config.engine,files);
          if(row.status==='fault')throw Error(row.error??'Own sampling fault');
          const samples=adapter.samples(row,players,status.version,config.reward);
          if(config.teacher&&samples.length){
            const requests=new Map(row.packets.filter(p=>p.kind==='request').map(p=>[JSON.stringify(p.value.id),p.value]));
            for(const sample of samples)sample.teacherIndex=await adapter.label(requests.get(sample.requestId));
          }
          if(samples.length)status=await client.request({command:'learn',version:status.version,rows:samples});
          metadata.nextSeed++;metadata.episodes++;
          if(row.status==='truncated')metadata.truncated++;
          if(metadata.episodes%config.checkpointEvery===0)await save();
          if(metadata.episodes%10===0)console.log(JSON.stringify({event:'own-training-progress',samples:status.samples,updates:status.updates,
            optimizerSteps:status.optimizerSteps,phases:status.phases,stats:status.stats??null,episodes:metadata.episodes,truncated:metadata.truncated,milliseconds:performance.now()-started}));
        }
        await save();
        const teacherAfter=teacherClient?await teacherClient.request({command:'status'}):null;
        console.log(JSON.stringify({event:'own-training-complete',checkpoint:target,game:config.game,stopped:stopping,episodes:metadata.episodes,
          truncated:metadata.truncated,newSamples:status.samples-initialSamples,initialOptimizerSteps:initialSteps,...status,
          milliseconds:performance.now()-started,teacherUpdates:teacherAfter?.updates??null,roundTripMilliseconds:client.timings,
          nodePeakRssBytes:process.resourceUsage().maxRSS*1024}));
      }
    }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await Promise.all([client.close(),teacherClient?.close(),previous?.close()]);}
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)trainingMain().catch(error=>{console.error(error);process.exitCode=1;});
