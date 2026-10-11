import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argumentsOf } from '../src/main.ts';
test('CLI parses explicit output, resume and invalid positional input', () => {
  assert.deepEqual(argumentsOf(['--resume', '--output', 'data']), {
    resume: true,
    output: 'data'
  });
  assert.throws(() => argumentsOf(['unexpected']));
});
test('command-specific options reject ignored flags and frozen-budget changes on resume', async () => {
  const {
    main
  } = await import('../src/main.ts');
  await assert.rejects(() => main(['serve', '--resume']), /Unknown option/);
  await assert.rejects(() => main(['experiment', '--resume', '--concurrency', '2']), /frozen registered budgets/);
});
