import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {enemyContinuationDefinition as definition,performedEnemyActions,type EnemyContinuationCase} from './enemy-continuation-fixture.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {enemies} from '../src/rules/enemies.ts';
import {turns} from '../src/rules/turns.ts';
import {battles} from '../src/rules/battles.ts';
import {powers} from '../src/rules/powers.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {bronzeOrb} from '../src/content/enemies/city/bronze-orb.ts';
import {beyondBosses} from '../src/content/enemies/beyond/bosses.ts';
import {combatStorageViews} from '../src/adapters/combat-storage-views.ts';
import {moveId} from '../src/combat-identifiers.ts';
import {formatDecision,presentDecision} from '../src/presentation.ts';
import {observe} from '../src/contract.ts';
import type {Frame} from '../src/game.schemas.ts';

const END=(4<<29)>>>0;
const program=new CardProgram(definition);
function driver(scenario:EnemyContinuationCase['scenario'],domain=false,extra:Partial<Pick<EnemyContinuationCase,'thiefSlot'|'thiefMove'|'fullHand'>>={}){
  const storage=privateCardGraph(program.initial({seed:'130',scenario,domain,...extra},100_000_000)),machine=new CardMachine(program,storage);
  let stop=machine.advance();
  function frame():Frame{
    while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected combat decision: '+JSON.stringify(stop));
    return stop.call.input;
  }
  const query=<I,O>(q:Parameters<typeof inspectRuleQuery<I,O>>[2],input:I)=>inspectRuleQuery(definition,machine.root.state,q,input);
  function session(){const run=query(adventures.exports.instances,undefined)[0]!;return query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!);}
  function act(bits:number){assert.ok(frame().actions.some(a=>a.bits===bits),'action must be legal');stop=machine.advance({bits});return frame();}
  function play(id:string,target=0){const f=frame(),card=f.battle!.hand.findIndex(c=>c.id===id);assert.notEqual(card,-1,id+' in hand');return act((target<<16)|card);}
  return{frame,act,play,query,session,actions:()=>query(performedEnemyActions,undefined),close:()=>storage.close()};
}

for(const domain of [false,true])for(const phase of ['player','enemy'] as const){
  test(`Time Warp crosses 11/12/13 cards without mixing strength and early end; domain=${domain}, phase=${phase}`,()=>{
    const d=driver('warp',domain);
    try{
      const s=d.session(),owner=s.roster[0]!.actor!,power=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor:owner,definition:beyondBosses.exports.TimeWarp})!;
      assert.equal(d.query(powers.exports.level,power),10);
      d.play(domain?'FIXTURE_DOMAIN':'VOLIBEAR_B02');
      assert.equal(d.query(powers.exports.level,power),domain?10:11);assert.equal(d.frame().battle!.turn,0);
      const f=phase==='player'?d.play('VOLIBEAR_C11',0):d.play('VOLIBEAR_B02');
      assert.equal(d.query(powers.exports.level,power),domain?10:0);
      assert.equal(f.battle!.monsters[0]!.strength,domain?0:2,'domain disables the entire Time Warp ability');
      assert.equal(f.battle!.turn,domain?0:1,'only the unsuppressed early-end operation ends the player turn');
      if(domain){
        d.play('VOLIBEAR_B02');assert.equal(d.query(powers.exports.level,power),10);assert.equal(d.frame().battle!.monsters[0]!.strength,0);
        assert.equal(d.frame().battle!.turn,0);d.act(END);
      }
      assert.equal(d.actions().length,1,'engaging on card 12 must not duplicate the normal enemy action');
      assert.equal(d.query(turns.exports.current,s.controller).phase,0);
    }finally{d.close();}
  });
}

for(const domain of [false,true])for(const phase of ['player','enemy'] as const){
  test(`Writhing Mass implant changes the permanent deck only outside domain; domain=${domain}, phase=${phase}`,()=>{
    const d=driver('implant',domain);
    try{
      // Combat publications keep the room-entry game snapshot. Check the actual
      // permanent deck in the controlled Context rather than that frozen DTO.
      const run=d.query(adventures.exports.instances,undefined)[0]!,deck=d.query(adventures.exports.bindings,run).deck;
      const count=()=>d.query(permanentDecks.exports.view,deck).deck.filter(c=>c.id==='PARASITE').length,before=count();
      assert.equal(d.frame().battle!.intents![0]!.name,'WRITHING_MASS_IMPLANT');
      if(domain)d.play('FIXTURE_DOMAIN');
      if(phase==='player')d.play('VOLIBEAR_C11',0);else d.act(END);
      assert.equal(count(),before+(domain?0:1));assert.equal(d.actions().length,1);assert.equal(d.actions()[0]!.move,moveId.WRITHING_MASS_IMPLANT);
      assert.notEqual(d.frame().battle!.intents![0]!.name,'WRITHING_MASS_IMPLANT','AI advances even when the implant is suppressed');
      assert.equal(d.query(turns.exports.current,d.session().controller).phase,0);
    }finally{d.close();}
  });
}

for(const domain of [false,true])for(const phase of ['player','enemy'] as const)for(const thiefSlot of [0,1])for(const thiefMove of ['mug','smoke','escape'] as const){
  test(`thief ${thiefSlot} ${thiefMove} keeps attack/block separate from theft/escape; domain=${domain}, phase=${phase}`,()=>{
    const d=driver('thieves',domain,{thiefSlot,thiefMove});
    try{
      const initial=d.frame(),controller=d.session().roster[thiefSlot]!.controller!,gold=initial.game.gold;
      if(domain)d.play('FIXTURE_DOMAIN');
      const hp=d.frame().battle!.player.hp,block=d.frame().battle!.player.block+(phase==='player'?8:0);
      if(phase==='player')d.play('VOLIBEAR_C11',thiefSlot);else d.act(END);
      const f=d.frame(),state=d.query(enemies.exports.current,controller),stolen=d.query(enemies.exports.presentation,controller).miscInfo;
      const attacks=Number(thiefMove==='mug')+Number(phase==='enemy');
      assert.equal(f.game.gold,gold-(domain?0:attacks*20));
      assert.equal(stolen,!domain&&thiefMove==='mug'?20:0,'only a successful theft updates stolen gold');
      assert.equal(state.escaped,thiefMove==='escape'&&!domain);
      assert.equal(f.battle!.player.hp,hp-Math.max(0,11*attacks-block),'domain must not suppress either thief attack');
      if(thiefMove==='smoke'){
        assert.equal(f.battle!.monsters[thiefSlot]!.block,thiefSlot===1?17:6);
        assert.equal(state.history[0],thiefSlot===1?moveId.MUGGER_ESCAPE:moveId.LOOTER_ESCAPE);
      }
      if(thiefMove==='escape'&&domain){
        if(phase==='player')d.act(END);
        assert.equal(d.frame().battle!.domain!.active,false);d.act(END);
        assert.equal(d.query(enemies.exports.current,controller).escaped,true,'escape becomes possible once the domain expires');
      }
    }finally{d.close();}
  });
}

for(const domain of [false,true])for(const phase of ['player','enemy'] as const)for(const fullHand of [false,true]){
  test(`Stasis returns the exact card on death, including inside domain; domain=${domain}, phase=${phase}, full=${fullHand}`,()=>{
    const d=driver('orb',domain,{fullHand});
    try{
      const s=d.session(),actor=s.roster[0]!.actor!,registry=d.query(battles.exports.status,s.battle).registry,piles=d.query(battles.exports.status,s.battle).piles;
      if(phase==='player')d.play('VOLIBEAR_C11',0);else d.act(END);
      const power=d.query(powers.exports.find,{registry,actor,definition:bronzeOrb.exports.Stasis});assert.notEqual(power,null);
      const zone=d.query(bronzeOrb.exports.heldZone,power!)!,held=d.query(zones.exports.members,zone);assert.equal(held.length,1);
      const card=held[0]!,identity=d.query(cardInstances.exports.current,card).uniqueId;
      assert.ok(!d.query(cardPiles.exports.membership,piles).registered.includes(card));
      if(domain)d.play('FIXTURE_DOMAIN');
      assert.equal(d.frame().battle!.domain!.active,domain);
      assert.deepEqual(d.query(zones.exports.members,zone),[card],'opening domain must preserve the stored card');
      assert.ok(d.query(combatStorageViews.exports.slots,registry).some(slot=>slot.zone===zone),'domain must not hide existing storage');
      const handSize=d.frame().battle!.hand.length;if(fullHand)assert.equal(handSize,10);else assert.ok(handSize<10);
      const fire=presentDecision(observe(d.frame()),d.frame().actions).actions.find(a=>a.kind==='drink-potion'&&a.details.target===0);assert.ok(fire);
      d.act(fire.bits);
      assert.equal(d.frame().battle!.monsters[0]!.hp,0);assert.deepEqual(d.query(zones.exports.members,zone),[]);
      assert.equal(d.query(cardPiles.exports.membership,piles).registered.filter(c=>c===card).length,1);
      const pile=d.query(cardPiles.exports.bindings,piles),destination=fullHand?pile.discard:pile.hand;
      assert.ok(d.query(zones.exports.members,destination).includes(card),fullHand?'full hand returns the card to discard':'free hand receives the returned card');
      assert.equal(d.query(cardInstances.exports.current,card).uniqueId,identity);
      d.act(END);
      assert.equal(d.query(cardPiles.exports.membership,piles).registered.filter(c=>c===card).length,1,'later turns must not return or register the same card twice');
    }finally{d.close();}
  });
}

for(const domain of [false,true])for(const phase of ['player','enemy'] as const){
  test(`new Stasis remains suppressible while existing storage cleanup is unconditional; domain=${domain}, phase=${phase}`,()=>{
    const d=driver('orb',domain);
    try{
      if(domain)d.play('FIXTURE_DOMAIN');
      if(phase==='player')d.play('VOLIBEAR_C11',0);else d.act(END);
      const s=d.session(),power=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor:s.roster[0]!.actor!,definition:bronzeOrb.exports.Stasis});
      assert.equal(power===null,domain,'only new theft is suppressed, not the release hook');
      if(power!==null)assert.equal(d.query(zones.exports.members,d.query(bronzeOrb.exports.heldZone,power)!).length,1);
    }finally{d.close();}
  });
}

for(const domain of [false,true]){
  for(const scenario of ['time','champ'] as const)for(const phase of ['player','enemy'] as const){
    test(`${scenario} special recovery is gated independently of strength/block; domain=${domain}, phase=${phase}`,()=>{
      const d=driver(scenario,domain);
      try{
        const initial=d.frame().battle!.monsters[0]!;
        assert.equal(initial.hp,100);assert.equal(initial.strength,-3);assert.equal(initial.weak,2);assert.equal(initial.vulnerable,2);
        assert.equal(d.frame().battle!.intents![0]!.name,scenario==='time'?'TIME_EATER_HASTE':'THE_CHAMP_ANGER');
        if(domain){d.play('FIXTURE_DOMAIN');assert.equal(d.frame().battle!.domain!.active,true);}
        const f=phase==='player'?d.play('VOLIBEAR_C11',0):d.act(END),enemy=f.battle!.monsters[0]!;
        assert.equal(enemy.hp,scenario==='time'&&!domain?240:100,'only an unsuppressed Haste heals');
        if(domain){assert.ok(enemy.weak>0,'domain preserves Weak');assert.ok(enemy.vulnerable>0,'domain preserves Vulnerable');}
        else{assert.equal(enemy.weak,0);assert.equal(enemy.vulnerable,0);}
        assert.equal(enemy.strength,scenario==='champ'?(domain?9:12):(domain?-3:0),'Champ still gains 12 strength; cleansing negative strength is special');
        assert.equal(enemy.block,scenario==='time'?32:0,'Haste retains its 32 block with or without domain');
        assert.equal(d.actions().length,1);assert.equal(d.query(turns.exports.current,d.session().controller).phase,0);
        assert.notEqual(f.battle!.intents![0]!.name,scenario==='time'?'TIME_EATER_HASTE':'THE_CHAMP_ANGER','suppressed special effects still complete the action and roll the next intent');
      }finally{d.close();}
    });
  }

  test(`a pending Darkling revival is canceled by domain and otherwise remains atomic; domain=${domain}`,()=>{
    const d=driver('revive',domain);
    try{
      assert.equal(d.frame().battle!.domain!.active,false);
      const maxHp=d.frame().battle!.monsters[0]!.maxHp,controller=d.session().roster[0]!.controller!;
      d.play('VOLIBEAR_B01',0);d.act(END);
      assert.equal(d.frame().battle!.domain!.active,domain);
      assert.equal(d.query(enemies.exports.current,controller).halfDead,!domain);
      if(!domain)assert.equal(d.frame().battle!.intents!.find(i=>i.index===0)!.name,'DARKLING_REINCARNATE');
      d.act(END);
      if(domain){
        const f=d.frame();assert.equal(f.battle!.monsters[0]!.hp,0);assert.equal(d.query(enemies.exports.current,controller).halfDead,false);
        assert.equal(f.battle!.monsters[0]!.strength,0,'suppressed revival does not partially initialize powers');
        assert.ok(!presentDecision(observe(f),f.actions).actions.some(a=>a.kind==='play-card'&&a.details.target===0));
        assert.equal(f.battle!.domain!.active,false);d.act(END);
      }
      assert.equal(d.frame().battle!.monsters[0]!.hp,domain?0:Math.trunc(maxHp/2));
      assert.equal(d.query(enemies.exports.current,controller).halfDead,false);
      assert.equal(d.actions().some(a=>a.enemy===controller&&a.move===moveId.DARKLING_REINCARNATE),!domain);
    }finally{d.close();}
  });

  test(`Darkling Harden keeps both independent strength and block; domain=${domain}`,()=>{
    const d=driver('harden',domain);
    try{
      if(domain)d.play('FIXTURE_DOMAIN');
      const f=d.play('VOLIBEAR_C11',0),enemy=f.battle!.monsters[0]!;
      assert.equal(enemy.strength,2);assert.equal(enemy.block,12);assert.equal(enemy.hp,1);
    }finally{d.close();}
  });
}

for(const domain of [false,true])for(const scenario of ['boss','acid','spike'] as const)for(const phase of ['player','enemy'] as const){
  test(`${scenario} split preserves health and slots outside domain and is terminally canceled inside domain (${phase}); domain=${domain}`,()=>{
    const d=driver(scenario,domain);
    try{
      const initial=d.frame(),parent=d.session().roster[0]!.controller!;
      assert.equal(initial.battle!.monsters[0]!.hp,20);
      if(domain)d.play('FIXTURE_DOMAIN');
      let f=phase==='player'?d.play('VOLIBEAR_C11',0):d.act(END);
      if(domain){
        assert.equal(d.session().roster.filter(e=>e.controller!==null).length,1,'domain blocks split deployment');
        assert.equal(d.session().roster[0]!.controller,parent);assert.equal(f.battle!.monsters[0]!.hp,20);
        assert.equal(d.actions().length,1);
        if(phase==='player'){d.act(END);assert.equal(d.actions().length,1,'engaged parent must not act twice');}
        assert.equal(d.frame().battle!.domain!.active,false);
        f=d.act(END);
        assert.equal(d.session().roster.filter(e=>e.controller!==null).length,1,'a canceled split cannot resume after domain expiry');
        assert.equal(d.session().roster[0]!.controller,parent);
        return;
      }
      const splitActions=domain?2:1,playerSplit=phase==='player'&&!domain;
      const s=d.session(),children=s.roster.flatMap((e,index)=>e.controller===null?[]:[{...e,index}]);
      assert.equal(children.length,2);
      assert.deepEqual(children.map(e=>e.index),scenario==='boss'?[0,2]:[0,1]);
      assert.ok(!children.some(e=>e.controller===parent));
      for(const child of children){
        assert.equal(f.battle!.monsters[child.index]!.hp,20,'each child inherits all remaining health');
        assert.equal(f.battle!.monsters[child.index]!.maxHp,20);
        assert.equal(d.query(enemies.exports.current,child.controller!).claimed,playerSplit);
      }
      assert.equal(d.actions().length,splitActions,'suppressed splits do not create offspring actions');
      assert.equal(d.query(turns.exports.current,s.controller).phase,0);
      // Slot holes must not appear as intent targets or legal card targets.
      assert.deepEqual(f.battle!.intents!.map(i=>i.index),children.map(c=>c.index));
      const targets=f.actions.filter(a=>a.bits>>>29===0&&f.battle!.hand[a.bits&65535]?.id==='VOLIBEAR_B01').map(a=>(a.bits>>>16)&8191);
      if(playerSplit)assert.deepEqual(targets,children.map(c=>c.index));
      if(playerSplit){
        d.play('VOLIBEAR_C11',children[0]!.index);
        assert.equal(d.actions().length,1,'repeated engage must not grant a claimed child an action');
        d.act(END);
        assert.equal(d.actions().length,1,'children skip the remaining enemy phase of their creation round');
      }
      for(const child of children)assert.equal(d.query(enemies.exports.current,child.controller!).claimed,false);
      d.act(END);
      const next=d.actions().slice(splitActions);
      assert.deepEqual(next.map(a=>a.enemy).sort((a,b)=>a-b),children.map(c=>c.controller!).sort((a,b)=>a-b),'both children act exactly once in the next round');
      assert.ok(next.every(a=>a.turn===(domain?3:2)));
    }finally{d.close();}
  });
}

test('a killed enemy loses its intent without changing the surviving target slot',()=>{
  const d=driver('corpse');
  try{
    assert.deepEqual(d.frame().battle!.intents!.map(i=>i.index),[0,1]);
    const f=d.play('VOLIBEAR_B01',0),b=f.battle!;
    assert.equal(b.monsters.length,2);assert.equal(b.monsters[0]!.hp,0);assert.equal(b.monsters[1]!.index,1);
    assert.deepEqual(b.intents!.map(i=>i.index),[1]);
    assert.ok(!f.actions.some(a=>a.bits>>>29===0&&((a.bits>>>16)&8191)===0));
    const text=formatDecision(observe(f),presentDecision(observe(f),f.actions));
    assert.match(text,/敌人\[0\].*意图 无/);
    const hp=b.monsters[1]!.hp;
    d.play('VOLIBEAR_C11',1);
    assert.deepEqual(d.actions().map(a=>a.enemy),[d.session().roster[1]!.controller!]);
    assert.equal(d.frame().battle!.monsters[1]!.hp,hp,'targeting slot 1 still engages the survivor');
  }finally{d.close();}
});

test('a half-dead Darkling retains its regrow intent, cannot be targeted, and revives',()=>{
  const d=driver('revive');
  try{
    const f=d.play('VOLIBEAR_B01',0),controller=d.session().roster[0]!.controller!;
    assert.equal(f.battle!.monsters[0]!.hp,0);assert.equal(d.query(enemies.exports.current,controller).halfDead,true);
    assert.equal(f.battle!.intents!.find(i=>i.index===0)!.name,'DARKLING_REGROW');
    assert.ok(!f.actions.some(a=>a.bits>>>29===0&&((a.bits>>>16)&8191)===0));
    d.act(END);d.act(END);
    assert.ok(d.frame().battle!.monsters[0]!.hp>0);assert.equal(d.query(enemies.exports.current,controller).halfDead,false);
    assert.ok(d.actions().some(a=>a.enemy===controller&&a.move===moveId.DARKLING_REGROW));
  }finally{d.close();}
});

test('an escaped enemy with positive health has no intent or legal target while other slots remain stable',()=>{
  const d=driver('escaped');
  try{
    const f=d.frame();assert.equal(f.battle!.monsters[0]!.hp,1);
    assert.equal(d.query(enemies.exports.current,d.session().roster[0]!.controller!).escaped,true);
    assert.deepEqual(f.battle!.intents!.map(i=>i.index),[1]);
    assert.ok(!f.actions.some(a=>a.bits>>>29===0&&((a.bits>>>16)&8191)===0));
    d.act(END);assert.deepEqual(d.actions().map(a=>a.enemy),[d.session().roster[1]!.controller!]);
  }finally{d.close();}
});

test('restoring the controlled Context after an engage split preserves child action ownership',async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,stepBudget:100_000_000}).load(definition));
  const parent=unwrap(await loaded.core.start({seed:'130',scenario:'boss'}));
  const bind=(instance:typeof parent,bits?:number)=>{let used=false;return instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>bits===undefined||used?{kind:'pause'}:(used=true,{kind:'reply',value:{bits}})});};
  const view=async(instance:typeof parent)=>{let stop=unwrap(await instance.inspect());while(stop.kind==='call'&&stop.call.port==='event'){unwrap(await instance.run());stop=unwrap(await instance.inspect());}if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected saved combat decision: '+JSON.stringify(stop));return stop.call.input;};
  let restored:typeof parent|undefined;
  try{
    unwrap(await bind(parent));unwrap(await parent.run());
    const f=await view(parent),card=f.battle!.hand.findIndex(c=>c.id==='VOLIBEAR_C11');
    assert.notEqual(card,-1);unwrap(await bind(parent,card));unwrap(await parent.run());
    const split=await view(parent);assert.deepEqual(split.battle!.monsters.filter(m=>m.hp>0).map(m=>m.hp),[20,20]);
    const snapshot=unwrap(await loaded.persistence!.save(parent));await parent.close();
    try{
    restored=unwrap(await loaded.persistence!.restore(snapshot));
    assert.deepEqual(await view(restored),split);
    unwrap(await bind(restored,END));unwrap(await restored.run());
    const first=await view(restored);assert.equal(first.battle!.turn,1);
    assert.deepEqual(first.battle!.monsters.filter(m=>m.hp>0).map(m=>m.hp),[20,20]);
    for(const index of [0,2])assert.deepEqual(first.battle!.monsters[index]!.moves,split.battle!.monsters[index]!.moves,'restored children still skip the creation round');
    unwrap(await bind(restored,END));unwrap(await restored.run());
    const second=await view(restored);assert.equal(second.battle!.turn,2);
    for(const index of [0,2])assert.equal(second.battle!.monsters[index]!.moves[1],first.battle!.monsters[index]!.moves[0],'each child executes its first move next round');
    }finally{await loaded.persistence!.release(snapshot);}
  }finally{await parent.close();await restored?.close();}
});
