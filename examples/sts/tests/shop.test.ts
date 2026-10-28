import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {adventures} from '../src/rules/adventures.ts';
import {adventureViews} from "../src/adapters/adventure-views.ts";
import {shopCaseFixture,eventSamplingFixture,relicFallbackFixture} from './adventure-case-fixture.ts';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import type {RelicTier} from '../src/rules/adventures.types.ts';
import {potionId,relicId,type RelicId} from '../src/identifiers.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';

test('empty relic pools return from tier fallback safely and preserve the requested draw direction',async()=>{
  const reference=await ReferenceClient.create(),names=new Map<number,string>(Object.entries(relicId).map(([name,id])=>[id,name]));
  const cases:{clear:RelicTier[];tier:RelicTier}[]=[{clear:['common'],tier:'common'},{clear:['common','uncommon'],tier:'common'},{clear:['shop'],tier:'shop'},{clear:['rare'],tier:'rare'},{clear:['boss'],tier:'boss'}];
  try{for(const input of cases)for(const front of [false,true]){
    const expected=await reference.call<{picked:number;remaining:Record<string,number>}>({op:'relic-fallback',seed:'130',...input,front});
    if(input.tier==='rare')assert.equal(expected.picked,relicId.CIRCLET);
    if(input.tier==='boss')assert.equal(expected.picked,relicId.RED_CIRCLET);
    for(const controlled of [true]){
      const definition=relicFallbackFixture(input.clear,input.tier,front),program=new CardProgram(definition),root=program.initial({seed:'130'},100_000_000),storage=privateCardGraph(root),machine=new CardMachine(program,storage);
      try{const stop=machine.advance();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Fallback must not ask a player choice');
        assert.deepEqual(stop.result,{picked:names.get(expected.picked),remaining:expected.remaining});
      }finally{storage.close?.();}
    }
  }}finally{await reference.close();}
});

test('shops preserve every slot, random stream, discounts, restocks, purchase and removal continuation',async()=>{
  const reference=await ReferenceClient.create();
  try{
    const purchases=[...Array.from({length:7},(_,index)=>({kind:'card',index})),...Array.from({length:3},(_,index)=>({kind:'potion',index})),...Array.from({length:3},(_,index)=>({kind:'relic',index})),{kind:'remove',index:0},{kind:'select',index:0}];
    for(const seed of ['0','1','24','130','18446744073709551615'])for(const owned of [[],['THE_COURIER'],['MEMBERSHIP_CARD'],['MOLTEN_EGG','TOXIC_EGG','FROZEN_EGG'],['THE_COURIER','MEMBERSHIP_CARD','SMILING_MASK','MAW_BANK']] as RelicId[][]){
      const definition=shopCaseFixture(owned),program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed},100_000_000))),steps:{kind:'action';bits:number}[]=[];
      let stop=machine.advance();
      const view=()=>{const ids=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined);assert.equal(ids.length,1);return inspectRuleQuery(definition,machine.root.state,adventureViews.exports.privateGame,ids[0]!);};
      const expected=async()=>{const states=await reference.call<any[]>({op:'shop-case',seed,relics:owned.map(id=>relicId[id]),steps});return states.at(-1)!;};
      const act=async(bits:number)=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);assert.equal(stop.kind,'call',JSON.stringify(stop));if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Shop did not request a decision');assert.ok(stop.call.input.actions.some(action=>action.bits===bits),'shop continuation action must be legal');stop=machine.advance({bits});steps.push({kind:'action',bits});assertSameState(await expected(),view(),`shop seed=${seed} relics=${owned} step=${steps.length}`);};
      assertSameState(await expected(),view(),`shop setup seed=${seed} relics=${owned}`);
      for(const purchase of purchases){
        const bits=purchase.kind==='card'||purchase.kind==='select'?purchase.index:purchase.kind==='potion'?(3<<27)|purchase.index:purchase.kind==='relic'?(4<<27)|purchase.index:5<<27;
        const beforeAct=purchase.kind==='potion'?view():null;
        await act(bits);
        // Complete a purchased relic's actual source continuation before buying again.
        // Every original purchase/removal remains; nested screens add their own legal actions.
        if(purchase.kind==='relic')while(view().screen==='CARD_SELECT'||view().screen==='REWARDS')await act(view().screen==='CARD_SELECT'?0:6<<27);
        // A full potion inventory must not offer further potion purchases; the two
        // capacity-limited purchases above stay the complete legal sequence.
        // A full belt keeps the purchase available (the original game allows it) but a
        // failed obtain must not consume stock or gold; discarding a potion frees the slot.
        if(beforeAct&&beforeAct.potions.filter(potion=>potion!==potionId.EMPTY_POTION_SLOT).length>=2){
          const after=view();
          assert.equal(after.gold,beforeAct.gold,'a failed potion purchase must not charge gold');
          assert.deepEqual(after.shop!.potions,beforeAct.shop!.potions,'a failed potion purchase must not consume stock');
        }
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
      const expected=await reference.call({op:'event-sampling',seed,relics:owned.map(id=>relicId[id]),lastShops}),program=new CardProgram(eventSamplingFixture(owned,lastShops)),machine=new CardMachine(program,privateCardGraph(program.initial({seed},100_000_000))),stop=machine.advance();
      assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Event sampling did not finish');assertSameState(expected,stop.result,`event draws seed=${seed} relics=${owned}`);
      for(const {event} of stop.result.outcomes)assert.ok(event!==12&&event!==31,'source-disabled Colosseum and Match and Keep cannot enter the event pipeline');
    }
  }finally{await reference.close();}
});
