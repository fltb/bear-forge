import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
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
  const order={phases:[{phase:restriction,before:[transform]},{phase:transform}],default:transform};
  const health=m.own(defineComponent({schema:healthSchema,initial:()=>({hp:1,maxHp:1})}));
  const block=m.own(defineComponent({schema:amount,initial:()=>0}));
  const energy=m.own(defineComponent({schema:amount,initial:()=>0}));
  const gold=m.own(defineComponent({schema:z.int32().min(-32768).max(32767),initial:()=>0}));
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
  const actor=m.kind({config:z.object({side:z.union([z.literal(0),z.literal(1)])}).strict(),setup:resourceSetupSchema,components:[health,block,energy,gold],
    initialize:defineEffect<EntityLifecycle<ResourceSetup>,void>(b=>call(initialize,b.read(v=>({...v.input.setup,entity:v.input.entity})))),
  });
  const current=defineQuery({input:entityId,output:resourceSetupSchema,reads:[health,block,energy,gold],base:(r,entity)=>({
    ...r.component(entity,health),block:r.component(entity,block),energy:r.component(entity,energy),gold:r.component(entity,gold),
  })});
  const side=defineQuery({input:entityId,output:z.union([z.literal(0),z.literal(1)]),kinds:[actor],base:(r,entity)=>r.configuration(entity,actor).side});

  // Every checkpoint is resolved by its owner. Each commit sees the latest data after any suspended replacement.
  function through<I>(checkpoint:Owned<Checkpoint<I,I>>,commit:Effect<I,number>):Effect<I,number>{
    return defineEffect<I,number>(b=>{const checked=b.local<ReplacementResult<I>>(),result=b.local<number>();return sequence(
      b.assign(checked,m.resolve(checkpoint,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(0)),
      b.assign(result,call(commit,b.read(v=>{const result=v.get(checked);if(result.kind==='cancel')throw Error('Canceled resource transition');return result.value;}))),b.return(result),
    );});
  }
  const heal=through(beforeHeal,m.atom({input:resourceAmountSchema,output:amount,reads:[health],writes:[health],emits:[healed],run(r,input){
    const before=r.component(input.entity,health),after=Math.min(before.maxHp,before.hp+input.amount);
    return{writes:[{entity:input.entity,component:health,value:{...before,hp:after}}],events:[{event:healed,payload:{...input,before:before.hp,after,maxHp:before.maxHp}}],result:after-before.hp};
  }}));
  const commitLoss=m.atom({input:hpLossSchema,output:z.object({entity:entityId,amount,lost:amount}),reads:[health],writes:[health],emits:[hpLost],run(r,input){
    const before=r.component(input.entity,health),after=Math.max(0,before.hp-input.amount);
    return{writes:input.amount>0?[{entity:input.entity,component:health,value:{...before,hp:after}}]:[],events:input.amount>0?[{event:hpLost,payload:{...input,before:before.hp,after,maxHp:before.maxHp}}]:[],result:{entity:input.entity,amount:input.amount,lost:before.hp-after}};
  }});
  const announceDeath=m.atom({input:entityId,output:z.undefined(),reads:[],writes:[],emits:[wouldDie],run(_r,entity){return{writes:[],events:[{event:wouldDie,payload:{entity}}],result:undefined};}});
  const loseHpDetailed=defineEffect<HpLoss,HpLossReceipt>(b=>{const checked=b.local<ReplacementResult<HpLoss>>(),result=b.local<HpLossReceipt>();return sequence(
    b.assign(checked,m.resolve(beforeHpLoss,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return({entity:b.read(v=>v.input.entity),amount:0,lost:0})),
    b.assign(result,call(commitLoss,b.read(v=>{const resolved=v.get(checked);if(resolved.kind==='cancel')throw Error('Canceled HP loss');return resolved.value;}))),
    when(b.read(v=>v.get(result).lost>0&&v.get(query(current,v.get(result).entity)).hp===0),call(announceDeath,b.read(v=>v.get(result).entity))),b.return(result),
  );});
  const loseHp=defineEffect<HpLoss,number>(b=>{const result=b.local<HpLossReceipt>();return sequence(b.assign(result,call(loseHpDetailed,b.input)),b.return(b.read(v=>v.get(result).lost)));});
  const gainBlock=through(beforeBlockGain,m.atom({input:resourceAmountSchema,output:amount,reads:[block],writes:[block],emits:[blockGained],run(r,input){
    const before=r.component(input.entity,block),after=before+input.amount;
    return{writes:input.amount>0?[{entity:input.entity,component:block,value:after}]:[],events:input.amount>0?[{event:blockGained,payload:{...input,before,after}}]:[],result:input.amount};
  }}));
  const consumeBlock=m.atom({input:resourceAmountSchema,output:amount,reads:[block],writes:[block],emits:[],run(r,input){
    const before=r.component(input.entity,block),taken=Math.min(before,input.amount);return{writes:[{entity:input.entity,component:block,value:before-taken}],events:[],result:taken};
  }});
  const gainEnergy=m.atom({input:resourceAmountSchema,output:amount,reads:[energy],writes:[energy],emits:[energyGained],run(r,input){
    const before=r.component(input.entity,energy),after=before+input.amount;return{writes:[{entity:input.entity,component:energy,value:after}],events:[{event:energyGained,payload:{...input,before,after}}],result:input.amount};
  }});
  const useEnergy=m.atom({input:resourceAmountSchema,output:amount,reads:[energy],writes:[energy],emits:[],run(r,input){
    const before=r.component(input.entity,energy);if(input.amount>before)throw Error('Insufficient energy');return{writes:[{entity:input.entity,component:energy,value:before-input.amount}],events:[],result:input.amount};
  }});
  const rechargeEnergy=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[],writes:[energy],emits:[],run(_r,input){return{writes:[{entity:input.entity,component:energy,value:input.amount}],events:[],result:undefined};}});
  const gainGold=through(beforeGoldGain,m.atom({input:resourceAmountSchema,output:amount,reads:[gold],writes:[gold],emits:[goldGained],run(r,input){
    const before=r.component(input.entity,gold),after=((before+input.amount)<<16)>>16;
    return{writes:[{entity:input.entity,component:gold,value:after}],events:[{event:goldGained,payload:{...input,before,after}}],result:input.amount};
  }}));
  const increaseMaxHp=m.atom({input:resourceAmountSchema,output:amount,reads:[health],writes:[health],emits:[],run(r,input){
    const before=r.component(input.entity,health);return{writes:[{entity:input.entity,component:health,value:{...before,maxHp:before.maxHp+input.amount}}],events:[],result:input.amount};
  }});
  const raiseMaxHp=defineEffect<ResourceAmount,void>(b=>sequence(call(increaseMaxHp,b.input),call(heal,b.input)));
  const loseMaxHp=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[health],writes:[health],emits:[],run(r,i){const s=r.component(i.entity,health),maxHp=s.maxHp-i.amount;return{writes:[{entity:i.entity,component:health,value:{maxHp,hp:Math.min(s.hp,maxHp)}}],events:[],result:undefined};}});
  const spendGold=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[gold],writes:[gold],emits:[],run(r,i){return{writes:[{entity:i.entity,component:gold,value:Math.max(0,r.component(i.entity,gold)-i.amount)}],events:[],result:undefined};}});
  const setHealth=m.atom({input:z.object({entity:entityId,hp:z.int32().nonnegative(),maxHp:z.int32().positive()}),output:z.undefined(),reads:[],writes:[health],emits:[],run(_r,i){if(i.hp>i.maxHp)throw Error('Health exceeds maximum');return{writes:[{entity:i.entity,component:health,value:{hp:i.hp,maxHp:i.maxHp}}],events:[],result:undefined};}});
  const limitHp=m.atom({input:resourceAmountSchema,output:z.undefined(),reads:[health],writes:[health],emits:[],run(r,i){const s=r.component(i.entity,health);return{writes:[{entity:i.entity,component:health,value:{...s,hp:Math.min(s.hp,i.amount)}}],events:[],result:undefined};}});
  return{exports:{actor,current,side,heal,loseHp,loseHpDetailed,gainBlock,consumeBlock,gainEnergy,useEnergy,rechargeEnergy,gainGold,spendGold,setHealth,limitHp,increaseMaxHp,raiseMaxHp,loseMaxHp,stages,
    beforeHeal:beforeHeal.public,beforeHpLoss:beforeHpLoss.public,beforeBlockGain:beforeBlockGain.public,beforeGoldGain:beforeGoldGain.public,
    healed:healed.public,hpLost:hpLost.public,wouldDie:wouldDie.public,blockGained:blockGained.public,energyGained:energyGained.public,goldGained:goldGained.public}};
}});
