import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {phaseDefinition,type PhaseCase} from './combat-phases-fixture.ts';
import {oracleViewOf} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {encounterId} from '../src/identifiers.ts';
import {moveId} from '../src/combat-identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';
const program=new CardProgram(phaseDefinition);
function driver(input:PhaseCase,controlled:boolean){
  const root=program.initial(input,100_000_000),storage=controlled?privateCardGraph(root):plainCardStorage(root),machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  return{machine,frame,advance(bits:number){stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}
for(const scenario of [
  {encounter:encounterId.CHAMP,slot:0,hp:150,moves:[moveId.THE_CHAMP_ANGER,moveId.THE_CHAMP_EXECUTE]},
  {encounter:encounterId.TIME_EATER,slot:0,hp:150,moves:[moveId.TIME_EATER_HASTE]},
  {encounter:encounterId.AWAKENED_ONE,slot:2,hp:1,moves:[moveId.AWAKENED_ONE_DARK_ECHO]},
  {encounter:encounterId.THREE_DARKLINGS,slot:0,hp:1,moves:[moveId.DARKLING_REGROW]},
])test(`actual threshold/death/rebirth continuation encounter=${scenario.encounter}`,async()=>{
  const input:PhaseCase={seed:'130',encounter:scenario.encounter,slot:scenario.slot,hp:scenario.hp},reference=await ReferenceClient.create(),native=driver(input,false),controlled=driver(input,true),seen=new Set<number>();let halfDead=false,revived=false;
  try{
    let source=await reference.call({op:'combatPhaseStart',...input}),turns=0,steps=0;
    for(;;){
      for(const d of [native,controlled]){const frame=d.frame(),state=oracleViewOf(phaseDefinition,d.machine.root.state,frame);assertSameState(source.battle,state.battle,`phase=${scenario.encounter} step=${steps}`);if(source.battle)assert.deepEqual(frame.actions.map(a=>a.bits),source.actions.map(a=>a.bits));}
      if(!source.battle||turns>=12)break;
      for(const enemy of source.battle.monsters)seen.add(enemy.moves[0]);
      const subject=source.battle.monsters[scenario.slot]!;if(subject.halfDead)halfDead=true;if(halfDead&&subject.hp>0&&!subject.halfDead)revived=true;
      assert.ok(++steps<500);const action=source.battle.input===1?source.actions.find(a=>a.type===0&&a.target===scenario.slot)??source.actions.find(a=>a.type===0)??source.actions.find(a=>a.type===4):source.actions.at(-1);assert.ok(action);if(action.type===4)turns++;
      native.advance(action.bits);controlled.advance(action.bits);source=await reference.call({op:'advance',bits:action.bits});
    }
    for(const move of scenario.moves)assert.ok(seen.has(move),`phase ${scenario.encounter} must actually reach move ${move}`);
    if(scenario.encounter===encounterId.AWAKENED_ONE||scenario.encounter===encounterId.THREE_DARKLINGS)assert.equal(revived,true,'death must actually be followed by revival');
  }finally{native.close();controlled.close();await reference.close();}
});
