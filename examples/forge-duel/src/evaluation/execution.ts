import { join } from 'node:path';
import { ExperimentFiles, createForgeRunner, RegistrationSchema } from '../experiment/execution.ts';
import { implementationIdentity, runBatches } from '@bear-forge/experiments';
import type { BatchState, ExecutionHooks } from '@bear-forge/experiments';
import { sameData } from '@bear-forge/boundary';
import { withForgeModels } from '../training/experiment.ts';
import { EvaluationSchema } from './evaluation.schemas.ts';
import { createEvaluationTasks } from './tasks.ts';
import { analyzeEvaluation, nextEvaluationBatch } from './analysis.ts';
import type { EvaluationBatch, EvaluationConfig, EvaluationReport, EvaluationRow, EvaluationTask } from './evaluation.types.ts';

export async function runEvaluation(directory:string,input?:unknown,onProgress?:(event:unknown)=>void,hooks:ExecutionHooks={}) {
  const files=new ExperimentFiles(directory);
  const stored=await files.read<{config:EvaluationConfig;tasks:unknown[]}>('registration');
  const config=EvaluationSchema.parse(input??stored?.config);
  if(stored&&!sameData(stored.config,config))throw Error('Frozen evaluation registration mismatch');
  return withForgeModels(config.models,async(select,models)=>{
    const identity=await implementationIdentity(['examples/forge-duel/src','packages/training/src','packages/analysis/src'],{rule:config.game,models,encoder:'card-features-v1'});
    const runtime={platform:process.platform,arch:process.arch,versions:process.versions};
    const registration=RegistrationSchema.parse({version:1,game:config.game,id:config.id,engine:config.engine,blocks:1,seed:config.seed,
      policies:config.policies,opponents:[...new Set(config.opponents.map(x=>x.policy))],models:config.models,
      checkpointEvery:config.checkpointEvery,concurrency:config.concurrency,memoryBudgetMB:config.memoryBudgetMB,computeStepBudget:config.computeStepBudget,
      maxSteps:config.maxSteps,maxAttempts:config.maxAttempts,minimumBlocks:64,margin:config.margin,bootstrap:2000,analysisSeed:config.seed});
    return runBatches<EvaluationBatch,EvaluationReport>({
      directory,
      verify:async()=>{
        await files.register(config,[]);
        const frozen=await files.read('evaluation-implementation');
        const expected={identity,runtime};
        if(frozen&&!sameData(frozen,expected))throw Error('Frozen evaluation implementation, model or runtime changed');
        if(!frozen)await files.write('evaluation-implementation',expected);
      },
      initialize:async()=>({id:'discovery-'+config.discoveryBlocks[0],phase:'discovery',from:0,to:config.discoveryBlocks[0]!,candidates:[],familySize:0}),
      execute:async(batch)=>{
        const tasks=createEvaluationTasks(config,batch);
        const prior=(await files.summaries()).length;
        const already=new Set((await files.summaries()).map(r=>r.id));
        if(prior+tasks.filter(t=>!already.has(t.id)).length>config.maxGames)throw Error('Evaluation game budget exceeded');
        const runner=createForgeRunner<EvaluationTask>({tasks:()=>tasks,
          policies:t=>({'0':select(t.seat==='0'?t.policy:t.opponent),'1':select(t.seat==='1'?t.policy:t.opponent)}),identity:async()=>identity});
        const child=join(directory,'batches',batch.id);
        const childFiles=new ExperimentFiles(child);
        await runner.runExperiment(child,registration,(done,total)=>onProgress?.({batch:batch.id,done,total}),{
          point:async(stage,taskId)=>{
            if(stage==='after-commit')await files.linkCommit(taskId,childFiles);
            await hooks.point?.(stage,taskId);
          }
        });
        // Import one immutable commit at a time; the child runner remains the sole game executor.
        for(const task of tasks){
          if(!already.has(task.id))await files.linkCommit(task.id,childFiles);
        }
      },
      advance:async(completed)=>{
        const report=analyzeEvaluation(config,await files.summaries() as EvaluationRow[],completed);
        const decision=nextEvaluationBatch(config,completed,report);
        report.stage=decision.next?.phase??'complete';report.reason=decision.reason;
        report.candidates=completed.find(b=>b.phase==='confirmation')?.candidates??decision.next?.candidates??[];
        return {next:decision.next,result:report};
      },
      publish:async(state:BatchState<EvaluationBatch,EvaluationReport>)=>{
        const batches=[...state.completed,...(state.pending?[state.pending]:[])];
        const report=state.result??analyzeEvaluation(config,await files.summaries() as EvaluationRow[],[]);
        await files.write('analysis',{...report,stage:state.pending?.phase??'complete',plannedGames:batches.reduce((s,b)=>s+createEvaluationTasks(config,b).length,0),
          configSummary:{margin:config.margin,alpha:config.alpha,opponents:config.opponents},batches});
        onProgress?.({stage:state.pending?.phase??'complete',reason:report.reason,tasks:report.cost.tasks,candidates:report.candidates});
      }
    });
  });
}
export { EvaluationSchema };
