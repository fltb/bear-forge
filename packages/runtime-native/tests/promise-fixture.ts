import {z} from 'zod';
export const program={
  schemas:{setup:z.number(),ports:{},result:z.object({values:z.array(z.number()),trace:z.array(z.string())})},
  async run(input:number){
    const trace:string[]=[];
    let finish!:(value:number)=>void;
    const first=new Promise<number>((resolve,reject)=>{
      trace.push('executor');finish=resolve;
    });
    const retained={finish};
    const bound=retained.finish.bind(null);
    bound.call(null,input);
    const second=(Promise as any).withResolvers();
    Reflect.apply(second.resolve,null,[input+1]);
    const third=(Promise as any).withResolvers();
    const target={};
    Object.defineProperty(target,'answer',{set:third.resolve});
    Reflect.set(target,'answer',input+2);
    const fourth=new Promise<number>((resolve,reject)=>reject(input+3));
    const fifth=new Promise<number>(()=>{throw input+4;});
    const sixth=Promise.prototype.finally.call(Object.freeze({constructor:undefined,
      then(fulfilled:(value:number)=>unknown){return fulfilled(input+5);}
    }) as any,()=>undefined);
    function custom(value:number){
      const promise=Promise.resolve(value);
      Object.defineProperty(promise,'then',{value:function(fulfilled:(value:number)=>unknown){return fulfilled(value);}});
      return Object.freeze(promise);
    }
    const seventh=Promise.all([custom(input+6)]).then(values=>values[0]);
    const eighth=Promise.allSettled([custom(input+7)]).then(values=>values[0]!.status==='fulfilled'?values[0]!.value:0);
    const ninth=Promise.any([custom(input+8)]);
    const tenth=Promise.race([custom(input+9)]);
    const values=await Promise.all([first,second.promise,third.promise,
      fourth.catch(value=>{trace.push('reject');return value;}),
      fifth.catch(value=>{trace.push('throw');return value;}),sixth,seventh,eighth,ninth,tenth]);
    trace.push('done');
    return {values,trace};
  }
};
