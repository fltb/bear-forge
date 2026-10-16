import { z } from 'zod';

export const program = {
  schemas: { setup: z.enum(['default','assigned','capture']), ports: {}, result: z.unknown() },
  async run(mode: 'default' | 'assigned' | 'capture') {
    const error=new Error('local');
    if(mode==='capture') { Error.captureStackTrace(error); return null; }
    if(mode==='assigned') Reflect.set(error,'stack',{owned:true});
    return error.stack;
  }
};
