import {z} from 'zod';

let checks = 0;
export const program = {
  schemas: {
    setup: z.null(),
    result: z.number(),
    ports: {
      step: {
        input: z.null(),
        output: z.number().refine(value => {
          checks++;
          if (value === 9) { try { Date.now(); } catch {} }
          return value >= 0;
        })
      }
    }
  },
  async run(_setup: null, io: {call(input: {port: 'step'; input: null}): Promise<number>}) {
    await io.call({port: 'step', input: null});
    return checks;
  }
};
