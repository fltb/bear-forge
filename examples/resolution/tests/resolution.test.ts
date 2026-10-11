import { test } from 'node:test';
import assert from 'node:assert/strict';
import { program } from '../src/program.ts';
import type { Setup } from '../src/program.ts';
async function run(variant: Setup['variant'] = 'normal', choices: Record<string, any> = {}) {
  const seen: any[] = [];
  const result = await program.run({
    variant
  }, {
    async call({
      input
    }) {
      seen.push(structuredClone(input));
      const kind = input.kind;
      if (choices[kind]) return choices[kind];
      if (kind.includes('response')) return {
        kind: 'pass',
        value: null
      };
      if (kind === 'wave-0-target') return {
        kind: 'target',
        value: variant === 'return-wolf' ? 'L2' : 'L'
      };
      if (kind === 'wave-0-prevent') return {
        kind: 'prevent',
        value: null
      };
      if (kind === 'wave-1-target') return {
        kind: 'target',
        value: 'G'
      };
      if (kind === 'wave-1-prevent') return {
        kind: 'prevent',
        value: 'U'
      };
      if (kind === 'take') return {
        kind: 'take',
        value: 'B'
      };
      return {
        kind: 'beneficiary',
        value: '0'
      };
    }
  });
  return {
    result,
    seen
  };
}
test('main path and K2–K6 represent distinct unfinished flow and exact final state', async () => {
  const {
    result,
    seen
  } = await run();
  assert.deepEqual(result.hp, [11, 10]);
  assert.deepEqual(result.hands, [['B'], []]);
  assert.deepEqual(result.deck, ['M', 'N', 'P', 'S']);
  assert.equal(result.board.find(u => u.id === 'G')!.hp, 3);
  assert.deepEqual(result.triggers, [{
    id: 'T1',
    source: 'W',
    owner: '0'
  }]);
  for (const kind of ['wave-0-prevent', 'wave-1-target', 'wave-1-prevent', 'take', 'beneficiary']) assert.ok(seen.some(s => s.kind === kind));
});
test('cases 1,2,5,13: prevention, dead trigger source, private reward and beneficiary branches', async () => {
  const a = await run('normal', {
    'wave-1-prevent': {
      kind: 'prevent',
      value: null
    }
  });
  assert.equal(a.result.damage, 4);
  assert.equal(a.result.board.find(u => u.id === 'G')!.hp, 1);
  const b = await run('normal', {
    'wave-1-target': {
      kind: 'target',
      value: 'W'
    }
  });
  assert.ok(!b.result.board.some(u => u.id === 'W'));
  assert.equal(b.result.hp[0], 11);
  const c = await run('normal', {
    take: {
      kind: 'take',
      value: 'P'
    },
    beneficiary: {
      kind: 'beneficiary',
      value: '1'
    }
  });
  assert.deepEqual(c.result.deck, ['M', 'N', 'B', 'S']);
  assert.deepEqual(c.result.hp, [10, 11]);
});
test('cases 10,11,12,14,15: response objects, flow distinction, fault, counter and skipped tail', async () => {
  const a = await run('return-wolf', {
    'spell-response': {
      kind: 'return',
      value: 'L'
    }
  });
  assert.ok(a.seen.some(s => s.options.some((o: any) => o.value === 'L2')));
  const empty = await run('empty-first', {
    'wave-1-target': {
      kind: 'target',
      value: 'L'
    },
    'wave-1-prevent': {
      kind: 'prevent',
      value: null
    }
  });
  assert.equal(empty.result.damage, 2);
  assert.ok(!empty.seen.some(s => s.kind === 'wave-0-target'));
  await assert.rejects(() => run('fail-discard'), /mid-resolution/);
  const counter = await run('counter', {
    'spell-response': {
      kind: 'counter',
      value: null
    }
  });
  assert.equal(counter.result.mana, 0);
  assert.equal(counter.result.damage, 0);
  assert.ok(!counter.seen.some(s => s.kind.startsWith('wave') || s.kind === 'take'));
  const skipped = await run('double-prevent', {
    'wave-0-target': {
      kind: 'target',
      value: 'G'
    },
    'wave-0-prevent': {
      kind: 'prevent',
      value: 'U1'
    },
    'wave-1-prevent': {
      kind: 'prevent',
      value: 'U2'
    }
  });
  assert.equal(skipped.result.damage, 0);
  assert.deepEqual(skipped.result.deck, ['P', 'B', 'S', 'M', 'N']);
  assert.ok(!skipped.seen.some(s => s.kind === 'take'));
});
