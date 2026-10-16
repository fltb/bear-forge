import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowProperties, propertyPageWidth} from '../src/cow-properties.ts';
const data = (value: unknown): PropertyDescriptor => ({value, writable: true, enumerable: true, configurable: true});

test('a first shared write copies one value page, preserves layout, and reuses it for later writes', () => {
  const parent = new CowProperties();
  for (const slot of [0, 1, 31, 32, 63, 64, 2 ** 33 - 4]) parent.define(slot, String(slot), slot, data(slot));
  const child = parent.fork(), shared = parent.read(0)!, other = parent.read(32)!;
  child.setValue(0, 'child');
  const detached = child.read(0)!;
  assert.notStrictEqual(detached, shared);
  assert.strictEqual(detached.layout, shared.layout);
  assert.notStrictEqual(detached.values, shared.values);
  assert.ok(detached.values.length <= propertyPageWidth);
  assert.equal(detached.setters, undefined, 'data-only pages allocate no setter array');
  assert.strictEqual(child.read(32), other);
  child.setValue(1, 'second'); child.setValue(31, undefined);
  assert.strictEqual(child.read(0), detached);
  assert.equal(parent.descriptor(0)!.value, 0);
  assert.equal(parent.descriptor(31)!.value, 31);
  assert.equal(child.descriptor(31)!.value, undefined);
  const later = child.fork();
  child.setValue(0, 'later parent'); later.setValue(0, 'later child');
  assert.equal(child.descriptor(0)!.value, 'later parent');
  assert.equal(later.descriptor(0)!.value, 'later child');
  assert.equal(parent.descriptor(0)!.value, 0);
});

test('structural edits detach layout and clear obsolete accessor or data references', () => {
  const parent = new CowProperties(), key = Symbol('key'), get = () => 1, set = (_value: unknown) => {};
  parent.define(1, key, 0, {get, set, enumerable: false, configurable: true});
  parent.define(3, 'other', 1, data({alive: true}));
  const child = parent.fork();
  child.define(1, key, 0, {value: undefined, writable: false, enumerable: true, configurable: false});
  assert.notStrictEqual(parent.read(1)!.layout, child.read(1)!.layout);
  assert.deepEqual(parent.descriptor(1), {get, set, enumerable: false, configurable: true});
  assert.deepEqual(child.descriptor(1), {value: undefined, writable: false, enumerable: true, configurable: false});
  assert.equal(child.read(1)!.setters?.[1], undefined, 'obsolete setter is not retained by the new page');
  child.delete(3);
  assert.equal(child.read(3)!.values[3], undefined);
  assert.ok(parent.descriptor(3));
  assert.deepEqual([...child.entries()].map(([slot, layout]) => [slot, layout.key]), [[1, key]]);
});

test('page deletion and sparse reinsertion retain siblings and insertion metadata', () => {
  const parent = new CowProperties(), far = 2 ** 33 - 4;
  parent.define(1, 'near', 0, data(1)); parent.define(far, 'far', 1, data(2));
  const child = parent.fork();
  child.delete(1); child.delete(far);
  assert.deepEqual([...child.entries()], []);
  assert.ok(parent.descriptor(far));
  child.define(far, 'again', 2, data(3));
  assert.deepEqual([...child.entries()].map(([slot, layout]) => [slot, layout.key, layout.order]), [[far, 'again', 2]]);
  assert.equal(parent.descriptor(far)!.value, 2);
});


test('optional setter pages detach across branches and release replaced accessors', () => {
  const parent = new CowProperties(), original = (_value: unknown) => {}, replacement = (_value: unknown) => {};
  parent.define(2, 'getterOnly', 2, {get: () => 1, configurable: true});
  assert.equal(parent.read(2)!.setters, undefined, 'getter-only properties need no setter array');
  for (const slot of [1, 33]) parent.define(slot, String(slot), slot, {set: original, configurable: true});
  const child = parent.fork();
  for (const slot of [1, 33]) {
    child.define(slot, String(slot), slot, {set: replacement, configurable: true});
    assert.equal(parent.descriptor(slot)!.set, original);
    assert.equal(child.descriptor(slot)!.set, replacement);
    assert.notStrictEqual(parent.read(slot)!.setters, child.read(slot)!.setters);
    child.define(slot, String(slot), slot, data('value'));
    assert.equal(child.read(slot)!.setters?.[slot % propertyPageWidth], undefined);
    assert.equal(parent.descriptor(slot)!.set, original);
  }
});
