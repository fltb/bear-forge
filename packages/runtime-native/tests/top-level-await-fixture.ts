import {z} from 'zod';
const trace:string[]=[];
await Promise.resolve().then(()=>trace.push('initialized'));
let count=0;
export const program={
  schemas:{setup:z.number(),result:z.object({count:z.number(),trace:z.array(z.string())}),ports:{step:{input:z.number(),output:z.number()}}},
  async run(setup:number,io:{call:(input:{port:'step';input:number})=>Promise<number>}){
    count+=setup;
    trace.push('run');
    count+=await io.call({port:'step',input:count});
    return {count,trace};
  }
};
