import {createRequire} from 'node:module';
import {posix} from 'node:path';
import {transformSync} from '@babel/core';
import type {OutputChunk} from 'rollup';
import {rollup} from '../../../vendor/rollup/index.js';
import {evaluateModuleGraph} from './module-evaluation.ts';
import {linkedNames} from './linked-names.ts';
import {materializeCallableOrigins,type SourceOrigins} from './source-origins.ts';
const t=createRequire(import.meta.url)('@babel/types');
type ImportBinding={source:string;name:string|null};
type ModuleFrame={code:string;map:any;imports:ImportBinding[];exports:string[];async:boolean};

/** A lexical activation is instantiated before its body is evaluated. Export
 * readers close over the actual declarations (including TDZ and hoisted
 * functions); imported reads call the resolved reader, never a copied value. */
function frame(chunk:OutputChunk,origins:SourceOrigins,namespaceFiles:Map<number,string>):ModuleFrame{
  const imports:ImportBinding[]=[],exports:string[]=[];let asynchronous=false;
  const result=transformSync(chunk.code,{
    filename:chunk.fileName,sourceType:'module',configFile:false,babelrc:false,sourceMaps:true,
    // The linker's self-namespace reference can lose its import declaration.
    // Restore only references carrying compiler provenance, then require every
    // export to resolve to an actual local binding below.
    parserOpts:{allowUndeclaredExports:true},
    inputSourceMap:JSON.parse(chunk.map!.toString()),
    plugins:[()=>materializeCallableOrigins(origins),()=>linkedNames(JSON.parse(chunk.map!.toString())),()=>({visitor:{Program:{exit(program:any){
      program.scope.crawl();
      const readers:any[]=[],locals:any[]=[],setters:any[]=[];
      program.traverse({
        VariableDeclaration(path:any){if(path.node.kind==='await using'&&!path.scope.getFunctionParent())asynchronous=true;},
        AwaitExpression(path:any){if(!path.scope.getFunctionParent())asynchronous=true;},
        ForOfStatement(path:any){if(path.node.await&&!path.scope.getFunctionParent())asynchronous=true;},
        CallExpression(path:any){
          const callee=path.node.callee;
          if(!t.isMemberExpression(callee)||callee.computed||!t.isIdentifier(callee.object,{name:'__bearOps'}))return;
          if(t.isIdentifier(callee.property,{name:'moduleNamespaceMarker'})){
            const [reference,token]=path.node.arguments;
            if(!t.isIdentifier(reference)||!t.isNumericLiteral(token)||!path.parentPath.isExpressionStatement())
              throw path.buildCodeFrameError('Namespace provenance lost during module framing');
            if(!program.scope.getBinding(reference.name)){
              const filename=namespaceFiles.get(token.value);
              if(filename===undefined)throw path.buildCodeFrameError('Namespace provenance has no linked module');
              let source=posix.relative(posix.dirname(chunk.fileName),filename);
              if(!source.startsWith('.'))source='./'+source;
              program.unshiftContainer('body',t.importDeclaration([t.importNamespaceSpecifier(t.cloneNode(reference))],t.stringLiteral(source)));
              program.scope.crawl();
            }
            path.parentPath.remove();
          }
        }
      });
      const getter=(source:string,name:string|null)=>{
        const id=program.scope.generateUidIdentifier('importReader');
        const parameter=program.scope.generateUidIdentifier('reader');
        imports.push({source,name});
        locals.push(t.variableDeclarator(t.cloneNode(id)));
        setters.push({parameter,statement:t.expressionStatement(t.assignmentExpression('=',t.cloneNode(id),t.cloneNode(parameter)))});
        return ()=>t.callExpression(t.cloneNode(id),[]);
      };
      for(const path of program.get('body'))if(path.isImportDeclaration()){
        for(const specifier of path.node.specifiers){
          const name=t.isImportNamespaceSpecifier(specifier)?null:t.isImportDefaultSpecifier(specifier)?'default':
            t.isIdentifier(specifier.imported)?specifier.imported.name:specifier.imported.value;
          const read=getter(path.node.source.value,name);
          const binding=program.scope.getBinding(specifier.local.name);
          for(const reference of binding.referencePaths){
            if(reference.parentPath.isExportSpecifier())continue;
            reference.replaceWith(read());
          }
          // Export specifiers cannot contain expressions. Resolve them when
          // producing the export readers below, before removing the import.
          binding.bearImportRead=read;
        }
      }
      const body:any[]=[],instantiation:any[]=[];
      for(const path of program.get('body')){
        if(path.isImportDeclaration())continue;
        if(path.isExportNamedDeclaration()){
          if(path.node.declaration)throw path.buildCodeFrameError('Linked export declaration was not normalized');
          for(const specifier of path.node.specifiers){
            if(!t.isExportSpecifier(specifier))throw path.buildCodeFrameError('Linked export specifier was not normalized');
            const name=t.isIdentifier(specifier.exported)?specifier.exported.name:specifier.exported.value;
            const local=specifier.local;
            if(!path.node.source&&!program.scope.getBinding(local.name))throw path.buildCodeFrameError('Linked export has no binding');
            const expression=path.node.source?getter(path.node.source.value,t.isIdentifier(local)?local.name:local.value)():
              program.scope.getBinding(local.name)?.bearImportRead?.()??t.cloneNode(local);
            exports.push(name);readers.push(t.objectProperty(t.stringLiteral(name),t.arrowFunctionExpression([],expression),true));
          }
          continue;
        }
        if(path.isExportDeclaration())throw path.buildCodeFrameError('Linker left unresolved export syntax');
        const expression=path.node.expression;
        if(t.isExpressionStatement(path.node)&&t.isCallExpression(expression)&&
          t.isMemberExpression(expression.callee)&&t.isIdentifier(expression.callee.object,{name:'__bearOps'})&&
          t.isIdentifier(expression.callee.property,{name:'nameFunction'}))instantiation.push(path.node);
        else body.push(path.node);
      }
      const setup=t.objectExpression([
        t.objectProperty(t.identifier('readers'),t.objectExpression(readers)),
        t.objectProperty(t.identifier('connect'),t.arrowFunctionExpression(setters.map(item=>item.parameter),
          t.blockStatement(setters.map(item=>item.statement))))
      ]);
      const activation=t.functionExpression(null,[],t.blockStatement([
        ...(locals.length?[t.variableDeclaration('let',locals)]:[]),...instantiation,
        t.expressionStatement(t.yieldExpression(setup)),...body
      ],[t.directive(t.directiveLiteral('use strict'))]),true,asynchronous);
      program.node.body=[t.exportNamedDeclaration(t.variableDeclaration('const',[
        t.variableDeclarator(t.identifier('frame'),t.callExpression(activation,[]))
      ]))];
    }}}})]
  });
  if(!result?.code)throw Error('Module frame generation produced no code');
  return {code:result.code,map:result.map,imports,exports,async:asynchronous};
}

/** Preserve lexical module boundaries while emitting one self-contained file.
 * The second link combines compiler-created frames, not author module bodies. */
export async function instantiateModules(chunks:OutputChunk[],origins:SourceOrigins,namespaceModules:Map<number,string>){
  const ordered=[...chunks].sort((a,b)=>a.fileName.localeCompare(b.fileName));
  const ids=new Map(ordered.map((chunk,index)=>[chunk.fileName,index]));
  const moduleFiles=new Map(ordered.flatMap(chunk=>chunk.moduleIds.map(id=>[id,chunk.fileName] as const)));
  const namespaceFiles=new Map<number,string>();
  for(const [token,id]of namespaceModules){const file=moduleFiles.get(id);if(file!==undefined)namespaceFiles.set(token,file);}
  const frames=ordered.map(chunk=>frame(chunk,origins,namespaceFiles));
  const entry=ordered.findIndex(chunk=>chunk.isEntry);
  if(entry<0||ordered.filter(chunk=>chunk.isEntry).length!==1)throw Error('Expected one module graph entry');
  const target=(index:number,source:string)=>{
    const id=ids.get(posix.normalize(posix.join(posix.dirname(ordered[index]!.fileName),source)));
    if(id===undefined)throw Error('Module dependency escaped the linked graph: '+source);
    return id;
  };
  const namespaceTargets=new Set<number>([entry]);
  for(const [index,item]of frames.entries())for(const binding of item.imports)if(binding.name===null){
    const id=target(index,binding.source);
    namespaceTargets.add(id);
  }
  const statements=ordered.map((_,id)=>`import {frame as f${id}} from ${JSON.stringify('frame:'+id)};`);
  for(const [id,item]of frames.entries())statements.push(`const m${id}=(${item.async?'await ':''}f${id}.next()).value;`);
  for(const id of namespaceTargets)statements.push(`const n${id}=__bearOps.moduleNamespace(m${id}.readers);`);
  for(const [id,item]of frames.entries()){
    const args=item.imports.map(binding=>{
      const dependency=target(id,binding.source);
      if(binding.name===null)return `()=>n${dependency}`;
      if(!frames[dependency]!.exports.includes(binding.name))throw Error('Linked module has no export '+binding.name);
      return `m${dependency}.readers[${JSON.stringify(binding.name)}]`;
    });
    statements.push(`m${id}.connect(${args.join(',')});`);
  }
  const definitions=ordered.map((chunk,id)=>{
    const dependencies=chunk.imports.map(name=>{const target=ids.get(name);if(target===undefined)throw Error('External dependency in module graph');return target;});
    return `{dependencies:${JSON.stringify(dependencies)},async:${frames[id]!.async},execute:()=>f${id}.next()}`;
  });
  const asynchronous=frames.some(frame=>frame.async);
  statements.push(`${asynchronous?'await ':''}(${evaluateModuleGraph.toString()})([${definitions.join(',')}],${entry}${asynchronous?'':',true'});`);
  statements.push(`module.exports=n${entry};`);
  const bundle=await rollup({input:'graph',treeshake:false,plugins:[{
    name:'instantiated-modules',resolveId(id){return id==='graph'||/^frame:\d+$/.test(id)?id:null;},
    load(id){if(id==='graph')return statements.join('\n');const item=frames[Number(id.slice(6))];if(!item)throw Error('Unknown module frame');return {code:item.code,map:item.map};}
  }]});
  try{
    // The compiler passes maps separately. An inline map would also become part
    // of the generated program's source string and every subsequent AST parse.
    const {output}=await bundle.generate({format:'es',sourcemap:'hidden'});
    const chunks=output.filter(item=>item.type==='chunk');
    if(chunks.length!==1||!chunks[0]?.map)throw Error('Module graph emission produced multiple outputs');
    return {code:chunks[0].code,map:JSON.parse(chunks[0].map.toString())};
  }finally{await bundle.close();}
}
