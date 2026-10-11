import { z } from 'zod';
let counter = 0;
export const program = {
  schemas: {
    setup: z.null(),
    result: z.number().refine(value => value === counter),
    ports: {
      step: {
        input: z.number(),
        output: z.number()
      }
    }
  },
  async run(_setup: null, io: any) {
    counter++;
    counter += await io.call({
      port: 'step',
      input: counter
    });
    return counter;
  }
};
export const namespaceProgram = {
  schemas: {
    setup: z.null(),
    result: z.number(),
    ports: {
      step: {
        input: z.number(),
        output: z.number()
      }
    }
  },
  async run(_setup: null, io: any) {
    module.exports.counter = 1;
    module.exports.counter += await io.call({
      port: 'step',
      input: module.exports.counter
    });
    return module.exports.counter;
  }
};
