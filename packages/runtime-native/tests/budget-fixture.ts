import { z } from 'zod';
export const program = {
  schemas: {
    setup: z.null(),
    result: z.number(),
    ports: {}
  },
  async run() {
    try {
      let count = 0;
      while (true) count++;
    } catch {}
    return 4;
  }
};
