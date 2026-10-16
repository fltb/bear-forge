import {parseSync} from '@babel/core';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),t=require('@babel/types'),generate=require('@babel/generator').generate;
import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {extname} from 'node:path';
import {resolve} from 'import-meta-resolve';
import type {Plugin} from 'rollup';
import {AuthorAdmissionError} from './admission.ts';
import {markDependencyResolutionError} from './module-resolution.ts';

type DataModule={source:string;type:'json'};
/** Import attributes select a data interpretation, never an executable source
 * bypass. Identity includes both the resolved resource and its module type. */
export function dataModules(register?:(id:string)=>void, registerSource?:(path:string,content:Uint8Array)=>void):Plugin{
  const modules=new Map<string,DataModule>();
  return {
    name:'static-data-modules',
    resolveId:{order:'pre',async handler(source,importer,options){
      if(modules.has(source))return source;
      const attributes=options.attributes;
      if(!Object.keys(attributes).length)return null;
      if(Object.keys(attributes).some(key=>key!=='type'))throw new AuthorAdmissionError('Unsupported import attribute');
      const type=attributes.type;
      if(type!=='json')throw new AuthorAdmissionError('Unsupported data module type: '+type);
      if(!importer||importer.includes('\0'))throw new AuthorAdmissionError('Data module requires a local importer');
      // Resolve a resource without asking executable-module plugins to load it.
      const resolved=new URL(resolve(source,pathToFileURL(importer).href));
      if(resolved.protocol!=='file:')throw new AuthorAdmissionError('Data module must resolve to a local resource');
      if(extname(fileURLToPath(resolved))!=='.json')throw new AuthorAdmissionError('JSON import requires a .json resource');
      const id='\0bear-data:'+JSON.stringify([resolved.href,type]);
      modules.set(id,{source:fileURLToPath(resolved),type});
      register?.(id);
      return {id,attributes:{},moduleSideEffects:true};
    }},
    async transform(code,id){
      if(modules.has(id))return null;
      const ast=parseSync(code,{filename:id,configFile:false,babelrc:false,sourceType:'module'});
      const requests:any[]=[];
      t.traverseFast(ast,(node:any)=>{
        if((t.isImportDeclaration(node)||t.isExportNamedDeclaration(node)||t.isExportAllDeclaration(node))&&node.source&&node.attributes?.length)
          requests.push(node);
      });
      if(!requests.length)return null;
      // Rollup keys requests by specifier alone. Resolve the full typed request
      // before linking so different interpretations never collide or lose type.
      for(const request of requests){
        const attributes=Object.fromEntries(request.attributes.map((item:any)=>[item.key.name??item.key.value,item.value.value])) as Record<string,string>;
        const resolved=await this.resolve(request.source.value,id,{attributes,skipSelf:false});
        if(!resolved||!modules.has(resolved.id))throw new AuthorAdmissionError('Attributed import did not resolve to an admitted data module');
        request.source=t.stringLiteral(resolved.id);request.attributes=[];
      }
      const output=generate(ast,{sourceMaps:true,sourceFileName:id},code);
      return {code:output.code,map:output.map};
    },
    async load(id){
      const module=modules.get(id);if(!module)return null;
      const content=await readFile(module.source);
      registerSource?.(module.source,content);
      const text=content.toString('utf8').replace(/^\uFEFF/,'');
      try{JSON.parse(text);}
      catch(error){
        if(error instanceof SyntaxError)markDependencyResolutionError(error);
        throw error;
      }
      return `export default JSON.parse(${JSON.stringify(text)});`;
    }
  };
}
