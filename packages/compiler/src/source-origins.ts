import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
import {captureSourceRanges} from './source-metadata.ts';
import {namedReexportBindings} from './module-namespaces.ts';
const t=createRequire(import.meta.url)('@babel/types');
const marker='callableSourceMarker',tag='@bear-callable-source:';
export type SourceOrigins={text:string;ranges:[number,number][];segments:[number,string][];remap:number[];inferredNames?:(string|undefined)[]};

/** Mark callable ownership before the linker can rename or relocate it. The
 * calls are compiler-only syntax and are removed before any program runs. */
export function markCallableOrigins(source:string,filename:string,origins:SourceOrigins,inputSourceMap?:any):string{
  const offset=origins.text.length;origins.text+=source+'\n';origins.segments.push([offset,source]);
  const result=transformSync(source,{
    filename,configFile:false,babelrc:false,sourceType:'module',parserOpts:{tokens:true},comments:false,sourceMaps:'inline',
    inputSourceMap:inputSourceMap??false,
    plugins:[captureSourceRanges,namedReexportBindings,()=>({visitor:{'Function|Class':{exit(path:any){
      const range=path.node.extra?.bearSourceRange;
      if(!range)return;
      const id=origins.ranges.length;origins.ranges.push([offset+range[0],offset+range[1]]);
      (origins.inferredNames??=[])[id]=path.node.extra.bearInferredName;
      const statement=t.expressionStatement(t.callExpression(
        t.memberExpression(t.identifier('__bearOps'),t.identifier(marker)),[t.numericLiteral(id)]));
      if(path.isClass())path.node.body.body.unshift(t.staticBlock([statement]));
      else if(t.isBlockStatement(path.node.body))path.node.body.body.unshift(statement);
      else path.node.body=t.blockStatement([statement,t.returnStatement(path.node.body)]);
    }}}})]
  });
  if(!result?.code)throw Error('Callable source marking produced no code');
  return result.code;
}

/** Asynchronous module reads must not determine artifact identities. */
export function finalizeCallableOrigins(origins:SourceOrigins):void{
  const offsets=new Map<number,number>(),texts=new Map<string,number>();let text='';
  for(const [offset,source]of [...origins.segments].sort((a,b)=>a[1]<b[1]?-1:a[1]>b[1]?1:0)){
    let next=texts.get(source);
    if(next===undefined){next=text.length;texts.set(source,next);text+=source+'\n';}
    offsets.set(offset,next);
  }
  const ranges=origins.ranges.map(([start,end],id)=>{
    const segment=origins.segments.find(([offset,source])=>start>=offset&&end<=offset+source.length);
    if(!segment)throw Error('Callable source range escaped its module');
    const delta=offsets.get(segment[0])!-segment[0];
    return {id,name:origins.inferredNames?.[id],range:[start+delta,end+delta] as [number,number]};
  }).sort((a,b)=>a.range[0]-b.range[0]||a.range[1]-b.range[1]);
  origins.remap=[];origins.ranges=[];origins.inferredNames=[];
  for(const entry of ranges){
    const previous=origins.ranges.at(-1);
    if(!previous||previous[0]!==entry.range[0]||previous[1]!==entry.range[1]){origins.ranges.push(entry.range);origins.inferredNames.push(entry.name);}
    origins.remap[entry.id]=origins.ranges.length-1;
  }
  origins.text=text;origins.segments=[];
}

/** Emit an inert annotation inside the same callable body. Author comments
 * were removed before marking; compiler annotations survive the final print
 * and can be read without relying on generated names or lossy source maps. */
export function materializeCallableOrigins(origins:SourceOrigins){
  return {visitor:{CallExpression(path:any){
    const callee=path.node.callee;
    if(!t.isMemberExpression(callee)||!t.isIdentifier(callee.object,{name:'__bearOps'})||
      !t.isIdentifier(callee.property,{name:marker}))return;
    const id=path.node.arguments[0]?.value;
    if(path.node.arguments.length!==1||!Number.isInteger(id)||origins.remap[id]===undefined||!path.parentPath.isExpressionStatement())
      throw path.buildCodeFrameError('Callable source marker lost its structural owner');
    const statement=t.emptyStatement();t.addComment(statement,'leading',tag+origins.remap[id]);
    path.parentPath.replaceWith(statement);
  }}};
}

export function takeCallableOrigin(path:any,origins:SourceOrigins):[number,number]|undefined{
  const classNode=path.isClass();
  const blocks=classNode?path.node.body.body.filter((node:any)=>t.isStaticBlock(node)):[path.node.body];
  const matches:{block:any;index:number;id:number}[]=[];
  for(const block of blocks)for(const [index,statement]of(Array.isArray(block?.body)?block.body:[]).entries()){
    const id=annotation(statement);
    if(id!==undefined)matches.push({block,index,id});
  }
  if(!matches.length)return;
  if(matches.length!==1)throw path.buildCodeFrameError('Callable has multiple source annotations');
  const {block,index,id}=matches[0]!,range=origins.ranges[id];
  if(!range)throw path.buildCodeFrameError('Callable source annotation has no origin');
  // Babel can attach the same comment object to both this statement and its
  // preceding sibling. Clear the consumed payload on that shared object too.
  for(const comment of block.body[index].leadingComments??[])if(comment.value.startsWith(tag))comment.value='';
  block.body.splice(index,1);
  if(classNode&&block.body.length===0)path.node.body.body.splice(path.node.body.body.indexOf(block),1);
  path.node.extra={...path.node.extra,bearInferredName:origins.inferredNames?.[id]};
  return range;
}

/** An annotation without a callable owner must never silently become linked
 * fallback text. Search after all owners consumed their own direct markers. */
export function assertCallableOriginsConsumed(program:any):void{
  program.traverse({EmptyStatement(path:any){
    if(annotation(path.node)!==undefined)throw path.buildCodeFrameError('Callable source annotation lost its owner');
  }});
}
function annotation(statement:any):number|undefined{
  if(!t.isEmptyStatement(statement))return;
  let result:number|undefined;
  for(const comment of statement.leadingComments??[]){
    if(comment.value.startsWith(tag)){
      const text=comment.value.slice(tag.length);
      if(!/^\d+$/.test(text))throw Error('Malformed callable source annotation');
      if(result!==undefined)throw Error('Multiple callable source annotations on one statement');
      result=Number(text);
    }
  }
  return result;
}
