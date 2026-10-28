import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {deckCaseFixture,mapRelicFixture,potionRelicFixture,prismRelicFixture} from './adventure-case-fixture.ts';
import {generateMap} from '../src/map.ts';
import {relicId,potionId,type RelicId} from '../src/identifiers.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import type {Setup,Ports} from '../src/game.schemas.ts';
function finish<R>(program:CardProgram<{},Setup,Ports,R>,controlled:boolean):R{
  const root=program.initial({seed:'130'},100_000_000),storage=privateCardGraph(root),machine=new CardMachine(program,storage);
  try{const stop=machine.advance();assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Owner fixture unexpectedly paused');return stop.result;}finally{storage.close?.();}
}

test('six relic gaps: Darkstone counts actual curses after Omamori and observes healing restrictions',async()=>{
  const ref=await ReferenceClient.create();try{
    for(const owned of [['DARKSTONE_PERIAPT'],['DARKSTONE_PERIAPT','OMAMORI'],['DARKSTONE_PERIAPT','OMAMORI','CERAMIC_FISH'],['DARKSTONE_PERIAPT','MARK_OF_THE_BLOOM']] as RelicId[][]){
      const steps=[{kind:'obtain' as const,id:'REGRET' as const,count:3},{kind:'obtain' as const,id:'INJURY' as const,count:1}],program=new CardProgram(deckCaseFixture(steps,owned));
      const expected=await ref.call({op:'deck-case',seed:'130',relics:owned.map(id=>({id:relicId[id],data:id==='OMAMORI'?2:0})),steps});
      for(const controlled of [true]){
        const states=finish(program,controlled),first=states[0]!,last=states.at(-1)!,count=owned.includes('OMAMORI')?2:4;
        assert.equal(last.maxHp-first.maxHp,6*count);assert.equal(last.hp-first.hp,owned.includes('MARK_OF_THE_BLOOM')?0:6*count);assert.equal(last.deck.length-first.deck.length,count);
        if(owned.includes('OMAMORI'))assert.equal(last.relics.find(r=>r.id==='OMAMORI')!.data,0);
        assertSameState(expected,last,`Darkstone ${owned} controlled=${controlled}`);
      }
    }
  }finally{await ref.close();}
});

test('six relic gaps: Wing Boots only spends three charges on unconnected next-row nodes',async()=>{
  const map=generateMap(130n,20,1,true),node=map.nodes.find(n=>n.y>=0&&n.y<13&&n.edges.length&&map.nodes.some(t=>t.y===n.y+1&&t.room!=='NONE'&&!n.edges.includes(t.x)))!;
  const target=map.nodes.find(t=>t.y===node.y+1&&t.room!=='NONE'&&!node.edges.includes(t.x))!.x;
  const positions=[{x:-1,y:-1,target:map.nodes.find(n=>n.y===0&&n.edges.length>0)!.x},{x:3,y:14,target:0},{x:node.x,y:node.y,target:node.edges[0]!},...Array.from({length:3},()=>({x:node.x,y:node.y,target})),{x:node.x,y:node.y,target:null}];
  const program=new CardProgram(mapRelicFixture(positions)),ref=await ReferenceClient.create();
  try{const expected=await ref.call({op:'map-relic-case',seed:'130',positions});
    for(const controlled of [true]){
      const result=finish(program,controlled);assert.deepEqual(result.map(r=>r.counter),[3,3,3,2,1,-2,-2]);
      assert.ok(result[2]!.options.includes(target));assert.ok(!result[6]!.options.includes(target));assert.deepEqual(result[6]!.options,node.edges);assert.deepEqual(result[1]!.options,[0]);
      assert.ok(!result[2]!.options.some(x=>map.nodes[(node.y+1)*7+x]!.room==='NONE'));assertSameState(expected,result,`Wing Boots controlled=${controlled}`);
    }
  }finally{await ref.close();}
});

test('six relic gaps: Toy Ornithopter heals five outside battle without Bark scaling or discard triggers',async()=>{
  const ref=await ReferenceClient.create();try{
    for(const owned of [['TOY_ORNITHOPTER'],['TOY_ORNITHOPTER','SACRED_BARK'],['TOY_ORNITHOPTER','MAGIC_FLOWER'],['TOY_ORNITHOPTER','MARK_OF_THE_BLOOM']] as RelicId[][])for(const discard of [false,true]){
      const program=new CardProgram(potionRelicFixture(owned,potionId.BLOOD_POTION,discard)),expected=await ref.call({op:'potion-relic-case',seed:'130',relics:owned.map(id=>relicId[id]),potion:potionId.BLOOD_POTION,discard});
      for(const controlled of [true]){const result=finish(program,controlled);assert.equal(result.hp,discard||owned.includes('MARK_OF_THE_BLOOM')?10:10+5+(owned.includes('SACRED_BARK')?32:16));assert.ok(!result.potions.includes(potionId.BLOOD_POTION));assertSameState(expected,result,`Toy outside ${owned} discard=${discard} controlled=${controlled}`);}
    }
  }finally{await ref.close();}
});

test('Prismatic Shard remains normally generatable and directly obtainable with its reward effect disabled',async()=>{
  const ref=await ReferenceClient.create();try{for(const controlled of [true]){
    const baseline=finish(new CardProgram(prismRelicFixture(false)),controlled),held=finish(new CardProgram(prismRelicFixture(true)),controlled);
    assert.ok(baseline.generated.includes('PRISMATIC_SHARD'));assert.deepEqual(held.generated,baseline.generated);assert.equal(held.held,true);assert.equal(baseline.held,false);assert.deepEqual(held.cards,baseline.cards);
    for(const owned of [false,true])assertSameState(await ref.call({op:'prism-policy-case',seed:'130',owned}),owned?held:baseline,`Prism owned=${owned} controlled=${controlled}`);
  }}finally{await ref.close();}
});
