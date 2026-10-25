import test from 'node:test';
import assert from 'node:assert/strict';
import {fit,wrap,cellWidth,renderTui} from '../src/sts-tui-view.ts';
import {runTui} from '../src/sts-tui.ts';
import type {TuiModel} from '../src/sts-tui-view.ts';

test('terminal layout measures Chinese cells, wraps descriptions and strips control sequences',()=>{
  assert.equal(cellWidth('中'),2);assert.equal(cellWidth('A'),1);assert.equal(fit('中文abc',5),'中文a');
  assert.deepEqual(wrap('中文ab',3),['中','文a','b']);assert.equal(fit('A\x1bB',3),'A B');
});
test('small terminal cannot obscure an active action; displays resize and save-exit instructions',()=>{
  const frame=renderTui({batch:{state:{}}} as TuiModel,40,10);
  assert.match(frame,/窗口过小/);assert.match(frame,/q 保存退出/);
});
test('CLI rejects unknown flags rather than starting an unintended game',async()=>{
  await assert.rejects(runTui(['--resume']),/缺少值/);await assert.rejects(runTui(['--seed','1','--seed','2']),/重复/);
});

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {openSimulator} from '../../../examples/sts/src/simulator.ts';
import {openSimulatorStore} from '../../../examples/sts/src/simulator-store.ts';
import {combatContentDefinition} from '../../../examples/sts/tests/combat-content-fixture.ts';
import {encounterId,potionId} from '../../../examples/sts/src/identifiers.ts';
import {chooseMultiple,decisionPresentation,contentLines} from '../src/sts-tui-view.ts';

test('TUI renders original multi-choice, rejects absent combinations, scrolls back from End, hides future and distinguishes terminal results',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-tui-choices-')),snapshots=memorySnapshotStore(),loaded=await createCardLoader({snapshots,recordCore:false,controlled:true,instructionsPerSlice:100_000}).load(combatContentDefinition);
  if(!loaded.ok)throw Error(JSON.stringify(loaded.error));
  const session=await openSimulator({store:await openSimulatorStore(dir,'new'),resume:false,kernel:{loaded:loaded.value,snapshots,program:'tui-fixture/1',character:'ironclad'},setup:{seed:'574853884',detailedEvents:true,encounter:encounterId.CULTIST,relics:['RUNIC_DOME'],potion:potionId.GAMBLERS_BREW,durable:false,elite:false}});
  try{
    let batch=await session.observe();assert.equal(batch.state.observation.battle!.draw,undefined);
    const known=new Set([...batch.state.observation.battle!.hand,...batch.state.observation.battle!.discard,...batch.state.observation.battle!.exhaust].map(c=>c.uniqueId));
    assert.ok(Object.values(batch.identities).filter(e=>e.kind==='card').every(e=>known.has(e.card!)),'no hidden draw entities published');
    const potion=decisionPresentation(batch).actions.find(a=>a.kind==='drink-potion')!;
    const response=await session.act({id:'gamble',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:potion.bits}});assert.ok(response.accepted);if(!response.accepted)throw Error('not accepted');batch=response.batch;
    const candidates=batch.state.observation.battle!.select!.candidates!;
    assert.ok(candidates.length>1);const choice=chooseMultiple(batch,[candidates[0]!.index,candidates[1]!.index]);assert.ok(choice);
    assert.equal(chooseMultiple(batch,[999]),undefined);
    const model:TuiModel={batch,tab:1,scroll:1e9,selected:0,filter:'',filtering:false,message:'fixture',busy:false,log:[],focus:'content',confirm:false,multi:[candidates[0]!.index]};
    const output=renderTui(model,80,24);assert.match(output,/\[x\]/);assert.match(output,/多选模式/);
    assert.ok(model.scroll<1e9);const end=model.scroll;model.scroll=Math.max(0,end-10);renderTui(model,80,24);assert.ok(model.scroll<end);
    assert.equal(output.split('\r\n').length,24);
    assert.match(contentLines(batch,0,[]).join('\n'),/意图 隐藏/);
    for(const [termination,label]of [['death','死亡'],['act3-clear','第三幕通关'],['heart-victory','第四幕碎心']] as const){const ended=structuredClone(model);ended.batch.state.termination=termination;ended.batch.state.request=null;ended.multi=null;assert.ok(renderTui(ended,80,24).includes(label));}
    const result=await session.act({id:'selected',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:choice!.bits}});assert.ok(result.accepted);
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});

import {simulatorRoomDefinition} from '../../../examples/sts/tests/simulator-room-fixture.ts';
for(const room of ['SHOP','REST','EVENT'] as const)test(`TUI and host accept original ${room} choices and expose the next real decision`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-tui-room-')),snapshots=memorySnapshotStore(),loaded=await createCardLoader({snapshots,recordCore:false,controlled:true,instructionsPerSlice:100_000}).load(simulatorRoomDefinition);
  if(!loaded.ok)throw Error(JSON.stringify(loaded.error));
  const session=await openSimulator({store:await openSimulatorStore(dir,'new'),resume:false,kernel:{loaded:loaded.value,snapshots,program:'room-fixture/1',character:'ironclad'},setup:{seed:'130',room}});
  try{
    const batch=await session.observe(),p=decisionPresentation(batch);
    const action=p.actions.find(a=>room==='SHOP'?a.kind==='buy-card':room==='REST'?a.kind==='rest-option'&&a.details.option===1:a.kind==='event-option'&&a.bits===0);assert.ok(action);
    const model:TuiModel={batch,tab:0,scroll:0,selected:p.actions.indexOf(action!),filter:'',filtering:false,message:'',busy:false,log:[],focus:'actions',confirm:false,multi:null};
    assert.ok(renderTui(model,110,30).includes(room==='SHOP'?'购买':room==='REST'?'锻造':'升级'));
    const response=await session.act({id:'room-input',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:action!.bits}});assert.ok(response.accepted);if(!response.accepted)throw Error('not accepted');
    assert.equal(response.batch.state.observation.game.screen,room==='SHOP'?'SHOP_ROOM':'CARD_SELECT');
    assert.ok(decisionPresentation(response.batch).actions.length>0);
    assert.ok(renderTui({...model,batch:response.batch,selected:0},80,24).length>0);
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});
