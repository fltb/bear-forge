import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
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
  const root=program.initial(input,100_000_000),storage=privateCardGraph(root),machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  return{machine,frame,done:()=>stop.kind==='done',advance(bits:number){stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}

async function exercise(input:AdventureContentCase,script:number,label:string){
  const ref=await ReferenceClient.create(),controlled=driver(input,true);
  try{
    let source=await ref.call({op:'adventureContentStart',...input,owned:(input.owned??[]).map(id=>relicId[id]),relic:input.relic===null?null:relicId[input.relic]}),decision=0,stalled=false;
    for(;;){
      for(const d of [controlled]){
        const frame=d.frame(),state=oracleViewOf(adventureContentDefinition,d.machine.root.state,frame);
        if(input.event===eventId.FORGOTTEN_ALTAR&&script===0&&decision===1){
          // Corrected C++ must update both flags and the displayed relic vector.
          assert.ok(source.game.relics.some((r:{id:string})=>r.id==='BLOODY_IDOL'));
          assert.ok(!source.game.relics.some((r:{id:string})=>r.id==='GOLDEN_IDOL'));
          const hasBit=(id:number)=>(BigInt(source.game.relicBits[Math.floor(id/64)])&(1n<<BigInt(id%64)))!==0n;
          assert.equal(hasBit(relicId.GOLDEN_IDOL),false);assert.equal(hasBit(relicId.BLOODY_IDOL),true);
        }
        assertSameState(source.game,state.game,`${label} script=${script} decision=${decision} game`);
        assertSameState(source.battle,state.battle,`${label} script=${script} decision=${decision} battle`);
        if(!d.done())assert.deepEqual(frame.actions.map(a=>a.bits),source.actions.map(a=>a.bits),`${label} complete legal domain`);
      }
      if(controlled.done()){if(source.game.outcome===1)assert.equal(source.game.screen,'MAP_SCREEN');else assert.equal(source.actions.length,0);break;}
      assert.ok(decision<1000,`${label} must terminate`);
      const actions=source.actions;let index=decision===0?Math.min(script,actions.length-1):script%2===0?0:actions.length-1;
      // A potion claim with a full belt is a legal but ineffective action; leave the screen
      // instead of picking the same no-op forever.
      if(stalled){const leave=actions.findIndex(a=>a.bits===(6<<27));if(leave>=0)index=leave;}
      if(source.battle&&source.battle.input===1)index=Math.max(0,actions.findIndex(a=>a.type===0));
      if(input.rewardRelic&&decision===0)index=actions.findIndex(a=>a.bits===(4<<27));
      const action=actions[index];assert.ok(action,`${label} continuation`);
      const stateBefore=JSON.stringify(source.game);
      controlled.advance(action.bits);source=await ref.call({op:'advance',bits:action.bits});decision++;
      stalled=JSON.stringify(source.game)===stateBefore;
    }
  }finally{controlled.close();await ref.close();}
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


test('six relic acquisition: Orrery has five manual rewards, Mirror preserves bottled upgraded card stats, Coin grants 300',async t=>{
  for(const relic of ['ORRERY','DOLLYS_MIRROR','OLD_COIN','PRISMATIC_SHARD'] as const)for(const owned of [[],['QUESTION_CARD'],['BUSTED_CROWN'],['ECTOPLASM'],['BLOODY_IDOL']] as RelicId[][]){
    const input={seed:'130',event:null,relic,owned,copyCard:relic==='DOLLYS_MIRROR'};
    await t.test(`${relic} ${owned}`,async()=>{
      await exercise(input,0,`relic=${relic} owned=${owned}`);
      for(const controlled of [true]){
        const d=driver(input,controlled);try{
          const f=d.frame();
          if(relic==='ORRERY'){
            assert.equal(f.game.rewards!.cards.length,5);
            assert.ok(f.game.rewards!.cards.every(cards=>cards.length===(owned.includes('QUESTION_CARD')?4:owned.includes('BUSTED_CROWN')?1:3)));
            const afterSkip=d.advance(5<<8);assert.equal(afterSkip.game.rewards!.cards.length,4);assert.equal(afterSkip.game.deck.length,13);
            const afterTake=d.advance(0);assert.equal(afterTake.game.deck.length,14);assert.equal(afterTake.game.rewards!.cards.length,3);
            const done=d.advance(6<<27);assert.equal(done.game.screen,'MAP_SCREEN');
          }else if(relic==='DOLLYS_MIRROR'){
            assert.equal(f.game.select!.type,5);assert.equal(f.game.select!.cards.length,14);
            assert.deepEqual(f.game.select!.cards[13]!.card,{id:'SEARING_BLOW',upgraded:true,misc:3});
            const after=d.advance(13);assert.equal(after.game.deck.length,15);assert.deepEqual(after.game.deck.at(-1),{id:'SEARING_BLOW',upgraded:true,misc:3});assert.equal(after.game.bottles[0],13);
          }else if(relic==='OLD_COIN'){assert.equal(f.game.gold,owned.includes('ECTOPLASM')?1000:1300);assert.equal(f.game.hp,owned.includes('BLOODY_IDOL')?495:490);}
          else assert.ok(f.game.relics.some(r=>r.id==='PRISMATIC_SHARD'));
        }finally{d.close();}
      }
    });
  }
  await t.test('Mirror with an empty deck does not open a dead selection',()=>exercise({seed:'130',event:null,relic:'DOLLYS_MIRROR',emptyDeck:true},0,'empty Mirror'));
  for(const relic of ['ORRERY','DOLLYS_MIRROR'] as const)await t.test(`nested reward ${relic}`,()=>exercise({seed:'130',event:null,relic,rewardRelic:true},0,`nested ${relic}`));
  for(const relic of ['ORRERY','DOLLYS_MIRROR'] as const)for(const controlled of [true]){
    const d=driver({seed:'130',event:null,relic,rewardRelic:true},controlled);try{
      let f=d.advance(4<<27);if(relic==='DOLLYS_MIRROR')f=d.advance(0);
      assert.equal(f.game.screen,'REWARDS');assert.deepEqual(f.game.rewards!.gold,[17]);assert.equal(f.game.rewards!.cards.length,relic==='ORRERY'?6:1);assert.equal(f.game.rewards!.relics.length,0);assert.equal(f.game.rewards!.sapphireKey,false);
    }finally{d.close();}
  }

});
