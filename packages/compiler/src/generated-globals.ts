import {createRequire} from 'node:module';
const t=createRequire(import.meta.url)('@babel/types');

/** Author globals were lowered before module linking. Generated helpers may
 * use language intrinsics, but obtain them from the runtime capability table
 * instead of resolving free names against Node's global object. */
const helperIntrinsics=new Set([
  'Object','Array','Number','String','Boolean','BigInt','Symbol','JSON',
  'Map','Set','WeakMap','WeakSet','Reflect','RegExp','Math','Promise',
  'Error','TypeError','ReferenceError','RangeError','SyntaxError',
  'EvalError','URIError','AggregateError','SuppressedError',
  'ArrayBuffer','DataView','Int8Array','Uint8Array','Uint8ClampedArray',
  'Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array',
  'Float64Array','BigInt64Array','BigUint64Array'
]);
const privateFactoryNames=new Set([
  'effects','__bearOps','__tick','__bearCapabilities','globalThis',
  'require','module','exports','undefined'
]);

export function generatedGlobals(controlled:boolean, extra:readonly string[]=[]){
  const allowed=new Set([...privateFactoryNames,...extra,
    ...(controlled?['Promise','WeakMap','WeakSet']:[])]);
  return {visitor:{Program:{exit(path:any){
    // Previous passes insert bindings after Babel's first scope crawl.
    path.scope.crawl();
    path.traverse({ReferencedIdentifier(reference:any){
      const name=reference.node.name;
      // A free `arguments` at module scope would read the private factory's
      // arguments, including runtime capabilities. Only a lexical function's
      // own arguments object is part of the generated program.
      if(name==='arguments'){
        let owner=reference.getFunctionParent();
        while(owner?.isArrowFunctionExpression())owner=owner.getFunctionParent();
        if(owner)return;
      }
      if(reference.scope.getBinding(name)||allowed.has(name))return;
      if(helperIntrinsics.has(name)){
        reference.replaceWith(t.memberExpression(
          t.memberExpression(t.identifier('__bearCapabilities'),t.identifier('intrinsics')),
          t.identifier(name)));
        return;
      }
      throw reference.buildCodeFrameError('Generated host-global reference '+name);
    }});
  }}}};
}
