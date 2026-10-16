import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowWeakCollections} from '../src/cow-weak.ts';
import {createRequire} from 'node:module';
import {createOperations} from '@bear-forge/runtime';
const require = createRequire(import.meta.url);

test('weak collection versions isolate updates and deletion without storing strong keys in roots', () => {
  const parent = new CowWeakCollections(), table = {}, key = {}, symbol = Symbol('weak');
  parent.create(table); parent.set(table, key, {key}); parent.set(table, symbol, undefined);
  const child = parent.fork(); child.set(table, key, 'child'); child.delete(table, symbol);
  assert.strictEqual((parent.get(table, key) as any).key, key);
  assert.equal(child.get(table, key), 'child'); assert.equal(parent.has(table, symbol), true);
  assert.equal(child.has(table, symbol), false);
  parent.delete(table, key); assert.equal(child.get(table, key), 'child');
  assert.equal(child.has(table, Symbol.for('invalid')), false);
  for (const value of [1, null, Symbol.for('invalid')]) assert.throws(() => child.set(table, value, 1), TypeError);
  const local = {}; child.create(local);
  assert.throws(() => parent.get(local, key), /does not belong/);
});

test('runtime WeakMap/WeakSet methods and codecs select active branch data', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowWeakCollections(); context.weakMemory = parent;
  for (const Constructor of [effects.WeakMap, effects.WeakSet]) {
    context.weakMemory = parent;
    const map = Constructor === effects.WeakMap, key = {}, table = ops.construct(Constructor, []);
    ops.invoke(Constructor.prototype[map ? 'set' : 'add'], table, [key, {key}]);
    const child = parent.fork(); context.weakMemory = child;
    const roots = {table, key};
    const restored = effects.S.read(effects.S.write(roots));
    const copied = effects.prepareCopy(roots, null, null)();
    for (const result of [restored, copied]) {
      assert.equal(ops.invoke(Constructor.prototype.has, result.table, [result.key]), true);
      if (map) assert.strictEqual(ops.invoke(Constructor.prototype.get, result.table, [result.key]).key, result.key);
    }
    ops.invoke(Constructor.prototype.delete, table, [key]);
    assert.equal(ops.invoke(Constructor.prototype.has, table, [key]), false);
    context.weakMemory = parent;
    assert.equal(ops.invoke(Constructor.prototype.has, table, [key]), true);
  }
});

test('weak version roots do not retain a key through its value cycle', async () => {
  const {execFileSync} = await import('node:child_process');
  const source = new URL('../src/cow-weak.ts', import.meta.url).href;
  execFileSync(process.execPath, ['--expose-gc', '--experimental-strip-types', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {CowWeakCollections} from ${JSON.stringify(source)};
    const parent = new CowWeakCollections(), table = {}; parent.create(table);
    let reference;
    (() => { const key = {}; reference = new WeakRef(key); parent.set(table, key, {key}); })();
    const child = parent.fork();
    let collected = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise(setImmediate); global.gc(); await new Promise(setImmediate);
      if (reference.deref() === undefined) {collected = true; break;}
    }
    assert.equal(collected, true, 'branch roots retained the key/value cycle');
    assert.deepEqual([...parent.items(table)], []);
    assert.deepEqual([...child.items(table)], []);
  `], {timeout: 15000, stdio: 'pipe'});
});
