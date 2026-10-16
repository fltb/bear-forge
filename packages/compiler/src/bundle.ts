import {dataModules} from './data-modules.ts';
import {validateModuleLink,isNativeModuleLinkError,type LinkModule} from './module-link.ts';
import {markDependencyResolutionError} from './module-resolution.ts';
import {importWrites} from './import-writes.ts';
import {ambientBindings} from './ambient-bindings.ts';
import {moduleMeta} from './module-meta.ts';
import {pathToFileURL} from 'node:url';
import {markCallableOrigins, materializeCallableOrigins, finalizeCallableOrigins, type SourceOrigins} from './source-origins.ts';
import { access, readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import { rollup } from '../../../vendor/rollup/index.js';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { admitSource,isAuthorParseError } from './admission.ts';
import { markModuleNamespaces, materializeModuleNamespaces,defaultExportBindings,namedReexportBindings } from './module-namespaces.ts';
import { linkedNames } from './linked-names.ts';
import { normalizeLabels } from './labels.ts';
import { instantiateModules } from './module-instantiation.ts';
const require = createRequire(import.meta.url);

/** Preserve lexical declarations across module linking. Admission sees original
 * source for every loaded module, before any plugin can erase a capability. */
export async function bundleProgram(entry: string, source?: string) {
  const input = source === undefined ? await realpath(entry) : resolve(entry);
  let hasTopLevelAwait = false, hasModuleResources = false;
  const origins:SourceOrigins={text:'',ranges:[],segments:[],remap:[]};
  const markers: {source:string; importer:string; attributes?:Record<string,string>}[]=[];
  const namespaceModules = new Map<number,string>();
  const propertyPositions = new Map<string,Set<number>>();
  const nativeSources=new Map<string,LinkModule>();
  const deferredMissingExports:string[]=[];
  const sourceFiles=new Map<string,string>();
  const recordSource=(path:string,content:Uint8Array)=>{
    sourceFiles.set(resolve(path),createHash('sha256').update(content).digest('hex'));
  };
  const sourceManifest=async()=>{
    for(const path of [...sourceFiles.keys()]){
      for(let parent=dirname(path);;parent=dirname(parent)){
        const manifest=join(parent,'package.json');
        if(!sourceFiles.has(manifest)){
          try{await access(manifest);recordSource(manifest,await readFile(manifest));}
          catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        }
        if(dirname(parent)===parent)break;
      }
    }
    return [...sourceFiles].sort(([a],[b])=>a.localeCompare(b));
  };
  let validateNative:(()=>Promise<void>)|undefined;
  const build = () => rollup({
    input,
    treeshake: false,
    onwarn(warning) {
      // Namespace conflicts omit ambiguous star exports. Missing property reads
      // evaluate to undefined, but missing named imports must reject even when
      // unused (Rollup emits a warning for those too). Match the diagnostic's
      // position to the parsed member property, never its message or source name.
      // Rollup preserves ESM top-level this by lowering it to undefined.
      // Its informational diagnostic is not a missing capability.
      if (warning.code === 'THIS_IS_UNDEFINED') return;
      // Preserved chunks are module records for our SCC evaluator, not chunks
      // that Rollup schedules for execution. Cyclic reexports remain linked.
      if (warning.code === 'CYCLIC_CROSS_CHUNK_REEXPORT' && (hasTopLevelAwait || hasModuleResources)) return;
      if (warning.code === 'CIRCULAR_DEPENDENCY' || warning.code === 'NAMESPACE_CONFLICT') return;
      if(warning.code==='MISSING_EXPORT' && warning.id && typeof warning.pos==='number' &&
        propertyPositions.get(warning.id)?.has(warning.pos))return;
      // V8's module linker is the phase/exception oracle. Rollup reports
      // missing exports as a generic warning before that linker runs.
      if(warning.code==='MISSING_EXPORT'){
        deferredMissingExports.push(warning.message);
        return;
      }
      throw new Error(warning.message);
    },
    plugins: [
      dataModules(id=>nativeSources.set(id,{id,exports:['default'],json:true}),recordSource),
      nodeResolve({ extensions: ['.mjs', '.js', '.json', '.ts', '.mts'], preferBuiltins: false }),
      {
        name: 'admitted-source',
        moduleParsed(info) {
          const positions=new Set<number>(),pending:any[]=[info.ast];
          while(pending.length){
            const node=pending.pop();
            if(!node||typeof node!=='object')continue;
            if(node.type==='MemberExpression'&&typeof node.property?.start==='number')positions.add(node.property.start);
            for(const value of Object.values(node)){
              if(Array.isArray(value))pending.push(...value);
              else if(value&&typeof value==='object'&&'type' in value)pending.push(value);
            }
          }
          propertyPositions.set(info.id,positions);
        },
        async buildEnd(error) {
          const record=async(id:string):Promise<LinkModule>=>{
            const original=nativeSources.get(id);
            if(!original)throw Error('Native module linking lost admitted source: '+id);
            return original;
          };
          validateNative=async()=>validateModuleLink(await record(input),async request=>{
            const resolution=await this.resolve(request.specifier,request.importer,{skipSelf:false,attributes:request.attributes});
            if(!resolution||resolution.external)throw Error('Native module linking left the admitted graph');
            return record(resolution.id);
          });
          if(error)return;
          for(const [index,marker] of markers.entries()){
            const resolution=await this.resolve(marker.source,marker.importer,{skipSelf:false,attributes:marker.attributes??{}});
            if(!resolution||resolution.external)throw new Error('Namespace import did not resolve to admitted source');
            namespaceModules.set(index,resolution.id);
          }
        },
        resolveId(id) { return source !== undefined && id === input ? id : null; },
        async load(id) {
          const content = id === input && source !== undefined ? undefined : await readFile(id);
          if(content)recordSource(id,content);
          const text = content ? content.toString('utf8') : source!;
          if (/\.json$/.test(id)) {
            throw new TypeError('JSON imports require type: json');
          }
          let admission:ReturnType<typeof admitSource>;
          try{admission=admitSource(text,id);}
          catch(error){
            if(id!==input&&isAuthorParseError(error))markDependencyResolutionError(error);
            throw error;
          }
          hasTopLevelAwait ||= admission.hasTopLevelAwait;
          hasModuleResources ||= admission.hasModuleResources;
          const result = transformSync(text, {
            filename: id, sourceType: 'module', configFile: false, babelrc: false, sourceMaps: true, comments: false, inputSourceMap: false,
            plugins: [[require('@babel/plugin-transform-typescript'), { onlyRemoveTypeImports: true }],namedReexportBindings],
          });
          if (typeof result?.code !== 'string') throw new Error('Source preparation produced no code');
          const original=/\.(?:m?tsx?)$/.test(id)?result.code:text;
          nativeSources.set(id,{id,source:original});
          const originated=normalizeLabels(markCallableOrigins(original,id,origins,/\.(?:m?tsx?)$/.test(id)?result.map:undefined),id);
          const ambient=transformSync(originated,{
            filename:id,configFile:false,babelrc:false,sourceMaps:true,sourceType:'module',
            plugins:[ambientBindings],
          });
          if(typeof ambient?.code!=='string')throw Error('Global binding adaptation produced no code');
          const marked=transformSync(ambient.code,{
            filename:id,configFile:false,babelrc:false,sourceMaps:true,sourceType:'module',
            ...(ambient.map ? {inputSourceMap:ambient.map as any} : {}),
            plugins:[defaultExportBindings,importWrites,()=>moduleMeta(pathToFileURL(id).href),()=>markModuleNamespaces((source,attributes)=>{const token=markers.length;markers.push({source,importer:id,attributes});return token;})],
          })!;
          return {code:marked.code!,map:marked.map ? JSON.stringify(marked.map) : undefined};
        },
      },
    ],
  });
  let bundle:Awaited<ReturnType<typeof build>>;
  try{bundle=await build();}
  catch(error){
    // Rollup can reject linking during build, before the ordinary native-link
    // step below. If the admitted graph is complete, let V8 report its own
    // link failure and exception class for the author's original modules.
    if(validateNative){
      try{await validateNative();}
      catch(linkError){if(isNativeModuleLinkError(linkError))throw linkError;}
    }
    throw error;
  }
  try {
    if(!validateNative)throw Error('Module graph did not register native link validation');
    await validateNative();
    if(deferredMissingExports.length)throw Error(deferredMissingExports[0]);
    const { output } = await bundle.generate({ format: 'es', sourcemap: 'inline', preserveModules:hasTopLevelAwait||hasModuleResources,
      ...((hasTopLevelAwait||hasModuleResources)?{dir:dirname(input),sourcemapPathTransform:(source:string,map:string)=>resolve(dirname(map),source)}:{}) });
    if(hasTopLevelAwait||hasModuleResources){
      if(output.some(item=>item.type!=='chunk'||!item.map))throw Error('Expected self-contained module graph');
      finalizeCallableOrigins(origins);
      const result=await instantiateModules(output as import('rollup').OutputChunk[],origins,namespaceModules);
      return {...result,origins,hasTopLevelAwait,sourceFiles:await sourceManifest()};
    }
    if (output.length !== 1 || output[0]?.type !== 'chunk' || !output[0].map) throw new Error('Expected one self-contained program');
    // Direct CJS rendering can replace exported bindings with object properties,
    // losing TDZ in cyclic imports. Link first, then retain the resulting local
    // declarations while adapting only the final module's exports.
    finalizeCallableOrigins(origins);
    const result = transformSync(output[0].code, {
      filename: input, sourceType: 'module', configFile: false, babelrc: false, sourceMaps: true,
      inputSourceMap: JSON.parse(output[0].map.toString()),
      plugins: [() => materializeCallableOrigins(origins), materializeModuleNamespaces, () => linkedNames(JSON.parse(output[0].map!.toString())), require('@babel/plugin-transform-modules-commonjs')],
    });
    if (typeof result?.code !== 'string') throw new Error('Module adaptation produced no code');
    return { code: result.code, map: result.map, origins, hasTopLevelAwait,sourceFiles:await sourceManifest() };
  } finally { await bundle.close(); }
}
