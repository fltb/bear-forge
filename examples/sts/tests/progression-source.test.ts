import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {adventureProgram,adventureContent} from '../src/program/adventure.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventureProgression,actRecovery} from '../src/program/progression.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';

const setupSchema=programSchemas.setup.extend({hp:z.int32(),maxHp:z.int32()});
type Setup=z.infer<typeof setupSchema>;
const {defineRules,defineEffect,sequence,call,query}=rules;
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
      call(adventureProgression.exports.nextAct,run),
      call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),
      b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );
  });
  return{exports:{entry}};
}});
const definition=linkRules<{},Setup,Ports,Frame>({id:'sts/progression-source',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});

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
