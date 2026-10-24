import {z} from 'zod';
import {createExperimentRunner, implementationIdentity, type TaskResult} from '@bear-forge/experiments';
import {createCardLoader, fileSnapshotStore} from '@bear-forge/runtime-card';
import {withCurrentSource} from '../../../../packages/game-host/src/current.ts';
import {acquireProbabilityHostCost} from '../../../../packages/runtime-card/src/probability-tracking.ts';
import {defaultSearchLimits} from '@bear-forge/policies';
import {cardDefinition} from '../card.ts';
import {contract, type StsTypes} from '../contract.ts';
import {createSearchPolicy} from './policy.ts';
import type {LoadedCore} from '@bear-forge/contracts/loading';
import type {Outcome} from '@bear-forge/contracts/instance';
import type {Setup,Ports,Frame} from '../game.schemas.ts';
type LoadSearchProgram = () => Promise<Outcome<LoadedCore<Setup,Ports,Frame>>>;

const seed = z.number().int().min(0).max(0xffffffff);
export const SearchRegistrationSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  phase: z.enum(['development','pilot','confirmation']),
  engine: z.literal('controlled').default('controlled'),
  characters: z.array(z.enum(['ironclad','volibear'])).min(1).max(2),
  algorithms: z.array(z.enum(['r0','r1','r2'])).min(1).max(3),
  modes: z.array(z.enum(['work','wall'])).min(1).max(2),
  gameSeeds: z.array(seed).min(1).max(32),
  searchSeeds: z.array(seed).min(1).max(2),
  excludedGameSeeds: z.array(seed).default([130]),
  simulations: z.number().int().min(1).max(256).default(256),
  worlds: z.number().int().min(1).max(8).default(8),
  attempts: z.number().int().min(1).max(64).default(64),
  decisions: z.number().int().min(1).max(64).default(64),
  rounds: z.number().int().min(1).max(8).default(8),
  milliseconds: z.number().int().min(1).max(2000).default(2000),
  maxSteps: z.number().int().min(1).max(4000).default(2000),
  maxAttempts: z.literal(1).default(1),
  concurrency: z.literal(1).default(1),
  checkpointEvery: z.number().int().min(0).max(100).default(25),
  memoryBudgetMB: z.number().int().min(32).max(1024).default(1024),
  computeStepBudget: z.number().int().min(1000).max(100_000_000).default(100_000_000),
  taskMilliseconds: z.number().int().min(1).max(1_800_000).default(120_000),
  batchMilliseconds: z.number().int().min(1).max(1_800_000),
  stopOnFault: z.literal(true).default(true),
}).superRefine((c, context) => {
  if (c.phase === 'development' && (c.gameSeeds.length > 8 || c.batchMilliseconds > 600_000)) context.addIssue({code:'custom',message:'Development is capped at 8 seeds and 10 minutes'});
  for (const key of ['characters','algorithms','modes','gameSeeds','searchSeeds'] as const) if (new Set<string | number>(c[key]).size !== c[key].length) context.addIssue({code:'custom',message:'Duplicate '+key});
  if (c.phase !== 'development' && c.gameSeeds.some(s => s === 130 || c.excludedGameSeeds.includes(s))) context.addIssue({code:'custom',message:'Evaluation seeds overlap excluded development or selection seeds'});
});
export type SearchRegistration = z.infer<typeof SearchRegistrationSchema>;
export type SearchTask = {
  id: string;
  seed: number; // PolicyRouter seed only; never the actual game seed.
  gameSeed: number;
  character: 'ironclad' | 'volibear';
  algorithm: 'r0' | 'r1' | 'r2';
  mode: 'work' | 'wall';
  limits: Pick<SearchRegistration,'simulations'|'worlds'|'attempts'|'decisions'|'rounds'|'milliseconds'>;
};
export function searchTasks(config: SearchRegistration): SearchTask[] {
  const tasks: SearchTask[] = [];
  // Paired policies are adjacent so an interrupted batch retains comparable blocks.
  for (const gameSeed of config.gameSeeds) for (const character of config.characters)
    for (const searchSeed of config.searchSeeds) for (const mode of config.modes) for (const algorithm of config.algorithms) {
      tasks.push({id: `${config.id}-${character}-${gameSeed}-${searchSeed}-${mode}-${algorithm}`,
        seed: searchSeed, gameSeed, character, algorithm, mode,
        limits: {simulations: config.simulations,worlds: config.worlds,attempts: config.attempts,decisions: config.decisions,rounds: config.rounds,milliseconds: config.milliseconds}});
    }
  return tasks;
}
export function summarizeSearch(row: TaskResult<SearchTask>) {
  const estimates = row.decisions.map(d => d.proposal.nextMemory.evidence);
  const completedCombats = row.packets.flatMap(p => p.kind === 'event' && p.value.event?.kind === 'detail' && p.value.event.type === 'battle-end' ? [p.value.event.data] : []);
  return {id:row.id,gameSeed:row.input.gameSeed,searchSeed:row.input.seed,character:row.input.character,algorithm:row.input.algorithm,mode:row.input.mode,
    status:row.status,result:row.result,error:row.error??null,cost:row.cost,policyResources:row.policyResources??{},decisions:row.decisions.length,
    searched:estimates.filter(e=>e.coverageComplete).length,
    fallbacks:estimates.filter(e=>row.input.algorithm!=='r0'&&(!e.coverageComplete||e.algorithm==='r0')).length,
    constructionAttempts:estimates.reduce((n,e)=>n+e.attempts,0),acceptedWorlds:estimates.reduce((n,e)=>n+e.accepted,0),
    simulations:estimates.reduce((n,e)=>n+e.simulations,0),completedCombats};
}
function createSearchRunner() {
  // The runner owns the shared Program and supplies the actual current Context.
  // Unknown futures branch through the original probability execution path.
  let loaded: ReturnType<LoadSearchProgram> | undefined;
  let loadingOptions: string | undefined;
  const loadProgram: LoadSearchProgram = () => {
    if (!loaded) throw Error('Search Program must be loaded by the experiment before policy use');
    return loaded;
  };
  return createExperimentRunner<StsTypes,SearchTask,SearchRegistration,ReturnType<typeof summarizeSearch>>({
    contract,
    execution: {identity:{kind:'card',rule:cardDefinition.id,search:'actual-current-belief@1'},
      load: ({controlled,stepBudget,snapshotDirectory}) => {
        if (!controlled) throw Error('STS player search requires controlled execution');
        const key=JSON.stringify([stepBudget,snapshotDirectory??null]);
        if (loadingOptions!==key) {
          loadingOptions=key;
          loaded=createCardLoader({controlled:true,recordCore:false,stepBudget,
            ...(snapshotDirectory?{snapshots:fileSnapshotStore(snapshotDirectory)}:{})}).load(cardDefinition);
        }
        return loadProgram();
      }},
    parseRegistration: value=>SearchRegistrationSchema.parse(value),tasks:searchTasks,
    setup:task=>({character:task.character,seed:String(task.gameSeed),detailedEvents:true}),
    requiresCurrent:()=>true,
    policies:(task,resources,forkCurrent)=>{
      const account=resources['0']??={milliseconds:0,costs:[]};
      return {'0':createSearchPolicy({character:task.character,algorithm:task.algorithm,account,forkCurrent,
        onEvidence:result=>account.costs.push(result.cost),
        limits:{...defaultSearchLimits,...task.limits,mode:task.mode}})};
    },
    checkpointCost:async(_task,resources,forkCurrent)=>{
      const account=resources['0']??={milliseconds:0,costs:[]};
      const cost=await withCurrentSource(forkCurrent,instance=>acquireProbabilityHostCost(instance,account.milliseconds));
      return milliseconds=>{account.milliseconds=cost.update(milliseconds).milliseconds;};
    },
    facts:()=>[],summarize:summarizeSearch,
    identity:()=>implementationIdentity(['examples/sts/src'],{rule:cardDefinition.id,search:'actual-current-belief@1'}),
  });
}

export function createSearchExperiment() {
  // A caller may reuse this facade for concurrent output directories. Each
  // invocation owns its provider; policies cannot switch to another run's
  // Program or snapshot store when that run loads.
  type Runner = ReturnType<typeof createSearchRunner>;
  return {
    runTask: (...args: Parameters<Runner['runTask']>) => createSearchRunner().runTask(...args),
    runExperiment: (...args: Parameters<Runner['runExperiment']>) => createSearchRunner().runExperiment(...args),
  };
}
