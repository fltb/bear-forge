/** Assembly-only descriptions of actual static definitions. Never executed or stored in Context. */
const texts=new WeakMap<object,string>();

/** Atomic semantic owners annotate their actual definition; unknown children clear prior projections. */
export function describeProgram<T extends object>(program:T,text:string|undefined):T{
  if(text===undefined)texts.delete(program);else texts.set(program,text);
  return program;
}
export function programText(program:object):string|undefined{return texts.get(program);}
