import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowQueue} from '../src/cow-queue.ts';

test('job queue fork and first removal share untouched state without copying pending jobs', () => {
  const parent = new CowQueue<object>();
  for (let i = 0; i < 20000; i++) parent.push({i});
  const child = parent.fork(), sibling = parent.fork();
  const root = (parent as any).items.root;
  assert.strictEqual((child as any).items.root, root);
  const first = child.shift();
  assert.strictEqual(parent.shift(), first);
  assert.equal(sibling.length, 20000);
  assert.equal(child.length, 19999);
  assert.strictEqual((child as any).items.root.slots[1], root.slots[1]);
  const extra = {}; child.push(extra);
  assert.equal([...child].at(-1), extra);
  assert.notEqual([...parent].at(-1), extra);
  parent.clear(); child.clear();
  assert.strictEqual(sibling.shift(), first);
});

test('job queue preserves FIFO across repeated forks, index wrap and empty reuse', () => {
  let queue = new CowQueue<number | undefined>(), expected: (number | undefined)[] = [];
  (queue as any).head = (queue as any).tail = Number.MAX_SAFE_INTEGER - 2;
  for (let index = 0; index < 2000; index++) {
    if (index % 7 === 0) {
      const original = queue; queue = queue.fork();
      queue.push(index); expected.push(index);
      assert.equal(original.length, expected.length - 1);
    } else if (index % 3 === 0) assert.equal(queue.shift(), expected.shift());
    else {queue.push(index % 5 ? index : undefined); expected.push(index % 5 ? index : undefined);}
  }
  assert.deepEqual([...queue], expected);
  while (expected.length) assert.equal(queue.shift(), expected.shift());
  assert.equal(queue.shift(), undefined); assert.equal(queue.length, 0);
  queue.push(42); assert.equal(queue.shift(), 42);
});
