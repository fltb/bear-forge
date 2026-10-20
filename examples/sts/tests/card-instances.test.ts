import test from 'node:test';
import type {AdventureCatalog} from '../src/rules/adventures.types.ts';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {cardInstances,CardMode} from '../src/rules/card-instances.ts';
import type {CardConfig,CardUse,CardSetup} from '../src/rules/card-instances.types.ts';
import {combatCardSchema,cardEvaluationSchema,cardMutableSchema,cardChangeSchema} from '../src/rules/card-instances.schemas.ts';
import {cards} from '../src/cards.ts';
import {cardId} from '../src/identifiers.ts';
import {standardUpgrade,repeatedUpgrade,upgradeOnce,mutableCard} from '../src/content/card-utils.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineEffect,defineQuery,defineEntity,sequence,spawnEntity,call,query}=rules;
const noop=defineEffect<CardUse,void>(b=>b.return(undefined));
const names=Object.keys(cards) as (keyof typeof cards)[];
// Isolated instance fixtures supply no play behavior; these are never production card definitions.
const definitions=names.map(id=>{
  const metadata=cards[id],repeat=id==='SEARING_BLOW';
  return defineEntity(cardInstances.exports.kind,{id,metadata,use:noop,canUpgrade:repeat?defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>true}):upgradeOnce(metadata),
    upgrade:repeat?repeatedUpgrade(metadata):standardUpgrade(metadata),...(repeat?{upgradeCount:defineQuery({input:cardEvaluationSchema,output:z.int32(),base:(_r,c)=>c.state.specialData})}:{})});
});
const snapshotSchema=z.object({card:combatCardSchema,canUpgrade:z.boolean(),upgradeCount:z.int32()});
const views=defineRules({requires:[cardInstances],build(){return{exports:{snapshot:defineQuery({input:z.number(),output:snapshotSchema,dependencies:[cardInstances.exports.combatView,cardInstances.exports.canUpgrade,cardInstances.exports.upgradeCount],base:(r,entity)=>({
  card:r.query(cardInstances.exports.combatView,entity),canUpgrade:r.query(cardInstances.exports.canUpgrade,entity),upgradeCount:r.query(cardInstances.exports.upgradeCount,entity),
})})}};}});
type Step={kind:'setCostForCombat'|'setCostForTurn'|'overrideTurnCost'|'upgradeBaseCost'|'updateCost'|'setSpecialData';amount:number}
  |{kind:'upgrade'}|{kind:'resetTurn'}|{kind:'setFlags';freeToPlayOnce:boolean;retain:boolean};
const steps:Step[]=[{kind:'updateCost',amount:-1},{kind:'setCostForTurn',amount:0},{kind:'upgradeBaseCost',amount:2},{kind:'upgrade'},
  {kind:'upgrade'},{kind:'setFlags',freeToPlayOnce:true,retain:true},{kind:'overrideTurnCost',amount:-9},{kind:'resetTurn'},
  {kind:'setCostForTurn',amount:4},{kind:'setCostForCombat',amount:5},{kind:'updateCost',amount:-2},{kind:'setCostForTurn',amount:3},
  {kind:'setSpecialData',amount:32767},{kind:'upgrade'},{kind:'setCostForCombat',amount:127},{kind:'updateCost',amount:1},
  {kind:'resetTurn'},{kind:'setFlags',freeToPlayOnce:false,retain:false}];
const setupSchema=z.object({index:z.number().int().nonnegative().max(names.length-1),upgraded:z.boolean()});
const entry=defineEffect<z.infer<typeof setupSchema>,z.infer<typeof snapshotSchema>[]>(b=>{
  const catalog=b.local<readonly rules.EntityDefinition<CardConfig,CardSetup>[]>(),entity=b.local<number>(),history=b.local<z.infer<typeof snapshotSchema>[]>();
  return sequence(b.assign(catalog,definitions),b.assign(entity,spawnEntity({kind:cardInstances.exports.kind,definition:b.read(v=>v.get(catalog)[v.input.index]!),owner:null,scope:0,
    setup:{mode:CardMode.Combat,master:null,uniqueId:7,specialData:2,upgraded:b.read(v=>v.input.upgraded)}})),
    b.assign(history,[query(views.exports.snapshot,entity)]),...steps.flatMap(step=>{
      const effect=step.kind==='upgrade'?call(cardInstances.exports.upgrade,entity)
        :step.kind==='resetTurn'?call(cardInstances.exports.resetTurn,{entity})
        :step.kind==='setFlags'?call(cardInstances.exports.setFlags,{entity,freeToPlayOnce:step.freeToPlayOnce,retain:step.retain})
        :step.kind==='setSpecialData'?call(cardInstances.exports.setSpecialData,{entity,value:step.amount})
        :call(cardInstances.exports[step.kind],{entity,amount:step.amount});
      return[effect,b.assign(history,b.read(v=>[...v.get(history),v.get(query(views.exports.snapshot,v.get(entity)))]))];
    }),b.return(history),
  );
});
const definition=linkRules({id:'sts/card-instance-matrix-1',schemas:{setup:setupSchema,result:z.array(snapshotSchema),ports:{}},initialize:()=>({}),entry,definitions:[entry,noop],modules:[views]});
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('every admitted card variant preserves CardInstance fees, upgrades, flags and signed storage through both modes',async()=>{
  const reference=await ReferenceClient.create();
  try{
    const loaded=await Promise.all([false,true].map(async controlled=>unwrap(await createCardLoader({controlled}).load(definition))));
    for(const [index,id] of names.entries())for(const upgraded of [false,true]){
      const expected=await reference.call({op:'card-instance-case',id:cardId[id],upgraded,specialData:2,uniqueId:7,steps});
      for(const [mode,core] of loaded.entries()){
        const instance=unwrap(await core.core.start({index,upgraded}));
        try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected card result');assertSameState(expected,stop.result,`card=${id} upgraded=${upgraded} mode=${mode}`);}
        finally{await instance.close();if(core.capture)await core.capture.release(instance.id);}
      }
    }
  }finally{await reference.close();}
});

test('a combat copy shares its definition and master identity while resetting temporary fees and flags',async()=>{
  const masterDefinition=definitions[names.indexOf('BASH')]!;
  const entry=defineEffect<void,unknown>(b=>{const master=b.local<number>(),copy=b.local<number>();return sequence(
    b.assign(master,spawnEntity({definition:masterDefinition,owner:null,scope:0,setup:{mode:CardMode.Permanent,master:null,uniqueId:-1,upgraded:false,specialData:9}})),
    call(cardInstances.exports.upgrade,master),call(cardInstances.exports.setCostForCombat,{entity:master,amount:0}),call(cardInstances.exports.setFlags,{entity:master,freeToPlayOnce:true,retain:true}),
    b.assign(copy,cardInstances.exports.copyIntoCombat({master,uniqueId:12,owner:master,scope:0})),
    call(cardInstances.exports.updateCost,{entity:copy,amount:-1}),b.return({master:query(cardInstances.exports.current,master),copy:query(cardInstances.exports.current,copy)}),
  );});
  const d=linkRules({id:'sts/card-copy-1',schemas:{setup:z.undefined(),result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry,noop],modules:[cardInstances]});
  for(const controlled of [false,true]){
    const core=unwrap(await createCardLoader({controlled}).load(d)),instance=unwrap(await core.core.start(undefined)),stop=unwrap(await instance.inspect());
    assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error(JSON.stringify(stop));
    assert.deepEqual(stop.result,{master:{mode:0,master:null,uniqueId:-1,specialData:9,upgraded:true,cost:0,costForTurn:2,freeToPlayOnce:true,retain:true},
      copy:{mode:1,master:1,uniqueId:12,specialData:9,upgraded:true,cost:1,costForTurn:1,freeToPlayOnce:false,retain:false}});
    await instance.close();if(core.capture)await core.capture.release(instance.id);
  }
});

test('a custom card can combine private hooks and typed query policies for a two-step upgrade program',async()=>{
  const used=rules.defineComponent({schema:z.number().int().nonnegative(),initial:()=>0});
  const custom=defineRules({requires:[cardInstances],build(){
    const eligible=defineQuery({input:z.custom<rules.ReactionContext<z.infer<typeof cardChangeSchema>>>(),output:z.boolean(),base:(_r,c)=>c.event.entity===c.source});
    const track=rules.on(cardInstances.exports.upgraded,{condition:eligible,effect:defineEffect<rules.ReactionContext<unknown>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),used,n=>n+1))});
    const created=defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>rules.install({ability:track,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:{},lifetime:b.read(v=>v.input.scope)}));
    const canUpgrade=defineQuery({input:cardEvaluationSchema,output:z.boolean(),reads:[used],base:(r,input)=>r.component(input.entity,used)<2});
    const upgrade=defineQuery({input:cardEvaluationSchema,output:cardMutableSchema,reads:[used],base:(r,input)=>{
      const cost=input.state.cost+r.component(input.entity,used)+1;return{...mutableCard(input.state),upgraded:true,cost,costForTurn:cost};
    }});
    return{exports:{card:defineEntity(cardInstances.exports.kind,{id:'CUSTOM_TWO_STEP',metadata:cards.BASH,use:noop,canUpgrade,upgrade,created},{components:[used]})}};
  }});
  const entry=defineEffect<void,unknown>(b=>{const catalog=b.local<AdventureCatalog>(),entity=b.local<number>(),first=b.local<boolean>(),second=b.local<boolean>(),third=b.local<boolean>();return sequence(
    b.assign(catalog,{cards:[{id:'CUSTOM_TWO_STEP',definition:custom.exports.card}],relics:[]}),b.assign(entity,spawnEntity({kind:cardInstances.exports.kind,definition:b.read(v=>v.get(catalog).cards[0]!.definition),owner:null,scope:0,setup:{mode:CardMode.Combat,master:null,uniqueId:4,upgraded:false,specialData:0}})),
    b.assign(first,call(cardInstances.exports.upgrade,entity)),b.assign(second,call(cardInstances.exports.upgrade,entity)),b.assign(third,call(cardInstances.exports.upgrade,entity)),
    b.return({first,second,third,used:rules.readComponent(entity,used),card:query(cardInstances.exports.combatView,entity)}),
  );});
  const d=linkRules({id:'sts/custom-upgrade-1',schemas:{setup:z.undefined(),result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry,noop],modules:[custom]});
  for(const controlled of [false,true]){
    const loaded=unwrap(await createCardLoader({controlled}).load(d)),instance=unwrap(await loaded.core.start(undefined));
    try{const stop=unwrap(await instance.inspect());assert.deepEqual(stop.kind==='done'?stop.result:stop,{first:true,second:true,third:false,used:2,card:{id:'CUSTOM_TWO_STEP',uniqueId:4,specialData:0,cost:5,costForTurn:5,upgraded:true,freeToPlayOnce:false,retain:false}});}
    finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
  }
});
