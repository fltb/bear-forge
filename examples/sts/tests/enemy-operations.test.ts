import {volibearDomain} from '../src/content/characters/volibear/mechanics/domain.ts';
import {createCardLoader} from '@bear-forge/runtime-card';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {enemyContinuationDefinition as definition,performedEnemyHits,observedRevivalStates,type EnemyContinuationCase} from './enemy-continuation-fixture.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {enemies} from '../src/rules/enemies.ts';
import {battles} from '../src/rules/battles.ts';
import {powers} from '../src/rules/powers.ts';
import {resources} from '../src/rules/resources.ts';
import {attributes} from '../src/rules/attributes.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {beyondPowers} from '../src/content/enemies/beyond/powers.ts';
import {enemyDefensePowers} from '../src/content/enemies/shared/defense-powers.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
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
  test(`Awakened One revival remains pending as one operation; domain=${domain}`,()=>{
    const d=driver('awakened',domain);try{
      const s=d.session(),controller=s.roster[2]!.controller!;
      d.play('VOLIBEAR_B01',2);assert.equal(d.frame().battle!.monsters[2]!.hp,0);assert.equal(d.query(enemies.exports.current,controller).halfDead,true);
      assert.ok(!d.frame().actions.some(a=>a.bits>>>29===0&&((a.bits>>>16)&8191)===2),'half-dead enemies cannot be engaged through a legal targeted card');
      if(domain)d.play('VOLIBEAR_U19');d.act(END);
      if(domain){assert.equal(d.frame().battle!.monsters[2]!.hp,0);assert.equal(d.query(enemies.exports.current,controller).halfDead,true);assert.equal(d.query(enemies.exports.eligible,controller),true);d.act(END);}
      assert.equal(d.frame().battle!.monsters[2]!.hp,320);assert.equal(d.query(enemies.exports.current,controller).halfDead,false);assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.AWAKENED_ONE_DARK_ECHO);
      const revived=d.query(observedRevivalStates,undefined).filter(v=>v.hp===320);assert.equal(revived.length,1);assert.equal(revived[0]!.halfDead,false,'health observers see the revived eligibility');assert.equal(revived[0]!.revivals,1,'phase history commits before the health event');
    }finally{d.close();}
  });
  for(const phase of ['player','enemy'] as const){
    test(`Heart cleanse is separate from every Strength grant; domain=${domain}, phase=${phase}`,()=>{
      const d=driver('heart',domain);try{if(domain)d.play('VOLIBEAR_U19');if(phase==='player')d.play('VOLIBEAR_B04');else d.act(END);
        assert.equal(d.frame().battle!.monsters[0]!.strength,domain?49:52);
      }finally{d.close();}
    });
    test(`Wither intent and actual strike use one declaration; domain=${domain}, phase=${phase}`,()=>{
      const d=driver('wither',domain);try{
        const f=d.frame(),s=d.session();assert.equal(d.query(enemies.exports.intent,s.roster[0]!.controller!).damage,12);assert.equal(d.query(enemies.exports.intent,s.roster[0]!.controller!).hits,1);
        if(domain)d.play('VOLIBEAR_U19');const hp=d.frame().battle!.player.hp,block=d.frame().battle!.player.block+(phase==='player'?7:0);
        if(phase==='player')d.play('VOLIBEAR_B04');else d.act(END);
        assert.equal(d.frame().battle!.player.hp,hp-Math.max(0,12-block));assert.equal(d.query(enemies.exports.acted,s.roster[0]!.controller!),phase==='player');
      }finally{d.close();}
    });
  }
  test(`Slow remains a harmful contribution through domain; domain=${domain}`,()=>{
    const d=driver('slow',domain);try{
      d.play(domain?'VOLIBEAR_U19':'VOLIBEAR_B02');const s=d.session(),board=d.query(battles.exports.status,s.battle),actor=s.roster[0]!.actor!;
      const slow=d.query(powers.exports.find,{registry:board.registry,actor,definition:beyondPowers.exports.Slow})!;
      assert.equal(d.query(powers.exports.polarity,slow),-1);assert.equal(d.query(powers.exports.level,slow),1);
      assert.equal(d.query(attributes.exports.attackAmount,{source:board.actor,target:actor,base:10,card:null}),11);
      d.play('VOLIBEAR_B01');assert.equal(d.query(powers.exports.level,slow),2);
    }finally{d.close();}
  });
  test(`Flight consumes hits and stuns while reduction may be suppressed; domain=${domain}`,()=>{
    const d=driver('flight',domain);try{
      if(domain)d.play('VOLIBEAR_U19');const s=d.session(),actor=s.roster[0]!.actor!,controller=s.roster[0]!.controller!,registry=d.query(battles.exports.status,s.battle).registry;
      const power=d.query(powers.exports.find,{registry,actor,definition:enemyDefensePowers.exports.Flight})!;
      const before=d.frame().battle!.monsters[0]!.hp;
      for(let i=0;i<4;i++){d.play('VOLIBEAR_B01');assert.equal(d.query(powers.exports.level,power),3-i);}
      assert.equal(d.frame().battle!.monsters[0]!.hp,before-(domain?24:12));assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.BYRD_STUNNED);
      d.act(END);assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.BYRD_HEADBUTT);
    }finally{d.close();}
  });
  test(`Plated Armor consumes layers and independently grants block; domain=${domain}`,()=>{
    const d=driver('plated',domain);try{
      if(domain)d.play('VOLIBEAR_U19');const s=d.session(),actor=s.roster[0]!.actor!,power=d.query(powers.exports.find,{registry:d.query(battles.exports.status,s.battle).registry,actor,definition:enemyDefensePowers.exports.PlatedArmor})!;
      d.play('VOLIBEAR_B01');assert.equal(d.query(powers.exports.level,power),1);d.act(END);assert.equal(d.query(resources.exports.defense,actor).block,1);
    }finally{d.close();}
  });
  test(`Shifting reduction and owed Strength restoration are independent; domain=${domain}`,()=>{
    const d=driver('shifting',domain);try{if(domain)d.play('VOLIBEAR_U19');d.play('VOLIBEAR_B01');assert.equal(d.frame().battle!.monsters[0]!.strength,-6);d.act(END);assert.equal(d.frame().battle!.monsters[0]!.strength,0);}finally{d.close();}
  });
  for(const card of ['VOLIBEAR_C20','VOLIBEAR_C21'])for(const actual of [false,true]){
    test(`opportunity facts remain distinct while ${card} no longer requires an action; actual=${actual}, domain=${domain}`,()=>{
      const d=driver(actual?'corpse':'boss',domain,true);try{
        const target=actual?1:0;d.play('VOLIBEAR_B04',target);if(domain)d.play('VOLIBEAR_U19');
        const s=d.session(),controller=s.roster[target]!.controller!,board=d.query(battles.exports.status,s.battle);
        assert.equal(d.query(enemies.exports.current,controller).claimed,true);assert.equal(d.query(enemies.exports.acted,controller),actual);
        const drawn=d.query(cardPiles.exports.current,board.piles).drawn,block=d.frame().battle!.player.block;d.play(card,card==='VOLIBEAR_C21'?0:target);
        assert.equal(d.query(cardPiles.exports.current,board.piles).drawn,drawn+1);if(card==='VOLIBEAR_C21')assert.equal(d.frame().battle!.player.block,block+8);
      }finally{d.close();}
    });
  }
  test(`minion victory ownership and reward exclusion survive domain; domain=${domain}`,()=>{
    const d=driver('minion',domain);try{
      d.play('VOLIBEAR_B04',1);if(domain)d.play('VOLIBEAR_U19');const s=d.session(),boss=s.roster[1]!.actor!;
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
      if(domain)d.play('VOLIBEAR_U19');if(phase==='player')d.play('VOLIBEAR_B04');else d.act(END);
      const hits=d.query(performedEnemyHits,undefined).filter(h=>h.source===actor&&h.attack);
      assert.equal(hits.length,1,'remaining queued hits from the killed attacker are canceled even with living allies');
      assert.equal(d.frame().battle!.monsters[0]!.hp,0);assert.ok(d.frame().battle!.monsters[1]!.hp>0);
    }finally{d.close();}
  });
}

test('a suppressed revival cold-restores pending, without replaying death or spending it twice',async()=>{
  const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,stepBudget:100_000_000}).load(definition));
  const parent=unwrap(await loaded.core.start({seed:'130',scenario:'awakened',domain:true}));let restored:typeof parent|undefined;
  const bind=(instance:typeof parent,bits?:number)=>{let used=false;return instance.bind({event:async()=>({kind:'reply',value:null}),decision:async()=>bits===undefined||used?{kind:'pause'}:(used=true,{kind:'reply',value:{bits}})});};
  const frame=async(instance:typeof parent)=>{let stop=unwrap(await instance.inspect());while(stop.kind==='call'&&stop.call.port==='event'){unwrap(await instance.run());stop=unwrap(await instance.inspect());}if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;};
  const act=async(instance:typeof parent,bits:number)=>{unwrap(await bind(instance,bits));unwrap(await instance.run());return frame(instance);};
  const play=async(instance:typeof parent,id:string,target=0)=>{const f=await frame(instance),index=f.battle!.hand.findIndex(c=>c.id===id);assert.ok(index>=0);return act(instance,(target<<16)|index);};
  try{
    unwrap(await bind(parent));unwrap(await parent.run());await play(parent,'VOLIBEAR_B01',2);await play(parent,'VOLIBEAR_U19');
    const pending=await act(parent,END);assert.equal(pending.battle!.monsters[2]!.hp,0);
    const saved=unwrap(await loaded.persistence!.save(parent));await parent.close();
    try{restored=unwrap(await loaded.persistence!.restore(saved));assert.deepEqual(await frame(restored),pending);
      const resumed=await act(restored,END);assert.equal(resumed.battle!.monsters[2]!.hp,320);assert.equal(resumed.battle!.intents!.find(i=>i.index===2)!.name,'AWAKENED_ONE_DARK_ECHO');
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
      if(domain)d.play('VOLIBEAR_U19');if(phase==='player')d.play('VOLIBEAR_B04',slot);else d.act(END);
      const created=d.session().roster.filter(e=>e.controller!==null&&!before.has(e.controller));assert.equal(created.length,domain?0:2);
      if(!domain){
        assert.deepEqual(created.map(e=>d.query(enemies.exports.current,e.controller!).slot).sort(),scenario==='gremlin'?[1,2]:scenario==='collector'?[0,1]:[1,4]);
        for(const e of created){assert.equal(d.query(enemies.exports.acted,e.controller!),false);if(phase==='player')assert.equal(d.query(enemies.exports.current,e.controller!).claimed,true);assert.equal(d.query(enemies.exports.current,e.controller!).history[0]===0,false,'initial roll or explicit move is present');}
      }
    }finally{d.close();}
  });
}
