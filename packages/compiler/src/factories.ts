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
