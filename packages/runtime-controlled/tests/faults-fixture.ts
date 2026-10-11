import { z } from 'zod';
export const program = {
  schemas: {
    setup: z.enum(['loop', 'catch-loop', 'overlap', 'pending', 'entropy', 'done', 'schema-budget']),
    ports: {
      step: {
        input: z.number(),
        output: z.number()
      }
    },
    result: z.number().refine(value => {
      if (value === 999) {
        for (let i = 0; i < 200000; i++) {}
      }
      return true;
    })
  },
  async run(mode: string, io: any) {
    if (mode === 'done') return 4;
    if (mode === 'schema-budget') return 999;
    if (mode === 'entropy') {
      try {
        const name = 'ran' + 'dom';
        Math[name as 'random']();
      } catch {}
      return 4;
    }
    if (mode === 'loop' || mode === 'catch-loop') {
      try {
        let x = 0;
        while (true) x++;
      } catch {
        if (mode === 'catch-loop') return 4;
        throw Error('stop');
      }
    }
    if (mode === 'pending') {
      io.call({
        port: 'step',
        input: 0
      });
      return 4;
    }
    if (mode === 'overlap') {
      try {
        io.call({
          port: 'step',
          input: 0
        });
        await io.call({
          port: 'step',
          input: 1
        });
      } catch {}
      return 4;
    }
    return 0;
  }
};
