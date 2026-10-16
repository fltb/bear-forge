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
export let namespaceCounter = 0;
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
    namespaceCounter = 1;
    namespaceCounter += await io.call({
      port: 'step',
      input: namespaceCounter
    });
    return namespaceCounter;
  }
};

export const configurationProgram = {
  schemas: { setup: z.number(), result: z.string(), ports: { step: { input: z.number(), output: z.number() } } },
  async run(n: number, io: any) {
    let local = n;
    z.config({ customError: () => 'context:' + local });
    local += await io.call({ port: 'step', input: n });
    const parsed = z.string().safeParse(42);
    return parsed.success ? 'unexpected' : parsed.error.issues[0]!.message;
  }
};
