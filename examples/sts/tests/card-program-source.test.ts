import assert from 'node:assert/strict';
import test from 'node:test';
import {cards} from '../src/cards.ts';
import {rules} from '../src/rules/execution.ts';
import type {CardUse} from '../src/rules/card-instances.types.ts';
import {additiveAmount,cardAmount,composePrograms,targetAttack,concreteCard,cardBlock,cardPower} from '../src/content/cards/shared/programs.ts';
import {programMetadata,programText,describeAmount} from '../src/content/cards/shared/program-facts.ts';
import {cardTargets} from '../src/rules/card-targets.ts';
import {cardEffects} from '../src/rules/card-effects.ts';
import {battles} from '../src/rules/battles.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';

// Read the actual assembled entities, including selection cards, rather than
// maintaining a parallel catalog or global registration side effects.
const catalog=new Map(adventureContent.cards.exports.definitions.map(({id,definition})=>[id,rules.entityConfiguration(cardInstances.exports.kind,definition).metadata]));
const cardProgramMetadata=(id:string)=>catalog.get(id as keyof typeof cards);

const projections=rules.defineRules({requires:[cardTargets,cardEffects,battles,basicPowers],build(){
  const idle=rules.defineEffect<CardUse,void>(b=>b.return(undefined));
  const fixed=targetAttack([17,23],2);
  const dynamic=targetAttack(()=>{throw Error('Assembly must never evaluate an opaque callback');});
  const grown=additiveAmount([7,11],()=>4);
  return{exports:{
    fixed:programMetadata(cards.STRIKE_RED,composePrograms(idle,fixed,idle)),
    dynamic:programMetadata(cards.BODY_SLAM,dynamic),
    idle:programMetadata(cards.DEFEND_RED,idle),
    grown:programMetadata(cards.RAMPAGE,targetAttack(grown)),
    amount:grown,
    fixedText:programText(fixed),
    completePower:programText(cardPower(basicPowers.exports.programs.Strength,2)),
    incompletePower:programText(cardPower({...basicPowers.exports.programs.Strength,complete:false},2)),
    opaqueText:programText(dynamic),
    incompleteText:programText(composePrograms(fixed,idle)),
    orderedText:programText(composePrograms(cardBlock([3,5]),fixed)),
    describedDynamic:programText(targetAttack(describeAmount(()=>{throw Error('Described callbacks must not run at assembly');},'当前格挡'))),
    incompleteLifecycle:rules.entityConfiguration(cardInstances.exports.kind,concreteCard('STRIKE_RED',fixed,{endTurn:idle})).text,
  }};
}});

test('card composition derives damage without evaluating dynamic TS callbacks',()=>{
  assert.deepEqual(projections.exports.fixed.variants.map(v=>v.damage),[17,23]);
  assert.deepEqual(projections.exports.dynamic.variants.map(v=>v.damage),[0,0]);
  assert.deepEqual(projections.exports.idle.variants.map(v=>v.damage),[-1,-1]);
  assert.deepEqual(projections.exports.grown.variants.map(v=>v.damage),[7,11]);
  // This additive callback needs only the upgrade flag; the same base operand
  // contributes to execution and to the assembly projection.
  for(const upgraded of [false,true]){
    const view={input:{state:{upgraded}}} as rules.ReadView<CardUse>;
    assert.equal(cardAmount(projections.exports.amount,view),upgraded?15:11);
  }
});

const expected:Partial<Record<keyof typeof cards,readonly[number,number]>>={
  STRIKE_RED:[6,9],BASH:[8,10],POMMEL_STRIKE:[9,10],IRON_WAVE:[5,7],
  FLASH_OF_STEEL:[3,6],ANGER:[6,8],BITE:[7,8],BODY_SLAM:[0,0],
  BLOOD_FOR_BLOOD:[18,22],BLUDGEON:[32,42],CARNAGE:[20,28],CLASH:[14,18],
  CLEAVE:[8,11],CLOTHESLINE:[12,14],DRAMATIC_ENTRANCE:[8,12],HEAVY_BLADE:[14,14],
  HEMOKINESIS:[15,20],IMMOLATE:[21,28],MIND_BLAST:[0,0],PUMMEL:[2,2],
  RECKLESS_CHARGE:[7,10],SWIFT_STRIKE:[7,10],THUNDERCLAP:[4,7],TWIN_STRIKE:[5,7],
  UPPERCUT:[13,13],WILD_STRIKE:[12,17],HEADBUTT:[9,12],SEARING_BLOW:[12,16],
  SWORD_BOOMERANG:[3,3],REAPER:[4,5],DROPKICK:[5,8],FEED:[10,12],
  FIEND_FIRE:[7,10],HAND_OF_GREED:[20,25],PERFECTED_STRIKE:[6,6],RAMPAGE:[8,8],
  RITUAL_DAGGER:[0,0],SEVER_SOUL:[16,22],WHIRLWIND:[5,8],
  DEFEND_RED:[-1,-1],SENTINEL:[-1,-1],BARRICADE:[-1,-1],THINKING_AHEAD:[-1,-1],
  WOUND:[-1,-1],BURN:[-1,-1],VOID:[-1,-1],ASCENDERS_BANE:[-1,-1],REGRET:[-1,-1],
};
for(const [id,amounts] of Object.entries(expected)){
  test(`production card ${id} derives base damage from its use program`,()=>{
    const metadata=cardProgramMetadata(id);
    assert.ok(metadata,`${id} was not assembled`);
    assert.deepEqual(metadata.variants.map(v=>v.damage),amounts);
    const identity=cards[id as keyof typeof cards];
    for(const index of [0,1] as const){
      const {damage,...variant}=metadata.variants[index];
      assert.deepEqual(variant,identity.variants[index]);
      assert.equal('damage' in identity.variants[index],false);
    }
  });
}

test('card text follows executable operands, composition order and explicit completeness',()=>{
  assert.match(projections.exports.fixedText!,/17（23）/);
  assert.match(projections.exports.fixedText!,/2/);
  assert.equal(projections.exports.opaqueText,undefined);
  assert.equal(projections.exports.incompleteText,undefined);
  assert.equal(projections.exports.incompleteLifecycle,undefined);
  assert.equal(projections.exports.incompletePower,undefined);
  assert.ok(projections.exports.completePower?.includes(basicPowers.exports.programs.Strength.text));
  assert.match(projections.exports.describedDynamic!,/当前格挡/);
  const ordered=projections.exports.orderedText!;
  assert.ok(ordered.indexOf('3（5）')<ordered.indexOf('17（23）'));
});

test('every supported original card publishes text from its actual assembled configuration',()=>{
  const unsupported=new Set<string>(adventureContent.cards.exports.unsupportedIds);
  for(const {id,definition} of adventureContent.cards.exports.definitions){
    const configuration=rules.entityConfiguration(cardInstances.exports.kind,definition);
    assert.equal(typeof configuration.text,'string',`${id}: missing executable description`);
    assert.ok(configuration.text!.length>0,`${id}: empty executable description`);
    if(unsupported.has(id))assert.match(configuration.text!,/尚未实现/);
    else assert.doesNotMatch(configuration.text!,/尚未实现|undefined/);
  }
});

test('unimplemented catalog entries do not invent a zero-damage attack',()=>{
  assert.ok(adventureContent.cards.exports.unsupportedIds.includes('EXPUNGER'));
  for(const id of adventureContent.cards.exports.unsupportedIds){
    assert.deepEqual(cardProgramMetadata(id)?.variants.map(v=>v.damage),[-1,-1],id);
  }
});
