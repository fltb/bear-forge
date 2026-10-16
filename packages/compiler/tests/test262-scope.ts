import {parseSync} from '@babel/core';
import traverse from '@babel/traverse';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,extname,isAbsolute,relative,resolve} from 'node:path';
import type {Test262Case} from './test262-cases.ts';

/** Independent Test262 scope check for production admission rejections.
 * Inspect the original static module graph, not the compiler's error text or
 * test filename. Script harnesses are intentionally not author modules. */
export async function excludedAuthorFeatures(root:string,candidate:Test262Case):Promise<Set<string>>{
  const base=await realpath(resolve(root,'test'));
  const seen=new Set<string>(),excluded=new Set<string>();
  async function visit(file:string,source?:string):Promise<void>{
    const actual=await realpath(file);
    const suffix=relative(base,actual);
    if(!suffix||suffix==='..'||suffix.startsWith('../')||isAbsolute(suffix))throw Error('Test262 graph escapes test directory');
    if(seen.has(actual))return;
    seen.add(actual);
    const ast=parseSync(source??await readFile(actual,'utf8'),{sourceType:'module',configFile:false,babelrc:false,
      parserOpts:{plugins:['deferredImportEvaluation','sourcePhaseImports']}});
    if(!ast)throw Error('Test262 graph parser produced no AST');
    const imports:string[]=[];
    const dependency=(value:string)=>{
      if(!value.startsWith('./')&&!value.startsWith('../'))return;
      const path=resolve(dirname(actual),value);
      imports.push(extname(path)?path:path+'.js');
    };
    traverse(ast,{
      ImportDeclaration(path){
        if(path.node.phase!=null)excluded.add('module-phase');
        else dependency(path.node.source.value);
      },
      ExportNamedDeclaration(path){if(path.node.source)dependency(path.node.source.value);},
      ExportAllDeclaration(path){dependency(path.node.source.value);},
      ImportExpression(){excluded.add('dynamic-import');},
      ReferencedIdentifier(path){
        if(path.node.name==='eval'&&!path.scope.getBinding('eval'))excluded.add('dynamic-code');
      },
      CallExpression(path){
        if(path.node.callee.type==='Identifier'&&path.node.callee.name==='Function'&&!path.scope.getBinding('Function'))
          excluded.add('dynamic-code');
      },
      NewExpression(path){
        if(path.node.callee.type==='Identifier'&&path.node.callee.name==='Function'&&!path.scope.getBinding('Function'))
          excluded.add('dynamic-code');
      }
    });
    for(const item of imports)await visit(item);
  }
  await visit(resolve(root,candidate.file),candidate.source);
  return excluded;
}
