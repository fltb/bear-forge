import {test} from 'node:test';
import assert from 'node:assert/strict';
import {test262Cases, verifyTest262Checkout} from '../test262-cases.ts';
import {runTest262ProductionParse} from '../test262-production-parse.ts';

test('pinned Test262 module parse-negative cases pass the production compiler early-error gate', async t => {
  const root = process.env.TEST262_ROOT;
  assert.ok(root, 'Set TEST262_ROOT to a complete clean checkout of the pinned Test262 revision');
  await verifyTest262Checkout(root);
  let selected = 0;
  const failures = [];
  for await (const candidate of test262Cases(root)) {
    if (candidate.mode !== 'module' || candidate.negative?.phase !== 'parse') continue;
    selected++;
    const result = runTest262ProductionParse(candidate);
    if (result.status !== 'passed') failures.push(result);
  }
  assert.ok(selected > 0, 'No applicable module parse-negative inputs were selected');
  t.diagnostic(JSON.stringify({backend:'production-module-parse',selected,passed:selected-failures.length,unpassed:failures.length}));
  assert.deepEqual(failures, []);
});
