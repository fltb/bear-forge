import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {adventures} from '../src/rules/adventures.ts';
import {adventureViews} from '../src/adapters/adventure-views.ts';
import {potionId} from '../src/identifiers.ts';
import {potionRewardCapacityFixture,shopPotionCapacityFixture} from './adventure-case-fixture.ts';

// Independent expectation: discarding a held potion is always offered (the original game
// allows discarding at any time), taking a potion while the belt is full must never lose
// the reward or the gold, and the same claim/purchase succeeds after a slot is freed.
const isPotionReward=(bits:number)=>((bits>>>27)&7)===3;
const discardBit=(slot:number)=>((0xc0000000|slot)>>>0);
const BRONZE=potionId.LIQUID_BRONZE,SWIFT=potionId.SWIFT_POTION,ENERGY=potionId.ENERGY_POTION;
const held=(potions:number[])=>potions.filter(potion=>potion!==potionId.EMPTY_POTION_SLOT).length;

test('a full belt keeps the reward and never loses the potion; discarding first lets it be claimed',()=>{
  const definition=potionRewardCapacityFixture([],[BRONZE,SWIFT],[ENERGY]),program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130'},100_000_000)));
  let current:number[]=[];
  const collect=(initial:ReturnType<typeof machine.advance>)=>{let stop=initial;while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected a decision: '+JSON.stringify(stop).slice(0,400));current=stop.call.input.actions.map(action=>action.bits);return current;};
  const view=()=>{const ids=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined);assert.equal(ids.length,1);return inspectRuleQuery(definition,machine.root.state,adventureViews.exports.privateGame,ids[0]!);};
  const act=(bits:number)=>{assert.ok(current.includes(bits),'action must be legal: '+bits);return collect(machine.advance({bits}));};
  const claim=collect(machine.advance()).find(isPotionReward);
  assert.notEqual(claim,undefined,'the potion reward stays visible while the belt is full');
  const before=view();
  act(claim!);
  const still=view();
  assert.deepEqual(still.potions,before.potions,'claiming with a full belt must not change the inventory');
  assert.deepEqual(still.rewards!.potions,before.rewards!.potions,'claiming with a full belt must not consume the reward');
  assert.ok(current.includes(discardBit(0)),'discarding a held potion stays legal on the reward screen');
  act(discardBit(0));
  assert.equal(held(view().potions),1);
  act(current.find(isPotionReward)!);
  const claimed=view();
  assert.equal(held(claimed.potions),2,'the freed slot takes the potion');
  assert.deepEqual(claimed.rewards!.potions,[],'the claim succeeds once there is room');
});

test('a full belt keeps shop stock and gold; buying works after discarding a potion',()=>{
  const definition=shopPotionCapacityFixture([],[BRONZE,SWIFT]),program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130'},100_000_000)));
  let current:number[]=[];
  const collect=(initial:ReturnType<typeof machine.advance>)=>{let stop=initial;while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected a decision: '+JSON.stringify(stop).slice(0,400));current=stop.call.input.actions.map(action=>action.bits);return current;};
  const view=()=>{const ids=inspectRuleQuery(definition,machine.root.state,adventures.exports.instances,undefined);assert.equal(ids.length,1);return inspectRuleQuery(definition,machine.root.state,adventureViews.exports.privateGame,ids[0]!);};
  const act=(bits:number)=>{assert.ok(current.includes(bits),'action must be legal: '+bits);return collect(machine.advance({bits}));};
  const buy=collect(machine.advance()).find(isPotionReward);
  assert.notEqual(buy,undefined,'the shop keeps offering potions while the belt is full');
  const before=view();
  act(buy!);
  const still=view();
  assert.equal(still.gold,before.gold,'a failed potion purchase must not charge gold');
  assert.deepEqual(still.shop!.potions,before.shop!.potions,'a failed potion purchase must not consume stock');
  const options=current;
  const discard=options.find(bits=>bits===discardBit(0)||bits===discardBit(1));
  assert.notEqual(discard,undefined,'discarding a held potion stays legal in the shop');
  act(discard!);
  act(current.find(isPotionReward)!);
  const bought=view();
  assert.equal(held(bought.potions),2);
  assert.ok(bought.gold<before.gold,'the purchase charges gold only after the potion is obtained');
});
