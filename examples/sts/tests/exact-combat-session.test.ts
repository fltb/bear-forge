import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {inflateRawSync} from 'node:zlib';
import {publicKey,compressedPublicKey} from '../src/search/information.ts';
import {CardMachine,CardProgram} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {unitMass,numericMass,addMass,subtractMass,zeroMass} from '@bear-forge/card-engine/probability-mass';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import {combatFinishedBoundary} from '../src/adapters/ports.ts';
import {readStsCurrent} from '../src/search/probability-current.ts';
import {stsExactDomain} from '../src/search/current-session.ts';
import {exactCombatPosition} from '../src/search/combat-objective.ts';
import type {StsSearchCurrent} from '../src/search/current-session.ts';
import type {Ports,Frame,StsEvent} from '../src/game.schemas.ts';

for(const card of ['SHRUG_IT_OFF','POMMEL_STRIKE'] as const)for(const cold of [false,true])test(`original ${card} public prefix survives its unexpanded draw space; cold=${cold}`,()=>{
  const program=new CardProgram(combatContentDefinition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',character:'ironclad',
    encounter:encounterId.JAW_WORM,relics:[],potion:null,durable:false,elite:false,bottledCard:card,detailedEvents:true},100_000_000)));
  let stop=machine.advance();const events:StsEvent[]=[];
  while(stop.kind==='call'&&stop.call.port==='event'){events.push(...stop.call.input);stop=machine.advance(null);}
  const root={current:new ProbabilityCurrent(machine) as ProbabilityCurrent<unknown,unknown,Ports,Frame>,events};
  const view=readStsCurrent(root.current,events),initial=view.decision.observation;
  const hand=initial.battle!.hand.findIndex(c=>c.id===card);
  const action=view.decision.actions.find(a=>a.bits>>>29===0&&(a.bits&0xffff)===hand)!;
  assert.ok(action);assert.ok(initial.battle!.intents!.some(intent=>intent.attack));
  const before=root.current.machine.storage.export(root.current.machine.root),domain=stsExactDomain(root.current.machine.program,initial,events.length);
  const baseline=exactCombatPosition(view.decision,initial,events.length).utility!;
  let expansion=domain.next(root,String(action.bits));
  try{
    let observed:ReturnType<typeof expansion.take>,steps=0;
    while(!observed){assert.ok(++steps<1000);expansion.step();observed=expansion.take();}
    domain.close(observed.current);
    assert.ok(expansion.delivered.numerator<expansion.delivered.denominator,'a real draw law remains open');
    if(cold){const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=domain.restoreExpansion(saved);}
    const advance=CardMachine.prototype.advanceExactProbability,initialize=CardProgram.prototype.initial;
    CardMachine.prototype.advanceExactProbability=()=>{throw Error('Prefix reads cannot execute');};
    CardProgram.prototype.initial=()=>{throw Error('Prefix reads cannot initialize');};
    try{
      const prefixes=expansion.localFrontier!();assert.ok(prefixes.length>0);
      assert.ok(prefixes.every(row=>row.utility>baseline),'original block/damage applies to every unfinished draw prefix');
      assert.deepEqual(prefixes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),subtractMass(unitMass(),expansion.delivered));
      assert.deepEqual(expansion.localFrontier!(),prefixes,'reads do not consume or modify the retained law');
      assert.deepEqual(root.current.machine.storage.export(root.current.machine.root),before,'the real source Context is unchanged');
    }finally{CardMachine.prototype.advanceExactProbability=advance;CardProgram.prototype.initial=initialize;}
  }finally{expansion.close();domain.close(root);}
});

test('current projection reuse proves full state and event equality, detaches results and releases its witness',()=>{
  const program=new CardProgram(combatContentDefinition);
  const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',character:'ironclad',
    encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true},100_000_000)));
  let stop=machine.advance();const events:StsEvent[]=[];
  while(stop.kind==='call'&&stop.call.port==='event'){events.push(...stop.call.input);stop=machine.advance(null);}
  const root={current:new ProbabilityCurrent(machine) as ProbabilityCurrent<unknown,unknown,Ports,Frame>,events};
  const decision=readStsCurrent(root.current,events).decision,initial=structuredClone(decision.observation);
  const domain=stsExactDomain(root.current.machine.program,initial,0),saved=domain.save(root);
  const passive=readStsCurrent(root.current,events,true);assert.deepEqual(passive.decision,decision);
  assert.deepEqual(domain.save(root),saved,'passive projection preserves the entire original current');
  const copy=domain.restore(saved),collision=domain.restore(saved);
  const inspect=ProbabilityCurrent.prototype.inspectPublication,initialize=CardProgram.prototype.initial,advance=CardMachine.prototype.advanceExactProbability;
  let reads=0,fail=true;
  // Inject at the domain's actual read boundary, including passive reads of
  // parked images which do not need CardMachine's writable execution graph.
  ProbabilityCurrent.prototype.inspectPublication=function(){reads++;if(fail)throw Error('projection-failure');return inspect.call(this);};
  CardProgram.prototype.initial=()=>{throw Error('Projection must not initialize');};
  CardMachine.prototype.advanceExactProbability=()=>{throw Error('Projection must not execute');};
  try{
    assert.throws(()=>domain.position(root),/projection-failure/);fail=false;
    const expected=exactCombatPosition(decision,initial,0),first=domain.position(root);assert.deepEqual(first,expected);assert.equal(reads,2);
    assert.equal(inflateRawSync(Buffer.from(first.information,'base64')).toString('utf8'),
      publicKey({...decision,observation:{...decision.observation,history:[]}}),'the key retains the entire original public projection');
    first.information='modified caller result';(first.actions[0]!.action as {bits:number}).bits=-1;
    assert.deepEqual(domain.position(copy),expected);assert.equal(reads,2,'equal cold current reuses its original projection');
    initial.battle!.player.maxHp*=2;
    assert.deepEqual(domain.position(copy),exactCombatPosition(decision,initial,0));assert.equal(reads,2,'current heuristic inputs are recomputed');
    // A forced candidate collision must still check the complete original
    // control state. This changes only a test-owned equality counter.
    const key=root.current.candidateKey();collision.current.machine.root.nextCall++;
    collision.current.candidateKey=()=>key;
    domain.position(collision);assert.equal(reads,3,'digest equality alone never establishes a projection witness');
    domain.close(root);
    domain.position(copy);assert.equal(reads,4,'closing the owning current releases its private cached witness');
    copy.events.push(structuredClone(events[0]!));domain.position(copy);assert.equal(reads,5,'different event histories cannot reuse a projection');
  }finally{
    ProbabilityCurrent.prototype.inspectPublication=inspect;CardProgram.prototype.initial=initialize;CardMachine.prototype.advanceExactProbability=advance;
    domain.close(collision);domain.close(copy);domain.close(root);
  }
});

// Fixture setup uses original acquisition and combat construction. The action,
// enemy deaths, scope cleanup and both healing reactions are production rules.
test('exact combat ends after original victory healing and before the adventure continuation',()=>{
  const program=new CardProgram(combatContentDefinition);
  const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',character:'ironclad',
    encounter:encounterId.TWO_LOUSE,relics:['LIZARD_TAIL','SACRED_BARK','MEAT_ON_THE_BONE'],
    potion:potionId.EXPLOSIVE_POTION,durable:false,elite:false,detailedEvents:true},100_000_000)));
  let stop=machine.advance();const events:StsEvent[]=[];
  while(stop.kind==='call'&&stop.call.port==='event'){events.push(...stop.call.input);stop=machine.advance(null);}
  assert.equal(stop.kind,'call');
  const root={current:new ProbabilityCurrent(machine) as ProbabilityCurrent<unknown,unknown,Ports,Frame>,events};
  const before=root.current.machine.storage.export(root.current.machine.root),view=readStsCurrent(root.current,events);
  const initial=view.decision.observation;
  assert.equal(initial.game.hp,1);
  assert.ok(initial.battle!.monsters.every(monster=>monster.hp<=20));
  const action=view.decision.actions.find(action=>action.bits>>>29===1&&((action.bits>>>16)&8191)===0);
  assert.ok(action);
  const domain=stsExactDomain(root.current.machine.program,initial,events.length);
  const same={current:root.current.fork(),events:structuredClone(events)};
  try{
    assert.equal(domain.equivalent!(root,same),true,'the original full Context and raw event history agree');
    same.current.machine.root.nextCall++;
    assert.equal(domain.equivalent!(root,same),false,'control identities are not removed to force a match');
  }finally{domain.close(same);}
  const withHistory={current:root.current.fork(),events:structuredClone(events)};
  try{
    assert.ok(events.length>0);withHistory.events.push(structuredClone(events[0]!));
    assert.equal(domain.equivalent!(root,withHistory),false,'future observations also depend on retained event history');
  }finally{domain.close(withHistory);}
  const compact=domain.save(root);assert.ok('packed' in compact,'production stores compressed current data');
  const legacy=domain.restore({...root.current.snapshot(),events:structuredClone(events)});
  try{assert.equal(domain.equivalent!(root,legacy),true,'existing raw current snapshots remain directly restorable');}finally{domain.close(legacy);}
  const currentSave=deserialize(serialize(compact)),restoredLeft=domain.restore(currentSave),restoredRight=domain.restore(currentSave);
  try{assert.equal(domain.equivalent!(restoredLeft,restoredRight),true,'cold witnesses compare their current graphs without executing them');}
  finally{domain.close(restoredLeft);domain.close(restoredRight);}
  let expansion=domain.next(root,String(action.bits)),terminal:StsSearchCurrent|undefined,sawPrivatePrefix=false;
  const original=CardProgram.prototype.initial,allMasses=ProbabilityExpansion.prototype.masses;
  CardProgram.prototype.initial=()=>{throw Error('Cannot initialize during next or restore');};
  ProbabilityExpansion.prototype.masses=()=>{throw Error('Scheduling must not scan unconsumed probability support');};
  try{
    while(!expansion.complete){
      expansion.step();const saved=deserialize(serialize(expansion.save()));
      const prefixMass=expansion.localFrontier!().reduce((sum,row)=>addMass(sum,row.mass),zeroMass());
      const fallback=subtractMass(subtractMass(unitMass(),expansion.delivered),prefixMass);
      assert.ok(fallback.numerator>=0n);sawPrivatePrefix||=fallback.numerator>0n;
      assert.deepEqual(expansion.delivered,saved.transferred);
      expansion.delivered.numerator=99n;
      assert.deepEqual(expansion.delivered,saved.transferred,'a scheduling read cannot mutate the transferred ledger');
      for(const row of [...saved.pending,...saved.ready]){
        assert.ok('packed' in row,'production retains compressed Contexts through save');
        assert.equal(typeof row.data.events,'string','branch metadata retains the full compressed event history');
      }
      expansion.close();expansion=domain.restoreExpansion(saved);
      assert.deepEqual(expansion.delivered,saved.transferred);
    }
    const outcome=expansion.take();assert.ok(outcome);terminal=outcome.current;
    assert.ok(sawPrivatePrefix,'private event/cleanup stops retain unknown source-prior mass without publishing a synthetic board');
    assert.deepEqual(outcome.mass,unitMass());assert.equal(expansion.take(),undefined);
    assert.deepEqual(expansion.delivered,unitMass());
    assert.deepEqual(terminal.current.inspect(),{kind:'chance',space:{kind:'boundary',name:combatFinishedBoundary}});
    const saved=deserialize(serialize(domain.save(terminal)));domain.close(terminal);terminal=domain.restore(saved);
    const exit=readStsCurrent(terminal.current,terminal.events).decision;
    assert.equal(exit.observation.battle,null);
    assert.equal(exit.observation.game.screen,'BATTLE','caller has not advanced to MAP_SCREEN');
    assert.equal(exit.observation.game.hp,19,'Burning Blood and Meat on the Bone each settle once');
    assert.ok(!exit.observation.game.potions.includes(potionId.EXPLOSIVE_POTION));
    assert.deepEqual(exit.actions,[]);
    assert.deepEqual(domain.position(terminal).terminal?.slice(0,2),[unitMass(),numericMass(19)]);
    assert.deepEqual(root.current.machine.storage.export(root.current.machine.root),before,'parent Context is unchanged');
  }finally{CardProgram.prototype.initial=original;ProbabilityExpansion.prototype.masses=allMasses;expansion.close();if(terminal)domain.close(terminal);domain.close(root);}
});

test('retained event histories compress complete data, preserve mutable ownership and convert old pending snapshots without execution',()=>{
  const program=new CardProgram(combatContentDefinition);
  const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',character:'ironclad',
    encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,detailedEvents:true},100_000_000)));
  let stop=machine.advance();const events:StsEvent[]=[];
  while(stop.kind==='call'&&stop.call.port==='event'){events.push(...stop.call.input);stop=machine.advance(null);}
  assert.ok(events.length);
  const long=Array.from({length:1000},(_,i)=>structuredClone(events[i%events.length]!));
  const root={current:new ProbabilityCurrent(machine) as ProbabilityCurrent<unknown,unknown,Ports,Frame>,events:long};
  const decision=readStsCurrent(root.current,long).decision,domain=stsExactDomain(root.current.machine.program,decision.observation,0);
  const saved=domain.save(root),left=domain.restore(saved),right=domain.restore(saved);
  const expansion=domain.next(root,String(decision.actions[0]!.bits)),pending=expansion.save();
  const decode=(value:string|StsEvent[])=>typeof value==='string'?deserialize(inflateRawSync(Buffer.from(value,'base64'))):value;
  const legacy={...pending,pending:pending.pending.map(row=>({...row,data:{events:decode(row.data.events)}})),ready:pending.ready.map(row=>({...row,data:{events:decode(row.data.events)}}))};
  const original=CardProgram.prototype.initial,advance=CardMachine.prototype.advanceExactProbability;
  CardProgram.prototype.initial=()=>{throw Error('Event restore must not initialize');};
  CardMachine.prototype.advanceExactProbability=()=>{throw Error('Event restore must not execute');};
  let restored:ReturnType<typeof domain.restoreExpansion>|undefined;
  try{
    assert.equal(typeof saved.events,'string');
    assert.ok(serialize(saved.events).length<serialize(long).length/4);
    assert.deepEqual(decode(saved.events),long);
    assert.equal(domain.equivalent!(left,right),true);
    assert.deepEqual(left.events,long);left.events.push(structuredClone(events[0]!));
    assert.deepEqual(right.events,long,'exposing and mutating one current cannot affect its sibling');
    assert.deepEqual(decode(saved.events),long,'saved data is detached from exposed current arrays');
    assert.equal(domain.equivalent!(left,right),false);
    assert.deepEqual(decode(domain.save(left).events),left.events,'later mutations must be included in the next save');
    right.events=[];assert.deepEqual(decode(domain.save(right).events),[],'replacing the public array remains supported');
    restored=domain.restoreExpansion(legacy);const compact=restored.save();
    const normalize=(value:typeof compact)=>({...value,pending:value.pending.map(row=>({...row,data:{events:decode(row.data.events)}})),ready:value.ready.map(row=>({...row,data:{events:decode(row.data.events)}}))});
    assert.deepEqual(normalize(compact),normalize(pending),'all current states, probability cursors, masses and metadata survive conversion');
    for(const row of [...compact.pending,...compact.ready])assert.equal(typeof row.data.events,'string');
  }finally{
    CardProgram.prototype.initial=original;CardMachine.prototype.advanceExactProbability=advance;
    restored?.close();expansion.close();domain.close(root);domain.close(left);domain.close(right);
  }
});


test('compressed public keys preserve complete canonical data, distant events and Unicode without hashes',()=>{
  const events=Array.from({length:1000},(_,i)=>({kind:'detail',type:'same mechanism',data:{sequence:i,text:'公开信息😀\ud800',amount:7,visible:true,missing:null}}));
  const value={events,actions:[{bits:2147483648}],nested:{b:2,a:1}},plain=publicKey(value),packed=compressedPublicKey(value);
  assert.equal(inflateRawSync(Buffer.from(packed,'base64')).toString('utf8'),plain);
  assert.ok(packed.length<plain.length/4,'repeated complete public data should occupy substantially less retained key storage');
  assert.equal(compressedPublicKey({nested:{a:1,b:2},actions:[{bits:2147483648}],events}),packed,'canonical property-order equivalence is unchanged');
  const changed=structuredClone(value);changed.events[999]!.data.text+='different';
  assert.notEqual(compressedPublicKey(changed),packed,'the end of a long history is not truncated');
  const reordered=structuredClone(value);reordered.events.reverse();assert.notEqual(compressedPublicKey(reordered),packed);
});
