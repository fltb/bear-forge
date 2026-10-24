import {deserialize} from 'node:v8';
import {memorySnapshotStore} from '../../../packages/runtime-card/src/store.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardMachine,CardProgram} from '@bear-forge/card-engine';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {ProbabilityCurrent,nextProbability,nextProbabilityFrontier,saveProbabilityFrontier,restoreProbabilityFrontier,captureForwardFrontier,takeProbabilityCurrent,type ProbabilityFrontier} from '../../../packages/runtime-card/src/probability.ts';
import {combatContentDefinition,type CombatContentCase} from './combat-content-fixture.ts';
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
import {generateProbability} from '../../../packages/card-engine/src/probability.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
import {contract,observe} from '../src/contract.ts';
import {describeAction} from '../src/presentation.ts';
import {createCardLoader} from '@bear-forge/runtime-card';
import {inspectProbabilityTracking} from '../../../packages/runtime-card/src/probability-tracking.ts';
import {withStsProbabilityTracking} from '../src/search/tracking.ts';

const program=new CardProgram(combatContentDefinition);
const trackedDefinition=withStsProbabilityTracking(combatContentDefinition);
test('both character instances retain actual current state and costs without historical worlds',async t=>{
  const definition=trackedDefinition;
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition));
  for(const character of ['ironclad','volibear'] as const)for(const dome of [false,true]){
    const instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.BOOK_OF_STABBING,relics:dome?['RUNIC_DOME']:[],potion:null,durable:true,elite:true,detailedEvents:true}));
    try{
      let failedAt:string|null=null;
      unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
      for(;;){
        const step=unwrap(await instance.run()),model=await inspectProbabilityTracking(instance);
        if(model?.phase==='failed'&&failedAt===null){
          const current=unwrap(await instance.inspect());failedAt=current.kind;
          if(current.kind==='call'){
            failedAt=current.call.port;
            if(current.call.port==='event')failedAt+=':'+contract.ports.event.receive(current.call.input).events.flatMap(raw=>{
              const visible=contract.projectEvent(contract.schemas.event.parse(raw),'0');if(!visible)return[];
              const event=contract.schemas.playerEvent.parse(visible.event);return[event.kind==='detail'?event.type:event.kind];
            }).join(',');
          }
        }
        if(!step.accepted)break;
      }
      const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original player decision');
      const received=contract.ports.decision.receive(stop.call.input);assert.equal(received.requests.length,1);
      assert.ok(contract.inputs.action.describe(received.view,received.requests[0]!).values.length>0);
      const tracking=await inspectProbabilityTracking(instance);assert.ok(tracking);assert.equal(tracking.account.captures,0);
      t.diagnostic(character+' dome='+dome+': '+tracking.phase+', worlds='+tracking.worlds+', reason='+tracking.reason+', boundary='+failedAt);
      assert.equal(tracking.mode,'current');assert.equal(tracking.phase,'waiting');assert.equal(tracking.worlds,0);
      const saved=unwrap(await loaded.persistence!.save(instance)),restored=unwrap(await loaded.persistence!.restore(saved));
      const snapshot=deserialize((await store.get(saved.snapshotId))!);
      assert.equal(snapshot.tracking.mode,'current');assert.equal(snapshot.tracking.frontier,null);
      const actual=await takeProbabilityCurrent<Ports,Frame>(unwrap(await instance.fork!()));
      const recoveredCurrent=await takeProbabilityCurrent<Ports,Frame>(unwrap(await restored.fork!()));
      try{
        assert.deepEqual(recoveredCurrent.machine.storage.export(recoveredCurrent.machine.root),actual.machine.storage.export(actual.machine.root),'direct restore retains the full actual Context, including private current state');
      }finally{actual.close();recoveredCurrent.close();}
      try{
        assert.deepEqual(unwrap(await restored.inspect()),stop);
        const recovered=await inspectProbabilityTracking(restored),prior=await inspectProbabilityTracking(instance);assert.ok(recovered&&prior);
        assert.equal(recovered.account.nodes,prior.account.nodes+prior.worlds);assert.equal(recovered.window.nodes,prior.window.nodes+prior.worlds);
        assert.ok(recovered.account.milliseconds>=snapshot.tracking.account.milliseconds);assert.ok(recovered.window.milliseconds>=snapshot.tracking.window.milliseconds);
        assert.deepEqual(recovered.account.random,prior.account.random);assert.equal(recovered.account.captures,prior.account.captures);
        assert.deepEqual({...recovered,account:prior.account,window:prior.window},prior);
        const end=stop.call.input.actions.find(action=>action.bits>>>29===4);assert.ok(end);let accepted=false;
        unwrap(await restored.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{if(accepted)return{kind:'pause'};accepted=true;return{kind:'reply',value:end};}}));
        const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Restored turn must use current frames');};
        try{for(;;){
          const step=unwrap(await restored.run()),model=await inspectProbabilityTracking(restored);
          if(model?.phase==='failed'){
            const current=unwrap(await restored.inspect());
            t.diagnostic('restored failure: '+(current.kind==='call'&&current.call.port==='event'?JSON.stringify(contract.ports.event.receive(current.call.input).events.map(event=>contract.projectEvent(contract.schemas.event.parse(event),'0'))):current.kind));break;
          }
          if(!step.accepted)break;
        }}
        finally{CardProgram.prototype.initial=initialize;}
        const next=await inspectProbabilityTracking(restored);assert.equal(next!.mode,'current');assert.equal(next!.phase,'waiting');assert.equal(next!.worlds,0);assert.equal(next!.account.captures,0);
        const nextStop=unwrap(await restored.inspect());assert.equal(nextStop.kind,'call');if(nextStop.kind!=='call'||nextStop.call.port!=='decision')throw Error('Expected next player turn');
        const nextView=contract.ports.decision.receive(nextStop.call.input).view,priorView=contract.ports.decision.receive(stop.call.input).view;
        assert.ok(contract.observe(nextView,'0').battle!.turn>contract.observe(priorView,'0').battle!.turn);
        assert.deepEqual(unwrap(await instance.inspect()),stop,'restored continuation does not mutate the live parent');
      }
      finally{unwrap(await restored.close());}
    }finally{unwrap(await instance.close());}
  }
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
const query=<I,O>(current:Current,q:rules.Query<I,O>,input:I)=>inspectRuleQuery(combatContentDefinition,current.machine.root.state,q,input);
function firstEnemy(current:Current){
  const run=query(current,adventures.exports.instances,undefined)[0]!;
  return query(current,combatSessions.exports.current,query(current,combatSessions.exports.forRun,run)!).roster[0]!.controller!;
}
function until(current:Current,reply:unknown,name:string){
  const owned=new Set<Current>(),pending:{current:Current;probability:number}[]=[],result:typeof pending=[];
  const entropy={word(){throw Error('The already announced move needs no new random choice before its roll');},check(){}};
  const advance=(parent:Current,reply:unknown,mass:number)=>{
    const next=nextProbability(parent,reply,{maximum:8-pending.length-result.length,entropy,untilBoundary:name});
    for(const child of next.outcomes){owned.add(child.current);pending.push({current:child.current,probability:mass*child.probability});}
  };
  try{
    advance(current,reply,1);
    while(pending.length){const node=pending.shift()!,stop=node.current.inspect();
      if(stop.kind==='chance'&&stop.space.kind==='boundary'&&stop.space.name===name)result.push(node);
      else if(stop.kind==='call'&&stop.call.port==='event'){advance(node.current,null,node.probability);node.current.close();owned.delete(node.current);}
      else throw Error('Original flow did not reach its expected AI boundary');
    }
    owned.clear();return result;
  }finally{for(const child of owned)child.close();}
}

test('original Book of Stabbing choice exposes joint move and counter successors before continuing its parent flow',()=>{
  const actual=actualCurrent(),before=actual.current.machine.storage.export(actual.current.machine.root);
  const initialize=CardProgram.prototype.initial,owned=new Set<Current>();
  try{
    CardProgram.prototype.initial=function(){throw Error('AI probability generation must not initialize or execute a history');};
    // Execute this actual current's end-turn action once, then retain its next,
    // not-yet-executed roll. No earlier frame or historical action is installed.
    const at=until(actual.current,actual.action,'enemy-roll:before');for(const node of at)owned.add(node.current);
    assert.equal(at.length,1);assert.equal(at[0]!.probability,1);
    const source=at[0]!.current,enemy=firstEnemy(source),state=query(source,enemies.exports.current,enemy);
    const count=query(source,enemies.exports.presentation,enemy).miscInfo!,rng=query(source,random.exports.current,state.aiRng);
    const parent=source.machine.storage.export(source.machine.root),other=source.fork();owned.add(other);
    const components=stateOf(other.machine.root.state).entities[state.aiRng]!.components;
    const entry=Object.entries(components).find(([,value])=>value&&typeof value==='object'&&'seed0' in value&&'seed1' in value);assert.ok(entry);
    components[Number(entry[0])]=other.machine.storage.own({...entry[1] as object,seed0:111n,seed1:222n});
    function successors(current:Current){
      let words=0;
      const next=nextProbability(current,0n,{maximum:8,untilBoundary:'enemy-roll:after',entropy:{check(){},word:()=>words++%2===0?0:99}});
      for(const node of next.outcomes)owned.add(node.current);
      assert.equal(next.representation,'particles');assert.equal(words,8);
      return next.outcomes.map(node=>{
        assert.deepEqual(node.current.inspect(),{kind:'chance',space:{kind:'boundary',name:'enemy-roll:after'}});
        const selected=query(node.current,enemies.exports.current,enemy),nextCount=query(node.current,enemies.exports.presentation,enemy).miscInfo;
        assert.deepEqual(selected.history.slice(1),[state.history[0]]);
        assert.equal(query(node.current,random.exports.current,state.aiRng).counter,rng.counter+1);
        assert.equal(nextCount,Number(count)+Number(selected.history[0]===moveId.BOOK_OF_STABBING_MULTI_STAB));
        // A continuation resumes after the completed selection and must not
        // increment its private counter or shift the move history a second time.
        const continuation=node.current.fork();owned.add(continuation);continuation.advance(0n);
        assert.deepEqual(query(continuation,enemies.exports.current,enemy).history,selected.history);
        assert.equal(query(continuation,enemies.exports.presentation,enemy).miscInfo,nextCount);
        return{move:selected.history[0],count:nextCount,probability:node.probability};
      });
    }
    const left=successors(source),right=successors(other);assert.deepEqual(left,right);
    assert.deepEqual(new Set(left.map(row=>row.move)),new Set([moveId.BOOK_OF_STABBING_SINGLE_STAB,moveId.BOOK_OF_STABBING_MULTI_STAB]));
    assert.equal(left.reduce((sum,row)=>sum+row.probability,0),1);
    assert.deepEqual(source.machine.storage.export(source.machine.root),parent);
    assert.deepEqual(actual.current.machine.storage.export(actual.current.machine.root),before);
  }finally{CardProgram.prototype.initial=initialize;for(const current of owned)current.close();actual.current.close();}
});

test('normal AI generation stores joint changes and independent probability accounting in the current Context',()=>{
  const actual=actualCurrent(),enemy=firstEnemy(actual.current),root=actual.current.machine;
  try{
    const law=query(actual.current,enemies.exports.intentDistribution,enemy);assert.ok(law);assert.equal(law.reason,null);
    assert.ok(law.outcomes.length>0);assert.ok(law.paths.length>0);
    assert.ok(Math.abs(law.outcomes.reduce((mass,row)=>mass+row.probability,0)-1)<1e-12);
    assert.ok(law.outcomes.every(row=>row.values.length===law.paths.length));
    assert.ok(law.paths.every(path=>path.length>0&&/^\d+$/.test(path[0]!)),'only original entity component changes are retained');
    const account=stateOf(root.root.state).probabilityAccount!;assert.ok(account.captures>=2);assert.ok(account.advances>0);assert.ok(account.words>0);
    const saved=root.storage.export(root.root),initialize=CardProgram.prototype.initial;
    CardProgram.prototype.initial=function(){throw Error('Restore must not regenerate the distribution');};
    try{
      program.validate(saved);
      const restored=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(saved)));
      try{assert.deepEqual(query(restored,enemies.exports.intentDistribution,enemy),law);assert.deepEqual(stateOf(restored.machine.root.state).probabilityAccount,account);}
      finally{restored.close();}
    }finally{CardProgram.prototype.initial=initialize;}
  }finally{actual.current.close();}
});

test('exhausted forward accounting preserves normal AI execution and publishes no partial law',()=>{
  const actual=actualCurrent(),machine=actual.current.machine,enemy=firstEnemy(actual.current);
  const previous=query(actual.current,enemies.exports.current,enemy),rng=query(actual.current,random.exports.current,previous.aiRng);
  let deliveries=0;const detach=captureForwardFrontier(machine,{data:null,receive(frontier){deliveries++;for(const node of frontier.outcomes)node.current.close();}});
  try{
    const account=stateOf(machine.root.state).probabilityAccount!;
    stateOf(machine.root.state).probabilityAccount={...account,milliseconds:60_000};
    let stop=machine.advance(actual.action);while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    assert.equal(stop.kind,'call');
    const law=query(actual.current,enemies.exports.intentDistribution,enemy)!;
    assert.equal(law.reason,'forward-wall-budget');assert.deepEqual(law.outcomes,[]);assert.deepEqual(law.paths,[]);assert.equal(deliveries,0);
    assert.equal(query(actual.current,random.exports.current,previous.aiRng).counter,rng.counter+1);
    assert.equal(query(actual.current,enemies.exports.current,enemy).history[1],previous.history[0]);
  }finally{detach();actual.current.close();}
});


test('retained Book of Stabbing contexts execute the original battle-start update before saving the current decision',()=>{
  const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.BOOK_OF_STABBING,relics:['RUNIC_DOME'],potion:null,durable:true,elite:true,detailedEvents:true})));
  const root=new ProbabilityCurrent(machine),owned=new Set<Current>([root]),initialize=CardProgram.prototype.initial;
  let random={state:37851201,position:0};
  const entropy={check(){},word(){const next=searchEntropyWord(random);random=next.random;return next.value;}};
  try{
    CardProgram.prototype.initial=function(){throw Error('Current probability execution cannot initialize or replay');};
    // This is a fresh production entry moving forward for the first time.
    // Keep its current continuation when the FIRST AI selection is reached.
    let stop=machine.advanceProbability(),steps=0;
    while(!(stop.kind==='chance'&&stop.space.kind==='boundary'&&stop.space.name==='enemy-roll:before')){
      assert.ok(++steps<300,'first original AI boundary must be reachable');
      if(stop.kind==='chance'){
        const choice=generateProbability(stop.space,1,entropy,source=>machine.sampleProbability(source)).outcomes[0]!;
        stop=machine.advanceProbability(choice.coordinate);
      }else if(stop.kind==='call'&&stop.call.port==='event')stop=machine.advanceProbability(contract.ports.event.receive(stop.call.input).output);
      else throw Error('Original initialization did not reach its first AI selection');
    }
    // The original enemy initializer selects its first move before the combat
    // session is installed. The pending marker's original input is its owner.
    const enemy=machine.root.frames.at(-1)!.input;assert.equal(typeof enemy,'number');
    const before=machine.storage.export(machine.root);let words=0;
    const selected=nextProbability(root,0n,{maximum:8,untilBoundary:'enemy-roll:after',entropy:{check(){},word:()=>words++%2===0?0:99}});
    for(const node of selected.outcomes)owned.add(node.current);
    const source={...selected,outcomes:selected.outcomes.map(node=>({...node,data:{count:Number(query(node.current,enemies.exports.presentation,enemy).miscInfo),move:query(node.current,enemies.exports.current,enemy).history[0]!}}))};
    assert.deepEqual(new Set(source.outcomes.map(node=>node.data.move)),new Set([moveId.BOOK_OF_STABBING_SINGLE_STAB,moveId.BOOK_OF_STABBING_MULTI_STAB]));
    const current=nextProbabilityFrontier(source,()=>0n,{maximum:8,entropy,continueCall(stop,data){
      if(stop.call.port!=='event')return;return{reply:contract.ports.event.receive(stop.call.input).output,data};
    }});
    for(const node of current.outcomes)owned.add(node.current);
    const mass=new Map<number,number>();
    for(const node of current.outcomes){
      const stop=node.current.inspect();assert.equal(stop.kind,'call');if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected current player decision');
      assert.equal(query(node.current,enemies.exports.current,enemy).history[0],node.data.move);
      assert.equal(query(node.current,enemies.exports.presentation,enemy).miscInfo,node.data.count+1,'the original battle-start listener ran on this branch');
      mass.set(node.data.move,(mass.get(node.data.move)??0)+node.probability);
    }
    assert.deepEqual([...mass.values()],[.5,.5],'later random choices retain the joint selection mass');
    const saved=saveProbabilityFrontier(current);
    for(const node of [...source.outcomes,...current.outcomes]){node.current.close();owned.delete(node.current);}
    const restored=restoreProbabilityFrontier(program,saved);for(const node of restored.outcomes)owned.add(node.current);
    assert.deepEqual(saveProbabilityFrontier(restored),saved);
    for(const node of restored.outcomes)assert.equal(query(node.current,enemies.exports.presentation,enemy).miscInfo,node.data.count+1);
    assert.deepEqual(machine.storage.export(machine.root),before);
  }finally{CardProgram.prototype.initial=initialize;for(const current of owned)current.close();}
});


test('the real normal Book initializer hands its first-generation currents to the probability receiver before closing the scope',()=>{
  const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.BOOK_OF_STABBING,relics:['RUNIC_DOME'],potion:null,durable:true,elite:true,detailedEvents:true})));
  const actual=new ProbabilityCurrent(machine);let received:ProbabilityFrontier<{},CombatContentCase,Ports,Frame,null>|undefined,deliveries=0;
  const detach=captureForwardFrontier(machine,{data:null,continueCall(stop,data){if(stop.call.port!=='event')return;return{reply:contract.ports.event.receive(stop.call.input).output,data};},receive(frontier){received=frontier;deliveries++;}});
  const initialize=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('The original generation must not initialize again');};
  try{
    let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(contract.ports.event.receive(stop.call.input).output);
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual player decision');
    assert.ok(received);assert.equal(deliveries,1);assert.ok(received.outcomes.length>0&&received.outcomes.length<=8);
    assert.equal(received.representation,'particles');
    assert.ok(Math.abs(received.outcomes.reduce((sum,node)=>sum+node.probability,0)-1)<1e-12);
    const enemy=firstEnemy(actual),selected=query(actual,enemies.exports.current,enemy);
    assert.equal(selected.history[0],moveId.BOOK_OF_STABBING_SINGLE_STAB,'actual seeded AI still executes its original selection');
    assert.equal(query(actual,enemies.exports.presentation,enemy).miscInfo,1);
    assert.equal(query(actual,random.exports.current,selected.aiRng).counter,1);
    for(const node of received.outcomes){
      const stop=node.current.inspect();if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('A receiver may retain only the current public boundary');
      const childEnemy=firstEnemy(node.current),move=query(node.current,enemies.exports.current,childEnemy).history[0];
      assert.ok(move===moveId.BOOK_OF_STABBING_SINGLE_STAB||move===moveId.BOOK_OF_STABBING_MULTI_STAB);
      assert.equal(query(node.current,enemies.exports.presentation,childEnemy).miscInfo,move===moveId.BOOK_OF_STABBING_MULTI_STAB?2:1);
      assert.equal(node.current.machine.program,program);
    }
    const account=stateOf(machine.root.state).probabilityAccount!;assert.equal(account.captures,1);assert.ok(account.words>8);assert.ok(account.advances>received.outcomes.length);
    const saved=saveProbabilityFrontier(received);for(const node of received.outcomes)node.current.close();received=undefined;
    const restored=restoreProbabilityFrontier(program,saved);
    try{assert.deepEqual(saveProbabilityFrontier(restored),saved);assert.equal(query(actual,random.exports.current,selected.aiRng).counter,1);}
    finally{for(const node of restored.outcomes)node.current.close();}
  }finally{CardProgram.prototype.initial=initialize;detach();for(const node of received?.outcomes??[])node.current.close();actual.close();}
});

for(const upgraded of [false,true])for(const discard of [false,true])test(`accepted original scry ${upgraded?'three':'two'} cards and ${discard?'discard':'keep'} continues the actual current`,async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(trackedDefinition));
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
      const tracking=await inspectProbabilityTracking(instance);assert.ok(tracking);assert.equal(tracking.mode,'current');assert.equal(tracking.phase,'waiting');assert.equal(tracking.worlds,0);assert.equal(tracking.account.captures,0);
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
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(trackedDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.CULTIST,relics:[],potion:null,durable:true,elite:false,detailedEvents:true})),initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Every actual turn continues current frames');};
    let reply:{bits:number}|undefined,shuffled=false,previousDraw=Infinity;
    for(let turn=0;turn<=3;turn++){
      let accepted=false;
      unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{if(reply===undefined||accepted)return{kind:'pause'};accepted=true;return{kind:'reply',value:reply};}}));
      while(unwrap(await instance.run()).accepted){}
      const stop=unwrap(await instance.inspect());if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual next combat turn');
      const view=observe(stop.call.input),model=await inspectProbabilityTracking(instance);assert.ok(model);
      t.diagnostic(`turn=${turn}, draw=${view.battle!.drawCount}, account=${model.phase}, reason=${model.reason}`);
      assert.equal(model.mode,'current');assert.equal(model.phase,'waiting');assert.equal(model.worlds,0);assert.equal(model.account.captures,0);assert.equal(view.battle!.turn,turn);
      if(view.battle!.drawCount>previousDraw)shuffled=true;previousDraw=view.battle!.drawCount;
      reply=stop.call.input.actions.find(action=>describeAction(view,action.bits).kind==='end-turn');assert.ok(reply);
    }
    assert.equal(shuffled,true,'the original draw path must actually exhaust and shuffle the discard pile');
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());}
});


for(const character of ['ironclad','volibear'] as const)for(const visible of [false,true])test(`${character} Frozen Eye=${visible} original Deep Breath keeps fresh shuffled suffixes uncertain after restore`,async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(trackedDefinition));
  let instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.CULTIST,relics:visible?['THE_ABACUS','SUNDIAL','FROZEN_EYE']:['THE_ABACUS','SUNDIAL'],potion:null,durable:true,elite:false,detailedEvents:true,bottledCard:'DEEP_BREATH'}));
  const original=instance,initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Shuffle continuation cannot initialize');};
    const advance=async(reply?:{bits:number})=>{
      let sent=false;unwrap(await instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>{if(reply===undefined||sent)return{kind:'pause'};sent=true;return{kind:'reply',value:reply};}}));
      while(unwrap(await instance.run()).accepted){}
      const stop=unwrap(await instance.inspect());if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected actual combat decision');
      const model=await inspectProbabilityTracking(instance);assert.equal(model!.mode,'current');assert.equal(model!.phase,'waiting');assert.equal(model!.worlds,0);assert.equal(model!.account.captures,0);return stop.call.input;
    };
    const first=await advance(),view=observe(first),play=first.actions.find(action=>{const d=describeAction(view,action.bits);return d.kind==='play-card'&&view.battle!.hand[Number(d.details.hand)]?.id!=='DEEP_BREATH';});assert.ok(play);
    const afterPlay=await advance(play),ready=observe(afterPlay);assert.ok(ready.battle!.discard.length>0,'the original card must create a discard pile');
    const before=unwrap(await original.inspect()),saved=unwrap(await loaded.persistence!.save(original));instance=unwrap(await loaded.persistence!.restore(saved));
    const breath=afterPlay.actions.find(action=>{const d=describeAction(ready,action.bits);return d.kind==='play-card'&&ready.battle!.hand[Number(d.details.hand)]?.id==='DEEP_BREATH';});assert.ok(breath);
    const next=observe(await advance(breath));assert.equal(next.battle!.hand.length,ready.battle!.hand.length);assert.ok(next.battle!.discard.some(card=>card.id==='DEEP_BREATH'));
    assert.equal(next.battle!.player.block,ready.battle!.player.block+6,'the original Abacus shuffle event fires once');
    const currentSaved=unwrap(await loaded.persistence!.save(instance)),snapshot=deserialize((await store.get(currentSaved.snapshotId))!);
    const actual=await takeProbabilityCurrent<Ports,Frame>(unwrap(await instance.fork!()));
    assert.equal(snapshot.tracking.frontier,null);
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
