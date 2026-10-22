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
import {cardId} from '../src/identifiers.ts';
import {fixture,initializations,type Setup,type Step} from './battle-card-fixture.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function request(setup:Setup,steps:readonly Step[],seed:string,replies:readonly number[]){return{op:'play-case',...setup,deck:setup.deck.map(c=>({...c,id:cardId[c.id]})),steps:steps.map(s=>'id'in s?{...s,id:cardId[s.id]}:s),seed,captureChoices:true,replies};}
type Expected={states:unknown[];interactions:{screen:number;cards:unknown[];bits:number[]}[]};
const queue=(id:'WARCRY'|'HEADBUTT'|'BASH'|'DEFEND_RED'|'STRIKE_RED'):Step=>({kind:'queue',id}),settle:Step={kind:'settle'};
const branchSetup:Setup={deck:[{id:'WARCRY'},{id:'BASH'},{id:'DEFEND_RED'},{id:'STRIKE_RED'}],draw:4};
const branchSteps:Step[]=[queue('WARCRY'),settle];

test('Warcry and Headbutt use typed choice continuations and preserve source empty, singleton RNG and multi-card semantics',async()=>{
  const cases:{setup:Setup;steps:Step[];replies:number[]}[]=[
    {setup:branchSetup,steps:branchSteps,replies:[1]},
    {setup:{deck:[{id:'WARCRY'},{id:'STRIKE_RED'}],draw:2},steps:[queue('WARCRY'),settle],replies:[]},
    {setup:{deck:[{id:'WARCRY'}],draw:1},steps:[queue('WARCRY'),settle],replies:[]},
    {setup:{deck:[{id:'HEADBUTT'},{id:'BASH'},{id:'DEFEND_RED'},{id:'STRIKE_RED'}],draw:4},steps:[queue('BASH'),settle,queue('DEFEND_RED'),settle,queue('HEADBUTT'),settle],replies:[0]},
    {setup:{deck:[{id:'HEADBUTT'},{id:'DEFEND_RED'},{id:'STRIKE_RED'}],draw:3},steps:[queue('DEFEND_RED'),settle,queue('HEADBUTT'),settle],replies:[]},
    {setup:{deck:[{id:'HEADBUTT'},{id:'STRIKE_RED'}],draw:2},steps:[queue('HEADBUTT'),settle],replies:[]},
    {setup:{deck:[{id:'HEADBUTT'},{id:'DEFEND_RED'},{id:'STRIKE_RED'}],draw:3,enemyHp:1},steps:[queue('DEFEND_RED'),settle,queue('HEADBUTT'),settle],replies:[]},
  ];
  const reference=await ReferenceClient.create();
  try{for(const seed of ['0','130'])for(const [index,c] of cases.entries()){
    const expected=await reference.call<Expected>(request(c.setup,c.steps,seed,c.replies)),definition=fixture(c.setup,c.steps,seed);
    for(const controlled of [true]){
      const loaded=unwrap(await createCardLoader({controlled,recordCore:false}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{
        let stop=unwrap(await instance.inspect()),at=0;
        while(stop.kind==='call'){
          assert.deepEqual(stop.call.input,expected.interactions[at],`selection seed=${seed} case=${index} mode=${controlled}`);
          unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:(2<<29)|c.replies[at++]!}})}));unwrap(await instance.run());stop=unwrap(await instance.inspect());
        }
        assert.equal(at,expected.interactions.length);assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Choice continuation did not finish');assertSameState(expected.states,stop.result,`selection-result seed=${seed} case=${index} mode=${controlled}`);

      }finally{await instance.close();await loaded.capture?.release(instance.id);}
    }
  }}finally{await reference.close();}
});

test('a paid Warcry waiting with cleanup queued rejects invalid replies, forks, and cold-restores independently',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-warcry-')),reference=await ReferenceClient.create();
  try{
    const expectedA=await reference.call<Expected>(request(branchSetup,branchSteps,'130',[0])),expectedB=await reference.call<Expected>(request(branchSetup,branchSteps,'130',[1]));
    const definition=fixture(branchSetup,branchSteps,'130'),loaded=unwrap(await createCardLoader({recordCore:false,snapshots:fileSnapshotStore(directory)}).load(definition)),parent=unwrap(await loaded.core.start(undefined)),count=initializations;
    const before=unwrap(await parent.inspect());assert.equal(before.kind,'call');
    unwrap(await parent.bind({decision:async()=>({kind:'reply',value:{bits:0}})}));const bad=unwrap(await parent.run());assert.equal(bad.accepted,false);assert.equal(bad.pause,'invalid_reply');assert.deepEqual(unwrap(await parent.inspect()),before);
    const snapshot=unwrap(await loaded.persistence!.save(parent)),a=unwrap(await parent.fork!()),b=unwrap(await loaded.persistence!.restore(snapshot));await parent.close();await loaded.capture?.release(parent.id);
    for(const [instance,index,expected] of [[a,0,expectedA],[b,1,expectedB]] as const){unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:(2<<29)|index}})}));unwrap(await instance.run());const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Fork did not finish');assertSameState(expected.states,stop.result,'choice branch');await instance.close();await loaded.capture?.release(instance.id);}
    assert.equal(initializations,count);assert.notDeepEqual(expectedA.states.at(-1),expectedB.states.at(-1));
    const code=`
      import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
      import {fixture,initializations} from ${JSON.stringify(new URL('./battle-card-fixture.ts',import.meta.url).href)};
      const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
      const definition=fixture(${JSON.stringify(branchSetup)},${JSON.stringify(branchSteps)},'130');
      const loaded=unwrap(await createCardLoader({recordCore:false,snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('Reinitialized paid card');}}));
      const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
      unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:2<<29}})}));unwrap(await instance.run());
      const stop=unwrap(await instance.inspect());if(stop.kind!=='done'||initializations!==0)throw Error(JSON.stringify({stop,initializations}));process.stdout.write(JSON.stringify(stop.result));await instance.close();await loaded.capture?.release(instance.id);
    `;
    const cold=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{maxBuffer:1024*1024});assertSameState(expectedA.states,JSON.parse(cold.stdout),'cold choice');await loaded.persistence!.release(snapshot);
  }finally{await reference.close();await rm(directory,{recursive:true,force:true});}
});
