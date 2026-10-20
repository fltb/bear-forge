import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {oracleView} from './state-inspection.ts';
import {publishReference} from './reference/publication.ts';
import {FrameSchema} from '../src/game.schemas.ts';
import {cardDefinition} from '../src/card.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import type {Trace} from './reference/play.ts';

async function completeTrace(controlled:boolean){
  const trace=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as Trace;
  const ref=await ReferenceClient.create(),program=new CardProgram(cardDefinition),root=program.initial({seed:trace.seed},100_000_000);
  const storage=controlled?privateCardGraph(root):plainCardStorage(root);
  const machine=new CardMachine(program,storage);let stop=machine.advance();
  try {
    let s=await ref.call({op:'start',seed:trace.seed});
    for(let i=0;i<=trace.actions.length;i++) {
      while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
      assert.ok(stop.kind==='done'||stop.kind==='call'&&stop.call.port==='decision',`decision=${i} ${JSON.stringify(stop)}`);if(stop.kind!=='done'&&(stop.kind!=='call'||stop.call.port!=='decision'))throw Error('Expected a decision or terminal result');
      const frame=FrameSchema.parse(stop.kind==='done'?stop.result:stop.call.input),oracle=oracleView(machine.root.state,frame);
      assert.deepEqual(frame.actions.map(a=>a.bits),s.actions.map(a=>a.bits),`action domain decision=${i} ${JSON.stringify({floor:s.game.floor,screen:s.game.screen,event:s.game.eventName,hand:s.battle?.cards.hand,source:s.actions})}`);
      assertSameState(publishReference(s,trace.actions.slice(0,i)),frame,`public decision=${i} floor=${s.game.floor} controlled=${controlled} player=${JSON.stringify({expected:s.battle?.player,actual:frame.battle?.player,expectedDiscard:s.battle?.cards.discard,actualDiscard:frame.battle?.discard,current:s.battle?.current})}`);
      assertSameState(s.game,oracle.game,`game decision=${i} floor=${s.game.floor} screen=${s.game.screen} event=${s.game.eventName} controlled=${controlled}`);
      assertSameState(s.battle,oracle.battle,`battle decision=${i} controlled=${controlled}`);
      assert.deepEqual(frame.actions.map(a=>a.bits),s.actions.map(a=>a.bits),`full action domain at ${i}`);
      assert.deepEqual(frame.history,trace.actions.slice(0,i));assert.equal(frame.decisions,i);
      if(i===21){assert.equal(frame.game.screen,'MAP_SCREEN');assert.equal(frame.battle,null);assert.equal(frame.game.hp,74);}
      if(i===trace.actions.length){assert.equal(stop.kind,'done');assert.equal(s.heartDefeated,true);assert.equal(frame.heartDefeated,true);assert.equal(frame.game.hp,s.game.hp);break;}
      const a=trace.actions[i]!;
      stop=machine.advance({bits:a.bits});
      s=await ref.call({op:'advance',bits:a.bits});
    }
  }finally{storage.close?.();await ref.close();}
}

test('complete normal A20 Heart trace compares production Context at every boundary in native and controlled execution',async()=>{for(const controlled of [false,true])await completeTrace(controlled);});
