import assert from 'node:assert/strict';
import test from 'node:test';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {typedValue} from '../src/rules/value.schemas.ts';
import {powers} from '../src/rules/powers.ts';
import {battles} from '../src/rules/battles.ts';
import {enemyOperations} from '../src/content/enemies/shared/operations.ts';
import {enemyPowerAbilities,contribution,defineDescribedEnemyPower} from '../src/content/enemies/shared/abilities.ts';
import {counterPolicies} from '../src/content/powers/utils.ts';
import {programText} from '../src/content/cards/shared/program-facts.ts';
import {afterCardUse,firstEnemyCardUse,queuedRetaliation,cardBattle,owner,cardUser,level,addCounter,sequencePrograms,whenProgram,projectChildren,resetCounterFrom,rememberAppliedAmount,attachAfter} from '../src/content/enemies/shared/status-programs.ts';
import {cityPowers} from '../src/content/enemies/city/powers.ts';
import {beyondPowers} from '../src/content/enemies/beyond/powers.ts';
import {finalPowers} from '../src/content/enemies/ending/powers.ts';
import type {CardUse} from '../src/rules/card-instances.types.ts';
import type {PowerLifecycle,PowerMerged} from '../src/rules/powers.types.ts';

type Use=rules.ReactionContext<CardUse>;
const fixture=rules.defineRules({requires:[powers,battles,enemyOperations],build(){
  const opaque=rules.defineEffect<Use,void>(b=>b.return(undefined));
  const opaqueCondition=rules.defineQuery({input:typedValue<Use>(),output:z.boolean(),base:()=>{throw Error('Do not evaluate opaque callbacks to describe them');}});
  const known=addCounter<CardUse>(3);
  const condition=firstEnemyCardUse(true);
  const missingEffect=afterCardUse({condition,effect:opaque});
  const missingCondition=afterCardUse({condition:opaqueCondition,effect:known});
  const missingTarget=queuedRetaliation({battle:cardBattle(),source:owner<CardUse>(),target:()=>{throw Error('Do not evaluate opaque target');},amount:level<CardUse>()},{attack:false,selfDamage:false});
  const missingAmount=queuedRetaliation({battle:cardBattle(),source:owner<CardUse>(),target:cardUser(),amount:()=>{throw Error('Do not evaluate opaque amount');}},{attack:false,selfDamage:false});
  const front=queuedRetaliation({battle:cardBattle(),source:owner<CardUse>(),target:cardUser(),amount:level<CardUse>()},{position:'front',attack:false,selfDamage:false});
  const back=queuedRetaliation({battle:cardBattle(),source:owner<CardUse>(),target:cardUser(),amount:level<CardUse>()},{position:'back',attack:false,selfDamage:false});
  const ability=afterCardUse({condition,effect:known});
  const opaqueSlot=rules.defineComponent({schema:z.int32(),initial:()=>0});
  const missingState=programText(resetCounterFrom<CardUse>(opaqueSlot));
  const missingInitializer=programText(attachAfter(rememberAppliedAmount(opaqueSlot)));
  const stale=programText(projectChildren(addCounter<CardUse>(9),[opaque],()=>{throw Error('Incomplete composition must not render');}));
  const incompleteLifecycle=defineDescribedEnemyPower('test',counterPolicies({bits:16}),{attach:abilities=>rules.defineEffect<PowerLifecycle,void>(b=>rules.call(abilities,b.input))},enemyPowerAbilities(contribution(ability)));
  const incompleteMerged=defineDescribedEnemyPower('test',{...counterPolicies({bits:16}),merged:rules.defineEffect<PowerMerged,void>(b=>b.return(undefined))},{},enemyPowerAbilities(contribution(ability)));
  return{exports:{missingState,missingInitializer,stale,missingEffect:programText(missingEffect),missingCondition:programText(missingCondition),missingTarget:programText(missingTarget),missingAmount:programText(missingAmount),front:programText(front),back:programText(back),sequence:programText(sequencePrograms(known,opaque)),branch:programText(whenProgram<Use>(()=>{throw Error('Do not evaluate opaque branch');},known)),incompleteLifecycle,incompleteMerged,complete:programText(ability)}};
}});

test('enemy description composition refuses unknown trigger/action/target/amount children',()=>{
  for(const text of [fixture.exports.missingEffect,fixture.exports.missingCondition,fixture.exports.missingTarget,fixture.exports.missingAmount,fixture.exports.sequence,fixture.exports.branch,fixture.exports.missingState,fixture.exports.missingInitializer,fixture.exports.stale])assert.equal(text,undefined);
  assert.match(fixture.exports.complete!,/首位敌人/);
  assert.match(fixture.exports.complete!,/增加3/);
});
test('queue placement comes from the actual enqueue operand',()=>{
  assert.match(fixture.exports.front!,/队首/);
  assert.match(fixture.exports.back!,/队尾/);
});
test('custom lifecycle callbacks cannot inherit a complete ability description',()=>{
  for(const program of [fixture.exports.incompleteLifecycle,fixture.exports.incompleteMerged]){
    assert.equal(program.complete,false);
    assert.equal(program.text,'规则说明尚未完整。');
  }
});
test('actual enemy owners project first-owner conditions, shuffle, and front queue',()=>{
  assert.match(finalPowers.exports.statusTexts.BEAT_OF_DEATH,/首位敌人/);
  assert.match(beyondPowers.exports.statusTexts.SLOW,/首位敌人/);
  assert.match(beyondPowers.exports.statusTexts.THORNS,/队首/);
  assert.match(cityPowers.exports.statusTexts.HEX,/随机洗入.*抽牌堆/);
});
