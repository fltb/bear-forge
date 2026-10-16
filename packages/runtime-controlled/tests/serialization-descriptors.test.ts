import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const serialization = require('@effectful/serialization');

test('shared reference handlers dispatch to their own descriptor and preserve cyclic aliases', () => {
  class Left {value: any; constructor(value: any) {this.value = value;}}
  class Right {value: any; constructor(value: any) {this.value = value;}}
  const register = (name: string, Constructor: typeof Left) => {
    const descriptor = serialization.regDescriptor({
      name, props: false,
      create() {return new Constructor(undefined);},
      write(ctx: any, value: Left) {const json: any = {}; json.value = ctx.step(value.value, json, 'value'); return json;},
      readContent(ctx: any, json: any, value: Left) {value.value = ctx.step(json.value);}
    });
    return descriptor;
  };
  const leftDescriptor = register('shared-reference-left', Left);
  const rightDescriptor = register('shared-reference-right', Right);
  assert.equal(leftDescriptor.read, rightDescriptor.read);
  assert.equal(leftDescriptor.write, rightDescriptor.write);
  const left = new Left(undefined), right = new Right(left);
  left.value = right;
  serialization.setObjectDescriptor(left, leftDescriptor);
  serialization.setObjectDescriptor(right, rightDescriptor);
  for (const alwaysByRef of [false, true]) {
    const result = serialization.read(JSON.parse(JSON.stringify(serialization.write(Object.assign(Object.create(null), {left, right, alias: left}), {alwaysByRef}))));
    assert.ok(result.left instanceof Left);
    assert.ok(result.right instanceof Right);
    assert.equal(result.left, result.alias);
    assert.equal(result.left.value, result.right);
    assert.equal(result.right.value, result.left);
  }
});
