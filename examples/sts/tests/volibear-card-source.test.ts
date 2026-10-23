import assert from 'node:assert/strict';
import test from 'node:test';
import {rules} from '../src/rules/execution.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import type {CardUse} from '../src/rules/card-instances.types.ts';
import {volibearContent} from '../src/program/volibear-content.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {cardConfig,attack,block,compose,queued,volibearCardPrograms} from '../src/content/characters/volibear/cards/programs.ts';
import {cardRuleText} from '../src/content/cards/shared/programs.ts';
import {conditional,ordered} from '../src/content/characters/volibear/cards/operations.ts';
import {programText,hasFixedAttack,describeAmount,describeProgram} from '../src/content/cards/shared/program-facts.ts';

const catalog=new Map(volibearContent.cards.exports.definitions.map(({id,definition})=>[String(id),rules.entityConfiguration(cardInstances.exports.kind,definition)]));
const get=(code:keyof typeof volibearCardDescriptions)=>{
  const config=catalog.get(volibearCardDescriptions[code].id);
  assert.ok(config,code);
  return config;
};

for(const [code,identity] of Object.entries(volibearCardDescriptions)){
  test(`Volibear ${code} projects its complete rule text from actual use and lifecycle`,()=>{
    const config=get(code as keyof typeof volibearCardDescriptions);
    assert.equal('text' in identity,false);
    for(const variant of identity.metadata.variants)assert.equal('damage' in variant,false);
    assert.ok(config.use);
    assert.ok(programText(config.use),`${code} has an undescribed executing composition`);
    const parts=[config.created,config.canUse,config.returned,config.removed].filter((part):part is NonNullable<typeof part>=>part!==undefined);
    assert.equal(config.text,cardRuleText(identity.metadata,config.use,...parts));
    assert.equal(typeof config.text,'string');
    assert.doesNotMatch(config.text!,/undefined|NaN/);
    for(const index of [0,1] as const){
      const {damage,...variant}=config.metadata.variants[index];
      assert.deepEqual(variant,identity.metadata.variants[index]);
    }
  });
}

test('fixed attack capability follows executing atoms, including wrapped and repeated attacks',()=>{
  for(const code of ['C06','U20','U08','U24','U31','R20'] as const)assert.equal(hasFixedAttack(get(code).use!),true,code);
  for(const code of ['U05','R07','R21','B02'] as const)assert.equal(hasFixedAttack(get(code).use!),false,code);
  assert.deepEqual(get('U05').metadata.variants.map(v=>v.damage),[0,0]);
  assert.deepEqual(get('U08').metadata.variants.map(v=>v.damage),[8,10]);
  assert.deepEqual(get('R20').metadata.variants.map(v=>v.damage),[4,5]);
});

test('Wing Statue consumes actual base damage metadata, not type, growth or composite totals',()=>{
  // These are the public damage values consumed by the production event's >=10
  // predicate, not a second fixed-attack classification maintained by cards.
  for(const [code,expected] of [['U05',[false,false]],['U07',[true,true]],['U08',[false,true]],['C02',[false,false]],['R20',[false,false]]] as const){
    assert.deepEqual(get(code).metadata.variants.map(v=>v.damage>=10),expected,code);
  }
});

const probes=rules.defineRules({requires:[volibearCardPrograms],build(){
  const opaque=attack(()=>{throw Error('Opaque callback evaluated during assembly');},1,false,false);
  const described=attack(describeAmount((_:rules.ReadView<CardUse>)=>{throw Error('Described callback evaluated during assembly');},'任意作者表达式'),1,false,false);
  const use=compose(block([31,37]),queued(attack([41,43],3)));
  const predicate=describeProgram((_:rules.ReadView<CardUse>)=>{throw Error('Predicate evaluated during assembly');},'作者条件，');
  const unknown=rules.defineEffect<CardUse,void>(b=>b.return(undefined));
  const branch=conditional(predicate,attack(13),block(7),block(2));
  return {exports:{opaque:cardConfig(volibearCardDescriptions.B01,opaque),described:cardConfig(volibearCardDescriptions.B01,described),ordered:cardConfig(volibearCardDescriptions.B01,use),branch,missingBranch:conditional(predicate,attack(13),unknown),missingPredicate:conditional(()=>true,attack(13)),missingOrdered:ordered(attack(13),unknown)}};
}});

test('Volibear constructors preserve arbitrary callbacks and derive numbers and ordering',()=>{
  assert.equal(probes.exports.opaque.text,undefined);
  assert.match(probes.exports.described.text!,/任意作者表达式/);
  const text=probes.exports.ordered.text!;
  assert.ok(text.indexOf('31（37）')<text.indexOf('41（43）'));
  assert.match(text,/重复3次/);
  assert.deepEqual(probes.exports.ordered.metadata.variants.map(v=>v.damage),[41,43]);
});

test('actual conditional branches fail closed on every undescribed child',()=>{
  assert.match(programText(probes.exports.branch)!,/效果开始时判断条件.*若作者条件.*13.*否则.*7/);
  for(const effect of [probes.exports.missingBranch,probes.exports.missingPredicate,probes.exports.missingOrdered]){
    assert.equal(programText(effect),undefined);
    assert.equal(hasFixedAttack(effect),true);
  }
});

test('conditional, selection and charge cards retain their executing distinctions',()=>{
  assert.match(get('C06').text!,/效果开始时.*否则/);
  assert.match(get('U36').text!,/消耗2蓄雷.*2（3）能量.*至少2蓄雷/);
  assert.match(get('R17').text!,/消耗量×3（4）.*不额外释放蓄雷/);
  assert.match(get('U24').text!,/非半死.*每次实际打出至多/);
  assert.match(get('R11').text!,/翻倍.*6（10）/);
  assert.match(get('C14').text!,/未升级消耗/);
  assert.match(get('R01').text!,/升级后固有/);
});
