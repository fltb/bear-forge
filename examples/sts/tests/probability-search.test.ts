import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {CardProgram} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {SearchSession} from '@bear-forge/policies/search/session';
import {ProbabilityCurrent,ProbabilityBudgetStopped} from '@bear-forge/runtime-card/probability';
import {addMass,multiplyMass,unitMass,zeroMass} from '@bear-forge/card-engine/probability-mass';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {contract} from '../src/contract.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';
import {takeStsSearchCurrent,stsExactDomain,type StsExpansionSnapshot,type StsSearchCurrent} from '../src/search/current-session.ts';
import {readStsCurrent} from '../src/search/probability-current.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {enemies} from '../src/rules/enemies.ts';

const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
async function fixture(character:'ironclad'|'volibear'='ironclad',intent=false){
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',character,encounter:intent?encounterId.BOOK_OF_STABBING:encounterId.CULTIST,
    relics:intent?['RUNIC_DOME']:[],potion:intent?null:potionId.ATTACK_POTION,durable:true,elite:intent,detailedEvents:true}));
  const game=unwrap(await createGameBinder().bind({instance,contract})),events:StsEvent[]=[];
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));
  unwrap(await game.run());
  const before=unwrap(await game.inspect());if(before.kind!=='request')throw Error('Expected root request');
  const root=await takeStsSearchCurrent(async()=>unwrap(await game.fork!()),events),view=readStsCurrent(root.current,root.events);
  return{game,before,root,domain:stsExactDomain(root.current.machine.program,view.decision.observation,events.length)};
}
function mass(snapshot:StsExpansionSnapshot){
  const pending=snapshot.pending.reduce((sum,row)=>addMass(sum,row.phase==='chance'?[{mass:row.mass,cursor:row.cursor},...row.remainder??[]].reduce((total,piece)=>addMass(total,multiplyMass(piece.mass,piece.cursor.remaining)),zeroMass()):row.mass),zeroMass());
  const ready=snapshot.ready.reduce((sum,row)=>addMass(sum,row.mass),zeroMass());
  assert.deepEqual(addMass(addMass(pending,ready),snapshot.transferred),unitMass());
  return{pending,ready,transferred:snapshot.transferred};
}

test('production potion search retains its complete support across cold continuation without sampled worlds',async()=>{
  const f=await fixture(),initialize=CardProgram.prototype.initial;
  let session=SearchSession.from(f.domain,f.root);
  try{
    CardProgram.prototype.initial=()=>{throw Error('Search must not initialize');};
    // A finite inspection window tests an unfinished graph. It is not a
    // production depth/space limit and it never supplies a fallback action.
    for(let i=0;i<128;i++)assert.equal(session.step(),true);
    const saved=deserialize(serialize(session.save()));
    assert.equal(session.evidence().status,'incomplete');assert.equal(session.evidence().action,null);
    assert.ok(saved.queue.length>0);let frontiers=0;
    for(const execution of saved.executions)for(const edge of execution.edges)if(edge.expansion){
      frontiers++;mass(edge.expansion);
      assert.deepEqual(edge.outcomes.reduce((sum:any,row:any)=>addMass(sum,row.mass),zeroMass()),edge.expansion.transferred);
    }
    assert.ok(frontiers>0);
    session.close();session=SearchSession.restore(f.domain,saved);
    assert.equal(session.evidence().steps,saved.steps);
    for(let i=0;i<128;i++)assert.equal(session.step(),true);
    assert.ok(session.evidence().steps>saved.steps);
    for(const execution of session.save().executions)for(const edge of execution.edges)if(edge.expansion)mass(edge.expansion);
    assert.deepEqual(unwrap(await f.game.inspect()),f.before);
  }finally{CardProgram.prototype.initial=initialize;session.close();unwrap(await f.game.close());}
});

test('interruption before a production advance preserves the exact graph and resumes the same edge',async()=>{
  const f=await fixture(),advance=ProbabilityCurrent.prototype.advanceExact;
  let session=SearchSession.from(f.domain,f.root),calls=0;
  try{
    ProbabilityCurrent.prototype.advanceExact=function(...args){if(++calls===3)throw new ProbabilityBudgetStopped();return advance.apply(this,args);};
    assert.throws(()=>{for(;;)session.step();},ProbabilityBudgetStopped);
    ProbabilityCurrent.prototype.advanceExact=advance;
    const saved=deserialize(serialize(session.save()));assert.ok(saved.steps>0n);assert.ok(saved.queue.length>0);
    for(const execution of saved.executions)for(const edge of execution.edges)if(edge.expansion)mass(edge.expansion);
    session.close();session=SearchSession.restore(f.domain,saved);
    assert.deepEqual(session.save(),saved,'restore loads the saved current graph without advancing it');
    assert.equal(session.step(),true);assert.ok(session.evidence().steps>saved.steps);
    assert.deepEqual(unwrap(await f.game.inspect()),f.before);
  }finally{ProbabilityCurrent.prototype.advanceExact=advance;session.close();unwrap(await f.game.close());}
});

for(const character of ['ironclad','volibear'] as const)test(`${character}: consecutive exact turns execute the authorized current intent through original enemy callbacks`,async()=>{
  const f=await fixture(character,true),initialize=CardProgram.prototype.initial;
  let root:StsSearchCurrent=f.root;
  const retained:ReturnType<typeof f.domain.next>[]=[],hitsPerTurn:number[]=[];
  CardProgram.prototype.initial=()=>{throw Error('Continuation must not initialize or replay');};
  try{
    for(let turn=0;turn<2;turn++){
      const view=readStsCurrent(root.current,root.events),before=root.current.machine.storage.export(root.current.machine.root);
      const query=<I,O>(q:Parameters<typeof inspectRuleQuery<I,O>>[2],input:I)=>inspectRuleQuery(combatContentDefinition,root.current.machine.root.state,q,input);
      const run=query(adventures.exports.instances,undefined)[0]!,battle=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!);
      const enemy=battle.roster[0]!,controller=enemy.controller!,actor=enemy.actor!;
      const intent=query(enemies.exports.intent,controller),move=query(enemies.exports.current,controller).history[0];
      assert.equal(view.decision.observation.battle!.intentHidden,true);assert.deepEqual(view.decision.observation.battle!.intents,[]);
      const end=view.decision.actions.find(action=>action.bits>>>29===4);assert.ok(end);
      let expansion=f.domain.next(root,String(end.bits));retained.push(expansion);
      // Resume the current partial edge once; no repeated end-turn input.
      expansion.step();const saved=deserialize(serialize(expansion.save()));mass(saved);
      expansion.close();expansion=f.domain.restoreExpansion(saved);retained[retained.length-1]=expansion;
      let outcome=expansion.take();while(!outcome){assert.equal(expansion.complete,false);expansion.step();outcome=expansion.take();}
      const successor=outcome.current;
      try{
        const next=readStsCurrent(successor.current,successor.events).decision;
        assert.equal(next.observation.battle!.turn,view.decision.observation.battle!.turn+1);
        const events=successor.events.slice(root.events.length);
        const actions=events.filter(event=>event.kind==='detail'&&event.type==='enemy-action'&&event.data.enemy===controller);
        assert.equal(actions.length,1);assert.equal(actions[0]!.kind,'detail');
        if(actions[0]!.kind==='detail')assert.equal(actions[0]!.data.move,move,'no reroll of the already chosen enemy intent');
        const hits=events.filter(event=>event.kind==='detail'&&event.type==='damage'&&event.data.source===actor);
        assert.equal(hits.length,intent.hits);assert.ok(hits.every(event=>event.kind==='detail'&&event.data.requested===intent.attackDamage&&event.data.attack===intent.attack));
        hitsPerTurn.push(hits.length);
        assert.deepEqual(root.current.machine.storage.export(root.current.machine.root),before);
        mass(expansion.save());
        // Keep every unvisited outcome in its original expansion. A chosen
        // child is only a continuation fixture, never evidence of a full solve.
        const nextSaved=deserialize(serialize(f.domain.save(successor)));
        f.domain.close(root);root=f.domain.restore(nextSaved);
      }finally{f.domain.close(successor);}
    }
    assert.ok(hitsPerTurn.every(hits=>hits>0));assert.equal(new Set(hitsPerTurn).size,2);
    assert.deepEqual(unwrap(await f.game.inspect()),f.before);
  }finally{CardProgram.prototype.initial=initialize;for(const expansion of retained)expansion.close();f.domain.close(root);unwrap(await f.game.close());}
});
