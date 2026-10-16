import {z} from 'zod';
export const program = {
  schemas: {
    setup:z.null(), ports:{},
    result:z.object({steps:z.array(z.object({value:z.number(),done:z.boolean()})),protected:z.array(z.boolean()),owned:z.number()})
  },
  async run() {
    function* sequence():Generator<number,number,unknown> {try {yield 1;} catch(error) {yield Number(error);} return 3;}
    async function* asynchronous():AsyncGenerator<number,number,unknown> {try {yield 1;} catch(error) {yield Number(error);} return 3;}
    const first=sequence(),second=asynchronous();
    const steps=[first.next(),first.throw(4),first.next(),await second.next(),await second.throw(4),await second.next()];
    const closed=sequence(),asyncClosed=asynchronous();closed.next();await asyncClosed.next();
    steps.push(closed.return(5),await asyncClosed.return(5));
    const cursors=[[][Symbol.iterator](),''[Symbol.iterator](),new Map().entries(),new Set().values(),new Uint8Array().values()];
    const targets=[...cursors.map(cursor=>Object.getPrototypeOf(cursor)),
      Object.getPrototypeOf(Object.getPrototypeOf(first)),Object.getPrototypeOf(Object.getPrototypeOf(second))];
    const protectedValues=[];
    for (const target of targets) {
      try {target.bearMutationProbe=1;protectedValues.push(false);}
      catch(error) {if (!(error instanceof TypeError)) throw error;protectedValues.push(true);}
    }
    const owned=Object.getPrototypeOf(first);owned.ownState=7;
    return {steps,protected:protectedValues,owned:owned.ownState};
  }
};
