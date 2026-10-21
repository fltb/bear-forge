import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {powers} from '../src/rules/powers.ts';
import {basicPowers} from "../src/content/powers/attributes.ts";
import {attributes} from '../src/rules/attributes.ts';
import {resources} from '../src/rules/resources.ts';
import {PS,MS} from '../src/combat-identifiers.ts';
import type {PowerDefinition,PowerState} from "../src/rules/powers.types.ts";
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineQuery,defineEntity,defineEffect,sequence,spawnEntity,call,query,when}=rules;
const p=basicPowers.exports;
const definitions=Object.values(p),playerDef=defineEntity(resources.exports.actor,{side:0}),enemyDef=defineEntity(resources.exports.actor,{side:1}),registryDef=defineEntity(powers.exports.registryKind,undefined);
const bases=[-3,0,1,5,6,8,17,16777217];
const playerBindings:{definition:PowerDefinition;id:number;field?:'strength'|'dexterity'|'focus'|'artifact'}[]=[
  {definition:p.Strength,id:PS.STRENGTH,field:'strength'},{definition:p.Dexterity,id:PS.DEXTERITY,field:'dexterity'},{definition:p.Focus,id:PS.FOCUS,field:'focus'},{definition:p.PlayerArtifact,id:PS.ARTIFACT,field:'artifact'},
  {definition:p.PlayerWeak,id:PS.WEAK},{definition:p.PlayerVulnerable,id:PS.VULNERABLE},{definition:p.Frail,id:PS.FRAIL},{definition:p.NoBlock,id:PS.NO_BLOCK},
];
const enemyBindings:{definition:PowerDefinition;id:number;field:'strength'|'weak'|'vulnerable'|'artifact'}[]=[
  {definition:p.Strength,id:MS.STRENGTH,field:'strength'},{definition:p.EnemyWeak,id:MS.WEAK,field:'weak'},{definition:p.EnemyVulnerable,id:MS.VULNERABLE,field:'vulnerable'},{definition:p.EnemyArtifact,id:MS.ARTIFACT,field:'artifact'},
];
const views=defineRules({requires:[basicPowers],build(){return{exports:{view:defineQuery({
  input:z.object({registry:z.number(),player:z.number(),enemy:z.number()}),output:z.unknown(),dependencies:[powers.exports.find,powers.exports.current,attributes.exports.attackAmount,attributes.exports.blockAmount],
  base(r,input){
    const lookup=(definition:PowerDefinition,actor:number):PowerState|null=>{const entity=r.query(powers.exports.find,{registry:input.registry,actor,definition});return entity===null?null:r.query(powers.exports.current,entity);};
    const player={strength:0,dexterity:0,focus:0,artifact:0,statusBits0:'0',statusBits1:0,justApplied:0,statuses:[] as number[][]};
    const enemy={strength:0,weak:0,vulnerable:0,artifact:0,statusBits:'0'};let bits=0n,enemyBits=0n,just=0n;
    for(const binding of playerBindings){const s=lookup(binding.definition,input.player);if(!s)continue;
      if(binding.field)player[binding.field]=s.level;else{player.statuses.push([binding.id,s.level]);if(s.active)bits|=1n<<BigInt(binding.id);}
      if(s.justApplied)just|=1n<<BigInt(binding.id);
    }
    player.statuses.sort((a,b)=>a[0]!-b[0]!);player.statusBits0=BigInt.asUintN(64,bits).toString();player.statusBits1=Number((bits>>64n)&0xffffffffn);player.justApplied=Number(BigInt.asUintN(32,just));
    for(const binding of enemyBindings){const s=lookup(binding.definition,input.enemy);if(!s)continue;enemy[binding.field]=s.level;
      if(binding.field!=='strength'&&s.active)enemyBits|=1n<<BigInt(binding.id);
      if(s.justApplied&&binding.id===MS.WEAK)enemyBits|=1n<<62n;if(s.justApplied&&binding.id===MS.VULNERABLE)enemyBits|=1n<<63n;
    }
    enemy.statusBits=enemyBits.toString();return{player,enemy,math:bases.map(base=>[base,
      r.query(attributes.exports.attackAmount,{source:input.player,target:input.enemy,base,card:null}),r.query(attributes.exports.attackAmount,{source:input.enemy,target:input.player,base,card:null}),r.query(attributes.exports.blockAmount,{actor:input.player,base})])};
  },
})}};}});
type Step={kind:'buff'|'debuff'|'decrement'|'remove'|'clear';target:0|1;definition:PowerDefinition;amount:number;source?:0|1|null};
const step=(kind:Step['kind'],target:0|1,definition:PowerDefinition,amount=0,source:Step['source']=null):Step=>({kind,target,definition,amount,source});
function fixture(steps:readonly Step[]){
  const entry=defineEffect<void,unknown[]>(b=>{
    const catalog=b.local<readonly PowerDefinition[]>(),player=b.local<number>(),enemy=b.local<number>(),registry=b.local<number>(),history=b.local<unknown[]>(),found=b.local<number|null>();
    const ids={registry,player,enemy};
    return sequence(b.assign(catalog,definitions),b.assign(player,spawnEntity({definition:playerDef,owner:null,scope:0,setup:{hp:80,maxHp:80,gold:0,energy:0,block:0}})),
      b.assign(enemy,spawnEntity({definition:enemyDef,owner:null,scope:0,setup:{hp:100,maxHp:100,gold:0,energy:0,block:0}})),b.assign(registry,spawnEntity({definition:registryDef,owner:player,scope:0})),b.assign(history,[query(views.exports.view,ids)]),
      ...steps.flatMap(s=>{
        const actor=s.target===0?player:enemy;
        const action=s.kind==='buff'||s.kind==='debuff'?call(powers.exports.apply,{registry,actor,definition:s.definition,amount:s.amount,source:s.source===0?player:s.source===1?enemy:null,debuff:s.kind==='debuff',scope:0})
          :sequence(b.assign(found,query(powers.exports.find,{registry,actor,definition:s.definition})),when(b.read(v=>v.get(found)!==null),s.kind==='decrement'?call(powers.exports.decrement,{entity:b.read(v=>v.get(found)!),amount:s.amount})
            :call(s.kind==='remove'?powers.exports.remove:powers.exports.clearJustApplied,b.read(v=>v.get(found)!))));
        return[action,b.assign(history,b.read(v=>[...v.get(history),v.get(query(views.exports.view,{registry:v.get(registry),player:v.get(player),enemy:v.get(enemy)}))]))];
      }),b.return(history),
    );
  });
  return linkRules({id:'sts/power-fixture-1',schemas:{setup:z.undefined(),result:z.array(z.unknown()),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[views]});
}
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('composed powers preserve source counters, justApplied, Artifact and float arithmetic at every step',async()=>{
  const cases:Step[][]=[
    [step('buff',0,p.Strength,3),step('buff',1,p.Strength,5),step('buff',0,p.Dexterity,-2),step('buff',0,p.Focus,1),step('debuff',0,p.PlayerWeak,2,1),step('debuff',0,p.PlayerVulnerable,2,1),step('debuff',0,p.Frail,1,1),
      step('buff',0,p.NoBlock,1),step('remove',0,p.NoBlock),step('clear',0,p.PlayerWeak),step('decrement',0,p.PlayerWeak,2),step('buff',0,p.PlayerWeak,3),step('remove',0,p.PlayerWeak),step('debuff',0,p.PlayerWeak,1,1)],
    [step('buff',0,p.PlayerArtifact,2),step('debuff',0,p.PlayerWeak,2,1),step('debuff',0,p.Frail,0,1),step('debuff',0,p.PlayerVulnerable,2,1),step('debuff',0,p.Frail,1,1),
      step('buff',1,p.EnemyArtifact,1),step('debuff',1,p.EnemyWeak,0,0),step('buff',1,p.EnemyArtifact,0),step('debuff',1,p.Strength,0,0),step('remove',1,p.EnemyArtifact),
      step('debuff',1,p.EnemyWeak,2,0),step('debuff',1,p.EnemyWeak,3,1),step('remove',1,p.EnemyWeak),step('debuff',1,p.EnemyWeak,1,0),step('clear',1,p.EnemyWeak),step('decrement',1,p.EnemyWeak,1)],
    [step('buff',0,p.Strength,16777217),step('buff',1,p.Strength,-16777217),step('buff',0,p.Dexterity,-16777217),step('buff',0,p.PlayerWeak,32767),step('buff',0,p.PlayerWeak,1),step('decrement',0,p.PlayerWeak,1),
      step('remove',0,p.PlayerWeak),step('buff',0,p.PlayerWeak,-2),step('buff',1,p.EnemyArtifact,127),step('buff',1,p.EnemyArtifact,1),step('debuff',1,p.EnemyWeak,1,0)],
    [step('debuff',1,p.EnemyWeak,0,0),step('debuff',0,p.PlayerWeak,0,1),step('buff',1,p.Strength,0),step('buff',0,p.NoBlock,0),step('buff',1,p.EnemyArtifact,0),step('decrement',1,p.EnemyArtifact,0)],
  ];
  const reference=await ReferenceClient.create();
  try{
    for(const [index,steps] of cases.entries()){
      const wire=steps.map(s=>{const binding=(s.target===0?playerBindings:enemyBindings).find(b=>b.definition===s.definition);if(!binding)throw Error('Missing source power mapping');return{kind:s.kind,target:s.target,status:binding.id,amount:s.amount,source:s.source??null};});
      const expected=await reference.call({op:'power-case',bases,steps:wire}),d=fixture(steps);
      for(const controlled of [false,true]){
        const loaded=unwrap(await createCardLoader({controlled}).load(d)),instance=unwrap(await loaded.core.start(undefined));
        try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected result');assertSameState(expected,stop.result,`powers case=${index} controlled=${controlled}`);}
        finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
      }
    }
  }finally{await reference.close();}
});
