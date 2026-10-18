import type { z } from 'zod';
import type { EvaluationSchema } from './evaluation.schemas.ts';
import type { TaskInput, TaskSummary } from '../experiment/experiment.types.ts';
export type EvaluationConfig = z.infer<typeof EvaluationSchema>;
export type EvaluationTask = TaskInput & { variant: string; environment: string };
export type EvaluationRow = TaskSummary & { input: EvaluationTask };
export type EvaluationBatch = { id:string; phase:'discovery'|'confirmation'; from:number; to:number; candidates:string[]; familySize:number };
export type EvaluationRelation = {
  id:string; comparison:string; kind:'comparison'|'replacement'|'interaction'; label:string;
  source:string; target:string; policy:string; opponent:string; phase:'discovery'|'confirmation';
  status:'positive'|'negative'|'equivalent'|'unknown'; effect:number|null; interval:[number,number]|null; variance:number|null;
  blocks:number; missing:number; confirmed:boolean; candidateCount:number;
  opportunities:TaskSummary['opportunities']; opportunitiesByVariant:Record<string,TaskSummary['opportunities']>;
  evidence:string[]; adaptationFlag:boolean;
};
export type EvaluationReport = {
  experimentId:string; adaptation:'frozen-policies'; candidates:string[]; relations:EvaluationRelation[];
  stage:string; reason:string; trainingSamples:0; plannedGames:number; maxGames:number;
  matrix:{variant:string;policy:string;opponent:string;phase:string;games:number;missing:number;score:number|null}[];
  weighted:{comparison:string;policy:string;phase:string;effect:number|null;interval:[number,number]|null}[];
  dependencies:{comparison:string;opponent:string;phase:string;policies:string[]}[];
  cost:{tasks:number;attempts:number;ended:number;fault:number;truncated:number;milliseconds:number;unknownCostAttempts:number};
};
