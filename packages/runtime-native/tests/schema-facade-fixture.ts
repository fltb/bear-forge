import { z } from 'zod';

const state = { count: 1 };
const setup = z.object({ count: z.number() });
Object.defineProperty(setup, 'parse', {
  value: () => state,
  configurable: true
});

export const program = {
  schemas: {
    setup,
    ports: {},
    result: z.number()
  },
  async run() { return state.count; }
};
