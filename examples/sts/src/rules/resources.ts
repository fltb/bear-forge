import {z} from 'zod';
import {rules} from './execution.ts';
import {describeProgram} from './program-descriptions.ts';
import type {ruleModules} from '@bear-forge/card-engine';
import {amount,entityId,healthSchema,resourceSetupSchema,resourceAmountSchema,hpLossSchema,resourceChangeSchema,healthChangeSchema,hpLostSchema} from './resources.schemas.ts';
import type {ResourceSetup,ResourceAmount,HpLoss,HpLossReceipt} from './resources.types.ts';
const {defineRules,defineComponent,defineQuery,defineEvent,defineCheckpoint,defineEffect,sequence,when,call,query}=rules;
type Effect<I,O>=rules.Effect<I,O>;
type Checkpoint<I,O>=rules.Checkpoint<I,O>;
type ReplacementResult<T>=rules.ReplacementResult<T>;
type EntityLifecycle<T>=rules.EntityLifecycle<T>;
type Owned<T>=ruleModules.Owned<T>;
export const HpLossOrigin={Direct:0,Damage:1} as const;

/** Finite resource transitions. Card, relic and power behavior belongs in composed effects and registrations. */
export const resources=defineRules({requires:[],build(m){
  const restriction={},transform={},stages={restriction,transform};
  describeProgram(restriction,'资源限制阶段');describeProgram(transform,'资源变换阶段');
  const order={phases:[{phase:restriction,before:[transform]},{phase:transform}],default:transform};
  const health=m.own(defineComponent({schema:healthSchema,initial:()=>({hp:1,maxHp:1})}));
  const block=m.own(defineComponent({schema:amount,initial:()=>0}));
  const energy=m.own(defineComponent({schema:amount,initial:()=>0}));
  const escrow=m.own(defineComponent({schema:amount,initial:()=>0}));
  const gold=m.own(defineComponent({schema:z.int32().min(-32768).max(32767),initial:()=>0}));
  const changed=m.own(defineEvent({payload:z.object({entity:entityId,resource:z.enum(['energy','block','gold','hp','maxHp']),before:z.number(),after:z.number()}),dispatch:'immediate'}));
  const healed=m.own(defineEvent({payload:healthChangeSchema,dispatch:'immediate'}));
  const hpLost=m.own(defineEvent({payload:hpLostSchema,dispatch:'immediate'}));
  const wouldDie=m.own(defineEvent({payload:z.object({entity:entityId}).strict(),dispatch:'immediate'}));
  const blockGained=m.own(defineEvent({payload:resourceChangeSchema,dispatch:'immediate'}));
  const energyGained=m.own(defineEvent({payload:resourceChangeSchema,dispatch:'immediate'}));
  const goldGained=m.own(defineEvent({payload:resourceChangeSchema,dispatch:'immediate'}));
  const beforeHeal=m.own(defineCheckpoint({input:resourceAmountSchema,output:resourceAmountSchema,order}));
  const beforeHpLoss=m.own(defineCheckpoint({input:hpLossSchema,output:hpLossSchema,order}));
  const beforeBlockGain=m.own(defineCheckpoint({input:resourceAmountSchema,output:resourceAmountSchema,order}));
  const beforeGoldGain=m.own(defineCheckpoint({input:resourceAmountSchema,output:resourceAmountSchema,order}));
  const initialize=m.atom({input:resourceSetupSchema.extend({entity:entityId}),output:z.undefined(),reads:[],writes:[health,block,energy,gold],emits:[],run(_r,input){return{
    writes:[{entity:input.entity,component:health,value:{hp:input.hp,maxHp:input.maxHp}},
      {entity:input.entity,component:block,value:input.block},{entity:input.entity,component:energy,value:input.energy},{entity:input.entity,component:gold,value:input.gold}],events:[],result:undefined,
  };}});
  const actor=m.kind({config:z.object({side:z.union([z.literal(0),z.literal(1)])}).strict(),setup:resourceSetupSchema,components:[health,block,energy,gold,escrow],
    initialize:defineEffect<EntityLifecycle<ResourceSetup>,void>(b=>call(initialize,b.read(v=>({...v.input.setup,entity:v.input.entity})))),
  });
  const escrowedGold=defineQuery({input:entityId,output:amount,reads:[escrow],base:(r,entity)=>r.component(entity,escrow)});
  // Debit and recovery ownership are one commit, so gold observers cannot see
  // a debit without its matching escrow ledger (or vice versa).
  const seizeGold=m.atom({input:z.object({source:entityId,target:entityId,amount}),output:amount,reads:[gold,escrow],writes:[gold,escrow],emits:[changed],run(r,i){
    const before=r.component(i.source,gold),taken=Math.max(0,Math.min(before,i.amount));
    return{writes:taken===0?[]:[{entity:i.source,component:gold,value:before-taken},{entity:i.target,component:escrow,value:r.component(i.target,escrow)+taken}],events:taken===0?[]:[{event:changed,payload:{entity:i.source,resource:'gold' as const,before,after:before-taken}}],result:taken};
  }});
  const current=defineQuery({input:entityId,output:resourceSetupSchema,reads:[health,block,energy,gold],base:(r,entity)=>({
    ...r.component(entity,health),block:r.component(entity,block),energy:r.component(entity,energy),gold:r.component(entity,gold),
  })});
  const vitality=defineQuery({input:entityId,output:healthSchema,reads:[health],base:(r,id)=>r.component(id,health)});
  const defense=defineQuery({input:entityId,output:z.object({block:resourceSetupSchema.shape.block}).strict(),reads:[block],base:(r,id)=>({block:r.component(id,block)})});
  const stamina=defineQuery({input:entityId,output:z.object({energy:resourceSetupSchema.shape.energy}).strict(),reads:[energy],base:(r,id)=>({energy:r.component(id,energy)})});
  const wealth=defineQuery({input:entityId,output:z.object({gold:resourceSetupSchema.shape.gold}).strict(),reads:[gold],base:(r,id)=>({gold:r.component(id,gold)})});
  const side=defineQuery({input:entityId,output:z.union([z.literal(0),z.literal(1)]),kinds:[actor],base:(r,entity)=>r.configuration(entity,actor).side});

  // Every checkpoint is resolved by its owner. Each commit sees the latest data after any suspended replacement.
  function through<I>(checkpoint:Owned<Checkpoint<I,I>>,commit:Effect<I,number>):Effect<I,number>{
    return defineEffect<I,number>(b=>{const checked=b.local<ReplacementResult<I>>(),result=b.local<number>();return sequence(
      b.assign(checked,m.resolve(checkpoint,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(0)),
      b.assign(result,call(commit,b.read(v=>{const result=v.get(checked);if(result.kind==='cancel')throw Error('Canceled resource transition');return result.value;}))),b.return(result),
    );});
  }
  const healBody=through(beforeHeal,m.atom({input:resourceAmountSchema,output:amount,reads:[health],writes:[health],emits:[healed],run(r,input){
    const before=r.component(input.entity,health),after=Math.min(before.maxHp,before.hp+input.amount);
    return{writes:[{entity:input.entity,component:health,value:{...before,hp:after}}],events:[{event:healed,payload:{...input,before:before.hp,after,maxHp:before.maxHp}}],result:after-before.hp};
  }}));
  const heal=defineEffect<ResourceAmount,number>(b=>{const result=b.local<number>();return sequence(b.assign(result,call(healBody,b.input)),b.return(result));});
  const commitLoss=m.atom({input:hpLossSchema,output:z.object({entity:entityId,amount,lost:amount}),reads:[health],writes:[health],emits:[hpLost],run(r,input){
    const before=r.component(input.entity,health),after=Math.max(0,before.hp-input.amount);
    return{writes:input.amount>0?[{entity:input.entity,component:health,value:{...before,hp:after}}]:[],events:input.amount>0?[{event:hpLost,payload:{...input,before:before.hp,after,maxHp:before.maxHp}}]:[],result:{entity:input.entity,amount:input.amount,lost:before.hp-after}};
  }});
  const announceDeath=m.atom({input:entityId,output:z.undefined(),reads:[],writes:[],emits:[wouldDie],run(_r,entity){return{writes:[],events:[{event:wouldDie,payload:{entity}}],result:undefined};}});
  const loseHpDetailed=defineEffect<HpLoss,HpLossReceipt>(b=>{const checked=b.local<ReplacementResult<HpLoss>>(),result=b.local<HpLossReceipt>();return sequence(
    b.assign(checked,m.resolve(beforeHpLoss,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return({entity:b.read(v=>v.input.entity),amount:0,lost:0})),
    b.assign(result,call(commitLoss,b.read(v=>{const resolved=v.get(checked);if(resolved.kind==='cancel')throw Error('Canceled HP loss');return resolved.value;}))),
    when(b.read(v=>v.get(result).lost>0&&v.query(vitality,v.get(result).entity).hp===0),call(announceDeath,b.read(v=>v.get(result).entity))),b.return(result),
  );});
  const loseHp=defineEffect<HpLoss,number>(b=>{const result=b.local<HpLossReceipt>();return sequence(b.assign(result,call(loseHpDetailed,b.input)),b.return(b.read(v=>v.get(result).lost)));});
  const gainBlock=through(beforeBlockGain,m.atom({input:resourceAmountSchema,output:amount,reads:[block],writes:[block],emits:[blockGained],run(r,input){
    const before=r.component(input.entity,block),after=before+input.amount;
    return{writes:input.amount>0?[{entity:input.entity,component:block,value:after}]:[],events:input.amount>0?[{event:blockGained,payload:{...input,before,after}}]:[],result:input.amount};
  }}));
  const consumeBlock=m.atom({input:resourceAmountSchema,output:amount,reads:[block],writes:[block],emits:[changed],run(r,input){
    const before=r.component(input.entity,block),taken=Math.min(before,input.amount);return{writes:[{entity:input.entity,component:block,value:before-taken}],events:[{event:changed,payload:{entity:input.entity,resource:'block' as const,before,after:before-taken}}],result:taken};
  }});
  const gainEnergy=m.atom({input:resourceAmountSchema,output:amount,reads:[energy],writes:[energy],emits:[energyGained],run(r,input){
    const before=r.component(input.entity,energy),after=before+input.amount;return{writes:[{entity:input.entity,component:energy,value:after}],events:[{event:energyGained,payload:{...input,before,after}}],result:input.amount};
  }});
  const useEnergy=m.atom({input:resourceAmountSchema,output:amount,reads:[energy],writes:[energy],emits:[changed],run(r,input){
    const before=r.component(input.entity,energy);if(input.amount>before)throw Error('Insufficient energy');return{writes:[{entity:input.entity,component:energy,value:before-input.amount}],events:[{event:changed,payload:{entity:input.entity,resource:'energy' as const,before,after:before-input.amount}}],result:input.amount};
  }});
  const rechargeEnergy=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[energy],writes:[energy],emits:[changed],run(r,input){const before=r.component(input.entity,energy);return{writes:[{entity:input.entity,component:energy,value:input.amount}],events:[{event:changed,payload:{entity:input.entity,resource:'energy' as const,before,after:input.amount}}],result:undefined};}});
  const gainGold=through(beforeGoldGain,m.atom({input:resourceAmountSchema,output:amount,reads:[gold],writes:[gold],emits:[goldGained],run(r,input){
    const before=r.component(input.entity,gold),after=((before+input.amount)<<16)>>16;
    return{writes:[{entity:input.entity,component:gold,value:after}],events:[{event:goldGained,payload:{...input,before,after}}],result:input.amount};
  }}));
  const increaseMaxHp=m.atom({input:resourceAmountSchema,output:amount,reads:[health],writes:[health],emits:[changed],run(r,input){
    const before=r.component(input.entity,health),after=before.maxHp+input.amount;return{writes:[{entity:input.entity,component:health,value:{...before,maxHp:after}}],events:[{event:changed,payload:{entity:input.entity,resource:'maxHp' as const,before:before.maxHp,after}}],result:input.amount};
  }});
  const raiseMaxHp=defineEffect<ResourceAmount,void>(b=>sequence(call(increaseMaxHp,b.input),call(heal,b.input)));
  const loseMaxHp=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[health],writes:[health],emits:[changed],run(r,i){const s=r.component(i.entity,health),maxHp=s.maxHp-i.amount,hp=Math.min(s.hp,maxHp);return{writes:[{entity:i.entity,component:health,value:{maxHp,hp}}],events:[{event:changed,payload:{entity:i.entity,resource:'maxHp' as const,before:s.maxHp,after:maxHp}},{event:changed,payload:{entity:i.entity,resource:'hp' as const,before:s.hp,after:hp}}],result:undefined};}});
  const spendGold=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[gold],writes:[gold],emits:[changed],run(r,i){const before=r.component(i.entity,gold),after=Math.max(0,before-i.amount);return{writes:[{entity:i.entity,component:gold,value:after}],events:[{event:changed,payload:{entity:i.entity,resource:'gold' as const,before,after}}],result:undefined};}});
  const setHealth=m.atom({input:z.object({entity:entityId,hp:z.int32().nonnegative(),maxHp:z.int32().positive()}),output:z.undefined(),reads:[health],writes:[health],emits:[changed],run(r,i){if(i.hp>i.maxHp)throw Error('Health exceeds maximum');const before=r.component(i.entity,health);return{writes:[{entity:i.entity,component:health,value:{hp:i.hp,maxHp:i.maxHp}}],events:[{event:changed,payload:{entity:i.entity,resource:'hp' as const,before:before.hp,after:i.hp}},{event:changed,payload:{entity:i.entity,resource:'maxHp' as const,before:before.maxHp,after:i.maxHp}}],result:undefined};}});
  const limitHp=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[health],writes:[health],emits:[changed],run(r,i){const s=r.component(i.entity,health),hp=Math.min(s.hp,i.amount);return{writes:[{entity:i.entity,component:health,value:{...s,hp}}],events:[{event:changed,payload:{entity:i.entity,resource:'hp' as const,before:s.hp,after:hp}}],result:undefined};}});
  return{exports:{seizeGold,escrowedGold,changed:describeProgram(changed.public,'资源值更新'),actor,current,vitality,defense,stamina,wealth,side,heal,loseHp,loseHpDetailed,gainBlock,consumeBlock,gainEnergy,useEnergy,rechargeEnergy,gainGold,spendGold,setHealth,limitHp,increaseMaxHp,raiseMaxHp,loseMaxHp,stages,
    beforeHeal:describeProgram(beforeHeal.public,'治疗提交前'),beforeHpLoss:describeProgram(beforeHpLoss.public,'生命损失提交前'),beforeBlockGain:describeProgram(beforeBlockGain.public,'获得格挡提交前'),beforeGoldGain:describeProgram(beforeGoldGain.public,'获得金币提交前'),
    healed:describeProgram(healed.public,'治疗提交后'),hpLost:describeProgram(hpLost.public,'正数生命损失请求提交后'),wouldDie:describeProgram(wouldDie.public,'实际失去生命并降至零生命后'),blockGained:describeProgram(blockGained.public,'正数格挡获得提交后'),energyGained:describeProgram(energyGained.public,'能量获得提交后'),goldGained:describeProgram(goldGained.public,'金币获得提交后')}};
}});
