import { z } from 'zod';

export const modes = ['resolve', 'executor', 'with-resolvers', 'reaction', 'await'] as const;
export const program = {
  schemas: {
    setup: z.enum(modes), ports: {},
    result: z.object({value: z.number(), trace: z.array(z.string())})
  },
  async run(mode: typeof modes[number]) {
    const trace: string[] = [];
    const thenable = Object.freeze({
      get then() {
        trace.push('get');
        return function(this: unknown, resolve: (value: number) => void) {
          if (this !== thenable) throw new Error('Wrong then receiver');
          trace.push('then');
          resolve(7);
        };
      }
    });
    // The cast describes PromiseLike's generic method to TS; the actual
    // JavaScript protocol accepts this concrete resolving function.
    const input = thenable as unknown as PromiseLike<number>;
    let result: PromiseLike<number>;
    switch (mode) {
      case 'resolve': result = Promise.resolve(input); break;
      case 'executor': result = new Promise<number>(resolve => resolve(input)); break;
      case 'with-resolvers': {
        const capability = (Promise as PromiseConstructor & {
          withResolvers<T>(): {
            promise: Promise<T>;
            resolve(value: T | PromiseLike<T>): void;
            reject(reason: unknown): void;
          };
        }).withResolvers<number>();
        capability.resolve(input);
        result = capability.promise;
        break;
      }
      case 'reaction': result = Promise.resolve().then(() => input); break;
      case 'await': result = input; break;
    }
    trace.push('scheduled');
    const value = await result;
    trace.push('done');
    return {value, trace};
  }
};

export const ingressModes=['arrow','rest','default','method','bound','async-method','nested','reject','throw-getter','noncallable','function-value','order'] as const;
export const ingressProgram={
  schemas:{setup:z.enum(ingressModes),ports:{},result:z.unknown()},
  async run(mode:typeof ingressModes[number]){
    const trace:unknown[]=[],marker={marker:true};
    let saved:any;
    const complete=(resolve:any,reject:any)=>{
      saved=resolve;trace.push(['callback',resolve.name,resolve.length,Object.hasOwn(resolve,'prototype'),resolve===reject]);
      if(mode==='reject'){reject(marker);resolve(99);return;}
      resolve(mode==='nested'?Object.freeze({then(next:any){trace.push('nested');next(7);}}):7);
      reject(marker);
    };
    const methods:any={
      arrow:(resolve:any,reject:any)=>complete(resolve,reject),
      rest:(...args:any[])=>complete(args[0],args[1]),
      default:(resolve:any,reject:any=()=>undefined)=>complete(resolve,reject),
      method:{then(resolve:any,reject:any){return complete(resolve,reject);}}.then
    };
    methods.bound=methods.method.bind(null);
    methods['async-method']=async function(resolve:any,reject:any){await Promise.resolve();complete(resolve,reject);};
    const input=Object.freeze({get then(){trace.push('get');if(mode==='throw-getter')throw marker;
      return mode==='noncallable'?0:methods[mode]??methods.method;
    }});
    const value=mode==='function-value'?Math.abs:input;
    if(mode==='order')Promise.resolve().then(()=>trace.push('before'));
    const promise=Promise.resolve(value);
    if(mode==='order')Promise.resolve().then(()=>trace.push('after'));
    trace.push('scheduled');
    let result:unknown;
    try{
      const answer:unknown=await promise;
      result=answer===input?'original':answer===Math.abs?'function':answer;
      if(saved){const bound=saved.bind(null);bound(88);trace.push(['saved',saved.length]);}
    }catch(error){result=error===marker?'marker':'wrong';}
    trace.push('done');
    return {result,trace};
  }
};

export const forbiddenPromiseProgram={
  schemas:{setup:z.enum(['await','async-return']),ports:{},result:z.string()},
  async run(mode:'await'|'async-return'){
    const input:any=Object.freeze({get then(){return Function;}});
    try{
      if(mode==='await')await input;
      else await (async()=>input)();
      return 'resolved';
    }catch(error){return String(error);}
  }
};
