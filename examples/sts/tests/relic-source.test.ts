import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {attributes} from '../src/rules/attributes.ts';
import {relicTexts} from '../src/content/relics/descriptions.ts';
import {damageRelics} from '../src/content/relics/common/damage.ts';
import {pileRelics} from '../src/content/relics/common/piles.ts';
import {resourceRelics} from '../src/content/relics/common/resources.ts';
import {openingRelics} from '../src/content/relics/common/opening.ts';
import {relicId,encounterId,type RelicId} from '../src/identifiers.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {deckCaseFixture} from './adventure-case-fixture.ts';
import type {Frame} from '../src/game.schemas.ts';

const projections=[damageRelics.exports.texts,pileRelics.exports.texts,resourceRelics.exports.texts,openingRelics.exports.texts];
test('migrated relic descriptions are projections of installed programs, not a second literal table',async()=>{
  const source=await readFile(new URL('../src/content/relics/descriptions.ts',import.meta.url),'utf8');
  const seen=new Set<string>();
  for(const projection of projections){
    assert.ok(Object.isFrozen(projection));
    for(const [id,text] of Object.entries(projection)){
      assert.ok(!seen.has(id),id);seen.add(id);
      assert.equal(relicTexts[id],text,id);
      assert.doesNotMatch(source,new RegExp(`\\b${id}\\s*:`),id);
    }
  }
  assert.equal(seen.size,23);
  assert.ok(Object.isFrozen(relicTexts));
  const expectedKeys=[...new Set([...Object.keys(relicId),'VOLIBEAR_HUNTERS_HEART','VOLIBEAR_IMMORTAL_HEART'])];
  assert.deepEqual(Object.keys(relicTexts).sort(),expectedKeys.sort());
  for(const id of expectedKeys.filter(id=>id!=='INVALID')){
    assert.ok(relicTexts[id]?.length,id);
    assert.doesNotMatch(source,new RegExp(`\\b${id}\\s*:\\s*['\"\x60]`),id);
  }
  for(const [id,text] of Object.entries(adventureContent.acquisition.exports.texts)){
    if(id.startsWith('VOLIBEAR_'))continue; // Character catalog replaces the Ironclad fallback.
    assert.ok(relicTexts[id]!.includes(text),id);
  }
  assert.match(relicTexts.DARKSTONE_PERIAPT!,/被阻止的牌不触发/);
});

test('conditions, targets and timing survive the description projection',()=>{
  assert.match(relicTexts.TORII!,/自身受到.*大于0且不超过5.*改为1/);
  assert.match(relicTexts.THE_BOOT!,/自身造成.*大于0且小于5.*改为5/);
  assert.match(relicTexts.SUNDIAL!,/自身洗牌时.*每累计3次.*自身获得2能量/);
  assert.match(relicTexts.MAGIC_FLOWER!,/战斗内自身.*1.5.*向下取整/);
  assert.match(relicTexts.ECTOPLASM!,/自身每回合补充能量.*1能量.*自身不能获得金币/);
  assert.match(relicTexts.ANCIENT_TEA_SET!,/开战时.*上一房间为篝火.*2能量/);
  assert.match(relicTexts.CAPTAINS_WHEEL!,/自身回合开始时.*第3回合.*18格挡/);
  assert.match(relicTexts.ORICHALCUM!,/自身回合结束时.*自身无格挡.*6格挡/);
  assert.match(relicTexts.BRIMSTONE!,/开战时.*自身获得2力量.*全体敌人获得1力量.*自身回合开始时/);
});

const program=new CardProgram(combatContentDefinition),END=(4<<29)>>>0;
function driver(relics:RelicId[],elite=false){
  const storage=privateCardGraph(program.initial({seed:'130',encounter:encounterId.TWO_LOUSE,relics,potion:null,durable:true,elite},100_000_000));
  const machine=new CardMachine(program,storage);let stop=machine.advance();
  function frame():Frame{
    while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    if(stop.kind==='done')return stop.result;
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));
    return stop.call.input;
  }
  function current(){
    frame();
    const runs=inspectRuleQuery(combatContentDefinition,machine.root.state,adventures.exports.instances,undefined);
    const actor=inspectRuleQuery(combatContentDefinition,machine.root.state,adventures.exports.bindings,runs[0]!).actor;
    return{...inspectRuleQuery(combatContentDefinition,machine.root.state,resources.exports.current,actor),strength:inspectRuleQuery(combatContentDefinition,machine.root.state,attributes.exports.strength,actor),dexterity:inspectRuleQuery(combatContentDefinition,machine.root.state,attributes.exports.dexterity,actor)};
  }
  return{frame,current,end(){assert.ok(frame().actions.some(a=>a.bits===END));stop=machine.advance({bits:END});return current();},close:()=>storage.close()};
}

for(const [id,field,increase] of [
  ['VAJRA','strength',1],['ODDLY_SMOOTH_STONE','dexterity',1],['ANCHOR','block',10],['LANTERN','energy',1],['BLOOD_VIAL','hp',2],['BRIMSTONE','strength',2],
] as const){
  test(`projected opening program executes its actual effect: ${id}`,()=>{
    const baseline=driver([]),owned=driver([id]);
    try{assert.equal(owned.current()[field]-baseline.current()[field],increase);}finally{baseline.close();owned.close();}
  });
}

test('turn-gated relic programs keep exact turn boundaries rather than becoming opening effects',()=>{
  const baseline=driver([]),horn=driver(['HORN_CLEAT']),wheel=driver(['CAPTAINS_WHEEL']);
  try{
    assert.equal(horn.current().block,baseline.current().block);assert.equal(wheel.current().block,baseline.current().block);
    const second=baseline.end();assert.equal(horn.end().block-second.block,14);assert.equal(wheel.end().block-second.block,0);
    const third=baseline.end();assert.equal(horn.end().block-third.block,0);assert.equal(wheel.end().block-third.block,18);
  }finally{baseline.close();horn.close();wheel.close();}
});

test('Brimstone keeps its opening and recurring programs; Anchor is opening-only',()=>{
  const brimstone=driver(['BRIMSTONE']),anchor=driver(['ANCHOR']);
  try{assert.equal(brimstone.current().strength,2);assert.equal(brimstone.end().strength,4);assert.equal(anchor.current().block,10);assert.equal(anchor.end().block,0);}finally{brimstone.close();anchor.close();}
});


test('unsupported and pinned inactive relics never advertise nonexistent effects',()=>{
  assert.match(relicTexts.DU_VU_DOLL!,/当前实现不提供额外效果/);
  assert.match(relicTexts.LIZARD_TAIL!,/当前|不可用|不.*复活/);
  assert.match(relicTexts.MATRYOSHKA!,/初始可用次数为0.*不提供/);
  assert.match(relicTexts.PEACE_PIPE!,/不执行删除/);
  assert.match(relicTexts.CRACKED_CORE!,/未实现.*战斗开始时.*抛出错误/);
  assert.match(relicTexts.PRISMATIC_SHARD!,/禁用跨颜色/);
});

test('split-owner effects append rather than overwrite energy, room and reward conditions',()=>{
  for(const id of ['BUSTED_CROWN','COFFEE_DRIPPER','FUSION_HAMMER','CURSED_KEY','RUNIC_DOME'])assert.match(relicTexts[id]!,/额外获得1能量/,id);
  assert.match(relicTexts.BUSTED_CROWN!,/选项数减少2/);
  assert.match(relicTexts.COFFEE_DRIPPER!,/不能休息/);
  assert.match(relicTexts.CURSED_KEY!,/打开非Boss宝箱.*1张随机诅咒/);
  assert.match(relicTexts.WHITE_BEAST_STATUE!,/少于4项.*上限则不生成/);
  assert.match(relicTexts.TINY_CHEST!,new RegExp(`每经过${adventureContent.acquisition.exports.counterPrograms.TINY_CHEST.period}个问号`));
  assert.equal(adventureContent.acquisition.exports.counterPrograms.TINY_CHEST.triggerAt,adventureContent.acquisition.exports.counterPrograms.TINY_CHEST.period-1);
  assert.match(relicTexts.GIRYA!,new RegExp(adventureContent.acquisition.exports.counterPrograms.GIRYA.text));
  assert.ok(relicTexts.EMPTY_CAGE!.includes(adventureContent.acquisition.exports.selections.exports.describe(4,2)));
  assert.ok(relicTexts.ASTROLABE!.includes(adventureContent.acquisition.exports.selections.exports.describe(2,3)));
});

test('deck relic projections execute actual post-prevention curse counts and resource amounts',()=>{
  for(const owned of [['DARKSTONE_PERIAPT'],['DARKSTONE_PERIAPT','OMAMORI'],['DARKSTONE_PERIAPT','OMAMORI','CERAMIC_FISH'],['DARKSTONE_PERIAPT','MARK_OF_THE_BLOOM']] as RelicId[][]){
    const program=new CardProgram(deckCaseFixture([{kind:'obtain',id:'REGRET',count:3},{kind:'obtain',id:'INJURY',count:1}],owned,true));
    const storage=privateCardGraph(program.initial({seed:'130'},100_000_000)),machine=new CardMachine(program,storage);
    try{
      const stop=machine.advance();assert.equal(stop.kind,'done',JSON.stringify({owned,stop}));if(stop.kind!=='done')throw Error('Deck fixture unexpectedly paused');
      const first=stop.result[0]!,last=stop.result.at(-1)!,count=owned.includes('OMAMORI')?2:4;
      assert.equal(last.maxHp-first.maxHp,6*count);
      assert.equal(last.hp-first.hp,owned.includes('MARK_OF_THE_BLOOM')?0:6*count);
      assert.equal(last.deck.length-first.deck.length,count);
      if(owned.includes('OMAMORI'))assert.equal(last.relics.find(r=>r.id==='OMAMORI')!.data,0);
    }finally{storage.close();}
  }
});
