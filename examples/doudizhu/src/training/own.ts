import type { OwnTask } from './training.types.ts';
import type { PolicyRequest } from '@bear-forge/policies';
import { transformerPolicy, acceptedSamples } from '@bear-forge/training';
import type { ProcessClient, Features } from '@bear-forge/training';
import { createDoudizhuRunner } from '../experiment/execution.ts';
import { RegistrationSchema } from '../experiment/registration.schemas.ts';
import { ObservedSchema, ActionSchema, ResultSchema } from '../schemas.ts';
import { modelPolicy, evaluationScript } from './policy.ts';
import type { LearnerClient } from './client.ts';
import type { TaskResult } from '@bear-forge/experiments';

const patterns = ['single','pair','triple','tripleSingle','triplePair','straight','pairs','airplane','airplaneSingle','airplanePair','fourSingles','fourPairs','bomb','rocket'];
const phases = ['bidding','doubling','redoubling','playing'];
const eventTypes = ['deal','redeal','bid','landlord','doubleChosen','doublesRevealed','redouble','bottom','play','pass','lastCard','result'];
const vector = () => Array<number>(64).fill(0);
const relative = (seat: string, actor: string) => (Number(seat)-Number(actor)+3)%3;
function ranks(token: number[], cards: readonly number[], offset: number) {
  for (const rank of cards) token[offset+rank-3]! += 1/4;
}
export function encodeDoudizhu(request: PolicyRequest): Features {
  const visible = ObservedSchema.parse(request.observation), o = visible.observation;
  if (request.player !== o.actor || request.options.kind !== 'exact') throw Error('Invalid DDZ policy request');
  const global = vector(); global[0]=1;global[2]=1; global[8+phases.indexOf(o.phase)]=1;
  global[12]=o.highBid/3; global[13]=o.landlord === null ? -1 : relative(o.landlord,o.actor)/2;
  global[14]=relative(o.firstBidder,o.actor)/2;global[15]=o.turn === null ? -1 : relative(o.turn,o.actor)/2;
  for (const seat of ['0','1','2']) {
    const index=relative(seat,o.actor);
    global[16+index]=o.counts[seat as '0']/20;
    const choice=o.doubles?.[seat as '0']; global[20+index]=choice===null||choice===undefined?-1:Number(choice);
  }
  global[24]=o.ownDouble===null?-1:Number(o.ownDouble);global[25]=o.redoubled===null?-1:Number(o.redoubled);
  const hand=vector();hand[0]=1;hand[3]=1;ranks(hand,o.hand,16);
  const bottom=vector();bottom[0]=1;bottom[4]=1;bottom[8]=Number(o.bottom!==null);ranks(bottom,o.bottom??[],16);
  const last=vector();last[0]=1;last[5]=1;
  if(o.last){last[8]=relative(o.last.actor,o.actor)/2;ranks(last,o.last.play.cards,16);last[32+patterns.indexOf(o.last.play.pattern.kind)]=1;}
  const events=visible.events;
  let start=-1;for(let i=0;i<events.length;i++)if(events[i]!.type==='deal')start=i;
  const history=events.slice(start+1).slice(-32).map(event=>{
    const token=vector();token[0]=1;token[6]=1;token[8+eventTypes.indexOf(event.type)]=1;
    if('actor'in event) token[21]=relative(event.actor,o.actor)/2;
    if('value'in event) token[22]=Number(event.value)/3;
    if(event.type==='play'){ranks(token,event.play.cards,24);token[40+patterns.indexOf(event.play.pattern.kind)]=1;}
    if(event.type==='bottom')ranks(token,event.cards,24);
    return token;
  });
  const actions=request.options.values.map(raw=>{
    const action=ActionSchema.parse(raw), token=vector();token[0]=1;
    token[8+['bid','double','redouble','pass','play'].indexOf(action.kind)]=1;
    if('value'in action)token[16]=Number(action.value)/(action.kind==='bid'?3:1);
    if(action.kind==='play'){
      ranks(token,action.cards,17);token[32+patterns.indexOf(action.pattern.kind)]=1;
      token[46]=action.pattern.high/17;token[47]=action.pattern.length/12;
    }
    return token;
  });
  return {tokens:[global,hand,bottom,last,...history],actions};
}

export function doudizhuReturns(row: TaskResult, objective: 'score'|'win') {
  const result=ResultSchema.parse(row.result);
  return Object.fromEntries(['0','1','2'].map(player=>[player, objective==='score'
    ? Math.tanh(result.scores[player as '0']/12)
    : (result.winningSide==='landlord')===(result.landlord===player)?1:-1]));
}
export function createOwnDoudizhu(client: ProcessClient, teacher?: { client: LearnerClient; version: string }, previous?: {client:ProcessClient;version:string}) {

  const runner=createDoudizhuRunner<OwnTask>({
    policies:task=>Object.fromEntries(['0','1','2'].map(player=>{
      const selected=task.model.players.includes(player)?transformerPolicy(client,task.model.version,encodeDoudizhu,task.model.stochastic)
        :task.opponent==='previous'?previous?transformerPolicy(previous.client,previous.version,encodeDoudizhu,false):(()=>{throw Error('Missing previous model');})()
        :task.opponent==='wp'?teacher?modelPolicy(teacher.client,teacher.version,0):(()=>{throw Error('Missing WP opponent');})()
        :evaluationScript(task.opponent as 'first'|'last'|'random');
      const preplay=evaluationScript('first');
      return [player,task.model.playingOnly?{...selected,async decide(input:Parameters<typeof selected.decide>[0]){
        return ObservedSchema.parse(input.request.observation).observation.phase==='playing'?selected.decide(input):preplay.decide(input);
      }}:selected];
    })),
    tasks:()=>{throw Error('Use explicit frozen own-model tasks');},
    identity:async()=>({game:'doudizhu',learner:'own-ppo'})
  });
  return {
    players:['0','1','2'],encode:encodeDoudizhu,
    async run(seed:number,version:string,players:string[],stochastic:boolean,opponent:string,maxSteps:number,engine:'native'|'controlled'='native',files?:any,playingOnly=false) {
      return runner.runTask({id:'own-'+seed,seed,seats:['first','first','first'],model:{players,version,stochastic,playingOnly},opponent},
        RegistrationSchema.parse({id:'own',seats:['first','first','first'],maxSteps,engine}),1,files);
    },
    samples(row:TaskResult,players:string[],version:string,objective:'score'|'win') {
      return row.status==='ended' ? acceptedSamples(row,players,version,encodeDoudizhu,doudizhuReturns(row,objective),o=>ObservedSchema.parse(o).observation.phase):[];
    },
    /** Labels guide accepted student states; the label is never recorded as the executed action. */
    async label(request:PolicyRequest):Promise<number> {
      if(request.options.kind!=='exact')throw Error('Expected exact teacher candidates');
      const o=ObservedSchema.parse(request.observation).observation;
      if(o.phase==='playing'){
        if(!teacher)throw Error('Missing WP teacher');
        const value=await teacher.client.request({command:'score',observation:request.observation,actions:request.options.values});
        if(value.version!==teacher.version)throw Error('Teacher changed');return value.index;
      }
      if(o.phase==='bidding')return request.options.values.findIndex(a=>(a as any).value>0);
      return request.options.values.findIndex(a=>(a as any).value===false);
    }
  };
}
