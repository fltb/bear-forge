import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, beats, plays, key } from '../src/patterns.ts';
import { oracle } from './oracle.ts';

const cases: [number[], string][] = [
  [[3],'single'], [[15,15],'pair'], [[7,7,7],'triple'], [[3,3,3,4],'tripleSingle'], [[9,9,9,3,3],'triplePair'],
  [[3,4,5,6,7],'straight'], [[3,3,4,4,5,5],'pairs'], [[3,3,3,4,4,4],'airplane'],
  [[3,3,3,4,4,4,5,5],'airplaneSingle'], [[3,3,3,4,4,4,6,6,9,9],'airplanePair'],
  [[5,5,5,5,3,9],'fourSingles'], [[5,5,5,5,3,3],'fourSingles'], [[9,9,9,9,6,6,8,8],'fourPairs'], [[15,15,15,15],'bomb'], [[16,17],'rocket'],
];
for (const [cards, kind] of cases) test(`rulebook family ${kind}: ${cards.join(',')}`, () => assert.ok(classify(cards).some(p => p.kind === kind)));
test('illegal rank sequences, wings, double jokers and attached bomb are rejected', () => {
  for (const cards of [[11,12,13,14,15],[3,4,5,6],[3,3,4,4],[3,3,3,3,4],[3,3,3,4,4,4,16,17],[5,5,5,5,16,17],[5,5,5,5,8,8,8,8],[3,3,3,4,4,4,5,5,5,6,6,6,9,9,9,9]]) assert.deepEqual(classify(cards), [], cards.join(','));
});
test('comparison requires same family/length; bombs and rocket override', () => {
  const p = (cards: number[]) => classify(cards)[0]!;
  assert.equal(beats(p([4]),p([3])),true);
  assert.equal(beats(p([4,4]),p([3])),false);
  assert.equal(beats(p([4,5,6,7,8,9]),p([3,4,5,6,7])),false);
  assert.equal(beats(p([3,3,3,3]),p([15])),true);
  assert.equal(beats(p([16,17]),p([15,15,15,15])),true);
  assert.equal(beats(p([15,15,15,15]),p([16,17])),false);
  assert.equal(beats(p([3,3,3,4]),p([3,3,3,17])),false);
});
const hands = [
  [3,3,3,4,4,4,5,5], [4,4,4,4,5,5,6,6], [3,3,3,4,4,4,5,5,5,7,7,7],
  [3,4,5,6,7,8,9,10,11,12,13,14], [3,3,4,4,5,5,6,6,7,7,8,8],
  [3,3,3,4,4,4,6,6,9,9,16,17], [12,12,12,13,13,13,14,14,14,15,16,17],
  [3,3,3,3,4,4,4,4,16,17], [3,3,3,4,4,4,5,5,5,6,6,6],
];
for (const [index, hand] of hands.entries()) test(`complete legal-action set vs independent subset oracle ${index}`, () => {
  const expected = new Set<string>();
  // Physical subsets, deduplicated to rank-multiset actions. Oracle does not import production recognizer.
  for (let mask = 1; mask < 2 ** hand.length; mask++) {
    const cards = hand.filter((_, bit) => mask & 2 ** bit).sort((a,b) => a-b);
    for (const p of oracle(cards)) expected.add(`${cards.join(',')}|${key(p)}`);
  }
  const actual = new Set(plays(hand,null).map(p => `${p.cards.join(',')}|${key(p.pattern)}`));
  assert.deepEqual([...actual].sort(), [...expected].sort());
  for (const target of [{ kind: 'single' as const, high: 8, length: 1 }, { kind: 'bomb' as const, high: 4, length: 1 }]) {
    const subset = plays(hand,null).filter(p => beats(p.pattern,target));
    assert.deepEqual(plays(hand,target),subset);
  }
});
test('twos are not consecutive with ace when used as non-pair wings',()=>{
  assert.ok(classify([12,12,12,13,13,13,14,14,14,15,15,15]).some(p=>p.kind==='airplaneSingle'&&p.high===14));
});

// Exact input lists use one encoding per rank multiset; classifiers still accept
// arbitrary multiset order for internal card analysis.
import { ActionSchema } from '../src/schemas.ts';
test('canonical play encoding preserves every rulebook family and rejects permutation duplicates',()=>{
  for(const [cards] of cases){
    const sorted=[...cards].sort((a,b)=>a-b);
    for(const pattern of classify(cards)){
      const canonical={kind:'play',cards:sorted,pattern};
      assert.ok(ActionSchema.safeParse(canonical).success);
      assert.ok(plays(sorted,null).some(play=>JSON.stringify(play)===JSON.stringify(canonical)));
      const descending=[...sorted].reverse();
      if(descending.some((n,i)=>n!==sorted[i]))assert.equal(ActionSchema.safeParse({...canonical,cards:descending}).success,false);
      assert.deepEqual(classify(descending),classify(sorted));
    }
  }
});
