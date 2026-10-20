import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {damage} from '../src/rules/damage.ts';
import {powers} from '../src/rules/powers.ts';
import {resources} from '../src/rules/resources.ts';
import {defensePowers} from '../src/content/defense-powers.ts';
import {resourceRelics} from '../src/content/resource-relics.ts';
import {damageRelics} from '../src/content/damage-relics.ts';
import {PS,MS} from '../src/combat-identifiers.ts';
import {relicId,type RelicId} from '../src/identifiers.ts';
import type {HpLost} from '../src/rules/resources.types.ts';
import type {HitResult} from '../src/rules/damage.types.ts';
import type {PowerDefinition} from '../src/rules/powers.types.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineComponent,defineQuery,defineEntity,defineEffect,sequence,spawnEntity,call,query,on,install}=rules;
const playerDef=defineEntity(resources.exports.actor,{side:0}),enemyDef=defineEntity(resources.exports.actor,{side:1}),registryDef=defineEntity(powers.exports.registryKind,undefined);
const stats=defineRules({requires:[resources],build(m){
  const count=m.own(defineComponent({schema:z.number(),initial:()=>0}));
  const add=m.atom({input:z.number(),output:z.undefined(),reads:[count],writes:[count],emits:[],run(r,entity){return{writes:[{entity,component:count,value:r.component(entity,count)+1}],events:[],result:undefined};}});
  const eligible=defineQuery({input:z.custom<rules.ReactionContext<HpLost,{stats:number}>>(),output:z.boolean(),base:(_r,c)=>c.event.entity===c.owner});
  const ability=on(resources.exports.hpLost,{condition:eligible,order:1000,effect:defineEffect<rules.ReactionContext<HpLost,{stats:number}>,void>(b=>call(add,b.read(v=>v.input.environment.stats)))});
  const kind=m.kind({config:z.undefined(),setup:z.number(),components:[count],initialize:defineEffect<rules.EntityLifecycle<number>,void>(b=>install({source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup),ability,environment:{stats:b.read(v=>v.input.entity)},lifetime:b.read(v=>v.input.scope)}))});
  const current=defineQuery({input:z.number(),output:z.number(),reads:[count],base:(r,entity)=>r.component(entity,count)});
  return{exports:{kind,current}};
}});
const tracker=defineEntity(stats.exports.kind,undefined);
const views=defineRules({requires:[resources,powers,stats,defensePowers],build(){return{exports:{view:defineQuery({
  input:z.object({player:z.number(),enemy:z.number(),registry:z.number(),stats:z.number(),lastAttack:z.number()}),output:z.unknown(),dependencies:[resources.exports.current,powers.exports.current,powers.exports.find,powers.exports.level,stats.exports.current],
  base(r,input){
    const player=r.query(resources.exports.current,input.player),enemy=r.query(resources.exports.current,input.enemy);let bits=0n,justApplied=0n;const statuses:number[][]=[];
    for(const [id,definition] of [[PS.INTANGIBLE,defensePowers.exports.PlayerIntangible],[PS.BUFFER,defensePowers.exports.Buffer]] as const){
      const found=r.query(powers.exports.find,{registry:input.registry,actor:input.player,definition});if(found===null)continue;
      const state=r.query(powers.exports.current,found);statuses.push([id,state.level]);if(state.active)bits|=1n<<BigInt(id);if(state.justApplied)justApplied|=1n<<BigInt(id);
    }
    const intangible=r.query(powers.exports.find,{registry:input.registry,actor:input.enemy,definition:defensePowers.exports.EnemyIntangible}),active=intangible===null?null:r.query(powers.exports.current,intangible);
    return{player:{hp:player.hp,block:player.block,timesDamaged:r.query(stats.exports.current,input.stats),lastAttack:input.lastAttack,statuses,bits:bits.toString(),justApplied:Number(BigInt.asUintN(32,justApplied))},
      enemy:{hp:enemy.hp,block:enemy.block,intangible:intangible===null?0:r.query(powers.exports.level,intangible),bits:active?.active?(1n<<BigInt(MS.INTANGIBLE)).toString():'0'}};
  },
})}};}});
type Step={target:0|1;amount:number;attack?:boolean;calculate?:boolean;direct?:boolean;selfDamage?:boolean};
type Scenario={playerBlock?:number;enemyBlock?:number;enemyHp?:number;buffer?:number;playerIntangible?:number;enemyIntangible?:number;relics?:RelicId[];steps:Step[]};
const relicDefinitions={TUNGSTEN_ROD:resourceRelics.exports.TungstenRod,TORII:damageRelics.exports.Torii,THE_BOOT:damageRelics.exports.TheBoot};
function fixture(s:Scenario){
  const entry=defineEffect<void,unknown[]>(b=>{
    const player=b.local<number>(),enemy=b.local<number>(),registry=b.local<number>(),tracking=b.local<number>(),last=b.local<number>(),history=b.local<unknown[]>(),catalog=b.local<readonly PowerDefinition[]>(),receipt=b.local<HitResult>();
    const ids={player,enemy,registry,stats:tracking,lastAttack:last};
    return sequence(b.assign(catalog,Object.values(defensePowers.exports)),b.assign(player,spawnEntity({definition:playerDef,owner:null,scope:0,setup:{hp:80,maxHp:80,block:s.playerBlock??0,energy:0,gold:0}})),
      b.assign(enemy,spawnEntity({definition:enemyDef,owner:null,scope:0,setup:{hp:s.enemyHp??100,maxHp:s.enemyHp??100,block:s.enemyBlock??0,energy:0,gold:0}})),
      b.assign(registry,spawnEntity({definition:registryDef,owner:player,scope:0})),b.assign(tracking,spawnEntity({definition:tracker,owner:player,scope:0,setup:player})),b.assign(last,0),
      ...[s.buffer?call(powers.exports.apply,{registry,actor:player,definition:defensePowers.exports.Buffer,amount:s.buffer,source:null,debuff:false,scope:0}):null,
        s.playerIntangible?call(powers.exports.apply,{registry,actor:player,definition:defensePowers.exports.PlayerIntangible,amount:s.playerIntangible,source:null,debuff:false,scope:0}):null,
        s.enemyIntangible?call(powers.exports.apply,{registry,actor:enemy,definition:defensePowers.exports.EnemyIntangible,amount:s.enemyIntangible,source:null,debuff:false,scope:0}):null].filter((v):v is rules.Command<number|null>=>v!==null),
      ...(s.relics??[]).map(id=>{if(!(id in relicDefinitions))throw Error('Unsupported test relic');return spawnEntity({definition:relicDefinitions[id as keyof typeof relicDefinitions],owner:player,scope:0});}),
      b.assign(history,[query(views.exports.view,ids)]),...s.steps.flatMap(step=>{
        const target=step.target===0?player:enemy,source=step.target===0?enemy:player;
        const action=step.direct?call(resources.exports.loseHp,{entity:player,amount:step.amount,selfDamage:step.selfDamage??false})
          :b.assign(receipt,step.calculate?call(damage.exports.attack,{battle:tracking,source,target,base:step.amount,card:null}):call(damage.exports.hit,{battle:tracking,source,target,amount:step.amount,attack:step.attack??false,selfDamage:step.selfDamage??false}));
        return[action,...(!step.direct&&step.target===0&&step.attack?[b.assign(last,b.read(v=>v.get(receipt).unblocked))]:[]),
          b.assign(history,b.read(v=>[...v.get(history),v.get(query(views.exports.view,{player:v.get(player),enemy:v.get(enemy),registry:v.get(registry),stats:v.get(tracking),lastAttack:v.get(last)}))]))];
      }),b.return(history),
    );
  });
  return linkRules({id:'sts/damage-fixture-1',schemas:{setup:z.undefined(),result:z.array(z.unknown()),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[views,resourceRelics,damageRelics,damage]});
}
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('block, raw/calculated attack, direct HP loss, Buffer, Intangible, Torii, Rod and Boot compose exactly as C++',async()=>{
  const scenarios:Scenario[]=[
    {playerBlock:5,enemyBlock:4,steps:[{target:1,amount:6,attack:true},{target:0,amount:8,attack:true},{target:0,amount:5},{target:0,amount:3,direct:true,selfDamage:true},{target:1,amount:7},{target:1,amount:300}]},
    {relics:['TORII','TUNGSTEN_ROD'],steps:[{target:0,amount:5,attack:true},{target:0,amount:5},{target:0,amount:1,direct:true},{target:0,amount:6,attack:true},{target:0,amount:2,attack:true}]},
    {playerBlock:1,buffer:1,playerIntangible:1,steps:[{target:0,amount:50,attack:true,calculate:true},{target:0,amount:50,attack:true},{target:0,amount:0,direct:true},{target:0,amount:9},{target:0,amount:50,attack:true},{target:0,amount:7,direct:true}]},
    {enemyBlock:2,enemyHp:50,enemyIntangible:1,relics:['THE_BOOT'],steps:[{target:1,amount:9,attack:true},{target:1,amount:9,attack:true},{target:1,amount:9,attack:true},{target:1,amount:9},{target:1,amount:0,attack:true,calculate:true}]},
    {buffer:2,relics:['TUNGSTEN_ROD'],steps:[{target:0,amount:1,attack:true},{target:0,amount:1},{target:0,amount:1,attack:true},{target:0,amount:1,direct:true},{target:0,amount:3,attack:true}]},
  ];
  const reference=await ReferenceClient.create();
  try{for(const [index,scenario] of scenarios.entries()){
    const expected=await reference.call({op:'damage-case',...scenario,relics:(scenario.relics??[]).map(id=>relicId[id])}),d=fixture(scenario);
    for(const controlled of [false,true]){
      const loaded=unwrap(await createCardLoader({controlled}).load(d)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected result');assertSameState(expected,stop.result,`damage=${index} controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
    }
  }}finally{await reference.close();}
});
