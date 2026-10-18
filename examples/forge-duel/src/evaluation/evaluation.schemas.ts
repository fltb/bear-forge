import { z } from 'zod';
import { DeckSchema } from '../forge.schemas.ts';
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const Policy = z.union([z.enum(['first','last','random','rule']),z.templateLiteral(['model-',Id])]);
const Deck = z.strictObject({ id: Id, cards: DeckSchema });
const Comparison = z.strictObject({
  id: Id,
  kind: z.enum(['comparison','replacement','interaction']),
  baseline: Id,
  candidate: Id,
  xOnly: Id.optional(),
  yOnly: Id.optional(),
  description: z.string().min(1),
}).superRefine((v,c)=>{
  if(v.baseline===v.candidate)c.addIssue({code:'custom',message:'Candidate must differ from baseline'});
  if(v.kind==='interaction' && (!v.xOnly||!v.yOnly||new Set([v.baseline,v.candidate,v.xOnly,v.yOnly]).size!==4))c.addIssue({code:'custom',message:'Interaction needs four distinct conditions'});
  if(v.kind!=='interaction'&&(v.xOnly||v.yOnly))c.addIssue({code:'custom',message:'Only interaction uses xOnly/yOnly'});
});
export const EvaluationSchema = z.strictObject({
  id: Id,
  game: z.literal('forge-duel-v1'),
  engine: z.enum(['native','controlled']).default('native'),
  decks: z.array(Deck).min(2).max(32),
  comparisons: z.array(Comparison).min(1).max(16),
  opponents: z.array(z.strictObject({id:Id, deck:Id, policy:Policy, weight:z.number().positive().optional()})).min(1).max(8),
  policies: z.array(Policy).min(1).max(4),
  models: z.record(z.string(),z.string().min(1)).default({}),
  seed: z.number().int().min(0).max(4294967295),
  margin: z.number().positive().max(0.5).default(0.03),
  alpha: z.number().min(0.001).max(0.1).default(0.05),
  discoveryBlocks: z.array(z.number().int().min(64).max(256)).min(1).max(3).default([64,128,256]),
  confirmationMaxBlocks: z.number().int().min(64).max(2048).default(2048),
  maxGames: z.number().int().min(1).max(1000000),
  concurrency: z.number().int().min(1).max(4).default(1),
  maxSteps: z.number().int().min(1).max(10000).default(1000),
  maxAttempts: z.number().int().min(1).max(20).default(2),
  checkpointEvery: z.number().int().min(0).max(10000).default(0),
  memoryBudgetMB: z.number().int().min(32).max(32768).default(4096),
  computeStepBudget: z.number().int().min(1000).max(1000000000).default(100000000),
}).superRefine((v,c)=>{
  const issue=(message:string)=>c.addIssue({code:'custom',message});
  for(const list of [v.decks,v.comparisons,v.opponents])if(new Set(list.map(x=>x.id)).size!==list.length)issue('Duplicate identities');
  if(new Set(v.policies).size!==v.policies.length)issue('Duplicate policies');
  if(v.discoveryBlocks.some((x,i)=>i>0&&x<=v.discoveryBlocks[i-1]!))issue('Discovery blocks must increase');
  const decks=new Map(v.decks.map(d=>[d.id,d.cards]));
  for(const x of v.comparisons){
    for(const id of [x.baseline,x.candidate,x.xOnly,x.yOnly].filter(Boolean))if(!decks.has(id!))issue('Unknown comparison deck '+id);
    if(x.kind==='interaction'&&[x.baseline,x.candidate,x.xOnly,x.yOnly].every(id=>decks.has(id!))){
      const a=decks.get(x.baseline)!,b=decks.get(x.xOnly!)!,d=decks.get(x.yOnly!)!,both=decks.get(x.candidate)!;
      const names=new Set([...a,...b,...d,...both]);
      for(const name of names){
        const count=(cards:typeof a)=>cards.filter(c=>c===name).length;
        if(count(both)-count(a)!==count(b)-count(a)+count(d)-count(a))issue('Interaction conditions must compose the two declared changes');
      }
      if([b,d].some(cards=>[...cards].sort().join()===[...a].sort().join()))issue('Each interaction factor must change the baseline');
    }
    if(x.kind==='replacement'&&decks.has(x.baseline)&&decks.has(x.candidate)){
      const before=decks.get(x.baseline)!,after=decks.get(x.candidate)!;
      const names=new Set([...before,...after]);
      if([...names].reduce((s,n)=>s+Math.abs(before.filter(x=>x===n).length-after.filter(x=>x===n).length),0)!==2)issue('Replacement must exchange exactly one card');
    }
    if(decks.has(x.baseline)&&decks.has(x.candidate)&&[...decks.get(x.baseline)!].sort().join() === [...decks.get(x.candidate)!].sort().join())issue('Identical candidate composition');
  }
  for(const x of v.opponents)if(!decks.has(x.deck))issue('Unknown opponent deck');
  const weights=v.opponents.filter(x=>x.weight!==undefined).length;
  if(weights&&weights!==v.opponents.length)issue('Provide all environment weights or none');
  const names=[...v.policies,...v.opponents.map(x=>x.policy)];
  for(const name of names)if(name.startsWith('model-')&&!v.models[name])issue('Missing model binding '+name);
  if(Object.keys(v.models).length>4||Object.keys(v.models).some(n=>!names.includes(n as typeof names[number])))issue('Invalid or unused model binding');
  if(v.checkpointEvery&&v.engine!=='controlled')issue('Checkpoints require controlled execution');
  const variants=new Set(v.comparisons.flatMap(x=>[x.baseline,x.candidate,...(x.kind==='interaction'?[x.xOnly!,x.yOnly!]:[])]));
  if(variants.size*v.policies.length*v.opponents.length*2*v.discoveryBlocks[0]!>v.maxGames)issue('Budget cannot cover the first complete discovery batch');
});
