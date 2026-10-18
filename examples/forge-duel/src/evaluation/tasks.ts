import type { EvaluationBatch, EvaluationConfig, EvaluationTask } from './evaluation.types.ts';
export const relationId=(comparison:string,policy:string,opponent:string)=>[comparison,policy,opponent].join('/');
export function conditions(x:EvaluationConfig['comparisons'][number]) {
  return x.kind==='interaction'?[x.baseline,x.xOnly!,x.yOnly!,x.candidate]:[x.baseline,x.candidate];
}
export function createEvaluationTasks(config:EvaluationConfig,batch:EvaluationBatch):EvaluationTask[] {
  const tasks:EvaluationTask[]=[],decks=new Map(config.decks.map(d=>[d.id,d.cards])),selected=new Set(batch.candidates);
  for(let p=0;p<config.policies.length;p++)for(let o=0;o<config.opponents.length;o++){
    const policy=config.policies[p]!,opponent=config.opponents[o]!;
    const variants=new Set(config.comparisons.filter(c=>batch.phase==='discovery'||selected.has(relationId(c.id,policy,opponent.id))).flatMap(conditions));
    for(let block=batch.from;block<batch.to;block++)for(const seat of ['0','1'] as const)for(const variant of variants){
      const index=config.decks.findIndex(d=>d.id===variant);
      const seed=(config.seed+Math.imul(block+(batch.phase==='confirmation'?1048576:0),2654435761))>>>0;
      tasks.push({id:`${batch.phase}-${block}-p${p}-o${o}-s${seat}-v${index}`,phase:batch.phase,block,seed,seat,policy,opponent:opponent.policy,
        replacement:0,support:0,variant,environment:opponent.id,
        decks:{'0':[...decks.get(seat==='0'?variant:opponent.deck)!],'1':[...decks.get(seat==='1'?variant:opponent.deck)!]}});
    }
  }
  return tasks;
}
