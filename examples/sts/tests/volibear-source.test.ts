import test from 'node:test';
import assert from 'node:assert/strict';
import {rules} from '../src/rules/execution.ts';
import {powers} from '../src/rules/powers.ts';
import {programText} from '../src/content/cards/shared/program-facts.ts';
import {volibearEngagePowers} from '../src/content/characters/volibear/powers/engage.ts';
import {volibearLightningPowers} from '../src/content/characters/volibear/powers/lightning.ts';
import {volibearStormPowers} from '../src/content/characters/volibear/powers/storm.ts';
import {volibearBattleBody} from '../src/content/characters/volibear/powers/battle-body.ts';
import {volibearConduction} from '../src/content/characters/volibear/powers/conduction.ts';
import {volibearFury} from '../src/content/characters/volibear/powers/fury.ts';
import {volibearHunt} from '../src/content/characters/volibear/powers/hunt.ts';
import {volibearImmovable} from '../src/content/characters/volibear/powers/immovable.ts';
import {volibearInscription} from '../src/content/characters/volibear/powers/inscription.ts';
import {volibearPrey} from '../src/content/characters/volibear/powers/prey.ts';
import {volibearStanding} from '../src/content/characters/volibear/powers/standing.ts';
import {volibearStormSelf} from '../src/content/characters/volibear/powers/storm-self.ts';
import {volibearPreparation} from '../src/content/characters/volibear/mechanics/preparation.ts';
import {volibearThunderGuard} from '../src/content/characters/volibear/mechanics/thunder-guard.ts';
import {volibearStrength} from '../src/content/characters/volibear/mechanics/strength.ts';
import {volibearRepeat} from '../src/content/characters/volibear/mechanics/repeat.ts';
import {volibearEngagePreparation} from '../src/content/characters/volibear/mechanics/engage-preparation.ts';
import {volibearNextPlayDiscount} from '../src/content/characters/volibear/mechanics/next-play-discount.ts';
import {volibearDomain} from '../src/content/characters/volibear/mechanics/domain.ts';
import {stormCharge} from '../src/content/characters/volibear/mechanics/storm-charge.ts';
import {lightning} from '../src/content/characters/volibear/mechanics/lightning.ts';
import {productionDriver} from './production-driver.ts';

const modules=[volibearEngagePowers,volibearLightningPowers,volibearStormPowers,volibearBattleBody,volibearConduction,volibearFury,volibearHunt,volibearImmovable,volibearInscription,volibearPrey,volibearStanding,volibearStormSelf];

test('every Volibear power definition and public display project its actual attached composition',()=>{
  let count=0;
  for(const module of modules){
    for(const [key,program] of Object.entries(module.exports.programs)){
      count++;
      const config=rules.entityConfiguration(powers.exports.kind,program.definition);
      assert.deepEqual(config.display,{name:program.name,text:program.text},key);
      assert.equal((module.exports as unknown as Record<string,unknown>)[key],program.definition,key);
      assert.equal((module.exports.statusTexts as Record<string,string>)[key],program.text,key);
      assert.ok(config.attach,key);
      assert.ok(program.text.length>0,key);
      assert.equal(program.complete,true,`${key} has an undescribed executing child`);
      assert.ok(Object.isFrozen(program),key);
      // Applying a power must not display the card's separate immediate effect.
      assert.doesNotMatch(program.text,/打出时/);
    }
  }
  assert.equal(count,20);
});

test('mechanic effect descriptions are projections attached to the executing definitions',()=>{
  for(const [effect,text] of [
    [volibearPreparation.exports.prepare,volibearPreparation.exports.text],
    [volibearThunderGuard.exports.apply,volibearThunderGuard.exports.text],
    [volibearStrength.exports.charge,volibearStrength.exports.chargeText],
    [volibearStrength.exports.reclaim,volibearStrength.exports.reclaimText],
    [volibearRepeat.exports.prepare,volibearRepeat.exports.text],
    [volibearEngagePreparation.exports.prepare,volibearEngagePreparation.exports.text],
  ] as const)assert.equal(programText(effect),text);
  assert.match(volibearPreparation.exports.text,/2能量.*2（3）/);
  assert.match(volibearThunderGuard.exports.text,/3（5）.*完全格挡.*不随领域延长/);
  assert.match(lightning.exports.chargeText,/消耗1蓄雷.*增加3.*群体只消费一次/);
  assert.match(volibearFury.exports.programs.GrowingFury.text,/第2张/);
  assert.ok(volibearPrey.exports.programs.PreyStillStands.text.includes(volibearNextPlayDiscount.exports.text));
  assert.match(volibearConduction.exports.programs.StormConduction.text,/含过量伤害/);
  assert.match(volibearStormPowers.exports.programs.UnendingStorm.text,/与本次消耗数量无关/);
  assert.equal(volibearDomain.exports.describe(null),'领域持续本场战斗。');
  assert.equal(volibearDomain.exports.describe('2（4）'),'展开领域2（4）轮。');
});

test('production observation uses execution-owned charge text across independent contexts',()=>{
  // Effect descriptions are published only when detailed observations are enabled.
  const left=productionDriver('130','volibear',true),right=productionDriver('130','volibear',true);
  try{
    let frame=left.frame();
    for(let i=0;i<120&&!frame.battle;i++)frame=left.advance(frame.actions[0]!.bits);
    assert.ok(frame.battle,'production battle reached');
    const charge=frame.battle.effects?.find(effect=>effect.name==='蓄雷');
    assert.ok(charge);
    assert.equal(charge.text,stormCharge.exports.text+lightning.exports.chargeText);
    assert.equal(charge.level,1);
    // The other Context must still be at its original decision, not in this battle.
    assert.ok(!right.frame().battle);
  }finally{left.close();right.close();}
});
