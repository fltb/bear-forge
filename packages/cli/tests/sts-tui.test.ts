import test from 'node:test';
import assert from 'node:assert/strict';
import {fit,wrap,cellWidth,renderTui,cardLines,turnThreat,damageLines,engageLines,actionMatches,needsConfirmation,resultSummary} from '../src/sts-tui-view.ts';
import {routeMap,routeDetails} from '../src/sts-tui-map.ts';
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
test('card text keeps actual turn cost, free play, upgrade and original full effect',()=>{
  const lines=cardLines({id:'BASH',upgraded:true,cost:2,costForTurn:1,freeToPlayOnce:true,retain:true});
  assert.match(lines.join('\n'),/Bash\+.*攻击.*基础费用 2.*本回合费用 1/);
  assert.match(lines.join('\n'),/保留.*本次免费.*需要敌方目标/);
  assert.match(lines.join('\n'),/易伤/);
});

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {openSimulator} from '../../../examples/sts/src/simulator.ts';
import {openSimulatorStore} from '../../../examples/sts/src/simulator-store.ts';
import {combatContentDefinition} from '../../../examples/sts/tests/combat-content-fixture.ts';
import {encounterId,potionId} from '../../../examples/sts/src/identifiers.ts';
import {chooseMultiple,decisionPresentation,contentLines,actionLabel} from '../src/sts-tui-view.ts';

const plainFrame=(frame:string)=>frame.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');

test('TUI renders original multi-choice, rejects absent combinations, scrolls back from End, hides future and distinguishes terminal results',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-tui-choices-')),snapshots=memorySnapshotStore(),loaded=await createCardLoader({snapshots,recordCore:false,controlled:true,instructionsPerSlice:100_000}).load(combatContentDefinition);
  if(!loaded.ok)throw Error(JSON.stringify(loaded.error));
  const session=await openSimulator({store:await openSimulatorStore(dir,'new'),resume:false,kernel:{loaded:loaded.value,snapshots,program:'tui-fixture/1',character:'ironclad'},setup:{seed:'574853884',detailedEvents:true,encounter:encounterId.CULTIST,relics:['RUNIC_DOME'],potion:potionId.GAMBLERS_BREW,durable:false,elite:false}});
  try{
    let batch=await session.observe();assert.equal(batch.state.observation.battle!.draw,undefined);
    const initialActions=decisionPresentation(batch).actions,play=initialActions.find(a=>a.kind==='play-card'&&a.details.target!==null)!;
    assert.ok(play);
    const cost=batch.state.observation.battle!.costs![String(play.bits)];
    assert.ok(actionLabel(batch,play).includes(`${cost}费`));
    assert.ok(actionLabel(batch,play).includes(`→ [${play.details.target}]`));
    const focused:TuiModel={batch,tab:0,scroll:0,selected:initialActions.indexOf(play),filter:'',filtering:false,message:'',busy:false,log:['不应挤进主屏的历史记录'],focus:'actions',confirm:false,multi:null};
    const scene=contentLines(batch,0,focused.log).join('\n');
    assert.doesNotMatch(scene,/不应挤进主屏|当前计数|力量 0|虚弱 0|人工制品 0|基础费用/);
    assert.match(scene,/意图 隐藏/);
    assert.match(scene,/手牌 · 当前费用/);
    assert.ok(scene.includes(`[${play.details.hand}] ${cost}费`));
    const discounted=structuredClone(batch),hand=play.details.hand as number;
    discounted.state.observation.battle!.costs={[String(play.bits)]:0};
    assert.ok(contentLines(discounted,0,[]).join('\n').includes(`[${hand}] 0费`));
    assert.ok(actionLabel(discounted,play).startsWith(`[${hand}] 0费`));
    discounted.state.observation.battle!.costs[String((1<<16)|hand)]=2;
    assert.ok(contentLines(discounted,0,[]).join('\n').includes(`[${hand}] 0–2费`));

    assert.match(contentLines(batch,3,focused.log).join('\n'),/不应挤进主屏的历史记录/);
    for(const [columns,rows] of [[60,16],[80,24],[110,30]]){
      const frame=plainFrame(renderTui({...focused},columns!,rows!)),lines=frame.split('\r\n');
      assert.equal(lines.length,rows);
      for(const line of lines)assert.equal([...line].reduce((n,c)=>n+cellWidth(c),0),columns!-1);
      assert.match(frame,/能量/);assert.match(frame,/选中详情/);
      assert.equal(frame.match(/HP /g)?.length,2,'player HP appears once, alongside enemy HP');
    }
    // Published intents only: consumed actions and dead monsters cannot attack again.
    const danger=structuredClone(batch),db=danger.state.observation.battle!;
    db.intentHidden=false;db.player.hp=16;db.player.block=0;
    db.monsters=[{...db.monsters[0]!,index:0,hp:1},{...db.monsters[0]!,index:1,hp:29}];
    db.intents=[{index:0,name:'ATTACK',attack:true,baseDamage:8,attackDamage:8,hits:1},{index:1,name:'ATTACK',attack:true,baseDamage:13,attackDamage:13,hits:1}];
    assert.equal(turnThreat(danger)?.total,21);assert.equal(turnThreat(danger)?.lethal,true);
    assert.match(contentLines(danger,0,[]).join('\n'),/致死风险/);
    const dangerModel={...focused,batch:danger,selected:initialActions.findIndex(a=>a.kind==='end-turn')};
    assert.match(plainFrame(renderTui(dangerModel,80,24)),/致死风险/);
    assert.match(plainFrame(renderTui({...dangerModel,confirm:true},80,24)),/致死风险/);
    db.intents[0]!.acted=true;assert.equal(turnThreat(danger)?.total,13);assert.equal(turnThreat(danger)?.lethal,false);
    db.intents[1]!.hits=3;db.player.block=5;assert.equal(turnThreat(danger)?.loss,34);
    db.monsters[1]!.hp=0;assert.equal(turnThreat(danger)?.total,0);
    db.intentHidden=true;assert.equal(turnThreat(danger),null);
    // Do not hide arithmetic or imply that current operands predict future triggers.
    db.damagePreview={[String(play.bits)]:[{label:'普通攻击',target:0,amount:5,hits:2},{label:'领域附雷',target:null,amount:4,hits:1},{label:'狂雷渐起',target:null,amount:2,hits:2}]};
    const damage=damageLines(danger,play).join('\n');
    assert.match(damage,/5×2/);assert.match(damage,/狂雷渐起.*2×2/);assert.match(damage,/合计：\[0\] 18/);assert.match(damage,/条件效果另计/);
    db.damagePreview[String(play.bits)]!.push({label:'普通攻击',target:0,amount:5,hits:1},{label:'狂雷渐起',target:null,amount:2,hits:2});
    const grouped=damageLines(danger,play).join('\n');
    assert.match(grouped,/普通攻击.*5×3/);assert.match(grouped,/狂雷渐起.*2×4/);
    assert.equal(grouped.match(/狂雷渐起/g)?.length,1);assert.match(grouped,/合计：\[0\] 27/);
    db.intentHidden=false;db.intents[0]!.acted=false;
    const engage={...play,details:{...play.details,card:{id:'VOLIBEAR_C11',upgraded:false},target:0}};
    assert.match(engageLines(danger,engage).join('\n'),/目标现在行动.*\n.*8×1 = 8/);
    db.intents[0]!.acted=true;assert.match(engageLines(danger,engage).join('\n'),/不会再次行动/);
    db.intentHidden=true;assert.match(engageLines(danger,engage).join('\n'),/意图未知/);
    assert.equal(needsConfirmation(danger,engage),true,'unknown engage intent still requires confirmation');
    db.intentHidden=false;db.intents[0]!.acted=true;
    assert.equal(needsConfirmation(danger,engage),false,'spent enemy action does not need an engage confirmation');
    const fatal=structuredClone(batch),fb=fatal.state.observation.battle!;
    fatal.state.observation.game.hp=8;fb.player.hp=8;fb.player.energy=2;fb.player.block=13;fb.intentHidden=false;
    fb.hand[play.details.hand as number]={...fb.hand[play.details.hand as number]!,id:'VOLIBEAR_C10',cost:2,costForTurn:2,upgraded:false};
    fb.intents=[{index:0,name:'GREMLIN_LEADER_STAB',attack:true,baseDamage:6,attackDamage:11,hits:3}];
    fb.costs![String(play.bits)]=2;
    const fatalActions=decisionPresentation(fatal).actions,fatalAction=fatalActions.find(a=>a.bits===play.bits)!;
    assert.equal(needsConfirmation(fatal,fatalAction),true);
    for(const [columns,rows] of [[80,24],[110,34]]){
      const rendered=plainFrame(renderTui({...focused,batch:fatal,selected:fatalActions.indexOf(fatalAction)},columns!,rows!));
      assert.equal(rendered.split('\r\n').length,rows);
      for(const line of rendered.split('\r\n'))assert.equal([...line].reduce((n,c)=>n+cellWidth(c),0),columns!-1);
      assert.match(rendered,/总攻击 33/);assert.match(rendered,/格挡 13/);
      assert.match(rendered,/▶ \[0\]/);assert.match(rendered,/迎战立即让目标行动/);
      assert.match(rendered,/11×3 = 33/);assert.match(rendered,/尚未执行/);
      assert.match(rendered,/支付 2 能量，余 0/);
      assert.ok(rendered.indexOf('先迎战目标')>rendered.indexOf('选中详情'),'full-width card effect is visible before executing');
    }

    const crowded=structuredClone(fatal),cb=crowded.state.observation.battle!;
    cb.monsters=[...[1,2,3].map(index=>({...cb.monsters[0]!,index})),cb.monsters[0]!];
    const crowdedModel={...focused,batch:crowded,selected:fatalActions.indexOf(fatalAction)};
    const crowdedFrame=plainFrame(renderTui(crowdedModel,80,24));
    assert.ok(crowdedModel.scroll>0,'selected enemy scrolls into view');
    assert.match(crowdedFrame,/▶ \[0\]/);assert.match(crowdedFrame,/将攻击 11×3 = 33/);
    const map=structuredClone(batch),g=map.state.observation.game;
    g.screen='MAP_SCREEN';g.x=3;g.y=0;g.map.burningEliteX=4;g.map.burningEliteY=1;
    g.map.nodes=[{x:3,y:0,room:'MONSTER',edges:[2,4],parents:[]},{x:2,y:1,room:'REST',edges:[3],parents:[3]},{x:4,y:1,room:'ELITE',edges:[3],parents:[3]},{x:0,y:1,room:'SHOP',edges:[0],parents:[0]},{x:3,y:2,room:'TREASURE',edges:[],parents:[2,4]}];
    const drawing=routeMap(map,{...decisionPresentation(map),actions:[]}).join('\n');
    assert.match(drawing,/@ 当前：第 1 层 D/);assert.match(drawing,/╱/);assert.match(drawing,/╲/);assert.match(drawing,/R.*!/);
    assert.doesNotMatch(drawing.split('A  B  C  D  E  F  G')[1]!.split('↓ Boss')[0]!,/\$/,'unreachable shop omitted');
    assert.match(routeDetails(map,4,1).join('\n'),/燃烧精英.*\n.*绿钥匙.*\n.*D 宝箱/);
    assert.match(routeDetails(map,3,0).join('\n'),/之后可走：C 营火 \/ E 燃烧精英/);
    const travel={...play,kind:'travel' as const,label:'travel to (4, 1)',details:{x:4,y:1}};
    assert.equal(actionMatches(map,travel,'燃烧精英'),true);assert.equal(actionMatches(map,travel,'营火'),false);
    assert.equal(actionMatches(map,travel,'travel'),true);
    const before=plainFrame(renderTui({...focused},80,24)).split('\r\n');
    const after=plainFrame(renderTui({...focused,selected:initialActions.findIndex(a=>a.kind==='end-turn')},80,24)).split('\r\n');
    assert.equal(before.findIndex(line=>line.includes('选中详情')),after.findIndex(line=>line.includes('选中详情')),'preview stays in place while moving selection');
    const statuses=structuredClone(batch);statuses.state.observation.battle!.player.strength=-2;
    statuses.state.observation.battle!.effects=[{actor:0,target:'player',name:'WEAK',text:'攻击伤害降低',level:2,active:true}];
    assert.match(contentLines(statuses,0,[]).join('\n'),/虚弱 2.*力量 -2/);
    statuses.state.observation.battle!.effects.push({actor:0,target:'player',name:'LOSE_STRENGTH',text:'回收临时力量',level:4,active:false});
    const power={actor:0,target:'player',name:'狂雷渐起',text:'逐段雷伤',level:4,active:true};
    statuses.state.observation.battle!.effects.push(power,power);
    statuses.state.observation.battle!.domain={active:true,untilTurn:3};
    assert.doesNotMatch(contentLines(statuses,0,[]).join('\n'),/LOSE_STRENGTH/);
    assert.match(contentLines(statuses,0,[]).join('\n'),/狂雷渐起 4 ×2份/);
    assert.match(contentLines(statuses,0,[]).join('\n'),/敌方有利特效暂停/);
    assert.match(contentLines(statuses,4,[]).join('\n'),/LOSE_STRENGTH/);
    const empty=plainFrame(renderTui({...focused,filter:'不存在的操作'},80,24));assert.match(empty,/操作 0\/0/);assert.match(empty,/没有匹配的操作/);
    const known=new Set([...batch.state.observation.battle!.hand,...batch.state.observation.battle!.discard,...batch.state.observation.battle!.exhaust].map(c=>c.uniqueId));
    assert.ok(Object.values(batch.identities).filter(e=>e.kind==='card').every(e=>known.has(e.card!)),'no hidden draw entities published');
    const potion=decisionPresentation(batch).actions.find(a=>a.kind==='drink-potion')!;
    const response=await session.act({id:'gamble',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:potion.bits}});assert.ok(response.accepted);if(!response.accepted)throw Error('not accepted');batch=response.batch;
    const candidates=batch.state.observation.battle!.select!.candidates!;
    assert.ok(candidates.length>1);const choice=chooseMultiple(batch,[candidates[0]!.index,candidates[1]!.index]);assert.ok(choice);
    assert.equal(chooseMultiple(batch,[999]),undefined);
    const model:TuiModel={batch,tab:1,scroll:1e9,selected:0,filter:'',filtering:false,message:'fixture',busy:false,log:[],focus:'content',confirm:false,multi:[candidates[0]!.index]};
    const output=renderTui(model,80,24);assert.match(output,/\[x\] \[0\] \d+费/);assert.match(output,/多选模式/);
    assert.doesNotMatch(contentLines(batch,1,[]).join('\n'),/Frozen Eye/);
    assert.match(contentLines(batch,4,[]).join('\n'),/RUNIC_DOME · 当前计数/);
    const long=structuredClone(model);long.tab=5;long.scroll=0;
    assert.match(renderTui(long,80,24),/当前多选候选/);
    assert.ok(model.scroll<1e9);const end=model.scroll;model.scroll=Math.max(0,end-10);renderTui(model,80,24);assert.ok(model.scroll<end);
    assert.equal(output.split('\r\n').length,24);
    assert.match(contentLines(batch,0,[]).join('\n'),/意图 隐藏/);
    for(const [termination,label]of [['death','死亡'],['act3-clear','第三幕通关'],['heart-victory','第四幕碎心']] as const){const ended=structuredClone(model);ended.batch.state.termination=termination;ended.batch.state.request=null;ended.multi=null;assert.ok(renderTui(ended,80,24).includes(label));}
    const result=await session.act({id:'selected',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:choice!.bits}});assert.ok(result.accepted);
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});

for(const [kind,bark,expected] of [['drink-potion',false,2],['discard-potion',false,0],['drink-potion',true,4]] as const){
  test(`energy potion ${kind} at zero energy has the advertised result; Sacred Bark=${bark}`,async()=>{
    const dir=await mkdtemp(join(tmpdir(),'sts-tui-energy-')),snapshots=memorySnapshotStore();
    const loaded=await createCardLoader({snapshots,recordCore:false,controlled:true,instructionsPerSlice:100_000}).load(combatContentDefinition);
    if(!loaded.ok)throw Error(JSON.stringify(loaded.error));
    const session=await openSimulator({store:await openSimulatorStore(dir,'new'),resume:false,kernel:{loaded:loaded.value,snapshots,program:'tui-energy-fixture/1',character:'ironclad'},setup:{seed:'574853884',detailedEvents:true,encounter:encounterId.CULTIST,relics:bark?['SACRED_BARK']:[],potion:potionId.ENERGY_POTION,durable:false,elite:false}});
    try{
      let batch=await session.observe();
      const act=async(bits:number)=>{
        const response=await session.act({id:`energy-${batch.revision}`,sessionId:batch.state.sessionId,revision:batch.revision,action:{bits}});
        assert.ok(response.accepted);if(!response.accepted)throw Error('not accepted');batch=response.batch;
      };
      while(batch.state.observation.battle!.player.energy>0){
        const play=decisionPresentation(batch).actions.find(a=>a.kind==='play-card'&&batch.state.observation.battle!.costs![String(a.bits)]!>0);
        assert.ok(play,'fixture can spend remaining energy');await act(play.bits);
      }
      const actions=decisionPresentation(batch).actions,selected=actions.findIndex(a=>a.kind===kind);
      assert.ok(selected>=0);
      const model:TuiModel={batch,tab:0,scroll:0,selected,filter:'',filtering:false,message:'',busy:false,log:[],focus:'actions',confirm:false,multi:null};
      const rendered=plainFrame(renderTui(model,110,30));
      if(kind==='discard-potion'){
        assert.match(actionLabel(batch,actions[selected]!),/丢弃（不生效）/);
        assert.match(rendered,/不会触发任何药水效果/);
        assert.doesNotMatch(rendered,/获得2能量/);
      }else assert.match(rendered,/获得2能量/);
      const beforePotion=batch;
      await act(actions[selected]!.bits);
      if(expected)assert.ok(resultSummary(beforePotion,batch).includes(`能量 0→${expected}`));
      else assert.doesNotMatch(resultSummary(beforePotion,batch),/能量/);
      assert.equal(batch.state.observation.battle!.player.energy,expected);
      assert.ok(!batch.state.observation.game.potions.includes(potionId.ENERGY_POTION));
      const gains=batch.events.filter(e=>e.event.kind==='detail'&&e.event.type==='energy-gain');
      assert.equal(gains.length,kind==='drink-potion'?1:0);
    }finally{await session.close();await rm(dir,{recursive:true,force:true});}
  });
}

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
    if(room==='SHOP'){
      const publicCopy=structuredClone(batch);publicCopy.state.observation.game.gold=0;
      const text=contentLines(publicCopy,5,[]).join('\n');
      assert.match(text,/商店全部商品/);assert.match(text,/金币不足/);assert.match(text,/基础费用/);
    }
    if(room==='EVENT'){
      const long=structuredClone(batch);long.state.observation.game.optionDetails!['0']='很长的事件代价与收益。'.repeat(200)+'选项末尾可见';
      assert.match(plainFrame(renderTui({...model,batch:long,selected:0},80,24)),/详情.*可滚动/);
      const scroll:TuiModel={...model,batch:long,tab:5,scroll:0};let visible='';
      for(let page=0;page<150;page++){scroll.scroll=page*17;visible+=plainFrame(renderTui(scroll,80,24)).split('\r\n').slice(4,-2).map(line=>line.split(' │ ')[0]!.trimEnd()).join('');}
      assert.match(visible,/选项末尾可见/);
    }
    const response=await session.act({id:'room-input',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:action!.bits}});assert.ok(response.accepted);if(!response.accepted)throw Error('not accepted');
    assert.equal(response.batch.state.observation.game.screen,room==='SHOP'?'SHOP_ROOM':'CARD_SELECT');
    assert.ok(decisionPresentation(response.batch).actions.length>0);
    assert.ok(renderTui({...model,batch:response.batch,selected:0},80,24).length>0);
    if(room==='SHOP'){
      assert.match(contentLines(response.batch,5,[]).join('\n'),/已售罄／不可用/);
      assert.ok(!decisionPresentation(response.batch).actions.some(a=>a.kind==='buy-card'&&a.details.index===action!.details.index));
    }
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});
