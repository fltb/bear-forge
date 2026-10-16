import { createRequire } from 'node:module';
const { METHOD_FUNCTION_FLAG, GENERATOR_WRAPPER_FLAG, ASYNC_GENERATOR_WRAPPER_FLAG, ASYNC_WRAPPER_FLAG } = createRequire(import.meta.url)('@effectful/core/v2/scope');
export function synchronousLocals(flags: number): boolean {
  return !(flags & (3 | 256 | GENERATOR_WRAPPER_FLAG | ASYNC_GENERATOR_WRAPPER_FLAG | ASYNC_WRAPPER_FLAG));
}
/** Static closure factories for EffectfulJS v2. Upstream constructs these with
 * Function at registration time; ours emits them into the compilation artifact. */
export function factorySource(name: string, callee: string | null, params: string[], vars: number, flags: number, prefix: string, captures: number[][] = [], uncapturedLocals = false, rawLocals = false, capturedLocals?: number[], groupedLocals?: {cells: number[]}): string {
  const functionName = /^[a-zA-Z_$][\w$]*$/.test(name) && !params.includes(name) ? name : prefix + name.replace(/\W/g, '_');
  const f = functionName || prefix + 'anonymous';
  const values = [`${prefix}.$`, ...(callee ? [f] : []), ...params];
  while (values.length < vars) values.push('void 0');
  // Synchronous frames finish before an external IO boundary. Escaping
  // closures retain independent captured cells, never these temporary slots.
  const transient = synchronousLocals(flags) && (rawLocals || capturedLocals !== undefined || groupedLocals !== undefined);
  const localValues = rawLocals && transient;
  const localMode = transient ? {cells: capturedLocals ?? groupedLocals?.cells ?? [], transient: true, direct: !groupedLocals}
    : capturedLocals ?? groupedLocals ?? null;
  const head = [`${prefix}.$=${localValues ? `[${values.join(',')}]` : `${prefix}M.scope([${values.join(',')}],${rawLocals ? '"values"' : capturedLocals || groupedLocals ? prefix + 'locals' : uncapturedLocals})`};`];
  if (flags & 8) head.push(`${prefix}.self=${flags & 4 ? prefix + 'x[0].self' : 'this'};`);
  if (flags & 16) head.push(`${prefix}.args=${flags & 4 ? prefix + 'x[0].args' : flags & 256 ? `${prefix}args(${prefix},arguments)` : `${prefix}M.strictArguments(arguments)`};`);
  const generatorWrapper = flags & (GENERATOR_WRAPPER_FLAG | ASYNC_GENERATOR_WRAPPER_FLAG);
  const nonConstructable = !!(flags & (1 | 2 | 4 | METHOD_FUNCTION_FLAG | ASYNC_WRAPPER_FLAG) || generatorWrapper);
  if (!nonConstructable) head.unshift(`if(new.target)${prefix}M.constructed(this);`);
  const body = `${flags & 256 ? '' : '"use strict";'} var ${prefix}=${prefix}frame(${prefix}x,new.target,${transient}); ${head.join('')}
    ${flags & 2 ? `return ${prefix}.iter;` : `try{${prefix}pushFrame(${prefix},${f});return ${prefix}.meta.handler(${prefix},${prefix}.$,null);}catch(e){return ${prefix}M.handle(${prefix},e);}`}`;
  const callable = nonConstructable ? `{${f}(${params.join(',')}){${body}}}.${f}`
    : `function ${f}(${params.join(',')}){${body}}`;
  return `function(module,exports,${prefix}args,${prefix}context,${prefix}m,${prefix}M,${prefix}clos,${prefix}frame,${prefix}pushFrame){
    const ${prefix}captures=${JSON.stringify(captures)};
    const ${prefix}locals=${JSON.stringify(localMode)};
    return function(${prefix}parent,${prefix}vars=${prefix}parent&&${prefix}parent.$,${prefix}restoring=false){
    if(!${prefix}restoring){const captured=${prefix}M.capture(${prefix}parent,${prefix}vars,${prefix}captures,${flags});${prefix}parent=captured.parent;${prefix}vars=captured.vars;}
    var ${prefix}x=[${prefix}parent,${prefix}vars,${prefix}m,${callable}];
    ${nonConstructable ? `var ${f}=${prefix}x[3];` : ''}
    Object.defineProperty(${prefix}x[3],"name",{value:${JSON.stringify(name)},configurable:true});
    ${flags & 2 || generatorWrapper ? `Object.defineProperty(${prefix}x[3],"prototype",{value:{},writable:true});` : ''}
    return ${prefix}clos(${prefix}x);};}`;
}

/** A normal module exports a factory; each invocation owns the source module variables. */
export function programFactory(code: string, controlled: boolean, asynchronous = false): string {
  return `"use strict";module.exports=${asynchronous ? 'async ' : ''}function(effects,__bearCapabilities){
    const __tick=__bearCapabilities.tick;
    const __bearOps=effects?.operations ?? __bearCapabilities.operations;
    const globalThis=__bearCapabilities.globals(${controlled ? 'effects.Future,{WeakMap:effects.WeakMap,WeakSet:effects.WeakSet}' : ''});
    const require=name=>{if(name==='effects')return effects;throw Error('Undeclared module '+name);};
    ${controlled ? 'const Promise=effects.Future,WeakMap=effects.WeakMap,WeakSet=effects.WeakSet;' : ''}
    const module={id:'program',exports:{}};let exports=module.exports;
    ${code}
    ${controlled ? 'return {initialize:effects.initialize};' : 'return {get exports(){return module.exports;},set exports(value){module.exports=value;exports=value;}};'}
  };`;
}
