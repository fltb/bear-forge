import {z} from 'zod';
import {rules,type ruleModules} from '@bear-forge/card-engine';
import {entityId} from './resources.schemas.ts';

/** Typed component-local updates. Multi-component transitions explicitly list
 * their reads and writes in the owning module, preserving atomic commit. */
export function componentPart<T extends object>(module:ruleModules.ModuleBuilder,schema:z.ZodType<T>){
  const component=module.own(rules.defineComponent<T|null>({schema:schema.nullable(),initial:()=>null}));
  const current=rules.defineQuery({input:entityId,output:schema,reads:[component],base(read,entity){
    const value=read.component(entity,component);if(value===null)throw Error('Uninitialized component');return value;
  }});
  function change<I extends {run:number},O>(input:rules.Schema<I>,output:rules.Schema<O>,apply:(value:rules.Borrowed<T>,input:rules.Borrowed<I>)=>{state:T|rules.Borrowed<T>;result:O|rules.Borrowed<O>}){
    return module.atom({input,output,reads:[component],writes:[component],emits:[],run(read,input){
      const value=read.component(input.run,component);if(value===null)throw Error('Missing component');
      const next=apply(value,input);
      return{writes:[{entity:input.run,component,value:next.state}],events:[],result:next.result};
    }});
  }
  return{component,current,change};
}

/** Keys are fixed by assembly; runtime initialization only projects values. */
export function projectFields<S extends z.ZodObject>(schema:S):<T extends z.output<S>>(value:rules.Borrowed<T>)=>rules.Borrowed<z.output<S>> {
  const keys=Object.keys(schema.shape) as (keyof z.output<S>)[];
  return value=>{const result={} as z.output<S>;for(const key of keys)if(Object.hasOwn(value,key))result[key]=Reflect.get(value as object,key);return result as rules.Borrowed<z.output<S>>;};
}
