import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import type {CardDefinition} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {resources} from '../src/rules/resources.ts';
import {battles} from '../src/rules/battles.ts';
import {powers} from '../src/rules/powers.ts';
import {random} from '../src/rules/random.ts';
import {combatScope} from '../src/rules/combat-actions.ts';
import {resourceRelics} from '../src/content/resource-relics.ts';
import {relicId,type RelicId} from '../src/identifiers.ts';
import {resourceSetupSchema} from '../src/rules/resources.schemas.ts';
import type {ResourceSetup,ResourceAmount} from '../src/rules/resources.types.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineEffect,defineEntity,sequence,call,query,spawnEntity}=rules;
const actor=defineEntity(resources.exports.actor,{side:0}),enemy=defineEntity(resources.exports.actor,{side:1}),registry=defineEntity(powers.exports.registryKind,undefined),stream=defineEntity(random.exports.stream,undefined),battle=defineEntity(battles.exports.kind,undefined);
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
type Step={kind:'heal'|'gainBlock'|'consumeBlock'|'gainEnergy'|'useEnergy'|'gainGold'|'raiseMaxHp';amount:number}|{kind:'loseHp';amount:number;selfDamage:boolean};
function fixture(steps:readonly Step[],ownedRelics:readonly (typeof resourceRelics.exports.MagicFlower)[]=[]){
  const entry=defineEffect<ResourceSetup,ResourceSetup[]>(b=>{
    const entity=b.local<number>(),history=b.local<ResourceSetup[]>(),scope=b.local<number>(),target=b.local<number>(),powerRegistry=b.local<number>(),rng=b.local<number>();
    return sequence(b.assign(entity,spawnEntity({definition:actor,owner:null,scope:0,setup:b.input})),
      ...ownedRelics.map(definition=>spawnEntity({definition,owner:entity,scope:0})),
      b.assign(scope,ruleModules.openScope(combatScope,0)),b.assign(target,spawnEntity({definition:enemy,owner:null,scope,setup:{hp:9999,maxHp:9999,block:0,energy:0,gold:0}})),b.assign(powerRegistry,spawnEntity({definition:registry,owner:entity,scope})),b.assign(rng,spawnEntity({definition:stream,owner:entity,scope,setup:0n})),spawnEntity({definition:battle,owner:entity,scope,setup:{actor:entity,registry:powerRegistry,enemies:[target],masters:[],bottled:[],shuffleRng:rng,cardRng:rng,drawPerTurn:0}}),
      b.assign(history,[query(resources.exports.current,entity)]),
      ...steps.flatMap(step=>{
        const action=step.kind==='loseHp'?call(resources.exports.loseHp,{entity,amount:step.amount,selfDamage:step.selfDamage})
          :step.kind==='raiseMaxHp'?call(resources.exports.raiseMaxHp,{entity,amount:step.amount}):call(resources.exports[step.kind],{entity,amount:step.amount});
        return [action,
          b.assign(history,b.read(v=>[...v.get(history),v.get(query(resources.exports.current,v.get(entity)))]))];
      }),b.return(history),
    );
  });
  return linkRules({id:'sts/resource-fixture-1',schemas:{setup:resourceSetupSchema,result:z.array(resourceSetupSchema),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[resources,resourceRelics,random]});
}
async function execute<R>(definition:CardDefinition<any,ResourceSetup,any,R>,setup:ResourceSetup,controlled:boolean){
  const loaded=unwrap(await createCardLoader({controlled}).load(definition)),instance=unwrap(await loaded.core.start(setup));
  try{const result=unwrap(await instance.inspect());assert.equal(result.kind,'done');if(result.kind!=='done')throw Error(JSON.stringify(result));return result.result;}
  finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
}

test('typed resource atoms agree with pinned C++ Player in both real Instance modes',async()=>{
  const reference=await ReferenceClient.create();
  try{
    const active=await reference.call({op:'start',seed:'130'});
    const cases:{setup:ResourceSetup;steps:Step[]}[]=[
      {setup:{hp:36,maxHp:80,block:0,energy:3,gold:99},steps:[
        {kind:'gainBlock',amount:5},{kind:'gainBlock',amount:0},{kind:'consumeBlock',amount:3},{kind:'consumeBlock',amount:2},
        {kind:'loseHp',amount:7,selfDamage:true},{kind:'heal',amount:6},{kind:'heal',amount:200},
        {kind:'gainEnergy',amount:2},{kind:'useEnergy',amount:5},{kind:'gainGold',amount:18},{kind:'raiseMaxHp',amount:7},
      ]},
      {setup:{hp:1,maxHp:1,block:17,energy:0,gold:32760},steps:[
        {kind:'gainGold',amount:10},{kind:'consumeBlock',amount:17},{kind:'gainEnergy',amount:0},{kind:'useEnergy',amount:0},
        {kind:'raiseMaxHp',amount:9},{kind:'loseHp',amount:10,selfDamage:false},
      ]},
    ];
    // Generated cases vary resource magnitudes independently of the implementation under test.
    for(let n=1;n<=24;n++)cases.push({setup:{hp:n,maxHp:n+17,block:n+5,energy:n,gold:99},steps:[
      {kind:'consumeBlock',amount:n+5},{kind:'loseHp',amount:1,selfDamage:n%2===0},{kind:'heal',amount:n+10},
      {kind:'gainBlock',amount:2*n},{kind:'useEnergy',amount:n},{kind:'gainEnergy',amount:7},{kind:'raiseMaxHp',amount:3},{kind:'gainGold',amount:n*2},
    ]});
    for(const [index,c] of cases.entries()){
      const expected=await reference.call({op:'resource-case',...c}),definition=fixture(c.steps);
      for(const controlled of [false,true])assertSameState(expected,await execute(definition,c.setup,controlled),`resources case=${index} controlled=${controlled}`);
    }
    assertSameState(active,await reference.call({op:'inspect'}),'resource scenarios leave normal run untouched');
  }finally{await reference.close();}
});

test('resource checkpoint extensions compose without resource-module content branches',async()=>{
  const {defineQuery,replace,on,install,when}=rules;
  const extension=rules.defineRules({requires:[resources],build(){
    const doubled=defineEffect<rules.ReplacementContext<ResourceAmount>,rules.ReplacementResult<ResourceAmount>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:v.input.value.amount*2}))}));
    const applicable=defineQuery({input:z.any(),output:z.boolean(),base:(_r,c)=>c.value.entity===c.owner});
    const healAfterBlock=defineEffect<rules.ReactionContext<{entity:number;amount:number;before:number;after:number}>,void>(b=>
      when(b.read(v=>v.input.event.entity===v.input.owner),call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:3})));
    return{exports:{double:replace(resources.exports.beforeHeal,{condition:applicable,effect:doubled}),healAfterBlock:on(resources.exports.blockGained,{effect:healAfterBlock})}};
  }});
  const entry=defineEffect<ResourceSetup,ResourceSetup>(b=>{const entity=b.local<number>();return sequence(
    b.assign(entity,spawnEntity({definition:actor,owner:null,scope:0,setup:b.input})),
    install({source:entity,owner:entity,ability:extension.exports.double,environment:{},lifetime:0}),
    install({source:entity,owner:entity,ability:extension.exports.healAfterBlock,environment:{},lifetime:0}),
    call(resources.exports.gainBlock,{entity,amount:5}),b.return(query(resources.exports.current,entity)),
  );});
  const definition=linkRules({id:'sts/resource-extension-1',schemas:{setup:resourceSetupSchema,result:resourceSetupSchema,ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[resources,extension]});
  for(const controlled of [false,true])assert.deepEqual(await execute(definition,{hp:30,maxHp:80,block:0,energy:3,gold:99},controlled),{hp:36,maxHp:80,block:5,energy:3,gold:99});
});

test('five resource relics and their interactions use composed hooks and match C++ in both modes',async()=>{
  const definitions=resourceRelics.exports;
  const cases:{definitions:(typeof definitions.MagicFlower)[];ids:RelicId[]}[]=[
    {definitions:[definitions.MagicFlower],ids:['MAGIC_FLOWER']},{definitions:[definitions.MarkOfTheBloom],ids:['MARK_OF_THE_BLOOM']},
    {definitions:[definitions.Ectoplasm,definitions.BloodyIdol],ids:['ECTOPLASM','BLOODY_IDOL']},
    {definitions:[definitions.BloodyIdol,definitions.MagicFlower],ids:['BLOODY_IDOL','MAGIC_FLOWER']},
    {definitions:[definitions.MagicFlower,definitions.MarkOfTheBloom,definitions.BloodyIdol],ids:['MAGIC_FLOWER','MARK_OF_THE_BLOOM','BLOODY_IDOL']},
    {definitions:[definitions.TungstenRod,definitions.MagicFlower,definitions.BloodyIdol],ids:['TUNGSTEN_ROD','MAGIC_FLOWER','BLOODY_IDOL']},
  ];
  const setup={hp:20,maxHp:80,block:0,energy:3,gold:99};
  const steps:Step[]=[{kind:'heal',amount:5},{kind:'gainGold',amount:12},{kind:'loseHp',amount:1,selfDamage:true},
    {kind:'loseHp',amount:7,selfDamage:false},{kind:'raiseMaxHp',amount:7},{kind:'heal',amount:100}];
  const reference=await ReferenceClient.create();
  try{
    for(const [index,c] of cases.entries()){
      const expected=await reference.call({op:'resource-case',setup,steps,relics:c.ids.map(id=>relicId[id])}),definition=fixture(steps,c.definitions);
      for(const controlled of [false,true])assertSameState(expected,await execute(definition,setup,controlled),`resource relics=${index} controlled=${controlled}`);
    }
  }finally{await reference.close();}
});

test('redirected HP loss reports death for the committed target and permits its composed recovery hook',async()=>{
  const extension=rules.defineRules({requires:[resources],build(){
    const redirect=rules.replace(resources.exports.beforeHpLoss,{effect:defineEffect<rules.ReplacementContext<{entity:number;amount:number;selfDamage:boolean},{target:number}>,rules.ReplacementResult<{entity:number;amount:number;selfDamage:boolean}>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,entity:v.input.environment.target}))}))});
    const recover=rules.on(resources.exports.wouldDie,{effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.event.entity),amount:10}))});
    return{exports:{redirect,recover}};
  }});
  const entry=defineEffect<ResourceSetup,unknown>(b=>{const original=b.local<number>(),target=b.local<number>(),lost=b.local<number>();return sequence(
    b.assign(original,spawnEntity({definition:actor,owner:null,scope:0,setup:b.input})),
    b.assign(target,spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:3,maxHp:80,block:0,energy:0,gold:0}})),
    rules.install({source:original,owner:original,ability:extension.exports.redirect,environment:{target},lifetime:0}),
    rules.install({source:target,owner:target,ability:extension.exports.recover,environment:{},lifetime:0}),
    b.assign(lost,call(resources.exports.loseHp,{entity:original,amount:7,selfDamage:false})),
    b.return({lost,original:query(resources.exports.current,original),target:query(resources.exports.current,target)}),
  );});
  const definition=linkRules({id:'sts/resource-redirect-1',schemas:{setup:resourceSetupSchema,result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[extension]});
  const setup={hp:20,maxHp:80,block:0,energy:3,gold:99};
  for(const controlled of [false,true])assert.deepEqual(await execute(definition,setup,controlled),{lost:3,original:setup,target:{hp:10,maxHp:80,block:0,energy:0,gold:0}});
});
