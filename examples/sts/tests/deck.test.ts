import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {cards} from '../src/cards.ts';
import {relicId,type RelicId} from '../src/identifiers.ts';
import {deckCaseFixture,type DeckCaseStep} from './adventure-case-fixture.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';

test('every admitted card metadata variant matches the source rule helpers',async()=>{
  const reference=await ReferenceClient.create();try{assertSameState(await reference.call({op:'definitions'}),cards,'card metadata');}finally{await reference.close();}
});
test('permanent deck preserves source eggs, curses, bottles, copies, Searing Blow and random upgrade semantics',async()=>{
  const reference=await ReferenceClient.create();
  try{
    const active=await reference.call({op:'start',seed:'130'});
    const cases:{relics:RelicId[];steps:DeckCaseStep[]}[]=[
      {relics:[],steps:[{kind:'obtain',id:'SEARING_BLOW'},{kind:'upgrade',index:11},{kind:'upgrade',index:11},{kind:'bottle',index:1,type:0},{kind:'remove',index:0},{kind:'remove',index:0},{kind:'obtain',id:'PARASITE'},{kind:'remove',index:10},{kind:'upgrade-random',count:3}]},
      {relics:['OMAMORI','CERAMIC_FISH','MOLTEN_EGG','TOXIC_EGG','FROZEN_EGG'],steps:[{kind:'obtain',id:'REGRET',count:3},{kind:'obtain',id:'ASCENDERS_BANE'},{kind:'obtain',id:'SEARING_BLOW',misc:2,upgraded:true,count:2},{kind:'obtain',id:'SHRUG_IT_OFF'},{kind:'obtain',id:'BARRICADE'},{kind:'upgrade-random',count:4}]},
      {relics:['ECTOPLASM','CERAMIC_FISH'],steps:[{kind:'obtain',id:'BASH',count:2},{kind:'upgrade-random',count:30}]},
    ];
    for(const [index,example] of cases.entries()){
      const program=new CardProgram(deckCaseFixture(example.steps,example.relics));
      for(const seed of ['0','130','18446744073709551615']){
        const expected=await reference.call({op:'deck-case',seed,relics:example.relics.map(id=>({id:relicId[id],data:id==='OMAMORI'?2:0})),steps:example.steps}),machine=new CardMachine(program,privateCardGraph(program.initial({seed},100_000_000))),stop=machine.advance();
        assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Deck owner case did not finish');
        assertSameState(expected,stop.result.at(-1),`deck case=${index} seed=${seed}`);
      }
    }
    assertSameState(active,await reference.call({op:'inspect'}),'isolated examples cannot alter active run');
    const program=new CardProgram(deckCaseFixture([{kind:'obtain',id:'BASH',count:2},{kind:'upgrade',index:12}],[])),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'1'},100_000_000))),stop=machine.advance();
    assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Copy case did not finish');
    assert.equal(stop.result.at(-1)!.deck.at(-1)!.upgraded,true);assert.equal(stop.result.at(-1)!.deck.at(-2)!.upgraded,false,'obtained copies must have independent mutable state');
  }finally{await reference.close();}
});
