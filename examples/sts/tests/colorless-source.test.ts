import assert from 'node:assert/strict';
import test from 'node:test';
import {rules} from '../src/rules/execution.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {cards} from '../src/cards.ts';
import {cardRuleText} from '../src/content/cards/shared/programs.ts';
import {programText} from '../src/content/cards/shared/program-facts.ts';
import {colorlessAdditionalPowers} from '../src/content/cards/colorless/power-effects.ts';
import {discoveryDescription} from '../src/content/cards/shared/selection-utils.ts';

const configurations=new Map(adventureContent.cards.exports.definitions.map(({id,definition})=>[id,rules.entityConfiguration(cardInstances.exports.kind,definition)]));
const ids=[
  'PURITY','FORETHOUGHT','SECRET_TECHNIQUE','SECRET_WEAPON','THINKING_AHEAD',
  'DEEP_BREATH','DISCOVERY','JACK_OF_ALL_TRADES','CHRYSALIS','METAMORPHOSIS','TRANSMUTATION','VIOLENCE',
  'DARK_SHACKLES','APOTHEOSIS','APPARITION','BANDAGE_UP','BLIND','ENLIGHTENMENT','GOOD_INSTINCTS','IMPATIENCE','JAX','MADNESS','MASTER_OF_STRATEGY','PANACEA','PANIC_BUTTON','TRIP',
  'THE_BOMB','PANACHE','MAYHEM','MAGNETISM','SADISTIC_NATURE',
] as const;
const text=(id:typeof ids[number])=>{const config=configurations.get(id);assert.ok(config,id);assert.ok(config.text,id);return config.text;};

for(const id of ids)test(`colorless ${id} derives complete text from its actual use composition`,()=>{
  const config=configurations.get(id);assert.ok(config,id);
  assert.ok(programText(config.use),`${id}: use effect must own its description`);
  assert.equal(config.text,cardRuleText(cards[id],config.use));
  assert.doesNotMatch(config.text!,/undefined|NaN/);
  assert.deepEqual(config.metadata.variants.map(variant=>variant.damage),[-1,-1]);
});

test('colorless descriptions retain actual upgrade operands, choice constraints and ordering',()=>{
  assert.match(text('PURITY'),/0至3（5）张手牌消耗/);
  assert.match(text('FORETHOUGHT'),/选择1张手牌.*抽牌堆底.*基础费用为正.*下次打出免费/);
  assert.match(text('THINKING_AHEAD'),/抽2张牌.*手牌.*1张牌.*抽牌堆顶/);
  assert.match(text('SECRET_TECHNIQUE'),/抽牌堆.*1张技能牌.*手牌/);
  assert.match(text('SECRET_WEAPON'),/抽牌堆.*1张攻击牌.*手牌/);
  assert.match(text('BANDAGE_UP'),/回复4（6）生命/);
  assert.match(text('JAX'),/失去3生命.*2（3）层/);
  assert.match(text('BLIND'),/未升级：.*对目标.*2层.*升级后：.*所有敌人.*2层/);
  assert.match(text('TRIP'),/未升级：.*对目标.*2层.*升级后：.*所有敌人.*2层/);
  assert.match(text('IMPATIENCE'),/手牌中没有攻击牌.*2（3）张/);
  assert.match(text('ENLIGHTENMENT'),/本回合费用大于1.*升级后.*基础费用大于1.*本场战斗/);
  assert.match(text('MADNESS'),/本回合费用大于0.*若没有.*基础费用大于0.*本场战斗及本回合费用设为0/);
});

test('generation text describes the executing discovery owner and source-specific short-deck behavior',()=>{
  assert.ok(text('DISCOVERY').includes(discoveryDescription(3)));
  assert.match(text('DEEP_BREATH'),/弃牌堆非空.*再次洗牌.*抽1（2）张/);
  assert.match(text('JACK_OF_ALL_TRADES'),/1（2）张随机无色牌/);
  assert.match(text('CHRYSALIS'),/3（5）张随机技能牌.*本场战斗/);
  assert.match(text('METAMORPHOSIS'),/3（5）张随机攻击牌.*本场战斗/);
  assert.match(text('VIOLENCE'),/3（4）.*复制所选牌.*不移除原牌/);
  assert.match(text('TRANSMUTATION'),/X费用修正.*升级后生成升级牌.*次数为0时无操作/);
});

test('colorless power cards include the attached power descriptions, including unsupported Magnetism effect',()=>{
  for(const [id,key] of [['THE_BOMB','TheBomb'],['PANACHE','Panache'],['MAYHEM','Mayhem'],['MAGNETISM','Magnetism'],['SADISTIC_NATURE','SadisticNature']] as const){
    assert.ok(text(id).includes(colorlessAdditionalPowers.exports.programs[key].text),id);
  }
  assert.match(text('MAGNETISM'),/未装配实际效果/);
  assert.doesNotMatch(text('MAGNETISM'),/生成.*随机/);
});
