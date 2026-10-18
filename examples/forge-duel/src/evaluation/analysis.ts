import { boundedMean, effectStatus } from '@bear-forge/analysis';
import { conditions, relationId } from './tasks.ts';
import type { EvaluationBatch, EvaluationConfig, EvaluationRelation, EvaluationReport, EvaluationRow } from './evaluation.types.ts';
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
export function analyzeEvaluation(config:EvaluationConfig,rows:EvaluationRow[],batches:EvaluationBatch[]):EvaluationReport {
  const ids=new Set<string>(), cells=new Set<string>();
  for(const r of rows){
    const key=[r.input.phase,r.input.block,r.input.policy,r.input.environment,r.input.seat,r.input.variant].join('/');
    if(ids.has(r.id)||cells.has(key)||r.lineage&&(r.lineage.kind==='branch'||r.lineage.rootTaskId!==r.id))throw Error('Retries, duplicate cells and branches are not independent samples');
    ids.add(r.id);cells.add(key);
  }
  const frozen=batches.find(b=>b.phase==='confirmation');
  const relations:EvaluationRelation[]=[],matrix:EvaluationReport['matrix']=[];
  for(const phase of ['discovery','confirmation'] as const){
    const count=Math.max(0,...batches.filter(b=>b.phase===phase).map(b=>b.to));
    if(!count)continue;
    const phaseRows=rows.filter(r=>r.input.phase===phase);
    const index=new Map(phaseRows.map(r=>[[r.input.block,r.input.policy,r.input.environment,r.input.seat,r.input.variant].join('/'),r]));
    for(const policy of config.policies)for(const opponent of config.opponents)for(const c of config.comparisons){
      const id=relationId(c.id,policy,opponent.id);
      if(phase==='confirmation'&&!frozen!.candidates.includes(id))continue;
      const variants=conditions(c),values:number[]=[],evidence:string[]=[];
      for(let block=0;block<count;block++){
        const effects:number[]=[];const used:string[]=[];
        for(const seat of ['0','1'] as const){
          const required=variants.map(v=>index.get([block,policy,opponent.id,seat,v].join('/')));
          if(required.some(r=>!r||r.status!=='ended'||!Number.isFinite(r.result?.scores?.[seat])||r.result.scores[seat]<0||r.result.scores[seat]>1))break;
          const s=required.map(r=>r!.result.scores[seat] as number);
          effects.push(c.kind==='interaction'?s[3]!-s[1]!-s[2]!+s[0]!:s[1]!-s[0]!);
          used.push(...required.map(r=>r!.id));
        }
        if(effects.length===2){values.push(mean(effects));evidence.push(...used);}
      }
      const bound=c.kind==='interaction'?2:1;
      const stats=boundedMean(values,-bound,bound,phase==='confirmation'?config.alpha/Math.max(1,frozen!.familySize):config.alpha);
      const byVariant:EvaluationRelation['opportunitiesByVariant']={};
      for(const variant of variants){
        const totals:EvaluationRow['opportunities']={};
        for(const row of phaseRows.filter(r=>r.input.policy===policy&&r.input.environment===opponent.id&&r.input.variant===variant&&r.status==='ended')){
          for(const [card,counts] of Object.entries(row.opportunities)){
            const dest=totals[card]??={carry:0,draw:0,available:0,play:0};
            for(const k of ['carry','draw','available','play'] as const)dest[k]+=counts[k];
          }
        }
        byVariant[variant]=totals;
      }
      const opportunities=byVariant[c.candidate]!;
      const adaptationFlag=Object.values(opportunities).some(x=>x.available>=20&&x.play===0);
      relations.push({id,comparison:c.id,kind:c.kind,label:c.description,source:c.baseline,target:c.candidate,policy,opponent:opponent.id,phase,
        status:effectStatus(stats.interval,config.margin,count-values.length),effect:stats.mean,variance:stats.variance,interval:stats.interval,
        blocks:values.length,missing:count-values.length,confirmed:phase==='confirmation',candidateCount:frozen?.familySize??0,
        opportunities,opportunitiesByVariant:byVariant,evidence,adaptationFlag});
    }
    for(const variant of config.decks.map(d=>d.id))for(const policy of config.policies)for(const opponent of config.opponents){
      const selected=phaseRows.filter(r=>r.input.variant===variant&&r.input.policy===policy&&r.input.environment===opponent.id);
      if(!selected.length)continue;
      const scores=selected.filter(r=>r.status==='ended').map(r=>r.result?.scores?.[r.input.seat]).filter((x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1);
      matrix.push({variant,policy,opponent:opponent.id,phase,games:scores.length,missing:count*2-scores.length,score:scores.length?mean(scores):null});
    }
  }
  const weighted:EvaluationReport['weighted']=[];
  if(config.opponents.every(o=>o.weight!==undefined)){
    const total=config.opponents.reduce((s,o)=>s+o.weight!,0);
    for(const phase of ['discovery','confirmation'])for(const c of config.comparisons)for(const policy of config.policies){
      const found=config.opponents.map(o=>relations.find(r=>r.phase===phase&&r.comparison===c.id&&r.policy===policy&&r.opponent===o.id));
      if(found.some(r=>!r))continue;
      // Confirmation component bounds are simultaneous; their weighted sum remains valid.
      const complete=found.every(r=>r!.effect!==null&&r!.interval&&!r!.missing);
      const effect=complete?found.reduce((s,r,i)=>s+r!.effect!*config.opponents[i]!.weight!/total,0):null;
      const interval=complete?[0,1].map(k=>found.reduce((s,r,i)=>s+r!.interval![k]!*config.opponents[i]!.weight!/total,0)) as [number,number]:null;
      weighted.push({comparison:c.id,policy,phase,effect,interval});
    }
  }
  const dependencies:EvaluationReport['dependencies']=[];
  for(const phase of ['discovery','confirmation'])for(const c of config.comparisons)for(const opponent of config.opponents){
    const rs=relations.filter(r=>r.phase===phase&&r.comparison===c.id&&r.opponent===opponent.id);
    if(rs.some(r=>r.status==='positive')&&rs.some(r=>r.status==='negative'))dependencies.push({comparison:c.id,opponent:opponent.id,phase,policies:rs.map(r=>r.policy)});
  }
  return {experimentId:config.id,adaptation:'frozen-policies',candidates:frozen?.candidates??[],relations,stage:'discovery',reason:'',trainingSamples:0,
    plannedGames:rows.length,maxGames:config.maxGames,matrix,weighted,dependencies,
    cost:{tasks:rows.length,attempts:rows.reduce((s,r)=>s+r.attempt,0),ended:rows.filter(r=>r.status==='ended').length,fault:rows.filter(r=>r.status==='fault').length,
      truncated:rows.filter(r=>r.status==='truncated').length,milliseconds:rows.reduce((s,r)=>s+(r.attempts?.length?r.attempts.reduce((v,a)=>v+(a.cost?.milliseconds??0),0):r.cost.milliseconds),0),
      unknownCostAttempts:rows.reduce((s,r)=>s+(r.attempts?.filter(a=>!a.cost).length??0),0)}};
}
/** Screening only: two empirical standard errors select hypotheses, never confirm them. */
export function screen(config:EvaluationConfig,report:EvaluationReport) {
  return report.relations.filter(r=>r.phase==='discovery'&&!r.missing&&r.effect!==null&&r.variance!==null&&r.blocks>=64).filter(r=>{
    const error=2*Math.sqrt(r.variance!/r.blocks);
    return Math.abs(r.effect!)-error>config.margin||Math.abs(r.effect!)+error<config.margin;
  }).map(r=>r.id).sort();
}
export function nextEvaluationBatch(config:EvaluationConfig,completed:EvaluationBatch[],report:EvaluationReport) {
  const last=completed.at(-1)!;
  if(last.phase==='confirmation')return {next:null,reason:report.relations.some(r=>r.phase==='confirmation'&&r.status!=='unknown')?'independent-confirmation-complete':'confirmation-budget-exhausted'};
  if(report.cost.fault||report.cost.truncated)return {next:null,reason:'incomplete-blocks'};
  const candidates=screen(config,report);
  if(candidates.length){
    let desired=64;
    for(const id of candidates){
      const r=report.relations.find(r=>r.id===id&&r.phase==='discovery')!;
      const bound=r.kind==='interaction'?2:1;
      const gap=Math.max(config.margin/2,Math.abs(r.effect!)>config.margin?(Math.abs(r.effect!)-config.margin)/2:config.margin-Math.abs(r.effect!));
      const log=Math.log(4*candidates.length/config.alpha);
      let n=64;
      while(n<config.confirmationMaxBlocks && Math.sqrt(2*r.variance!*log/n)+7*(2*bound)*log/(3*(n-1))>gap)n++;
      desired=Math.max(desired,n);
    }
    const template:EvaluationBatch={id:'confirmation',phase:'confirmation',from:0,to:1,candidates,familySize:candidates.length};
    const perBlock=createCount(config,template);
    const remaining=config.maxGames-report.cost.tasks;
    const to=Math.min(desired,config.confirmationMaxBlocks,Math.floor(remaining/perBlock));
    return to>=64?{next:{...template,to},reason:'candidates-frozen'}:{next:null,reason:'insufficient-confirmation-budget'};
  }
  const to=config.discoveryBlocks.find(n=>n>last.to);
  if(to){
    const next:EvaluationBatch={id:'discovery-'+to,phase:'discovery',from:last.to,to,candidates:[],familySize:0};
    if(report.cost.tasks+createCount(config,next)<=config.maxGames)return {next,reason:'additional-discovery'};
  }
  return {next:null,reason:'discovery-budget-exhausted'};
}
import { createEvaluationTasks } from './tasks.ts';
function createCount(config:EvaluationConfig,b:EvaluationBatch){return createEvaluationTasks(config,b).length;}
