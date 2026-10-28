import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {potionPrograms} from '../src/content/potions/programs.ts';
import {potionTexts} from '../src/content/potions/descriptions.ts';
import {potionRequiresEnemy,bloodPotionHealing} from '../src/content/potions/metadata.ts';
import {fairyPotionHealing} from '../src/content/potions/vitality.ts';
import {describeAction} from '../src/presentation.ts';
import {potionId,encounterId,type RelicId} from '../src/identifiers.ts';
import type {Frame} from '../src/game.schemas.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {potionRelicFixture} from './adventure-case-fixture.ts';

function combat(potion:number,relics:RelicId[]=[]){
  const program=new CardProgram(combatContentDefinition);
  const storage=privateCardGraph(program.initial({seed:'130',encounter:encounterId.THREE_CULTIST,relics,potion,durable:false,elite:false},100_000_000));
  const machine=new CardMachine(program,storage);
  let stop=machine.advance();
  const frame=():Frame=>{
    while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    if(stop.kind==='done')return stop.result;
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected potion decision');
    return stop.call.input;
  };
  return {frame,drink(bits:number){stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}
const drinks=(frame:Frame)=>frame.actions.filter(a=>(a.bits>>>29)===1&&((a.bits>>>16)&8191)<6);

test('potion descriptions and targeting project every executing composition',()=>{
  for(const [name,program] of Object.entries(potionPrograms)){
    assert.equal(potionTexts[name],program.text,name);
    assert.equal(potionRequiresEnemy(potionId[name as keyof typeof potionPrograms]),program.targeted,name);
    assert.ok(program.text.length>0,name);
  }
  for(const name of Object.keys(potionId))assert.ok(potionTexts[name],name);
  assert.equal(potionTexts.BLOCK_POTION,'获得12格挡。');
  assert.equal(potionTexts.FRUIT_JUICE,'最大生命+5。');
  assert.equal(potionTexts.FIRE_POTION,'目标受到20伤害。');
  assert.match(potionTexts.FLEX_POTION!,/5力量.*5回合结束失去力量/);
  assert.match(potionTexts.SPEED_POTION!,/5敏捷.*5回合结束失去敏捷/);
  assert.match(potionTexts.SNECKO_OIL!,/抽5张牌.*0–3.*本战/);
  assert.match(potionTexts.ATTACK_POTION!,/3张攻击.*1张.*本回合免费/);
  assert.match(potionTexts.LIQUID_MEMORIES!,/1张弃牌.*本回合0费/);
  assert.equal(Object.isFrozen(potionPrograms),true);
  assert.equal(Object.isFrozen(potionTexts),true);
});

test('actual legal potion actions and public descriptions use the same recipient',()=>{
  for(const name of ['FEAR_POTION','FIRE_POTION','WEAK_POTION','BLOCK_POTION','EXPLOSIVE_POTION','FAIRY_POTION'] as const){
    const d=combat(potionId[name]);
    try {
      const frame=d.frame(),actions=drinks(frame);
      const targeted=['FEAR_POTION','FIRE_POTION','WEAK_POTION'].includes(name);
      assert.deepEqual(actions.map(a=>(a.bits>>>16)&8191),name==='FAIRY_POTION'?[]:targeted?[0,1,2]:[0],name);
      for(const action of actions)assert.equal(describeAction(frame,action.bits).details.target,targeted?(action.bits>>>16)&8191:null,name);
      if(name==='FIRE_POTION'){
        const before=frame.battle!.monsters.map(m=>m.hp),after=d.drink(actions[1]!.bits);
        assert.deepEqual(after.battle!.monsters.map(m=>m.hp),before.map((hp,i)=>hp-(i===1?20:0)));
      } else if(name==='FEAR_POTION'||name==='WEAK_POTION'){
        const field=name==='FEAR_POTION'?'vulnerable':'weak';
        const after=d.drink(actions[1]!.bits);
        assert.deepEqual(after.battle!.monsters.map(m=>m[field]),[0,3,0]);
      } else if(name==='BLOCK_POTION'){
        assert.equal(d.drink(actions[0]!.bits).battle!.player.block-frame.battle!.player.block,12);
      } else if(name==='EXPLOSIVE_POTION'){
        const after=d.drink(actions[0]!.bits);
        assert.deepEqual(after.battle!.monsters.map(m=>m.hp),frame.battle!.monsters.map(m=>m.hp-10));
      }
    } finally {d.close();}
  }
});

for(const bark of [false,true])test(`Fruit Juice uses the same operation in combat and adventure (Bark=${bark})`,()=>{
  const relics:RelicId[]=bark?['SACRED_BARK']:[],increase=bark?10:5;
  const d=combat(potionId.FRUIT_JUICE,relics);
  try {
    const before=d.frame(),after=d.drink(drinks(before)[0]!.bits);
    assert.equal(after.battle!.player.maxHp-before.battle!.player.maxHp,increase);
    assert.ok(!after.game.potions.includes(potionId.FRUIT_JUICE));
  } finally {d.close();}
  const definition=potionRelicFixture(relics,potionId.FRUIT_JUICE,false),program=new CardProgram(definition);
  const storage=privateCardGraph(program.initial({seed:'130'},100_000_000)),machine=new CardMachine(program,storage);
  try {
    let stop=machine.advance();
    while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    assert.equal(stop.kind,'done',JSON.stringify(stop));
    if(stop.kind!=='done')throw Error('Adventure potion did not complete');
    assert.equal(stop.result.maxHp,80+increase);
    assert.ok(!stop.result.potions.includes(potionId.FRUIT_JUICE));
  } finally {storage.close?.();}
});

for(const bark of [false,true])test(`Blood Potion shares its executing healing operation across scenes (Bark=${bark})`,()=>{
  const relics:RelicId[]=bark?['SACRED_BARK']:[],healing=bark?32:16;
  const d=combat(potionId.BLOOD_POTION,['LIZARD_TAIL',...relics]);
  try {
    const before=d.frame(),after=d.drink(drinks(before)[0]!.bits);
    assert.equal(before.battle!.player.hp,1);
    assert.equal(after.battle!.player.hp,1+healing);
  } finally {d.close();}
  const definition=potionRelicFixture(relics,potionId.BLOOD_POTION,false),program=new CardProgram(definition);
  const storage=privateCardGraph(program.initial({seed:'130'},100_000_000)),machine=new CardMachine(program,storage);
  try {
    let stop=machine.advance();
    while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    assert.equal(stop.kind,'done',JSON.stringify(stop));
    if(stop.kind!=='done')throw Error('Adventure potion did not complete');
    assert.equal(stop.result.hp,10+healing);
    assert.ok(!stop.result.potions.includes(potionId.BLOOD_POTION));
  } finally {storage.close?.();}
});

test('shared vitality formulas preserve rounding and existing Fairy adventure behavior',()=>{
  assert.equal(bloodPotionHealing(83,1),16);
  assert.equal(bloodPotionHealing(83,2),33);
  assert.equal(fairyPotionHealing(80,false,true),24);
  assert.equal(fairyPotionHealing(80,true,true),48);
  assert.equal(fairyPotionHealing(80,false,false),24);
  assert.equal(fairyPotionHealing(80,true,false),1);
});
