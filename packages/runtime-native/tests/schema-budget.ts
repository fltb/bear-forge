import { z } from 'zod';
export const program = {
  schemas: {
    setup: z.null(),
    ports: {},
    result: z.number().refine(value => {
      for (let i = 0; i < 200000; i++) {}
      return true;
    })
  },
  async run() {
    return 1;
  }
};
