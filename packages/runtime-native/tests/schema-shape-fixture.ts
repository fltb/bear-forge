import { z } from 'zod';

export const program = {
  schemas: {
    setup: z.null(),
    result: z.null(),
    ports: {},
    get leaked(): never { throw Error('Undeclared schema getter executed'); }
  },
  async run() { return null; }
};
