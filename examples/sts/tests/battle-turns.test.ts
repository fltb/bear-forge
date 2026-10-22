import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {cardId} from '../src/identifiers.ts';
import {fixture,initializations,type Setup,type Step} from './battle-card-fixture.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const end:Step={kind:'endTurn'},settle:Step={kind:'settle'};
test('typed turn phases, Cultist AI, Ritual, Demon Form, ethereal and retained cards match actual C++ end-to-end turns',async()=>{
  const cases:{setup:Setup;steps:Step[]}[]=[
    {setup:{turns:true,deck:[{id:'BARRICADE'},{id:'DEFEND_RED'},{id:'SEARING_BLOW',upgraded:true,misc:3},{id:'REGRET'},{id:'SENTINEL'},{id:'BASH'}],draw:6},steps:[{kind:'queue',id:'BARRICADE'},settle,{kind:'queue',id:'DEFEND_RED'},settle,{kind:'queue',id:'SEARING_BLOW'},settle,end,settle,end,settle]},
    {setup:{turns:true,deck:[{id:'DEMON_FORM'},{id:'ASCENDERS_BANE'},{id:'BASH'},{id:'STRIKE_RED'},{id:'DEFEND_RED'},{id:'SENTINEL'}],draw:6},steps:[{kind:'queue',id:'DEMON_FORM'},settle,{kind:'queue',id:'BASH'},settle,end,settle,end,settle,end,settle]},
    {setup:{turns:true,deck:[{id:'BATTLE_TRANCE'},{id:'DEFEND_RED'},{id:'STRIKE_RED'},{id:'ASCENDERS_BANE'},{id:'SENTINEL'},{id:'BASH'}],draw:6,frail:2},steps:[{kind:'queue',id:'BATTLE_TRANCE'},settle,{kind:'queue',id:'DEFEND_RED'},settle,{kind:'retain',id:'SENTINEL'},end,settle,end,settle,end,settle]},
    {setup:{turns:true,deck:[{id:'STRIKE_RED'},{id:'DEFEND_RED'},{id:'BASH'}],draw:3,enemyHp:1},steps:[{kind:'queue',id:'STRIKE_RED'},settle]},
  ];
  const reference=await ReferenceClient.create();
  try{for(const seed of ['0','130'])for(const [index,c] of cases.entries()){
    const expected=await reference.call({op:'turn-case',...c.setup,deck:c.setup.deck.map(c=>({...c,id:cardId[c.id]})),steps:c.steps.map(s=>'id'in s?{...s,id:cardId[s.id]}:s),seed});
    const definition=fixture(c.setup,c.steps,seed);
    for(const controlled of [true]){const loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected completed turn fixture');assertSameState(expected,stop.result,`turn seed=${seed} case=${index} controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);}
    }
  }}finally{await reference.close();}
});

test('claiming an enemy opportunity early is idempotent and the regular phase skips it',async()=>{
  const setup:Setup={turns:true,deck:[{id:'STRIKE_RED'},{id:'DEFEND_RED'},{id:'BASH'}],draw:3},reference=await ReferenceClient.create();
  try{const expected=await reference.call<unknown[]>({op:'turn-case',...setup,deck:setup.deck.map(c=>({...c,id:cardId[c.id]})),steps:[end,settle],seed:'130'});
    for(const controlled of [true]){const definition=fixture(setup,[{kind:'earlyEnemy'},{kind:'earlyEnemy'},settle,end,settle],'130'),loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Early opportunity did not finish');assertSameState(expected.at(-1),stop.result.at(-1),'same opportunity executes once');}
      finally{await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);}
    }
  }finally{await reference.close();}
});

test('the new card and turn pipeline completes a whole Cultist fight with the real starter deck in controlled execution',async()=>{
  // Directed combat initialization; normal adventure initialization is a separate migration requirement.
  const setup:Setup={turns:true,deck:[{id:'BASH'},...Array.from({length:5},()=>({id:'STRIKE_RED' as const})),...Array.from({length:4},()=>({id:'DEFEND_RED' as const})),{id:'ASCENDERS_BANE'}],draw:5,energy:3,enemyHp:54},steps:Step[]=[{kind:'fight'}],reference=await ReferenceClient.create();
  try{for(const seed of ['0','130','507']){const expected=await reference.call<any[]>({op:'turn-case',...setup,deck:setup.deck.map(c=>({...c,id:cardId[c.id]})),steps,seed});assert.equal(expected.at(-1).outcome,1);
    for(const controlled of [true]){const definition=fixture(setup,steps,seed),loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Whole combat failed');assertSameState(expected,stop.result,`whole Cultist seed=${seed} controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);}
    }
  }}finally{await reference.close();}
});

test('a whole fight composes choice continuations with later enemy phases and turn starts',async()=>{
  const setup:Setup={turns:true,deck:[{id:'BASH'},...Array.from({length:5},()=>({id:'STRIKE_RED' as const})),...Array.from({length:4},()=>({id:'DEFEND_RED' as const})),{id:'ASCENDERS_BANE'},{id:'DEMON_FORM'},{id:'WARCRY'}],draw:5,energy:3,enemyHp:54},steps:Step[]=[{kind:'fight'}],reference=await ReferenceClient.create();
  try{for(const seed of ['0','130','507']){const expected=await reference.call<{states:unknown[];interactions:unknown[]}>({op:'turn-case',...setup,deck:setup.deck.map(c=>({...c,id:cardId[c.id]})),steps,seed,captureChoices:true,replies:Array(50).fill(0)});
    for(const controlled of [true]){const definition=fixture(setup,steps,seed),loaded=unwrap(await createCardLoader({controlled,recordCore:false}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{let stop=unwrap(await instance.inspect()),at=0;while(stop.kind==='call'){assert.deepEqual(stop.call.input,expected.interactions[at++]);unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:2<<29}})}));unwrap(await instance.run());stop=unwrap(await instance.inspect());}
        assert.equal(at,expected.interactions.length);assert.ok(at>0);assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Fight with choices failed');assertSameState(expected.states,stop.result,`choice fight seed=${seed} controlled=${controlled}`);

      }finally{await instance.close();await loaded.capture?.release(instance.id);}
    }
  }}finally{await reference.close();}
});

test('a claimed enemy intent resumes after invalid replies, independent forks and cold restore without repeating its prefix',async()=>{
  const setup:Setup={turns:true,probeIntent:true,deck:[{id:'STRIKE_RED'},{id:'DEFEND_RED'},{id:'BASH'}],draw:3},steps=[end,settle],directory=await mkdtemp(join(tmpdir(),'sts-enemy-turn-')),reference=await ReferenceClient.create();
  try{const expected=await reference.call<unknown[]>({op:'turn-case',...setup,deck:setup.deck.map(c=>({...c,id:cardId[c.id]})),steps,seed:'130'});
    for(const controlled of [true]){const definition=fixture(setup,steps,'130'),loaded=unwrap(await createCardLoader({controlled,snapshots:fileSnapshotStore(directory),recordCore:false}).load(definition)),parent=unwrap(await loaded.core.start(undefined)),count=initializations;
      const before=unwrap(await parent.inspect());assert.equal(before.kind,'call',JSON.stringify(before));if(before.kind!=='call')throw Error('Expected intent wait');assert.equal(before.call.input.screen,2);assert.equal(before.call.input.cards.length,3);
      unwrap(await parent.bind({decision:async()=>({kind:'reply',value:{bits:0}})}));const bad=unwrap(await parent.run());assert.equal(bad.accepted,false);assert.equal(bad.pause,'invalid_reply');assert.deepEqual(unwrap(await parent.inspect()),before);
      const snapshot=unwrap(await loaded.persistence!.save(parent)),a=unwrap(await parent.fork!()),b=unwrap(await loaded.persistence!.restore(snapshot));await parent.close();await loaded.capture?.release(parent.id);assert.equal(initializations,count);
      for(const [instance,index] of [[a,0],[b,1]] as const){unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:(2<<29)|index}})}));unwrap(await instance.run());const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Intent branch did not finish');assertSameState(expected,stop.result,'restored enemy intent');await instance.close();await loaded.capture?.release(instance.id);}
      assert.equal(initializations,count,'fork and restore must not initialize');
      const code=`
        import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
        import {fixture,initializations} from ${JSON.stringify(new URL('./battle-card-fixture.ts',import.meta.url).href)};
        const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
        const definition=fixture(${JSON.stringify(setup)},${JSON.stringify(steps)},'130');
        const loaded=unwrap(await createCardLoader({recordCore:false,controlled:${controlled},snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('Reinitialized claimed enemy');}}));
        const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
        unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:2<<29}})}));unwrap(await instance.run());
        const stop=unwrap(await instance.inspect());if(stop.kind!=='done'||initializations!==0)throw Error(JSON.stringify({stop,initializations}));process.stdout.write(JSON.stringify(stop.result));await instance.close();await loaded.capture?.release(instance.id);
      `;
      const cold=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{maxBuffer:1024*1024});assertSameState(expected,JSON.parse(cold.stdout),'cold enemy intent');await loaded.persistence!.release(snapshot);
    }
  }finally{await reference.close();await rm(directory,{recursive:true,force:true});}
});
