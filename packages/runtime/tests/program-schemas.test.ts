import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProgramModuleShape, assertProgramSchemasShape } from '../src/program-schemas.ts';

test('ProgramSchemas inspection accepts Game port metadata and rejects accessors before reading them', () => {
  assert.doesNotThrow(() => assertProgramSchemasShape({
    setup: {}, result: {}, ports: { ask: { kind: 'request', input: {}, output: {} } },
    metadata: { owned: true }
  }));
  assert.doesNotThrow(() => assertProgramModuleShape({ schemas: {}, run() {}, count: 1 }));
  let called = false;
  const extra = { setup: {}, result: {}, ports: {}, get leaked() { called = true; return {}; } };
  assert.doesNotThrow(() => assertProgramSchemasShape(extra));
  assert.doesNotThrow(() => assertProgramModuleShape({ schemas: {}, run() {}, get leaked() { called = true; return {}; } }));
  const hidden = Object.defineProperty({ schemas: {}, run() {} }, 'retained', {
    get() { called = true; return 1; }
  });
  assert.doesNotThrow(() => assertProgramModuleShape(hidden));
  const ports = { get ask() { called = true; return {}; } };
  assert.throws(() => assertProgramSchemasShape({ setup: {}, result: {}, ports }), /data properties/);
  const port = { get input() { called = true; return {}; }, output: {} };
  assert.throws(() => assertProgramSchemasShape({ setup: {}, result: {}, ports: { ask: port } }), /data properties/);
  const proxy = new Proxy({ setup: {}, result: {}, ports: {} }, {
    getPrototypeOf() { called = true; throw Error('Proxy trap executed'); }
  });
  assert.throws(() => assertProgramSchemasShape(proxy), /Invalid ProgramSchemas table/);
  assert.equal(called, false);
});
