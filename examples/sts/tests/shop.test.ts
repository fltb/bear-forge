import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {adventures} from '../src/rules/adventures.ts';
import {adventureViews} from "../src/adapters/adventure-views.ts";
import {shopCaseFixture,eventSamplingFixture} from './adventure-case-fixture.ts';
import {relicId,type RelicId} from '../src/identifiers.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';

test('shops preserve every slot, random stream, discounts, restocks, purchase and removal continuation',async()=>{
  const reference=await ReferenceClient.create();
  try{
    const purchases=[...Array.from({length:7},(_,index)=>({kind:'card',index})),...Array.from({length:3},(_,index)=>({kind:'potion',index})),...Array.from({length:3},(_,index)=>({kind:'relic',index})),{kind:'remove',index:0},{kind:'select',index:0}];
    for(const seed of ['0','1','24','130','18446744073709551615'])for(const owned of [[],['THE_COURIER'],['MEMBERSHIP_CARD'],['MOLTEN_EGG','TOXIC_EGG','FROZEN_EGG'],['THE_COURIER','MEMBERSHIP_CARD','SMILING_MASK','MAW_BANK']] as RelicId[][]){
      const definition=shopCaseFixture(owned),program=new CardProgram(definition),machine=new CardMachine(program,plainCardStorage(program.initial({seed},100_000_000))),steps:{kind:'action';bits:number}[]=[];
      let stop=machine.advance();
      const view=()=>{const ids=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined);assert.equal(ids.length,1);return inspectRuleQuery(definition,machine.root.state,adventureViews.exports.privateGame,ids[0]!);};
      const expected=async()=>{const states=await reference.call<any[]>({op:'shop-case',seed,relics:owned.map(id=>relicId[id]),steps});return states.at(-1)!;};
      const act=async(bits:number)=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);assert.equal(stop.kind,'call',JSON.stringify(stop));if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Shop did not request a decision');assert.ok(stop.call.input.actions.some(action=>action.bits===bits),'shop continuation action must be legal');stop=machine.advance({bits});steps.push({kind:'action',bits});assertSameState(await expected(),view(),`shop seed=${seed} relics=${owned} step=${steps.length}`);};
      assertSameState(await expected(),view(),`shop setup seed=${seed} relics=${owned}`);
      for(const purchase of purchases){
        const bits=purchase.kind==='card'||purchase.kind==='select'?purchase.index:purchase.kind==='potion'?(3<<27)|purchase.index:purchase.kind==='relic'?(4<<27)|purchase.index:5<<27;
        await act(bits);
        // Complete a purchased relic's actual source continuation before buying again.
        // Every original purchase/removal remains; nested screens add their own legal actions.
        if(purchase.kind==='relic')while(view().screen==='CARD_SELECT'||view().screen==='REWARDS')await act(view().screen==='CARD_SELECT'?0:6<<27);
      }
    }
  }finally{await reference.close();}
});

test('question-mark outcomes and event pool draws match the live versus copied source streams',async()=>{
  const reference=await ReferenceClient.create();
  try{
    // Each case stays within one act's finite event pools. Exhausting 32 draws
    // without entering a new act is outside the fixed source's valid domain.
    const lastShops=Array.from({length:12},(_,i)=>i%3===1);
    for(const seed of ['0','1','24','130','409','18446744073709551615'])for(const owned of [[],['TINY_CHEST'],['JUZU_BRACELET']] as RelicId[][]){
      const expected=await reference.call({op:'event-sampling',seed,relics:owned.map(id=>relicId[id]),lastShops}),program=new CardProgram(eventSamplingFixture(owned,lastShops)),machine=new CardMachine(program,plainCardStorage(program.initial({seed},100_000_000))),stop=machine.advance();
      assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Event sampling did not finish');assertSameState(expected,stop.result,`event draws seed=${seed} relics=${owned}`);
      for(const {event} of stop.result.outcomes)assert.ok(event!==12&&event!==31,'source-disabled Colosseum and Match and Keep cannot enter the event pipeline');
    }
  }finally{await reference.close();}
});
