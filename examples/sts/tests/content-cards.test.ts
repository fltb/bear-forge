import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {contentCardDefinition,type ContentCase} from './content-card-fixture.ts';
import {oracleViewOf} from './state-inspection.ts';
import {ReferenceClient,type ReferenceState} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {cards} from '../src/cards.ts';
import {cardId} from '../src/identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';
const program=new CardProgram(contentCardDefinition),ids=Object.keys(cards) as (keyof typeof cards)[];
// These metadata entries have no use case in the fixed source. Their real
// execution must fail explicitly in both implementations, never silently no-op.
const sourceUnsupported=new Set<keyof typeof cards>(['BECOME_ALMIGHTY','BETA','BULLET_TIME','CONCENTRATE','EXPUNGER','FAME_AND_FORTUNE','INSIGHT','LIVE_FOREVER','MIRACLE','OMEGA','SAFETY','SHIV','SMITE','THROUGH_VIOLENCE']);
function driver(input:ContentCase,controlled:boolean){
  const root=program.initial(input,100_000_000),storage=controlled?privateCardGraph(root):plainCardStorage(root),machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  return{machine,frame,advance(bits:number){stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}
function configuration(id:keyof typeof cards,upgraded:boolean):ContentCase{
  return{seed:'130',id,upgraded,strength:0,vulnerable:0,attackIntent:false,enemyHp:['FEED','HAND_OF_GREED','RITUAL_DAGGER'].includes(id)?1:5000,support:id==='CLASH'?['STRIKE_RED']:id==='IMPATIENCE'?['DEFEND_RED','BURN']:['STRIKE_RED','DEFEND_RED','BURN','STRIKE_RED','DEFEND_RED']};
}
async function start(reference:ReferenceClient,input:ContentCase){return reference.call({op:'contentStart',...input,id:cardId[input.id],support:input.support.map(id=>cardId[id])});}

test('147 card definitions: 133 executable programs and 14 explicit source-unsupported prototypes, regular and upgraded, against C++',async t=>{
  assert.equal(ids.length,147);
  // A shared construction error fails immediately before registering hundreds of semantic cases.
  const initial=configuration('ANGER',false),reference=await ReferenceClient.create(),probe=driver(initial,false);
  try{const expected=await start(reference,initial),frame=probe.frame();assertSameState(expected.battle,oracleViewOf(contentCardDefinition,probe.machine.root.state,frame).battle,'content fixture initial state');assert.deepEqual(frame.actions.map(a=>a.bits),expected.actions.map(a=>a.bits));}finally{probe.close();await reference.close();}
  const cases=ids.flatMap(id=>[false,true].map(upgraded=>({label:`${id} upgraded=${upgraded}`,input:configuration(id,upgraded)})));
  for(const upgraded of [false,true])for(const id of ['DROPKICK','SPOT_WEAKNESS','LIMIT_BREAK','HEAVY_BLADE','ENLIGHTENMENT','PANACHE','BATTLE_TRANCE','MASTER_OF_STRATEGY'] as const){
    const input=configuration(id,upgraded);
    if(id==='DROPKICK')input.vulnerable=3;
    if(id==='SPOT_WEAKNESS')input.attackIntent=true;
    if(id==='LIMIT_BREAK'||id==='HEAVY_BLADE')input.strength=5;
    if(id==='ENLIGHTENMENT')input.support=['BASH','DEFEND_RED'];
    if(id==='PANACHE')input.support=Array.from({length:6},()=> 'STRIKE_RED');
    if(id==='BATTLE_TRANCE'||id==='MASTER_OF_STRATEGY')input.support=Array.from({length:9},()=> 'DEFEND_RED');
    cases.push({label:`${id} upgraded=${upgraded} positive or full-hand branch`,input});
  }
  for(const {label,input} of cases)await t.test(label,async()=>{
    const {id,upgraded}=input,reference=await ReferenceClient.create(),native=driver(input,false),controlled=driver(input,true);let source:ReferenceState;
    const compare=(label:string)=>{for(const d of [native,controlled]){const frame=d.frame(),state=oracleViewOf(contentCardDefinition,d.machine.root.state,frame);assertSameState(source.battle,state.battle,`${id} upgraded=${upgraded} ${label}`);if(source.battle)assert.deepEqual(frame.actions.map(a=>a.bits),source.actions.map(a=>a.bits),`${id} ${label} complete action domain`);else for(const key of ['hp','maxHp','gold','deck','deckCounts','upgradeableCount','transformableCount'] as const)assertSameState(source.game[key],state.game[key],`${id} ${label} persistent ${key}`);}};
    const advance=async(bits:number,label:string)=>{native.advance(bits);controlled.advance(bits);source=await reference.call({op:'advance',bits});compare(label);};
    const selections=async()=>{let steps=0;while(source.battle&&source.battle.input!==1){assert.ok(++steps<30,'selection must terminate');const action=source.actions.at(-1);assert.ok(action);await advance(action.bits,'selection');}};
    try{
      source=await start(reference,input);compare('initial');
      const at=source.battle!.cards.hand.findIndex(card=>card.uniqueId===11);assert.ok(at>=0);
      const subject=source.actions.find(a=>a.type===0&&a.source===at);
      if(sourceUnsupported.has(id)){
        assert.ok(subject,'unsupported prototype remains an explicit execution failure');
        await assert.rejects(reference.call({op:'advance',bits:subject.bits}),error=>{assert.match(String(error),/Reference exited \(SIGABRT\)/);assert.match(String(error),/attempted to use unimplemented card:/);return true;});
        for(const d of [native,controlled])assert.throws(()=>d.advance(subject.bits),new RegExp(`Card use is not implemented: ${id}`));
        return;
      }
      if(subject){await advance(subject.bits,'subject use');await selections();}
      // Follow-up attacks and skills expose hooks such as Rage, Double Tap, Panache,
      // Corruption and Pain; the seeded Burn/Dazed exercise end/draw/exhaust reactions.
      for(let i=0;i<5&&source.battle;i++){
        const action=source.actions.find(a=>a.type===0&&['STRIKE_RED','DEFEND_RED'].includes(source.battle!.cards.hand[a.source!]?.id??''));if(!action)break;await advance(action.bits,'follow-up');await selections();
      }
      for(let turn=0;turn<3&&source.battle;turn++){const end=source.actions.find(a=>a.type===4);assert.ok(end);await advance(end.bits,`end turn ${turn}`);await selections();}
    }finally{native.close();controlled.close();await reference.close();}
  });
});
