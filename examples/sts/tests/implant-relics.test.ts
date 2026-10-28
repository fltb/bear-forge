import {requireDifftest} from './reference/client.ts';
requireDifftest();
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {adventures} from '../src/rules/adventures.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {implantFixture} from './implant-fixture.ts';
import {ReferenceClient} from './reference/client.ts';
import {oracleViewOf} from './state-inspection.ts';
import {assertSameState} from './reference/compare.ts';
import {relicId,type RelicId} from '../src/identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';

test('six relic gaps: Implant resolves ordinary obtain hooks immediately and persists exactly once on battle exit',async t=>{
  const cases:{relics:RelicId[];spent:number;blocked:boolean;healed:number}[]=[
    {relics:['DARKSTONE_PERIAPT','CERAMIC_FISH','BLOODY_IDOL'],spent:0,blocked:false,healed:11},
    {relics:['DARKSTONE_PERIAPT','OMAMORI'],spent:0,blocked:true,healed:0},
    {relics:['DARKSTONE_PERIAPT','OMAMORI'],spent:2,blocked:false,healed:6},
    {relics:['DARKSTONE_PERIAPT','CERAMIC_FISH','BLOODY_IDOL','MAGIC_FLOWER'],spent:0,blocked:false,healed:16},
    {relics:['DARKSTONE_PERIAPT','MARK_OF_THE_BLOOM'],spent:0,blocked:false,healed:0},
  ];
  for(const c of cases)await t.test(`${c.relics} spent=${c.spent}`,async()=>{
    const definition=implantFixture(c.relics,c.spent),program=new CardProgram(definition),ref=await ReferenceClient.create();
    try{for(const controlled of [true]){
      const root=program.initial({seed:'130'},100_000_000),storage=privateCardGraph(root),machine=new CardMachine(program,storage);let stop=machine.advance();
      const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
      try{
        let source=await ref.call({op:'implantStart',seed:'130',relics:c.relics.map(id=>relicId[id]),spentOmamori:c.spent});
        const original=frame(),beforeGold=original.battle!.player.gold,beforeDeck=original.game.deck.length;
        assertSameState(source.battle,oracleViewOf(definition,machine.root.state,original).battle,'initial implant boundary');
        const end=source.actions.find(a=>a.type===4)!;stop=machine.advance({bits:end.bits});source=await ref.call({op:'advance',bits:end.bits});
        const implanted=frame();assert.equal(implanted.battle!.player.maxHp,10000+(c.blocked?0:6));assert.equal(implanted.battle!.player.hp,100+c.healed);assert.equal(implanted.battle!.player.gold,beforeGold+(!c.blocked&&c.relics.includes('CERAMIC_FISH')?9:0));
        // Run-level publication is an entry snapshot during combat; inspect the
        // actual owner to assert that obtaining itself already happened.
        const run=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined)[0]!,deck=inspectRuleQuery(definition,machine.root.state,adventures.exports.bindings,run).deck;
        assert.equal(inspectRuleQuery(definition,machine.root.state,permanentDecks.exports.current,deck).cards.length,beforeDeck+(c.blocked?0:1));
        assertSameState(source.battle,oracleViewOf(definition,machine.root.state,implanted).battle,'resolved implant boundary');
        let decisions=0;
        while(source.battle){assert.ok(++decisions<30);const a=source.battle.input===1?source.actions.find(a=>a.type===0)??source.actions.find(a=>a.type===4):source.actions.at(-1);assert.ok(a);stop=machine.advance({bits:a.bits});source=await ref.call({op:'advance',bits:a.bits});const current=frame(),state=oracleViewOf(definition,machine.root.state,current);assertSameState(source.battle,state.battle,'implant combat continuation');}
        const after=frame();assert.equal(after.game.deck.length,beforeDeck+(c.blocked?0:1));assert.equal(after.game.maxHp,10000+(c.blocked?0:6));
        for(const key of ['hp','maxHp','gold','deck','relics'] as const)assertSameState(source.game[key],after.game[key],`implant persistent ${key}`);
        if(c.relics.includes('OMAMORI'))assert.equal(after.game.relics.find(r=>r.id==='OMAMORI')!.data,c.blocked?1:0);
      }finally{storage.close?.();}
    }}finally{await ref.close();}
  });
});
