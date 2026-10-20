import test from 'node:test';
import assert from 'node:assert/strict';
import {ReferenceClient,type ReferenceState} from './reference/client.ts';
import {firstDifference,assertSameState} from './reference/compare.ts';
import {readFile} from 'node:fs/promises';
import {replay} from './reference/replay.ts';
import {revision} from './reference/build.ts';
import type {Trace} from './reference/play.ts';
import {productionDriver} from './production-driver.ts';
import {oracleView} from './state-inspection.ts';
import {publishReference} from './reference/publication.ts';
import {potionId} from '../src/identifiers.ts';

test('pinned reference starts a real Ironclad A20 run and inspection is read only',async()=>{
  const r=await ReferenceClient.create();
  try {
    const s=await r.call({op:'start',seed:'18446744073709551615'});
    assert.equal(s.game.seed,'18446744073709551615');assert.equal(s.game.ascension,20);
    assert.equal(s.game.screen,'EVENT_SCREEN');assert.equal(s.game.deck.length,11);
    assert.equal(s.game.keys.red,false);assert.equal(s.heartDefeated,false);
    assert.ok(s.actions.length>0);assert.deepEqual(await r.call({op:'inspect'}),s);
    assert.equal(await r.call<boolean>({op:'validate',bits:4294967295}),false);
    await assert.rejects(r.call({op:'advance',bits:4294967295}),/Illegal action/);
    assert.deepEqual(await r.call({op:'inspect'}),s);
  }finally{await r.close();}
});

test('reference close cannot miss an exit between the reply and the awaiting continuation',async()=>{
  const reference=await ReferenceClient.create(),original=reference.call.bind(reference);
  reference.call=async<T=ReferenceState>(request:Record<string,unknown>,timeout?:number):Promise<T>=>{
    if(request.op!=='close')return original<T>(request,timeout);
    const exited=new Promise<void>(resolve=>reference.process.once('exit',()=>resolve()));
    const result=await original<T>(request,timeout);
    reference.process.stdin.end();await exited;return result;
  };
  let timer:NodeJS.Timeout|undefined;
  try{await Promise.race([reference.close(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Reference close missed the prior exit')),2000);})]);}
  finally{if(timer)clearTimeout(timer);reference.process.kill();}
});

test('normal opening advances through Neow and a real first battle without state injection',async()=>{
  const r=await ReferenceClient.create();
  try {
    let s=await r.call({op:'start',seed:'1'});
    for(let i=0;i<30 && !s.battle;i++) {
      assert.ok(s.actions.length);
      s=await r.call({op:'advance',bits:s.actions[0]!.bits});
    }
    assert.ok(s.battle);assert.equal(s.game.act,1);assert.equal(s.game.floor,1);
    const before=await r.call({op:'inspect'});
    const search=await r.call<{candidates:{bits:number;visits:number}[];solution:number[];outcomeHp:number}>({op:'search',simulations:100,seed:1});
    assert.ok(search.candidates.length);assert.deepEqual(await r.call({op:'inspect'}),before);
    assert.ok(search.outcomeHp>0);assert.ok(search.solution.length);
    for(const bits of search.solution) {
      assert.equal(await r.call<boolean>({op:'validate',bits}),true);
      s=await r.call({op:'advance',bits});
    }
    assert.equal(s.battle,null);assert.equal(s.game.screen,'REWARDS');assert.ok(s.decisions>before.decisions);
  }finally{await r.close();}
});

test('comparison detects changed RNG, card order, identity and a missing interaction',async()=>{
  const r=await ReferenceClient.create();
  try {
    const s=await r.call({op:'start',seed:'1'});
    assertSameState(s,structuredClone(s),'unchanged');
    const rng=structuredClone(s);rng.game.rng.card.counter++;
    assert.equal(firstDifference(s,rng)?.path,'state.game.rng.card.counter');
    const cards=structuredClone(s);[cards.game.deck[0],cards.game.deck[1]]=[cards.game.deck[1]!,cards.game.deck[0]!];
    assert.match(firstDifference(s,cards)!.path,/deck\[0\]/);
    const missing=structuredClone(s);missing.actions.pop();
    assert.equal(firstDifference(s,missing)?.path,'state.actions.length');
    const field=structuredClone(s);delete field.game.rng;
    assert.equal(firstDifference(s,field)?.path,'state.game.rng');
    assert.throws(()=>assertSameState(s,rng,'injected RNG mismatch'),/injected RNG mismatch/);
  }finally{await r.close();}
});

test('real Ironclad A20 Heart fixture independently replays both bosses, keys and Act 4',async()=>{
  const trace=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as Trace;
  assert.equal(trace.actions.length,721);
  const s=await replay(trace);
  assert.equal(s.game.hp,6);assert.equal(s.heartDefeated,true);assert.equal(s.game.floor,56);
});

test('Heart validation cannot pass for an empty, incomplete or falsely labelled run',async()=>{
  const base:Trace={reference:revision,seed:'130',character:'IRONCLAD',ascension:20,actions:[],heartDefeated:false};
  await assert.rejects(replay(base),/complete Heart win/);
  await assert.rejects(replay({...base,heartDefeated:true}));
});

test('a single card reward can be legally skipped even when the original helper omits it',async()=>{
  const r=await ReferenceClient.create();
  try {
    let s=await r.call({op:'start',seed:'1'});
    s=await r.call({op:'advance',bits:s.actions.find(a=>a.index===2)!.bits});
    assert.equal(s.game.screen,'REWARDS');
    const skip=s.actions.find(a=>a.type===0 && a.index2===5)!;
    assert.ok(skip);assert.equal(await r.call<boolean>({op:'validate',bits:skip.bits}),true);
    const deck=structuredClone(s.game.deck),rng=structuredClone(s.game.rng);
    s=await r.call({op:'advance',bits:skip.bits});
    assert.deepEqual(s.game.deck,deck);assert.deepEqual(s.game.rng,rng);assert.equal(s.game.rewards.cards.length,0);
  }finally{await r.close();}
});


test('pinned GameAction potion fallthrough aborts; the normal driver executes only the actual potion primitive and preserves the pending reward',async()=>{
  const raw=await ReferenceClient.create(),fixed=await ReferenceClient.create(),prefix:number[]=[];
  try{
    let before=await fixed.call({op:'start',seed:'0'});await raw.call({op:'start',seed:'0'});
    for(let i=0;i<2;i++){const bits=before.actions[((i+1)*17)%before.actions.length]!.bits;prefix.push(bits);before=await fixed.call({op:'advance',bits});await raw.call({op:'advance',bits});}
    assert.equal(before.game.screen,'REWARDS');assert.equal(before.game.potionCount,1);assert.equal(before.game.rewards.cards.length,0);
    const drop=before.actions.find(a=>a.potion&&a.bits===0xc0000000);assert.ok(drop);
    await assert.rejects(raw.call({op:'upstreamAdvance',bits:drop.bits}),/function obtain, file Deck\.cpp, line 178/);
    const after=await fixed.call({op:'advance',bits:drop.bits}),expected=structuredClone(before);
    expected.game.potions[0]=potionId.EMPTY_POTION_SLOT;expected.game.allPotions[0]=potionId.EMPTY_POTION_SLOT;expected.game.potionCount=0;expected.decisions++;
    expected.actions=expected.actions.filter(a=>!a.potion||a.index!==0);assertSameState(expected,after,'discard changes only the original potion slot, count and decision domain');
    const history=[...prefix,drop.bits].map(bits=>({kind:'game' as const,bits}));
    for(const controlled of [false,true]){const driver=productionDriver('0',controlled);try{for(const bits of [...prefix,drop.bits])driver.advance(bits);const frame=driver.frame(),state=oracleView(driver.machine.root.state,frame);assertSameState(publishReference(after,history),frame,'discard resumes its original choice');assertSameState(after.game,state.game,'discard private state');}finally{driver.close();}}
  }finally{await raw.close();await fixed.close();}
});
