import {z} from 'zod';
import {rules} from './execution.ts';
import {resources,HpLossOrigin} from './resources.ts';
import {attributes} from './attributes.ts';
import {entityId} from './resources.schemas.ts';
import {hitRequestSchema,hitFactsSchema,hpDamageSchema,hitResultSchema,blockConsumptionSchema} from './damage.schemas.ts';
import type {HitRequest,HitFacts,HpDamageRequest,HitResult} from './damage.types.ts';
import type {HpLossReceipt} from './resources.types.ts';
const {defineRules,defineEvent,defineCheckpoint,defineEffect,sequence,when,call,query}=rules;
const emptyHit=(request:HitRequest):HitResult=>({battle:request.battle,source:request.source,target:request.target,blockTarget:request.target,requested:request.amount,blocked:0,blockSpent:0,unblocked:0,lost:0,attack:request.attack});

/** Shared damage flow; limits, prevention, reactions and relic behavior are registered content. */
export const damage=defineRules({requires:[resources,attributes],build(m){
  const prevention={},retaliation={},minimum={},reduction={},limit={},after={},stages={prevention,retaliation,minimum,reduction,limit,after};
  const order={phases:[{phase:prevention,before:[retaliation]},{phase:retaliation,before:[minimum]},{phase:minimum,before:[reduction]},{phase:reduction,before:[limit]},{phase:limit,before:[after]},{phase:after}],default:reduction};
  const beforeDamage=m.own(defineCheckpoint({input:hitRequestSchema,output:hitRequestSchema}));
  const beforeHpDamage=m.own(defineCheckpoint({input:hpDamageSchema,output:hpDamageSchema,order}));
  const started=m.own(defineEvent({payload:hitRequestSchema,dispatch:'immediate'}));
  const blocked=m.own(defineEvent({payload:hpDamageSchema,dispatch:'immediate'}));
  const resolved=m.own(defineEvent({payload:hitResultSchema,dispatch:'immediate'}));
  const announceStarted=m.atom({input:hitRequestSchema,output:z.undefined(),reads:[],writes:[],emits:[started],run(_r,payload){return{writes:[],events:[{event:started,payload}],result:undefined};}});
  const announceBlocked=m.atom({input:hpDamageSchema,output:z.undefined(),reads:[],writes:[],emits:[blocked],run(_r,payload){return{writes:[],events:[{event:blocked,payload}],result:undefined};}});
  const announceResolved=m.atom({input:hitResultSchema,output:z.undefined(),reads:[],writes:[],emits:[resolved],run(_r,payload){return{writes:[],events:[{event:resolved,payload}],result:undefined};}});
  // Absorption and expenditure are separate facts. Modifiers may reduce the
  // expenditure without generating block or changing the absorbed damage.
  const blockConsumption=rules.defineQuery({input:blockConsumptionSchema,output:z.number().int().nonnegative(),base:(_r,i)=>i.absorbed});
  const hit=defineEffect<HitRequest,HitResult>(b=>{
    const checked=b.local<rules.ReplacementResult<HitRequest>>(),request=b.local<HitRequest>(),facts=b.local<HitFacts>(),hadBlock=b.local<boolean>(),absorbed=b.local<number>(),spent=b.local<number>();
    const hpChecked=b.local<rules.ReplacementResult<HpDamageRequest>>(),hpRequest=b.local<HitRequest>(),hp=b.local<HpLossReceipt>(),result=b.local<HitResult>();
    const empty=b.read(v=>emptyHit(v.input));
    return sequence(b.assign(checked,m.resolve(beforeDamage,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(empty)),
      b.assign(request,b.read(v=>{const resolution=v.get(checked);if(resolution.kind==='cancel')throw Error('Canceled hit');return resolution.value;})),
      when(b.read(v=>!v.query(attributes.exports.damageable,v.get(request).target)),b.return(b.read(v=>emptyHit(v.get(request))))),call(announceStarted,request),
      when(b.read(v=>!v.query(attributes.exports.damageable,v.get(request).target)),b.return(b.read(v=>emptyHit(v.get(request))))),
      b.assign(hadBlock,b.read(v=>v.query(resources.exports.defense,v.get(request).target).block>0)),
      b.assign(absorbed,b.read(v=>Math.min(v.get(request).amount,v.query(resources.exports.defense,v.get(request).target).block))),
      b.assign(spent,query(blockConsumption,{request,absorbed})),
      when(b.read(v=>!Number.isInteger(v.get(spent))||v.get(spent)<0||v.get(spent)>v.get(absorbed)),b.return(b.read(()=>{throw Error('Block expenditure must be within absorbed damage');}))),
      b.assign(spent,call(resources.exports.consumeBlock,{entity:b.read(v=>v.get(request).target),amount:spent})),
      b.assign(facts,b.read(v=>({blockTarget:v.get(request).target,requested:v.get(request).amount,blocked:v.get(absorbed),blockSpent:v.get(spent),hadBlock:v.get(hadBlock),unblocked:Math.max(0,v.get(request).amount-v.get(absorbed))}))),
      b.assign(hpRequest,b.read(v=>({...v.get(request),amount:v.get(facts).unblocked}))),call(announceBlocked,{request:hpRequest,facts}),
      b.assign(hpChecked,m.resolve(beforeHpDamage,{request:hpRequest,facts})),
      when(b.read(v=>v.get(hpChecked).kind==='cancel'),b.assign(hpRequest,b.read(v=>({...v.get(hpRequest),amount:0}))),
        b.assign(hpRequest,b.read(v=>{
          const checked=v.get(hpChecked);if(checked.kind==='cancel')throw Error('Canceled HP damage');
          const before=v.get(facts),after=checked.value.facts;
          if(before.blockTarget!==after.blockTarget||before.requested!==after.requested||before.blocked!==after.blocked||before.blockSpent!==after.blockSpent||before.hadBlock!==after.hadBlock||before.unblocked!==after.unblocked)throw Error('A replacement cannot change committed block facts');
          return checked.value.request;
        }))),
      b.assign(hp,{entity:b.read(v=>v.get(hpRequest).target),amount:0,lost:0}),
      when(b.read(v=>v.get(hpRequest).amount>0),b.assign(hp,call(resources.exports.loseHpDetailed,{entity:b.read(v=>v.get(hpRequest).target),amount:b.read(v=>v.get(hpRequest).amount),selfDamage:b.read(v=>v.get(hpRequest).selfDamage),origin:HpLossOrigin.Damage,
        context:b.read(v=>({battle:v.get(hpRequest).battle,source:v.get(hpRequest).source,attack:v.get(hpRequest).attack}))}))),
      b.assign(result,b.read(v=>({battle:v.get(hpRequest).battle,source:v.get(hpRequest).source,target:v.get(hp).entity,blockTarget:v.get(facts).blockTarget,requested:v.get(facts).requested,blocked:v.get(facts).blocked,blockSpent:v.get(facts).blockSpent,unblocked:v.get(hp).amount,lost:v.get(hp).lost,attack:v.get(hpRequest).attack}))),
      call(announceResolved,result),b.return(result),
    );
  });
  const attack=defineEffect<{battle:number;source:number;target:number;base:number;card:number|null},HitResult>(b=>{const result=b.local<HitResult>();return sequence(
    b.assign(result,call(hit,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.source),target:b.read(v=>v.input.target),amount:query(attributes.exports.attackAmount,b.read(v=>({source:v.input.source,target:v.input.target,base:v.input.base,card:v.input.card}))),attack:true,selfDamage:false})),b.return(result),
  );});
  return{exports:{hit,attack,blockConsumption,beforeDamage:beforeDamage.public,beforeHpDamage:beforeHpDamage.public,started:started.public,blocked:blocked.public,resolved:resolved.public,stages}};
}});
