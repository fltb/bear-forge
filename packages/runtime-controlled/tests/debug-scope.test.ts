import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

test('debug scopes flatten lazily while preserving inherited names, shadows and shared identity', () => {
  const effects = require('../dist/effects.cjs')();
  const parent: any[] = [[['outer', [0, 'outer-loc']], ['shadow', [0, 'parent-loc']]], null, 0];
  const child: any[] = [[['inner', [1, 'inner-loc']], ['shadow', [1, 'child-loc']]], parent, 1];
  effects.module('debug-scope-test', {base: [0, 0, 'base-loc']}, {id: 'debug-scope-test', exports: {}}, () => {}, '$', {}, [], '');
  let meta: any;
  effects.fun('f', 'f', null, null, [], 0, 1, '1:0-1:1', 0, () => {}, null, null, 1,
    [[0, '1:0-1:1', child], [0, '1:0-1:1', child]],
    (...args: any[]) => {meta = args[4]; return () => {};}, [0, 1]);
  assert.equal(parent.length, 3, 'registration does not flatten ancestor metadata');
  assert.equal(child.length, 3, 'registration does not flatten child metadata');
  const view = meta.states[0].scope;
  assert.equal(Object.getPrototypeOf(view), null);
  assert.deepEqual(Object.keys(view), ['base', 'outer', 'shadow', 'inner']);
  assert.deepEqual({...view}, {base: [0, 0, 'base-loc'], outer: [0, 0, 'outer-loc'], shadow: [1, 1, 'child-loc'], inner: [1, 1, 'inner-loc']});
  assert.equal(parent.length, 4); assert.equal(child.length, 4);
  assert.strictEqual(meta.states[0].scope, view);
  assert.strictEqual(meta.states[1].scope, view);
});
