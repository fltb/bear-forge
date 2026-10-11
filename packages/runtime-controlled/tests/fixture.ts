import { z } from 'zod';
export const program = {
  schemas: {
    setup: z.number(),
    result: z.number(),
    ports: {
      read: {
        input: z.number(),
        output: z.number()
      }
    }
  },
  async run(setup: number, io: {
    call: (call: {
      port: string;
      input: number;
    }) => Promise<number>;
  }) {
    let n = setup;
    const state = {
      n
    };
    const alias = state;
    function next() {
      return ++n;
    }
    async function recurse(depth: number): Promise<number> {
      if (!depth) return await io.call({
        port: 'read',
        input: next()
      });
      return depth + (await recurse(depth - 1));
    }
    const a = await recurse(2);
    state.n = a;
    const b = await io.call({
      port: 'read',
      input: next()
    });
    return alias.n + b + n;
  }
};
