import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,ruleModules} from '@bear-forge/card-engine';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {stateOf} from '@bear-forge/card-engine/rules-module-internal';
import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {addMass,unitMass} from '@bear-forge/card-engine/probability-cursor';
import {serialize,deserialize} from 'node:v8';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {adventureProgram,adventureContent} from '../src/program/adventure.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventureProgression,actRecovery} from '../src/program/progression.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';

const setupSchema=programSchemas.setup.extend({hp:z.int32(),maxHp:z.int32(),pause:z.boolean().optional()});
type Setup=z.infer<typeof setupSchema>;
const {defineRules,defineEffect,sequence,call,query}=rules;
const pause=ruleModules.portEffect<number,null>('pause');
// Only initial health is fixture setup; the transition itself is the production
// nextAct effect, including healing modifiers, RNG, encounter plan and new map.
const fixture=defineRules({requires:[adventureProgram,adventureProgression],build(){
  const runDefinition=rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions});
  const entry=defineEffect<Setup,Frame>(b=>{
    const run=b.local<number>();
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:runDefinition})),
      call(resources.exports.setHealth,{entity:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).actor),hp:b.read(v=>v.input.hp),maxHp:b.read(v=>v.input.maxHp)}),
      call(stsPorts.exports.initialize,run),
      rules.when(b.read(v=>v.input.pause===true),call(pause,run)),
      call(adventureProgression.exports.nextAct,run),
      call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),
      b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );
  });
  return{exports:{entry}};
}});
const definition=linkRules<{},Setup,Ports&{pause:{input:number;output:null}},Frame>({id:'sts/progression-source',schemas:{...programSchemas,setup:setupSchema,ports:{...programSchemas.ports,pause:{input:z.number(),output:z.null()}}},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry,pause],modules:[fixture]});

for(const [hp,maxHp,healing] of [[29,72,32],[72,72,0],[71,72,1],[70,72,2],[69,72,2],[68,72,3],[66,72,5]] as const){
  test(`act recovery uses missing health and source rounding: ${hp}/${maxHp} heals ${healing}`,()=>{
    assert.equal(actRecovery.amount(hp,maxHp),healing);
  });
  test(`production nextAct restores ${hp}/${maxHp} to ${hp+healing}/${maxHp}`,()=>{
    const program=new CardProgram(definition),storage=privateCardGraph(program.initial({seed:'130',hp,maxHp},100_000_000)),machine=new CardMachine(program,storage);
    try{
      let stop=machine.advance();
      while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
      if(stop.kind!=='done')throw Error('Act transition unexpectedly requested a decision');
      const result=machine.storage.export(stop.result);
      assert.equal(result.game.hp,hp+healing);assert.equal(result.game.maxHp,maxHp);
      assert.equal(result.game.act,2);assert.equal(result.game.screen,'MAP_SCREEN');
    }finally{storage.close();}
  });
}

test('act recovery explanation describes the same operand rather than full healing',()=>{
  assert.match(actRecovery.text,/缺失生命的75%/);
  assert.match(actRecovery.text,/单精度.*四舍五入/);
  assert.match(actRecovery.text,/治疗修正/);
  assert.equal(actRecovery.amount(29,72),32);
  assert.equal(29+actRecovery.amount(29,72),61);
});


test('actual nextAct keeps its full unfinished future and original visible map across direct restoration',()=>{
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',hp:29,maxHp:72,pause:true},100_000_000)));
  let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
  if(stop.kind!=='call'||stop.call.port!=='pause')throw Error('Expected current act transition boundary');
  const run=stop.call.input,left=new ProbabilityCurrent(machine),right=left.fork();
  const components=stateOf(right.machine.root.state).entities[run]!.components;
  const key=Object.entries(components).find(([,value])=>value&&typeof value==='object'&&'seed' in value&&'streams' in value)![0];
  const bindings=inspectRuleQuery(definition,right.machine.root.state,adventures.exports.bindings,run);
  components[Number(key)]=right.machine.storage.own({...bindings,seed:999n});
  const before=machine.storage.export(machine.root),initial=CardProgram.prototype.initial;
  function future(source:typeof left){
    const options={continueCall(stop:Extract<ReturnType<typeof source.inspect>,{kind:'call'}>,data:null){if(stop.call.port==='event')return{reply:null,data};}};
    let expansion=ProbabilityExpansion.from(source,null,null,options);
    try{
      // Inspect retained work, not a completed act-transition distribution.
      for(let step=0;step<32;step++){
        expansion.step();
      }
      assert.equal(expansion.complete,false);assert.equal(expansion.take(),undefined);
      const saved=deserialize(serialize(expansion.save()));expansion.close();
      expansion=ProbabilityExpansion.restore(program,saved,options);assert.deepEqual(expansion.save(),saved);
      const mass=expansion.masses();assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
      return saved.pending.map((row:any)=>({phase:row.phase,mass:row.mass,kind:row.context.stop.kind,...(row.context.stop.kind==='chance'?{space:row.context.stop.space}:{})}));
    }finally{expansion.close();}
  }
  CardProgram.prototype.initial=function(){throw Error('No reinitialization during act transition');};
  try{
    const a=future(left),b=future(right);assert.ok(a.length>0);assert.deepEqual(a,b);
    assert.deepEqual(machine.storage.export(machine.root),before);
  }finally{CardProgram.prototype.initial=initial;left.close();right.close();}
});
