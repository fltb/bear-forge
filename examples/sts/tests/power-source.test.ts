import {rules} from '../src/rules/execution.ts';
import {attributes} from '../src/rules/attributes.ts';
import {describeProgram,programText,inheritPrograms,attackProgram,hasFixedAttack} from '../src/content/cards/shared/program-facts.ts';
import {programText as sharedProgramText} from '../src/rules/program-descriptions.ts';
import type {CardUse} from '../src/rules/card-instances.types.ts';
import {powerAbilities,composePowerProgram,powerDescription,describedAbility} from '../src/content/powers/utils.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {statusTexts,volibearMechanics} from '../src/content/powers/descriptions.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
import {defensePowers} from '../src/content/powers/defense.ts';
import {relicPowers} from '../src/content/powers/relics.ts';
import {ironcladPowers} from '../src/content/characters/ironclad/powers/definitions.ts';
import {potionPowers} from '../src/content/potions/powers.ts';
import {potionRelics,sacredBark} from '../src/content/potions/relics.ts';
import {enemyDefensePowers} from '../src/content/enemies/shared/defense-powers.ts';
import {enemyTurnPowers} from '../src/content/enemies/shared/ritual.ts';
import {finalPowers} from '../src/content/enemies/ending/powers.ts';
import {stormCharge} from '../src/content/characters/volibear/mechanics/storm-charge.ts';
import {lightning} from '../src/content/characters/volibear/mechanics/lightning.ts';
import {fairyPotionHealing} from '../src/content/potions/vitality.ts';

test('status glossary projects the installed static power owners',()=>{
  for(const owner of [basicPowers,ironcladPowers,relicPowers]){
    for(const [key,text] of Object.entries(owner.exports.statusTexts))assert.equal(statusTexts[key],text,key);
  }
  for(const owner of [basicPowers,defensePowers,ironcladPowers,relicPowers]){
    for(const program of Object.values(owner.exports.programs)){
      assert.ok(program.definition);
      assert.ok(program.name.length>0);
      assert.ok(program.text.length>0);
      assert.equal(Object.isFrozen(program),true);
    }
  }
  assert.equal(Object.isFrozen(statusTexts),true);
});

test('shared public status names preserve distinct player and enemy rules',()=>{
  assert.equal(statusTexts.REGEN,`玩家：${potionPowers.exports.programs.Regeneration.text}敌人：${finalPowers.exports.programs.Regen.text}`);
  assert.equal(statusTexts.RITUAL,`玩家：${potionPowers.exports.programs.Ritual.text}敌人：${enemyTurnPowers.exports.programs.EnemyRitual.text}`);
  assert.equal(statusTexts.PLATED_ARMOR,`玩家：${potionPowers.exports.programs.PlatedArmor.text}敌人：${enemyDefensePowers.exports.programs.PlatedArmor.text}`);
  assert.match(defensePowers.exports.programs.PlayerIntangible.text,/包括原本为0/);
  assert.match(defensePowers.exports.programs.EnemyIntangible.text,/至少1而非上限/);
  assert.match(ironcladPowers.exports.programs.Brutality.text,/不标记为自伤/);
});

test('mechanic and potion relic text consumes the executable recipes',()=>{
  assert.equal(volibearMechanics.雷势,stormCharge.exports.text+lightning.exports.chargeText);
  assert.equal(volibearMechanics.雷伤,lightning.exports.text);
  assert.equal(potionRelics.exports.relicTexts.SACRED_BARK,sacredBark.text);
  assert.equal(sacredBark.multiplier(false),1);
  assert.equal(sacredBark.multiplier(true),2);
  assert.equal(fairyPotionHealing(100,true,true),60);
  assert.equal(fairyPotionHealing(100,true,false),1);
});

test('adding an undescribed child cannot keep a power composition complete',()=>{
  const known=describeProgram(rules.modify(attributes.exports.strength,{transform:(_r,c)=>c.value+1}),'力量增加1。');
  const unknown=rules.modify(attributes.exports.strength,{transform:(_r,c)=>c.value+2});
  assert.equal(powerDescription([powerAbilities(known)]).complete,true);
  assert.equal(powerDescription([powerAbilities(known,unknown)]).complete,false);
  assert.equal(powerDescription([powerAbilities(known,unknown)]).text,'规则说明尚未完整。');
  assert.equal(programText(composePowerProgram({},known,unknown)),undefined);
  assert.equal(programText(composePowerProgram({},known)),'力量增加1。');
  const reused=composePowerProgram({},known);
  assert.equal(programText(reused),'力量增加1。');
  composePowerProgram(reused,known,unknown);
  assert.equal(programText(reused),undefined);
  assert.equal(describedAbility('不能用整段宏覆盖未知子项。',known,unknown).text,undefined);
  assert.equal(powerDescription([powerAbilities(known)],()=>{}).complete,false);
});

test('unknown child clears reused descriptions without losing known attack capabilities',()=>{
  assert.equal(programText,sharedProgramText);
  const known=describeProgram(attackProgram(rules.defineEffect<CardUse,void>(b=>b.return(undefined)),7,true),'固定攻击7。');
  const unknown=rules.defineEffect<CardUse,void>(b=>b.return(undefined));
  const reused=inheritPrograms(rules.defineEffect<CardUse,void>(b=>b.return(undefined)),known);
  assert.equal(programText(reused),'固定攻击7。');
  assert.equal(hasFixedAttack(reused),true);
  inheritPrograms(reused,known,unknown);
  assert.equal(sharedProgramText(reused),undefined);
  assert.equal(hasFixedAttack(reused),true);
});

test('uninstalled compatibility statuses do not assert unsupported rules',()=>{
  for(const key of ['DOUBLE_DAMAGE','FREE_ATTACK_POWER','DRAW_CARD_NEXT_TURN','ENERGIZED','OMEGA','BLOCK_RETURN','POISON'])assert.match(statusTexts[key]!,/未装配/);
});
