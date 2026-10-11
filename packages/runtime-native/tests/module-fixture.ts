import { z } from 'zod';
let counter = 0;
export const program = {
  schemas: {
    setup: z.number(),
    result: z.number().refine(value => value === counter),
    ports: {}
  },
  async run(input: number) {
    counter += input;
    return counter;
  }
};
