import { encodeForge } from './features.ts';
export { encodeForge } from './features.ts';
import type { OwnTask } from './own.types.ts';
import type { PolicyRequest } from '@bear-forge/policies';
import { transformerPolicy, acceptedSamples } from '@bear-forge/training';
import type { ProcessClient } from '@bear-forge/training';
import type { TaskResult } from '@bear-forge/experiments';
import { createForgeRunner } from '../experiment/execution.ts';
import { RegistrationSchema } from '../experiment/registration.schemas.ts';
import { policy, scoreAction } from '../experiment/policy.ts';
import { ResultSchema } from '../forge.schemas.ts';
import { baseDeck } from '../index.ts';

export function createOwnForge(client:ProcessClient,previous?:{client:ProcessClient;version:string}) {

  const runner=createForgeRunner<OwnTask>({
    policies:task=>Object.fromEntries(['0','1'].map(player=>[player,task.model.players.includes(player)
      ?transformerPolicy(client,task.model.version,encodeForge,task.model.stochastic):task.opponent==='model-previous'?previous?transformerPolicy(previous.client,previous.version,encodeForge,false):(()=>{throw Error('Missing previous model');})():policy(task.opponent)])),
    tasks:()=>{throw Error('Use explicit own model tasks');},identity:async()=>({game:'forge-duel',learner:'own-ppo'})
  });
  return {
    players:['0','1'],encode:encodeForge,
    async run(seed:number,version:string,players:string[],stochastic:boolean,opponent:string,maxSteps:number,engine:'native'|'controlled'='native',files?:any,_playingOnly=false) {
      return runner.runTask({id:'own-'+seed,seed,phase:'discovery',block:0,seat:'0',policy:'first',opponent:(opponent==='previous'?'model-previous':opponent) as 'first',replacement:0,support:0,
        decks:{'0':[...baseDeck],'1':[...baseDeck]},model:{players,version,stochastic}},RegistrationSchema.parse({version:1,game:'forge-duel-v1',id:'own',blocks:1,seed,
          policies:['first'],opponents:['first'],maxSteps,maxAttempts:1,minimumBlocks:64,margin:.05,bootstrap:2000,analysisSeed:1,engine}),1,files);
    },
    samples(row:TaskResult,players:string[],version:string,_objective:'score'|'win') {
      if(row.status!=='ended')return [];
      const result=ResultSchema.parse(row.result),returns=Object.fromEntries(['0','1'].map(s=>[s,2*result.scores[s as '0']-1]));
      return acceptedSamples(row,players,version,encodeForge,returns,()=> 'playing');
    },
    async label(request:PolicyRequest) {
      if(request.options.kind!=='exact')throw Error('Expected exact teacher candidates');
      let best=-Infinity,index=0;
      request.options.values.forEach((a,i)=>{const score=scoreAction(a,request);if(score>best){best=score;index=i;}});return index;
    }
  };
}
