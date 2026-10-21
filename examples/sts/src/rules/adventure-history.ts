import {z} from 'zod';
import {rules,type ruleModules} from '@bear-forge/card-engine';
import {entityId} from './resources.schemas.ts';
import {adventureHistorySchema} from './adventures.schemas.ts';

const entrySchema=adventureHistorySchema.shape.history.element;
const inputSchema=z.object({run:entityId,kind:entrySchema.shape.kind,bits:entrySchema.shape.bits});
const cursorSchema=z.object({length:z.int32().nonnegative(),published:z.int32().nonnegative()});
const stateSchema=cursorSchema.extend({first:entityId.nullable(),last:entityId.nullable(),publishChunk:entityId.nullable(),publishOffset:z.int32().min(0).max(64)});
const width=64;
type Entry=z.output<typeof entrySchema>;

/** Bounded chunks and their links are scoped entities in the same Context.
 * Append and acknowledgement touch only their tail/cursor, never an index or
 * complete history proportional to the previous number of decisions. */
export function adventureHistory(module:ruleModules.ModuleBuilder,scope:rules.Query<number,{scope:number}>){
  const component=module.own(rules.defineComponent({schema:stateSchema.nullable(),initial:()=>null}));
  const chunkSchema=z.object({entries:z.array(entrySchema).max(width),next:entityId.nullable()});
  const values=module.own(rules.defineComponent({schema:chunkSchema,initial:()=>({entries:[] as Entry[],next:null as number|null})}));
  const chunkKind=module.kind({config:z.undefined(),components:[values]});
  const chunkDefinition=rules.defineEntity(chunkKind,undefined);
  const metadata=rules.defineQuery({input:entityId,output:stateSchema,reads:[component],base(read,run){const state=read.component(run,component);if(state===null)throw Error('Missing adventure history');return state;}});
  const cursor=rules.defineQuery({input:entityId,output:cursorSchema,dependencies:[metadata],base:(read,run)=>{const state=read.query(metadata,run);return{length:state.length,published:state.published};}});
  const current=rules.defineQuery({input:entityId,output:adventureHistorySchema,reads:[values],dependencies:[metadata],base(read,run){
    const state=read.query(metadata,run),history:Entry[]=[];let chunk=state.first;
    for(let count=0;count<Math.ceil(state.length/width);count++){
      if(chunk===null)throw Error('Incomplete adventure history');
      const value=read.component(chunk,values);history.push(...value.entries);chunk=value.next;
    }
    if(chunk!==null||history.length!==state.length)throw Error('Invalid adventure history extent');
    return{history,published:state.published};
  }});
  const pending=rules.defineQuery({input:entityId,output:z.array(entrySchema),reads:[values],dependencies:[metadata],base(read,run){
    const state=read.query(metadata,run),history:Entry[]=[];let chunk=state.publishChunk,offset=state.publishOffset;
    for(let count=0;chunk!==null&&count<=Math.ceil((state.length-state.published)/width);count++){
      const value=read.component(chunk,values);
      for(let index=offset;index<value.entries.length;index++)history.push(value.entries[index]!);
      chunk=value.next;offset=0;
    }
    if(chunk!==null||history.length!==state.length-state.published)throw Error('Invalid pending history extent');
    return history;
  }});
  const admitted=rules.defineQuery({input:inputSchema,output:inputSchema,base:(_read,input)=>input});
  const append=module.atom({input:inputSchema.extend({chunk:entityId,fresh:z.boolean()}),output:z.undefined(),reads:[component,values],writes:[component,values],emits:[],run(read,input){
    const state=read.component(input.run,component),chunk=read.component(input.chunk,values);
    if(state===null||input.fresh&&state.length%width!==0||!input.fresh&&state.last!==input.chunk||chunk.entries.length>=width)throw Error('Invalid adventure history append');
    const previous=input.fresh&&state.last!==null?{entity:state.last,component:values,value:{...read.component(state.last,values),next:input.chunk}}:null;
    return{writes:[
      ...(previous?[previous]:[]),
      {entity:input.run,component,value:{...state,first:state.first??input.chunk,last:input.chunk,publishChunk:state.publishChunk??input.chunk,length:state.length+1}},
      {entity:input.chunk,component:values,value:{entries:[...chunk.entries,{kind:input.kind,bits:input.bits}],next:null}},
    ],events:[],result:undefined};
  }});
  const record=rules.defineEffect<z.output<typeof inputSchema>,void>(builder=>{
    const input=builder.local<z.output<typeof inputSchema>>(),chunk=builder.local<number>(),fresh=builder.local<boolean>();
    const run=builder.read(view=>view.input.run),state=rules.query(metadata,run),scopeValue=rules.query(scope,run);
    return rules.sequence(
      builder.assign(input,rules.query(admitted,builder.input)),
      builder.assign(fresh,builder.read(view=>view.get(state).length%width===0)),
      rules.when(fresh,builder.assign(chunk,rules.spawnEntity({definition:chunkDefinition,owner:run,scope:builder.read(view=>view.get(scopeValue).scope)})),builder.assign(chunk,builder.read(view=>view.get(state).last!))),
      rules.call(append,{run,chunk,fresh,kind:builder.read(view=>view.get(input).kind),bits:builder.read(view=>view.get(input).bits)}),
    );
  });
  const published=module.atom({input:z.object({run:entityId,count:z.int32().nonnegative()}),output:z.undefined(),reads:[component,values],writes:[component],emits:[],run(read,input){
    const state=read.component(input.run,component);
    if(state===null||input.count<state.published||input.count>state.length)throw Error('Invalid event acknowledgement');
    let remaining=input.count-state.published,chunk=state.publishChunk,offset=state.publishOffset;
    while(remaining>0){
      if(chunk===null)throw Error('Incomplete event acknowledgement');
      const value=read.component(chunk,values),take=Math.min(remaining,value.entries.length-offset);
      remaining-=take;offset+=take;
      if(remaining>0){if(value.next===null)throw Error('Incomplete event acknowledgement');chunk=value.next;offset=0;}
    }
    return{writes:[{entity:input.run,component,value:{...state,published:input.count,publishChunk:chunk,publishOffset:offset}}],events:[],result:undefined};
  }});
  return{component,current,cursor,pending,record,published,initial:():z.output<typeof stateSchema>=>({first:null,last:null,publishChunk:null,publishOffset:0,length:0,published:0})};
}
