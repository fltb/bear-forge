import { z } from 'zod';
export const modes = ['closure', 'control', 'exceptions', 'sort', 'graph', 'dp', 'matrix', 'random', 'strings', 'interpreter', 'numeric', 'schema'] as const;
export const program = {
  schemas: {
    setup: z.strictObject({
      mode: z.enum(modes),
      seed: z.number().int(),
      size: z.number().int().min(1).max(64),pause:z.boolean().optional()
    }),
    result: z.any(),
    ports: {
      step: {
        input: z.any(),
        output: z.number()
      }
    }
  },
  async run(setup: {
    mode: typeof modes[number];
    seed: number;
    size: number;pause?:boolean;
  }, io: any) {
    let random = setup.seed >>> 0;
    function rng() {
      random = Math.imul(random, 1664525) + 1013904223 >>> 0;
      return random;
    }
    const trace: unknown[] = [];let ordinal=0;
    async function point(label: string, value: unknown) {
      const answer = setup.pause===false?7+ordinal++:await io.call({
        port: 'step',
        input: {
          label,
          value
        }
      });
      trace.push([label, value, answer]);
      return answer;
    }
    const n = setup.size;
    switch (setup.mode) {
      case 'closure':
        {
          let value = 0;
          const object = {
            value: 0
          };
          const aliases = [object, object];
          const cycle: {
            self?: unknown;
          } = {};
          cycle.self = cycle;
          function increment() {
            return ++value;
          }
          function peek() {
            return value;
          }
          const functions = [];
          for (let i = 0; i < 4; i++) functions.push(() => i + peek());
          async function recur(depth: number): Promise<number> {
            const saved = depth;
            if (!depth) return await point('leaf', increment());
            return saved + (await recur(depth - 1));
          }
          const a = await recur(3);
          object.value = a;
          const b = await point('closure', functions.map(f => f()));
          increment();
          return {
            a,
            b,
            value: peek(),
            object: aliases[1]!.value,
            alias: aliases[0] === aliases[1],
            cycle: cycle.self === cycle
          };
        }
      case 'control':
        {
          let count = 0;
          outer: for (let i = 0; i < n; i++) {
            if (i % 3 === 0) continue;
            for (let j = 0; j < 4; j++) {
              if (j === 2) break;
              if (i > n - 2) break outer;
              count += i + j;
            }
          }
          const x = await point('loop', count);
          return {
            count,
            result: x + count
          };
        }
      case 'exceptions':
        {
          let value = 0;
          try {
            await point('before', 0);
            try {
              value += await point('inside', 1);
              throw Error('business');
            } finally {
              trace.push('inner-finally');
              value++;
            }
          } catch (e) {
            trace.push((e as Error).message);
          } finally {
            trace.push('outer-finally');
          }
          return {
            value,
            trace
          };
        }
      case 'sort':
        {
          const input = Array.from({
            length: n
          }, (_, i) => ({
            value: rng() % 7,
            index: i
          }));
          const sorted = input.slice().sort((a, b) => a.value - b.value);
          await point('sorted', sorted);
          return sorted;
        }
      case 'graph':
        {
          const graph = Array.from({
            length: n
          }, () => [] as number[]);
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rng() % 3 === 0) graph[i]!.push(j);
          const distances = Array(n).fill(-1),
            queue = [0],
            order: number[] = [];
          distances[0] = 0;
          while (queue.length) {
            const node = queue.shift()!;
            order.push(node);
            for (const next of graph[node]!) {
              if (distances[next] !== -1) continue;
              distances[next] = distances[node] + 1;
              queue.push(next);
            }
            if (order.length === 1) await point('frontier', queue.slice());
          }
          return {
            graph,
            distances,
            order
          };
        }
      case 'dp':
        {
          const items = Array.from({
            length: n
          }, () => ({
            weight: rng() % 5 + 1,
            value: rng() % 9 + 1
          }));
          const capacity = 12,
            dp = Array(capacity + 1).fill(0);
          for (let i = 0; i < items.length; i++) {
            const item = items[i]!;
            for (let w = capacity; w >= item.weight; w--) dp[w] = Math.max(dp[w], dp[w - item.weight] + item.value);
            if (i === 0) await point('dp', dp.slice());
          }
          return {
            items,
            value: dp[capacity],
            dp
          };
        }
      case 'matrix':
        {
          const m = Math.min(n, 4),
            a = Array.from({
              length: m
            }, () => Array.from({
              length: m
            }, () => rng() % 10)),
            b = Array.from({
              length: m
            }, () => Array.from({
              length: m
            }, () => rng() % 10)),
            out = Array.from({
              length: m
            }, () => Array(m).fill(0));
          for (let i = 0; i < m; i++) {
            for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) out[i]![j] += a[i]![k]! * b[k]![j]!;
            await point('row', out[i]);
          }
          return {
            a,
            b,
            out
          };
        }
      case 'random':
        {
          const array = Array.from({
            length: n
          }, (_, i) => i);
          for (let i = array.length - 1; i > 0; i--) {
            const j = rng() % (i + 1);
            const old = array[i]!;
            array[i] = array[j]!;
            array[j] = old;
          }
          await point('shuffle', array.slice());
          const samples = Array.from({
            length: n
          }, () => rng());
          return {
            array,
            samples,
            random
          };
        }
      case 'strings':
        {
          const text = '熊🐻a\u0301Z';
          const chars = [...text];
          await point('unicode', chars);
          const tree = {
            text,
            children: [{
              text: 'x',
              children: []
            }]
          };
          const serialized = JSON.stringify(tree);
          return {
            chars,
            length: text.length,
            slice: text.slice(1, 3),
            roundTrip: JSON.parse(serialized)
          };
        }
      case 'interpreter':
        {
          const instructions = [['push', 3], ['push', 4], ['add', 0], ['push', 2], ['multiply', 0]] as const;
          const stack: number[] = [];
          for (const [op, arg] of instructions) {
            if (op === 'push') stack.push(arg);else {
              const b = stack.pop()!,
                a = stack.pop()!;
              stack.push(op === 'add' ? a + b : a * b);
            }
            if (stack.length === 2) await point('stack', stack.slice());
          }
          return stack;
        }
      case 'numeric':
        {
          const array = [, NaN, -0, undefined, Infinity, -Infinity, 19n];
          await point('numbers', array);
          return {
            negativeZero: Object.is(array[2], -0),
            nan: Number.isNaN(array[1]),
            hole: !(0 in array),
            positiveInfinity: array[4] === Infinity,
            negativeInfinity: array[5] === -Infinity,
            bigint: array[6] === 19n,
            shift: 2147483647 + 1 | 0,
            rounding: 0.1 + 0.2 - 0.3
          };
        }
      case 'schema':
        {
          const checked = z.strictObject({
            value: z.number().min(0),
            label: z.string()
          });
          const good = checked.parse({
            value: n,
            label: 'x'
          });
          const bad = checked.safeParse({
            value: -1,
            label: 'x'
          });
          await point('schema', good);
          return {
            good,
            error: bad.success ? null : bad.error.issues.map(x => ({
              code: x.code,
              path: x.path
            }))
          };
        }
    }
  }
};
