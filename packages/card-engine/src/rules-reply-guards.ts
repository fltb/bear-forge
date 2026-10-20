import type {CardDefinition,CardFrame,CardRoot} from './card.types.ts';
export type ChoiceReplyGuard={port:string;validate:(locals:Readonly<Record<string,unknown>>,output:unknown)=>void};
const guards=new WeakMap<object,ReadonlyMap<string,ChoiceReplyGuard>>();
/** Static companion metadata is keyed by the shared effect array, never by an Instance. */
export function attachRuleReplyGuards(effects:readonly object[],value:ReadonlyMap<string,ChoiceReplyGuard>):void{if(value.size)guards.set(effects,new Map(value));}
export function ruleReplyGuardFor(definition:{effects:readonly object[]}):((name:string,frame:CardFrame,port:string,output:unknown)=>void)|null{
  const table=guards.get(definition.effects);if(!table)return null;
  return(name,frame,port,output)=>{const guard=table.get(name);if(guard){if(guard.port!==port)throw Error('Choice guard port mismatch');guard.validate(frame.locals,output);}};
}
