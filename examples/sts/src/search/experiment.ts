import {createExperimentRunner, implementationIdentity, type TaskResult} from '@bear-forge/experiments';
import {createCardLoader, fileSnapshotStore} from '@bear-forge/runtime-card';
import {cardDefinition} from '../card.ts';
import {contract, type StsTypes} from '../contract.ts';
import {createSearchPolicy} from './policy.ts';
import type {LoadedCore} from '@bear-forge/contracts/loading';
import type {Outcome} from '@bear-forge/contracts/instance';
import type {Setup,Ports,Frame} from '../game.schemas.ts';
type LoadSearchProgram = () => Promise<Outcome<LoadedCore<Setup,Ports,Frame>>>;

export type SearchRegistration={
  id:string;phase:'development'|'pilot'|'confirmation';engine:'controlled';
  characters:('ironclad'|'volibear')[];gameSeeds:number[];policySeeds:number[];excludedGameSeeds:number[];
  schedulingMilliseconds:number;maxSteps:number;maxAttempts:1;concurrency:number;checkpointEvery:number;
  memoryBudgetMB:number;taskMilliseconds:number;batchMilliseconds:number;stopOnFault:true;
};
/** Fill optional configuration defaults; the caller owns its typed inputs. */
export function searchRegistration(value:unknown):SearchRegistration{
  return {engine:'controlled',excludedGameSeeds:[130],schedulingMilliseconds:100,maxSteps:Number.MAX_SAFE_INTEGER,maxAttempts:1,
    concurrency:1,checkpointEvery:0,memoryBudgetMB:4096,taskMilliseconds:Number.MAX_SAFE_INTEGER,stopOnFault:true,
    ...value as Partial<SearchRegistration>} as SearchRegistration;
}
export type SearchTask = {
  id:string;
  seed:number; // Adventure preference cursor, never a future-world sample.
  gameSeed:number;
  character:'ironclad'|'volibear';
  schedulingMilliseconds:number;
};
export function searchTasks(config:SearchRegistration):SearchTask[]{
  const tasks:SearchTask[]=[];
  for(const gameSeed of config.gameSeeds)for(const character of config.characters)for(const policySeed of config.policySeeds){
    tasks.push({id:`${config.id}-${character}-${gameSeed}-${policySeed}`,seed:policySeed,gameSeed,character,schedulingMilliseconds:config.schedulingMilliseconds});
  }
  return tasks;
}
export function summarizeSearch(row: TaskResult<SearchTask>) {
  const estimates = row.decisions.map(d => d.proposal.nextMemory.evidence);
  const completedCombats = row.packets.flatMap(p => p.kind === 'event' && p.value.event?.kind === 'detail' && p.value.event.type === 'battle-end' ? [p.value.event.data] : []);
  const searches=estimates.filter(e=>e.algorithm==='exact-current-combat'&&e.method==='retained-information-sets'||
    e.algorithm==='local-current-combat'&&(e.method==='conservative-local-utility'||e.method==='public-prior-local-utility'));
  return {id:row.id,gameSeed:row.input.gameSeed,policySeed:row.input.seed,character:row.input.character,
    status:row.status,result:row.result,error:row.error??null,cost:row.cost,policyResources:row.policyResources??{},decisions:row.decisions.length,
    searched:searches.length,provenDecisions:searches.filter(e=>e.status==='proven-action').length,
    estimatedDecisions:searches.filter(e=>e.status==='estimated-action').length,
    exhaustedFrontiers:searches.filter(e=>e.pendingEdges===0).length,
    retainedEdges:searches.reduce((n,e)=>n+(e.pendingEdges??0),0),
    searchSteps:searches.reduce((n,e)=>n+BigInt(e.decisionSteps??e.steps??'0'),0n).toString(),completedCombats};
}
function createSearchRunner() {
  // The runner owns the shared Program and supplies the actual current Context.
  // Unknown futures branch through the original probability execution path.
  let loaded: ReturnType<LoadSearchProgram> | undefined;
  let loadingOptions: string | undefined;
  const loadProgram: LoadSearchProgram = () => {
    return loaded!;
  };
  return createExperimentRunner<StsTypes,SearchTask,SearchRegistration,ReturnType<typeof summarizeSearch>>({
    contract,
    execution: {identity:{kind:'card',rule:cardDefinition.id,search:'exact-current-combat@1'},
      load: ({snapshotDirectory}) => {
        const key=JSON.stringify([snapshotDirectory??null]);
        if (loadingOptions!==key) {
          loadingOptions=key;
          loaded=createCardLoader({controlled:true,recordCore:false,instructionsPerSlice:4096,
            ...(snapshotDirectory?{snapshots:fileSnapshotStore(snapshotDirectory)}:{})}).load(cardDefinition);
        }
        return loadProgram();
      }},
    parseRegistration: value=>searchRegistration(value),tasks:searchTasks,
    setup:task=>({character:task.character,seed:String(task.gameSeed),detailedEvents:true}),
    requiresCurrent:()=>true,
    retainedSearch:true,
    policies:(task,resources,forkCurrent)=>{
      const account=resources['0']??={milliseconds:0,costs:[]};
      return {'0':createSearchPolicy({character:task.character,account,forkCurrent,
        onEvidence:result=>account.costs.push(result.cost),schedulingMilliseconds:task.schedulingMilliseconds})};
    },
    facts:()=>[],summarize:summarizeSearch,
    identity:()=>implementationIdentity(['examples/sts/src'],{rule:cardDefinition.id,search:'exact-current-combat@1'}),
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
