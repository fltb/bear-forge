import { test } from 'node:test';
import assert from 'node:assert/strict';
import { program } from './benchmarks.ts';
async function result(mode: any) {
  return program.run({
    mode,
    seed: 37,
    size: 4
  }, {
    async call() {
      return 7;
    }
  });
}
test('graph distances match independent repeated relaxation, knapsack matches subset enumeration, matrix matches row-column dot products', async () => {
  const graph: any = await result('graph');
  const expected = Array(graph.graph.length).fill(Infinity);
  expected[0] = 0;
  for (let i = 0; i < graph.graph.length; i++) for (let a = 0; a < graph.graph.length; a++) for (const b of graph.graph[a]) expected[b] = Math.min(expected[b], expected[a] + 1);
  assert.deepEqual(graph.distances, expected.map(x => x === Infinity ? -1 : x));
  const dp: any = await result('dp');
  let best = 0;
  for (let mask = 0; mask < 2 ** dp.items.length; mask++) {
    let weight = 0,
      value = 0;
    dp.items.forEach((item: any, i: number) => {
      if (mask & 1 << i) {
        weight += item.weight;
        value += item.value;
      }
    });
    if (weight <= 12) best = Math.max(best, value);
  }
  assert.equal(dp.value, best);
  const matrix: any = await result('matrix');
  const columns = matrix.b[0].map((_: any, j: number) => matrix.b.map((r: number[]) => r[j]));
  assert.deepEqual(matrix.out, matrix.a.map((row: number[]) => columns.map((column: number[]) => row.reduce((sum, n, k) => sum + n * column[k]!, 0))));
});
