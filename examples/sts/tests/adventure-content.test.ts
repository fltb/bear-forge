import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {adventureContentDefinition,type AdventureContentCase} from './adventure-content-fixture.ts';
import {oracleViewOf} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {act1Events,act2Events,act3Events,act1Shrines,act2Shrines,act3Shrines,oneTimeEventsAsc15} from '../src/pools.ts';
import {eventId,relicId,type RelicId} from '../src/identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';

const program=new CardProgram(adventureContentDefinition);
function driver(input:AdventureContentCase,controlled:boolean){
  const root=program.initial(input,100_000_000),storage=controlled?privateCardGraph(root):plainCardStorage(root),machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  return{machine,frame,done:()=>stop.kind==='done',advance(bits:number){stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}

async function exercise(input:AdventureContentCase,script:number,label:string){
  const ref=await ReferenceClient.create(),native=driver(input,false),controlled=driver(input,true);
  try{
    let source=await ref.call({op:'adventureContentStart',...input,relic:input.relic===null?null:relicId[input.relic]}),decision=0;
    const initialRelics=structuredClone(source.game.relics);
    for(;;){
      for(const d of [native,controlled]){
        const frame=d.frame(),state=oracleViewOf(adventureContentDefinition,d.machine.root.state,frame);
        let expectedGame=source.game;
        if(input.event===eventId.FORGOTTEN_ALTAR&&script===0&&decision===1){
          // Fixed-source replaceRelic searches for the replacement instead of the
          // old id: its flags change but its display vector keeps Golden Idol.
          // Check that exact source defect, then independently specify the one
          // production result: remove the old relic and obtain Bloody Idol once.
          assert.deepEqual(source.game.relics,initialRelics);
          const hasBit=(id:number)=>(BigInt(source.game.relicBits[Math.floor(id/64)])&(1n<<BigInt(id%64)))!==0n;
          assert.equal(hasBit(relicId.GOLDEN_IDOL),false);assert.equal(hasBit(relicId.BLOODY_IDOL),true);
          expectedGame={...source.game,relics:[...initialRelics.filter((r:{id:string})=>r.id!=='GOLDEN_IDOL'),{id:'BLOODY_IDOL',data:0}]};
        }
        assertSameState(expectedGame,state.game,`${label} script=${script} decision=${decision} game`);
        assertSameState(source.battle,state.battle,`${label} script=${script} decision=${decision} battle`);
        if(!d.done())assert.deepEqual(frame.actions.map(a=>a.bits),source.actions.map(a=>a.bits),`${label} complete legal domain`);
      }
      if(native.done()){assert.equal(controlled.done(),true);if(source.game.outcome===1)assert.equal(source.game.screen,'MAP_SCREEN');else assert.equal(source.actions.length,0);break;}
      assert.ok(decision<1000,`${label} must terminate`);
      const actions=source.actions;let index=decision===0?Math.min(script,actions.length-1):script%2===0?0:actions.length-1;
      if(source.battle&&source.battle.input===1)index=Math.max(0,actions.findIndex(a=>a.type===0));
      const action=actions[index];assert.ok(action,`${label} continuation`);
      native.advance(action.bits);controlled.advance(action.bits);source=await ref.call({op:'advance',bits:action.bits});decision++;
    }
  }finally{native.close();controlled.close();await ref.close();}
}

test('all acquisition screens execute their production selection/reward continuations and persistent effects',async t=>{
  const ids:readonly RelicId[]=['ASTROLABE','BOTTLED_FLAME','BOTTLED_LIGHTNING','BOTTLED_TORNADO','CAULDRON','CALLING_BELL','DOLLYS_MIRROR','EMPTY_CAGE','ORRERY','TINY_HOUSE'];
  for(const relic of ids)for(const script of [0,1])await t.test(`${relic} script=${script}`,()=>exercise({seed:'130',event:null,relic},script,relic));
});

test('all enabled A20 events execute alternative initial choices and subsequent production continuations',async t=>{
  // Both are compile-time disabled in the fixed source; the pool-draw test below
  // checks their rejection instead of forcing an inadmissible event setup.
  const ids=[...new Set([...act1Events,...act2Events,...act3Events,...act1Shrines,...act2Shrines,...act3Shrines,...oneTimeEventsAsc15])].filter(id=>id!==eventId.COLOSSEUM&&id!==eventId.MATCH_AND_KEEP);
  for(const event of ids)for(const script of [0,1,2,3])await t.test(`event=${event} script=${script}`,()=>exercise({seed:'130',event,relic:null},script,`event=${event}`));
  for(const event of [eventId.DEAD_ADVENTURER,eventId.FACE_TRADER,eventId.CURSED_TOME,eventId.WHEEL_OF_CHANGE,eventId.SCRAP_OOZE,eventId.THE_MAUSOLEUM])for(let seed=0;seed<8;seed++)await t.test(`event=${event} random branch seed=${seed}`,()=>exercise({seed:String(seed),event,relic:null},0,`event=${event} seed=${seed}`));
});
