/** Static closure factories for EffectfulJS v2. Upstream constructs these with
 * Function at registration time; ours emits them into the compilation artifact. */
export function factorySource(name: string, callee: string | null, params: string[], vars: number, flags: number, prefix: string): string {
  const functionName = /^[a-zA-Z_$][\w$]*$/.test(name) && !params.includes(name) ? name : prefix + name.replace(/\W/g, '_');
  const f = functionName || prefix + 'anonymous';
  const values = [`${prefix}.$`, ...(callee ? [f] : []), ...params];
  while (values.length < vars) values.push('void 0');
  const head = [`${prefix}.$=[${values.join(',')}];`];
  if (flags & 8) head.push(`${prefix}.self=${flags & 4 ? prefix + 'parent.self' : 'this'};`);
  if (flags & 16) head.push(`${prefix}.args=${flags & 4 ? prefix + 'parent.args' : `${prefix}args(${prefix},arguments)`};`);
  return `function(module,exports,${prefix}args,${prefix}context,${prefix}m,${prefix}M,${prefix}clos,${prefix}frame,${prefix}pushFrame){
    return function(${prefix}parent,${prefix}vars=${prefix}parent&&${prefix}parent.$){var ${prefix}x=[${prefix}parent,${prefix}vars,${prefix}m,function ${f}(${params.join(',')}){
    ${flags & 256 ? '' : '"use strict";'} var ${prefix}=${prefix}frame(${prefix}x,new.target); ${head.join('')}
    ${flags & 2 ? `return ${prefix}.iter;` : `try{${prefix}pushFrame(${prefix},${f});return ${prefix}.meta.handler(${prefix},${prefix}.$,null);}catch(e){return ${prefix}M.handle(${prefix},e);}`}
    }];return ${prefix}clos(${prefix}x);};}`;
}

/** A normal module exports a factory; each invocation owns the source module variables. */
export function programFactory(code: string, controlled: boolean): string {
  return `"use strict";module.exports=function(effects,__bearCapabilities){
    const __tick=__bearCapabilities.tick, Math=__bearCapabilities.Math;
    const globalThis={__zod_globalConfig:{jitless:true}};
    const require=name=>{if(name==='effects')return effects;throw Error('Undeclared module '+name);};
    const Function=__bearCapabilities.Function;
    const Date=__bearCapabilities.unavailable;
    const setTimeout=Date,clearTimeout=Date,setInterval=Date,clearInterval=Date,setImmediate=Date,clearImmediate=Date,queueMicrotask=Date;
    ${controlled ? 'const Promise=effects.Future;' : ''}
    const module={id:'program',exports:{}};let exports=module.exports;
    ${code}
    return {get exports(){return module.exports;},set exports(value){module.exports=value;exports=value;}};
  };`;
}
