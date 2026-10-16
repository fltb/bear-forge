import {createRequire} from 'node:module';
import {guardedOperations} from '../../compiler/src/operations.ts';
const require=createRequire(import.meta.url);
const {transformSync}=require('@babel/core'),t=require('@babel/types');

/** Only test infrastructure is Script input. Keep its global declarations,
 * directives and assertions, but route object observations through Context.
 * This is not author Script admission or continuation compilation. */
export function harnessSource(source:string):string {
  const loops=()=>({visitor:{ForInStatement(path:any){
    path.replaceWith(t.forOfStatement(path.node.left,t.callExpression(
      t.memberExpression(t.identifier('__bearOps'),t.identifier('harnessKeys')),[path.node.right]),path.node.body));
  }}});
  return transformSync(source,{sourceType:'script',babelrc:false,configFile:false,
    plugins:[loops,[guardedOperations,{script:true}]]}).code;
}

export function harnessOperations(operations:any,global:any) {
  // fnGlobalObject and other infrastructure may use dynamic Function. Author
  // modules still pass their unchanged admission and runtime checks.
  const dynamic=global.Function;
  return {...operations,
    invoke(fn:any,receiver:any,args:any[]){
      return fn===dynamic?Reflect.apply(fn,receiver,args):operations.invoke(fn,receiver,args);
    },
    construct(fn:any,args:any[],newTarget=fn){
      return fn===dynamic?Reflect.construct(fn,args,newTarget):operations.construct(fn,args,newTarget);
    },
    *harnessKeys(value:any){
      for(const key of operations.forInKeys(value))if(operations.has(key,Object(value)))yield key;
    },
  };
}
