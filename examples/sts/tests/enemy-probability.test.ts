import {deserialize} from 'node:v8';
import {memorySnapshotStore} from '@bear-forge/runtime-card/store';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardMachine,CardProgram} from '@bear-forge/card-engine';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {stateOf} from '@bear-forge/card-engine/rules-module-internal';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {ProbabilityCurrent,takeProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {combatContentDefinition} from './combat-content-fixture.ts';
import type {Ports,Frame} from '../src/game.schemas.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {enemies} from '../src/rules/enemies.ts';
import {random} from '../src/rules/random.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {battles} from '../src/rules/battles.ts';
import {zones} from '../src/rules/zones.ts';
import {relics} from '../src/rules/relics.ts';
import {pileRelics} from '../src/content/relics/common/piles.ts';
import {encounterId} from '../src/identifiers.ts';
import {moveId} from '../src/combat-identifiers.ts';
import {contract,observe} from '../src/contract.ts';
import {describeAction} from '../src/presentation.ts';
import {createCardLoader} from '@bear-forge/runtime-card';

import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {addMass,compareMass,unitMass,zeroMass,probabilityMass,type ProbabilityMass} from '@bear-forge/card-engine/probability-mass';

const program=new CardProgram(combatContentDefinition);
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

for(const character of ['ironclad','volibear'] as const)for(const dome of [false,true])test(`${character} Dome=${dome} directly saves the actual enemy state without a historical probability account`,async()=>{
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(combatContentDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.BOOK_OF_STABBING,relics:dome?['RUNIC_DOME']:[],potion:null,durable:true,elite:true,detailedEvents:true}));
  const initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Current progression and restore must not initialize');};
    unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
    while(unwrap(await instance.run()).accepted){}
    const stop=unwrap(await instance.inspect());if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original combat decision');
    const saved=unwrap(await loaded.persistence!.save(instance)),snapshot=deserialize((await store.get(saved.snapshotId))!);
    assert.equal(Object.hasOwn(snapshot,'tracking'),false);
    const actual=await takeProbabilityCurrent<Ports,Frame>(unwrap(await instance.fork!()));
    try{
      assert.equal(Object.hasOwn(stateOf(actual.machine.root.state),'probabilityAccount'),false);
      const enemy=firstEnemy(actual),state=query(actual,enemies.exports.current,enemy);
      assert.equal(state.history[0],moveId.BOOK_OF_STABBING_SINGLE_STAB);
      assert.equal(query(actual,enemies.exports.presentation,enemy).miscInfo,1,'the original battle-start update executed once');
      assert.equal(query(actual,random.exports.current,state.aiRng).counter,1,'actual initialization chose one move');
      const restored=unwrap(await loaded.persistence!.restore(saved));
      try{
        const recovered=await takeProbabilityCurrent<Ports,Frame>(unwrap(await restored.fork!()));
        try{assert.deepEqual(recovered.machine.storage.export(recovered.machine.root),actual.machine.storage.export(actual.machine.root));}
        finally{recovered.close();}
        const action=stop.call.input.actions.find(action=>action.bits>>>29===4);assert.ok(action);let accepted=false;
        unwrap(await restored.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{if(accepted)return{kind:'pause'};accepted=true;return{kind:'reply',value:action};}}));
        while(unwrap(await restored.run()).accepted){}
        const next=unwrap(await restored.inspect());if(next.kind!=='call'||next.call.port!=='decision')throw Error('Expected next original turn');
        assert.ok(observe(next.call.input).battle!.turn>observe(stop.call.input).battle!.turn);
        assert.deepEqual(unwrap(await instance.inspect()),stop);
      }finally{unwrap(await restored.close());}
    }finally{actual.close();}
    unwrap(await loaded.persistence!.release(saved));
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());}
});
function actualCurrent(){
  const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.BOOK_OF_STABBING,relics:[],potion:null,durable:true,elite:true,detailedEvents:true})));
  let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
  if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original combat request');
  const first=stop.call.input.actions.find(a=>a.bits===(4<<29)>>>0);assert.ok(first);
  // This seed opens with single stab. Advance that actual turn once, leaving
  // the next (forced multi-stab) turn current; do not restore or repeat it.
  stop=machine.advance(first);while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
  if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected next actual combat request');
  const action=stop.call.input.actions.find(a=>a.bits===(4<<29)>>>0);assert.ok(action);
  return{current:new ProbabilityCurrent(machine),action};
}
type Current=ReturnType<typeof actualCurrent>['current'];
const query=<I,O>(current:ProbabilityCurrent<any,any,Ports,Frame>,q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,current.machine.root.state,q,input);
function firstEnemy(current:ProbabilityCurrent<any,any,Ports,Frame>){
  const run=query(current,adventures.exports.instances,undefined)[0]!;
  return query(current,combatSessions.exports.current,query(current,combatSessions.exports.forRun,run)!).roster[0]!.controller!;
}

function options(boundary:string){return{
  stopAtBoundary:boundary,
  continueCall(stop:Extract<ReturnType<Current['inspect']>,{kind:'call'}>,data:null){
    if(stop.call.port==='event')return{reply:contract.ports.event.receive(stop.call.input).output,data};
  },
};}
function boundaryOutcomes(current:Current,reply:unknown,boundary:string){
  let expansion=ProbabilityExpansion.from(current,reply,null,options(boundary));
  const outcomes:NonNullable<ReturnType<typeof expansion.take>>[]=[];
  try{
    // Save the actual pending operation, close its old owner, then continue it.
    expansion.step();const saved=expansion.save();expansion.close();
    expansion=ProbabilityExpansion.restore(program,saved,options(boundary));
    while(!expansion.complete){
      expansion.step();const mass=expansion.masses();
      assert.equal(compareMass(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass()),0);
      for(let next=expansion.take();next;next=expansion.take())outcomes.push(next);
    }
    for(let next=expansion.take();next;next=expansion.take())outcomes.push(next);
    assert.equal(compareMass(outcomes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass()),0);
    return outcomes;
  }catch(error){for(const row of outcomes)row.current.close();throw error;}
  finally{expansion.close();}
}

test('the complete original Book choice law retains correlated move, counter and history across direct restore',()=>{
  const actual=actualCurrent(),before=actual.current.machine.storage.export(actual.current.machine.root);
  const initial=CardProgram.prototype.initial,owned=new Set<Current>();
  try{
    CardProgram.prototype.initial=function(){throw Error('Original AI search may only continue current frames');};
    const at=boundaryOutcomes(actual.current,actual.action,'enemy-roll:before');for(const row of at)owned.add(row.current);
    assert.equal(at.length,1);assert.deepEqual(at[0]!.mass,unitMass());
    const source=at[0]!.current,enemy=firstEnemy(source),prior=query(source,enemies.exports.current,enemy);
    const count=Number(query(source,enemies.exports.presentation,enemy).miscInfo),rng=query(source,random.exports.current,prior.aiRng);
    const parent=source.machine.storage.export(source.machine.root),other=source.fork();owned.add(other);
    const components=stateOf(other.machine.root.state).entities[prior.aiRng]!.components;
    const entry=Object.entries(components).find(([,value])=>value&&typeof value==='object'&&'seed0' in value&&'seed1' in value);assert.ok(entry);
    components[Number(entry[0])]=other.machine.storage.own({...entry[1] as object,seed0:111n,seed1:222n});
    const successors=(root:Current)=>{
      const outcomes=boundaryOutcomes(root,0n,'enemy-roll:after');for(const row of outcomes)owned.add(row.current);
      assert.equal(outcomes.length,100,'all original integer rolls are represented without a particle limit');
      const law=new Map<number,ProbabilityMass>();
      for(const row of outcomes){
        assert.deepEqual(row.mass,probabilityMass(1n,100n));
        const selected=query(row.current,enemies.exports.current,enemy),nextCount=query(row.current,enemies.exports.presentation,enemy).miscInfo;
        assert.deepEqual(selected.history.slice(1),[prior.history[0]]);
        assert.equal(query(row.current,random.exports.current,prior.aiRng).counter,rng.counter+1);
        assert.equal(nextCount,count+Number(selected.history[0]===moveId.BOOK_OF_STABBING_MULTI_STAB));
        const saved=row.current.machine.storage.export(row.current.machine.root);
        row.current.close();owned.delete(row.current);
        const recovered=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(saved)));owned.add(recovered);
        // The after-marker resumes the completed original selection; it cannot
        // shift the history or increment the selection counter a second time.
        recovered.advanceExact(0n);
        assert.deepEqual(query(recovered,enemies.exports.current,enemy).history,selected.history);
        assert.equal(query(recovered,enemies.exports.presentation,enemy).miscInfo,nextCount);
        law.set(selected.history[0],addMass(law.get(selected.history[0])??zeroMass(),row.mass));
        recovered.close();owned.delete(recovered);
      }
      return [...law].sort(([a],[b])=>a-b);
    };
    const left=successors(source),right=successors(other);assert.deepEqual(left,right,'hidden actual RNG seeds never select future probability branches');
    const law=new Map(left);
    assert.deepEqual(law.get(moveId.BOOK_OF_STABBING_SINGLE_STAB),probabilityMass(15n,100n));
    assert.deepEqual(law.get(moveId.BOOK_OF_STABBING_MULTI_STAB),probabilityMass(85n,100n));
    assert.deepEqual(source.machine.storage.export(source.machine.root),parent);
    assert.deepEqual(actual.current.machine.storage.export(actual.current.machine.root),before);
  }finally{CardProgram.prototype.initial=initial;for(const current of owned)current.close();actual.current.close();}
});

for(const upgraded of [false,true])for(const discard of [false,true])test(`accepted original scry ${upgraded?'three':'two'} cards and ${discard?'discard':'keep'} continues the actual current`,async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(combatContentDefinition));
  let instance=unwrap(await loaded.core.start({seed:'130',character:'volibear',encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true,bottledCard:'VOLIBEAR_U17',bottledUpgraded:upgraded}));
  const original=instance,initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Accepted scry must continue current frames');};
    const advance=async(reply?:{bits:number})=>{
      let sent=false;
      unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{
        if(reply===undefined||sent)return{kind:'pause'};sent=true;return{kind:'reply',value:reply};
      }}));
      for(;;){const result=unwrap(await instance.run());if(!result.accepted)break;}
      const current=unwrap(await instance.inspect());
      if(current.kind!=='call'||current.call.port!=='decision')throw Error('Expected original player decision');
      return current.call.input;
    };
    const first=await advance(),view=observe(first);
    const play=first.actions.find(action=>{const d=describeAction(view,action.bits);return d.kind==='play-card'&&view.battle!.hand[Number(d.details.hand)]?.id==='VOLIBEAR_U17';});assert.ok(play);
    const menu=await advance(play),menuView=observe(menu),candidates=menuView.battle!.select!.candidates;assert.ok(candidates);assert.equal(candidates.length,upgraded?3:2);
    const before=unwrap(await original.inspect()),saved=unwrap(await loaded.persistence!.save(original));
    instance=unwrap(await loaded.persistence!.restore(saved));assert.deepEqual(unwrap(await instance.inspect()),before);
    const selection=menu.actions.find(action=>{const d=describeAction(menuView,action.bits);return discard?d.kind==='select-cards'&&JSON.stringify(d.details.indices)==='[0]':d.kind==='skip-selection'||d.kind==='select-cards'&&(d.details.indices as number[]).length===0;});assert.ok(selection);
    const after=observe(await advance(selection));
    assert.ok(after.battle!.hand.some(card=>card.uniqueId===candidates[discard?1:0]!.card.uniqueId),'original draw follows the retained revealed prefix');
    if(discard)assert.ok(!after.battle!.hand.some(card=>card.uniqueId===candidates[0]!.card.uniqueId));
    assert.deepEqual(unwrap(await original.inspect()),before,'restored continuation leaves the current parent untouched');
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());if(instance!==original)unwrap(await original.close());}
});


for(const character of ['ironclad','volibear'] as const)test(`${character} accepted turns retain the actual current through the first discard shuffle`,async t=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.CULTIST,relics:[],potion:null,durable:true,elite:false,detailedEvents:true})),initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Every actual turn continues current frames');};
    let reply:{bits:number}|undefined,shuffled=false,previousDraw=Infinity;
    for(let turn=0;turn<=3;turn++){
      let accepted=false;
      unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{if(reply===undefined||accepted)return{kind:'pause'};accepted=true;return{kind:'reply',value:reply};}}));
      while(unwrap(await instance.run()).accepted){}
      const stop=unwrap(await instance.inspect());if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual next combat turn');
      const view=observe(stop.call.input);
      t.diagnostic(`turn=${turn}, draw=${view.battle!.drawCount}`);
      assert.equal(view.battle!.turn,turn);
      if(view.battle!.drawCount>previousDraw)shuffled=true;previousDraw=view.battle!.drawCount;
      reply=stop.call.input.actions.find(action=>describeAction(view,action.bits).kind==='end-turn');assert.ok(reply);
    }
    assert.equal(shuffled,true,'the original draw path must actually exhaust and shuffle the discard pile');
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());}
});


for(const character of ['ironclad','volibear'] as const)for(const visible of [false,true])test(`${character} Frozen Eye=${visible} original Deep Breath keeps fresh shuffled suffixes uncertain after restore`,async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(combatContentDefinition));
  let instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.CULTIST,relics:visible?['THE_ABACUS','SUNDIAL','FROZEN_EYE']:['THE_ABACUS','SUNDIAL'],potion:null,durable:true,elite:false,detailedEvents:true,bottledCard:'DEEP_BREATH'}));
  const original=instance,initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Shuffle continuation cannot initialize');};
    const advance=async(reply?:{bits:number})=>{
      let sent=false;unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{if(reply===undefined||sent)return{kind:'pause'};sent=true;return{kind:'reply',value:reply};}}));
      while(unwrap(await instance.run()).accepted){}
      const stop=unwrap(await instance.inspect());if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual combat decision');
      return stop.call.input;
    };
    const first=await advance(),view=observe(first),play=first.actions.find(action=>{const d=describeAction(view,action.bits);return d.kind==='play-card'&&view.battle!.hand[Number(d.details.hand)]?.id!=='DEEP_BREATH';});assert.ok(play);
    const afterPlay=await advance(play),ready=observe(afterPlay);assert.ok(ready.battle!.discard.length>0,'the original card must create a discard pile');
    const before=unwrap(await original.inspect()),saved=unwrap(await loaded.persistence!.save(original));instance=unwrap(await loaded.persistence!.restore(saved));
    const breath=afterPlay.actions.find(action=>{const d=describeAction(ready,action.bits);return d.kind==='play-card'&&ready.battle!.hand[Number(d.details.hand)]?.id==='DEEP_BREATH';});assert.ok(breath);
    const next=observe(await advance(breath));assert.equal(next.battle!.hand.length,ready.battle!.hand.length);assert.ok(next.battle!.discard.some(card=>card.id==='DEEP_BREATH'));
    assert.equal(next.battle!.player.block,ready.battle!.player.block+6,'the original Abacus shuffle event fires once');
    const currentSaved=unwrap(await loaded.persistence!.save(instance)),snapshot=deserialize((await store.get(currentSaved.snapshotId))!);
    const actual=await takeProbabilityCurrent<Ports,Frame>(unwrap(await instance.fork!()));
    assert.equal(Object.hasOwn(snapshot,'tracking'),false);
    try{for(const state of [actual.machine.root.state]){
      const query=<I,O>(q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,state,q,input);
      const run=query(adventures.exports.instances,undefined)[0]!,session=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!),draw=query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles).draw;
      const knowledge=query(zones.exports.orderKnowledge,draw);assert.equal(knowledge.resolved,false);assert.equal(knowledge.blocks.some(block=>block.length>1),!visible,'only original Frozen Eye publication makes the shuffled suffix fully known');
      const sundial=query(relics.exports.find,{actor:query(adventures.exports.current,run).actor,definition:query(adventures.exports.relic,{run,id:'SUNDIAL'})});assert.ok(sundial!==null);
      assert.equal(query(pileRelics.exports.sundialCount,sundial),1,'both permutations retain exactly one original shuffle announcement in every current');
    }}finally{actual.close();}
    assert.deepEqual(unwrap(await original.inspect()),before);
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());if(instance!==original)unwrap(await original.close());}
});
