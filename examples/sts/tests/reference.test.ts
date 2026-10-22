import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {ReferenceClient,type ReferenceState} from './reference/client.ts';
import {firstDifference,assertSameState} from './reference/compare.ts';

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



test('hungry face starts with one charge in the controlled fixture and C++',async()=>{
  // NlothsMask constructor counter=1 in sts-re relic.json; neither side is the oracle.
  const [{createCardLoader},{adventureContentDefinition},{relicId}]=await Promise.all([
    import('@bear-forge/runtime-card'),import('./adventure-content-fixture.ts'),import('../src/identifiers.ts'),
  ]);
  const unwrap=<T,E>(r:import('@bear-forge/contracts/instance').Outcome<T,E>):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(adventureContentDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',event:null,relic:'NLOTHS_HUNGRY_FACE'}));
  let reference:ReferenceClient|undefined;
  try{
    reference=await ReferenceClient.create();
    const expected=await reference.call({op:'adventureContentStart',seed:'130',event:null,relic:relicId.NLOTHS_HUNGRY_FACE});
    assert.equal(expected.game.relics.find((r:{id:string;data:number})=>r.id==='NLOTHS_HUNGRY_FACE')?.data,1);
    let stop=unwrap(await instance.inspect());
    while(stop.kind==='call'&&stop.call.port==='event'){
      unwrap(await instance.bind({event:async()=>({kind:'reply',value:null})}));unwrap(await instance.run());stop=unwrap(await instance.inspect());
    }
    assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Acquisition fixture must finish');
    assert.equal(stop.result.game.relics.find(r=>r.id==='NLOTHS_HUNGRY_FACE')?.data,1);
  }finally{try{await instance.close();}finally{await reference?.close();}}
});
