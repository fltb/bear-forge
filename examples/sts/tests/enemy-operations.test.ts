import {volibearDomain} from '../src/content/characters/volibear/mechanics/domain.ts';
import {createCardLoader} from '@bear-forge/runtime-card';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {enemyContinuationDefinition as definition,performedEnemyHits,observedRevivalStates,type EnemyContinuationCase} from './enemy-continuation-fixture.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {enemies} from '../src/rules/enemies.ts';
import {battles} from '../src/rules/battles.ts';
import {powers} from '../src/rules/powers.ts';
import {resources} from '../src/rules/resources.ts';
import {attributes} from '../src/rules/attributes.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {exordiumBosses} from '../src/content/enemies/exordium/bosses.ts';
import {beyondPowers} from '../src/content/enemies/beyond/powers.ts';
import {enemyDefensePowers} from '../src/content/enemies/shared/defense-powers.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
import {combatEnemyPowers} from '../src/content/enemies/shared/combat-powers.ts';
import {moveId} from '../src/combat-identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';

const END=(4<<29)>>>0,program=new CardProgram(definition);
function driver(scenario:EnemyContinuationCase['scenario'],domain=false,opsCards=false,midRevivalDomain=false){
  const storage=privateCardGraph(program.initial({seed:'130',scenario,domain,opsCards,midRevivalDomain},100_000_000)),machine=new CardMachine(program,storage);let stop=machine.advance();
  function frame():Frame{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;}
  const query=<I,O>(q:Parameters<typeof inspectRuleQuery<I,O>>[2],input:I)=>inspectRuleQuery(definition,machine.root.state,q,input);
  function session(){const run=query(adventures.exports.instances,undefined)[0]!;return query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!);}
  function act(bits:number){assert.ok(frame().actions.some(a=>a.bits===bits),'legal action '+bits);stop=machine.advance({bits});return frame();}
  function play(id:string,target=0){const index=frame().battle!.hand.findIndex(c=>c.id===id);assert.ok(index>=0,id+' in hand');return act((target<<16)|index);}
  return{frame,query,session,act,play,close:()=>storage.close()};
}

for(const domain of [false,true]){
  test(`Awakened One revival is consumed when canceled and otherwise remains atomic; domain=${domain}`,()=>{
    const d=driver('awakened',domain);try{
      const s=d.session(),controller=s.roster[2]!.controller!;
      d.play('VOLIBEAR_B01',2);assert.equal(d.frame().battle!.monsters[2]!.hp,0);assert.equal(d.query(enemies.exports.current,controller).halfDead,true);
      assert.ok(!d.frame().actions.some(a=>a.bits>>>29===0&&((a.bits>>>16)&8191)===2),'half-dead enemies cannot be engaged through a legal targeted card');
      if(domain)d.play('FIXTURE_DOMAIN');d.act(END);
      if(domain){assert.equal(d.frame().battle!.monsters[2]!.hp,0);assert.equal(d.query(enemies.exports.current,controller).halfDead,false);assert.equal(d.query(enemies.exports.eligible,controller),false);d.act(END);assert.equal(d.frame().battle!.monsters[2]!.hp,0);assert.equal(d.query(enemies.exports.revivals,controller),0);return;}
      assert.equal(d.frame().battle!.monsters[2]!.hp,320);assert.equal(d.query(enemies.exports.current,controller).halfDead,false);assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.AWAKENED_ONE_DARK_ECHO);
      const revived=d.query(observedRevivalStates,undefined).filter(v=>v.hp===320);assert.equal(revived.length,1);assert.equal(revived[0]!.halfDead,false,'health observers see the revived eligibility');assert.equal(revived[0]!.revivals,1,'phase history commits before the health event');
    }finally{d.close();}
  });
  for(const phase of ['player','enemy'] as const){
    test(`Heart cleanse is separate from every Strength grant; domain=${domain}, phase=${phase}`,()=>{
      const d=driver('heart',domain);try{if(domain)d.play('FIXTURE_DOMAIN');if(phase==='player')d.play('VOLIBEAR_C11');else d.act(END);
        assert.equal(d.frame().battle!.monsters[0]!.strength,domain?49:52);
      }finally{d.close();}
    });
    test(`Wither intent and actual strike use one declaration; domain=${domain}, phase=${phase}`,()=>{
      const d=driver('wither',domain);try{
        const f=d.frame(),s=d.session();assert.equal(d.query(enemies.exports.intent,s.roster[0]!.controller!).damage,12);assert.equal(d.query(enemies.exports.intent,s.roster[0]!.controller!).hits,1);
        if(domain)d.play('FIXTURE_DOMAIN');const hp=d.frame().battle!.player.hp,block=d.frame().battle!.player.block+(phase==='player'?8:0);
        if(phase==='player')d.play('VOLIBEAR_C11');else d.act(END);
        assert.equal(d.frame().battle!.player.hp,hp-Math.max(0,12-block));assert.equal(d.query(enemies.exports.acted,s.roster[0]!.controller!),phase==='player');
      }finally{d.close();}
    });
  }
  test(`Slow vulnerability and counters remain active inside domain; domain=${domain}`,()=>{
    const d=driver('slow',domain);try{
      d.play(domain?'FIXTURE_DOMAIN':'VOLIBEAR_B02');const s=d.session(),board=d.query(battles.exports.status,s.battle),actor=s.roster[0]!.actor!;
      const slow=d.query(powers.exports.find,{registry:board.registry,actor,definition:beyondPowers.exports.Slow})!;
      assert.equal(d.query(powers.exports.polarity,slow),-1);assert.equal(d.query(powers.exports.level,slow),1);
      assert.equal(d.query(attributes.exports.attackAmount,{source:board.actor,target:actor,base:10,card:null}),11);
      d.play('VOLIBEAR_B01');assert.equal(d.query(powers.exports.level,slow),2);
    }finally{d.close();}
  });
  test(`Flight reduction is suppressed while hits still consume flight and stun; domain=${domain}`,()=>{
    const d=driver('flight',domain);try{
      if(domain)d.play('FIXTURE_DOMAIN');const s=d.session(),actor=s.roster[0]!.actor!,controller=s.roster[0]!.controller!,registry=d.query(battles.exports.status,s.battle).registry;
      const power=d.query(powers.exports.find,{registry,actor,definition:enemyDefensePowers.exports.Flight})!;
      const before=d.frame().battle!.monsters[0]!.hp;
      for(let i=0;i<4;i++){d.play('VOLIBEAR_B01');assert.equal(d.query(powers.exports.level,power),3-i);}
      assert.equal(d.frame().battle!.monsters[0]!.hp,before-(domain?40:12));assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.BYRD_STUNNED);
      d.act(END);assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.BYRD_HEADBUTT);
    }finally{d.close();}
  });
  test(`Plated Armor still wears down while its block gain is suppressed; domain=${domain}`,()=>{
    const d=driver('plated',domain);try{
      if(domain)d.play('FIXTURE_DOMAIN');const s=d.session(),actor=s.roster[0]!.actor!,power=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor,definition:enemyDefensePowers.exports.PlatedArmor})!;
      d.play('VOLIBEAR_B01');assert.equal(d.query(powers.exports.level,power),1);d.act(END);assert.equal(d.query(resources.exports.defense,actor).block,domain?0:1);
    }finally{d.close();}
  });
  test(`Shifting reduction and owed Strength restoration are independent; domain=${domain}`,()=>{
    const d=driver('shifting',domain);try{if(domain)d.play('FIXTURE_DOMAIN');d.play('VOLIBEAR_B01');assert.equal(d.frame().battle!.monsters[0]!.strength,domain?-10:-6);d.act(END);assert.equal(d.frame().battle!.monsters[0]!.strength,0);}finally{d.close();}
  });
  test(`Guardian damage threshold interrupts Fierce Bash but its passive shield is suppressed; domain=${domain}`,()=>{
    const d=driver('guardian',domain);try{
      if(domain)d.play('FIXTURE_DOMAIN');const s=d.session(),controller=s.roster[0]!.controller!,actor=s.roster[0]!.actor!,hp=d.frame().battle!.player.hp;
      d.play('VOLIBEAR_B01');
      assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.THE_GUARDIAN_DEFENSIVE_MODE);
      assert.equal(d.query(resources.exports.defense,actor).block,domain?0:20);
      assert.equal(d.frame().battle!.intents![0]!.attack,false);
      d.act(END);assert.equal(d.frame().battle!.player.hp,hp,'interrupted Fierce Bash does not execute');
      const hide=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor,definition:exordiumBosses.exports.SharpHide});
      assert.equal(hide!==null&&d.query(powers.exports.enabled,hide),!domain);
    }finally{d.close();}
  });
  test(`Guardian installs the next damage threshold even while domain is active; domain=${domain}`,()=>{
    const d=driver('guardian-return',domain);try{
      if(domain)d.play('FIXTURE_DOMAIN');const s=d.session(),actor=s.roster[0]!.actor!;
      d.act(END);
      const mode=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor,definition:exordiumBosses.exports.ModeShift});
      assert.notEqual(mode,null);assert.equal(d.query(powers.exports.level,mode!),50);
    }finally{d.close();}
  });
  test(`Fading still expires after its final attack inside domain; domain=${domain}`,()=>{
    const d=driver('fading',domain);try{if(domain)d.play('FIXTURE_DOMAIN');d.act(END);assert.equal(d.frame().battle,null);}finally{d.close();}
  });
  test(`enemy Entangled on the player is suppressed but still expires; domain=${domain}`,()=>{
    const d=driver('entangled',domain);try{
      const s=d.session(),board=d.query(battles.exports.status,s.battle);
      if(domain)d.play('FIXTURE_DOMAIN');
      const canAttack=d.frame().actions.some(a=>a.bits>>>29===0&&d.frame().battle!.hand[a.bits&65535]?.id==='VOLIBEAR_B01');
      assert.equal(canAttack,domain);
      d.act(END);
      const power=d.query(powers.exports.find,{registry:board.registry,actor:board.actor,definition:combatEnemyPowers.exports.Entangled});
      assert.ok(power===null||!d.query(powers.exports.enabled,power),'duration cleanup survives suppression');
    }finally{d.close();}
  });
  for(const card of ['VOLIBEAR_C20','VOLIBEAR_C21'])for(const actual of [false,true]){
    test(`opportunity facts remain distinct while ${card} no longer requires an action; actual=${actual}, domain=${domain}`,()=>{
      const d=driver(actual?'corpse':'boss',domain,true);try{
        const target=actual?1:0;d.play('VOLIBEAR_C11',target);if(domain)d.play('FIXTURE_DOMAIN');
        const s=d.session(),controller=s.roster[target]!.controller!,board=d.query(battles.exports.status,s.battle);
        assert.equal(d.query(enemies.exports.current,controller).claimed,true);assert.equal(d.query(enemies.exports.acted,controller),actual);
        const drawn=d.query(cardPiles.exports.current,board.piles).drawn,block=d.frame().battle!.player.block;const after=d.play(card,card==='VOLIBEAR_C21'?0:target);
        if(actual&&domain&&card==='VOLIBEAR_C20'){assert.equal(after.battle,null,'domain attachment defeats the final enemy');return;}
        assert.equal(d.query(cardPiles.exports.current,board.piles).drawn,drawn+(card==='VOLIBEAR_C21'?2:0));if(card==='VOLIBEAR_C21')assert.equal(d.frame().battle!.player.block,block+5);
      }finally{d.close();}
    });
  }
  test(`minion victory ownership and reward exclusion survive domain; domain=${domain}`,()=>{
    const d=driver('minion',domain);try{
      d.play('VOLIBEAR_C11',1);if(domain)d.play('FIXTURE_DOMAIN');const s=d.session(),boss=s.roster[1]!.actor!;
      assert.deepEqual(d.query(battles.exports.victoryTargets,s.battle),[boss]);
      for(const slot of [0,2])assert.equal(d.query(battles.exports.rewardEligible,{battle:s.battle,target:s.roster[slot]!.actor!}),false);
      d.play('VOLIBEAR_B01',1);assert.equal(d.frame().battle,null,'killing the leader ends the encounter with living minions');
    }finally{d.close();}
  });
}

for(const domain of [false,true])for(const phase of ['player','enemy'] as const){
  test(`each captured attack hit revalidates its living source after retaliation; domain=${domain}, phase=${phase}`,()=>{
    const d=driver('retaliation',domain);try{
      const s=d.session(),actor=s.roster[0]!.actor!;
      if(domain)d.play('FIXTURE_DOMAIN');if(phase==='player')d.play('VOLIBEAR_C11');else d.act(END);
      const hits=d.query(performedEnemyHits,undefined).filter(h=>h.source===actor&&h.attack);
      assert.equal(hits.length,1,'remaining queued hits from the killed attacker are canceled even with living allies');
      assert.equal(d.frame().battle!.monsters[0]!.hp,0);assert.ok(d.frame().battle!.monsters[1]!.hp>0);
    }finally{d.close();}
  });
}

test('a canceled revival stays canceled after cold restore and domain expiry',async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,stepBudget:100_000_000}).load(definition));
  const parent=unwrap(await loaded.core.start({seed:'130',scenario:'awakened',domain:true}));let restored:typeof parent|undefined;
  const bind=(instance:typeof parent,bits?:number)=>{let used=false;return instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>bits===undefined||used?{kind:'pause'}:(used=true,{kind:'reply',value:{bits}})});};
  const frame=async(instance:typeof parent)=>{let stop=unwrap(await instance.inspect());while(stop.kind==='call'&&stop.call.port==='event'){unwrap(await instance.run());stop=unwrap(await instance.inspect());}if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  const act=async(instance:typeof parent,bits:number)=>{unwrap(await bind(instance,bits));unwrap(await instance.run());return frame(instance);};
  const play=async(instance:typeof parent,id:string,target=0)=>{const f=await frame(instance),index=f.battle!.hand.findIndex(c=>c.id===id);assert.ok(index>=0);return act(instance,(target<<16)|index);};
  try{
    unwrap(await bind(parent));unwrap(await parent.run());await play(parent,'VOLIBEAR_B01',2);await play(parent,'FIXTURE_DOMAIN');
    const pending=await act(parent,END);assert.equal(pending.battle!.monsters[2]!.hp,0);
    const saved=unwrap(await loaded.persistence!.save(parent));await parent.close();
    try{restored=unwrap(await loaded.persistence!.restore(saved));assert.deepEqual(await frame(restored),pending);
      const resumed=await act(restored,END);assert.equal(resumed.battle!.monsters[2]!.hp,0);assert.equal(resumed.battle!.intents!.some(i=>i.index===2),false);
    }finally{await loaded.persistence!.release(saved);}
  }finally{await parent.close();await restored?.close();}
});

test('a domain opened by a revival health observer cannot cut an admitted revival in half',()=>{
  const d=driver('revive',false,false,true);try{
    const s=d.session(),actor=s.roster[0]!.actor!,controller=s.roster[0]!.controller!;
    d.play('VOLIBEAR_B01');d.act(END);d.act(END);
    assert.equal(d.query(volibearDomain.exports.active,s.battle),true);
    assert.ok(d.frame().battle!.monsters[0]!.hp>0);assert.equal(d.query(enemies.exports.current,controller).halfDead,false);
    const regrow=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor,definition:beyondPowers.exports.Regrow})!;
    assert.equal(d.query(powers.exports.enabled,regrow),true,'intrinsic revival state finishes even if a reaction opens the domain');
    assert.equal(d.query(enemies.exports.revivals,controller),1);
  }finally{d.close();}
});

for(const scenario of ['gremlin','collector','repto'] as const)for(const domain of [false,true])for(const phase of ['player','enemy'] as const){
  test(`shared deployment retains ${scenario} slots and creation-round action facts; domain=${domain}, phase=${phase}`,()=>{
    const d=driver(scenario,domain);try{
      const slot=scenario==='gremlin'?3:2,s=d.session(),before=new Set(s.roster.flatMap(e=>e.controller===null?[]:[e.controller]));
      if(domain)d.play('FIXTURE_DOMAIN');if(phase==='player')d.play('VOLIBEAR_C11',slot);else d.act(END);
      const created=d.session().roster.filter(e=>e.controller!==null&&!before.has(e.controller));assert.equal(created.length,domain?0:2);
      if(!domain){
        assert.deepEqual(created.map(e=>d.query(enemies.exports.current,e.controller!).slot).sort(),scenario==='gremlin'?[1,2]:scenario==='collector'?[0,1]:[1,4]);
        for(const e of created){assert.equal(d.query(enemies.exports.acted,e.controller!),false);if(phase==='player')assert.equal(d.query(enemies.exports.current,e.controller!).claimed,true);assert.equal(d.query(enemies.exports.current,e.controller!).history[0]===0,false,'initial roll or explicit move is present');}
      }
    }finally{d.close();}
  });
}
