/** Source-level work counters for performance.ts. Not a timing benchmark.
 * Hooks only add counters; the loaded Program, defaults and game path stay the
 * same. Counters start after assembly and cover one fresh full trajectory. */
import {registerHooks} from 'node:module';
import {parse} from '@babel/parser';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,source,revision} from './reference/build.ts';

type Site={file:string;line:number;column:number;kind:string;name:string};
type Ast={type:string;start:number;end:number;loc?:{start:{line:number;column:number}};[key:string]:any};
export function installWorkCounters(){
  const sites:Site[]=[],counts:number[][]=[[],[],[]];let phase=-1;
  const hit=(id:number)=>{if(phase>=0)counts[phase]![id]=(counts[phase]![id]??0)+1;};
  const key=Symbol.for('sts.performance.work-counts');
  (globalThis as any)[key]=hit;
  const add=(site:Site)=>{const id=sites.length;sites.push(site);return `__stsWorkHit(${id})`;};
  registerHooks({load(url,context,next){
    const loaded=next(url,context);
    if(!url.startsWith('file:'))return loaded;
    const file=relative(root,fileURLToPath(url));
    if(!/^(packages\/[^/]+|examples\/sts)\/src\/.*\.ts$/.test(file)||!loaded.source)return loaded;
    let code=String(loaded.source);
    if(code.includes('__stsWorkHit'))throw Error('Diagnostic identifier collision: '+file);
    const edits:{at:number;text:string;order:number}[]=[];let order=0;
    const insert=(at:number,text:string)=>edits.push({at,text,order:order++});
    const ast=parse(code,{sourceType:'module',plugins:['typescript']}) as unknown as Ast;
    function walk(node:Ast,parent:Ast|null,scope:string){
      if(!node||typeof node.type!=='string')return;
      const line=node.loc?.start.line??0,column=node.loc?.start.column??0;
      const functionNode=/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod)$/.test(node.type)&&node.body;
      let name=scope;
      if(functionNode){
        const local=node.id?.name??node.key?.name??node.key?.value??parent?.id?.name??parent?.key?.name??'<callback>';
        name=scope?scope+'/'+local:String(local);
        const call=add({file,line,column,kind:'function',name});
        if(node.body.type==='BlockStatement')insert(node.body.directives?.at(-1)?.end??node.body.start+1,call+';');
        else {insert(node.body.start,'('+call+',(');insert(node.body.end,'))');}
      }else if(node.type==='ClassDeclaration')name=scope?scope+'/'+node.id.name:node.id.name;
      if(/^(ForStatement|ForOfStatement|ForInStatement|WhileStatement|DoWhileStatement)$/.test(node.type)){
        const call=add({file,line,column,kind:'loop',name:scope});
        if(node.body.type==='BlockStatement')insert(node.body.start+1,call+';');
        else {insert(node.body.start,'{'+call+';');insert(node.body.end,'}');}
      }
      // Count actual newly constructed copy containers separately from visits,
      // primitive returns and successful sharing. No source traversal is itself
      // labelled a copy.
      if(node.type==='VariableDeclarator'&&node.init&&['target','out','twin','output'].includes(node.id?.name)&&
        /\/(rules-values|values|publication|graph)\.ts$/.test(file)&&
        /^(ConditionalExpression|TSAsExpression|ObjectExpression|ArrayExpression|NewExpression|CallExpression)$/.test(node.init.type)){
        const snippet=code.slice(node.init.start,node.init.end);
        if(/new Array|Object\.create|\{\}/.test(snippet)){
          const call=add({file,line,column,kind:'copy-container',name:scope+'/'+node.id.name});
          insert(node.init.start,'('+call+',(');insert(node.init.end,'))');
        }
      }
      for(const [key,value] of Object.entries(node)){
        if(['loc','start','end','extra','comments','tokens'].includes(key))continue;
        if(Array.isArray(value))for(const child of value){if(child&&typeof child.type==='string')walk(child,node,name);}
        else if(value&&typeof value==='object'&&typeof value.type==='string')walk(value,node,name);
      }
    }
    walk(ast,null,'');
    // Every executed Core instruction, including requests and control flow.
    if(file==='packages/card-engine/src/card.ts'){
      const anchor='block.run[frame.index]!(this, frame);',at=code.indexOf(anchor);
      if(at<0||code.indexOf(anchor,at+1)>=0)throw Error('Missing unique Core instruction site');
      insert(at,add({file,line:code.slice(0,at).split('\n').length,column:0,kind:'instruction',name:'Execution.step'})+';');
    }
    edits.sort((a,b)=>b.at-a.at||b.order-a.order);
    for(const edit of edits)code=code.slice(0,edit.at)+edit.text+code.slice(edit.at);
    return{...loaded,source:'const __stsWorkHit = globalThis[Symbol.for("sts.performance.work-counts")];\n'+code};
  }});
  return{
    phase(value:'initialize'|'play'|'close'){phase=['initialize','play','close'].indexOf(value);},
    begin(){for(const values of counts)values.fill(0);phase=0;},
    finish(){phase=-1;return sites.map((site,id)=>({...site,n:counts.reduce((sum,values)=>sum+(values[id]??0),0),phases:counts.map(values=>values[id]??0)})).filter(site=>site.n>0);},
  };
}

/** Coverage counters include inline reference functions as well as out-of-line
 * functions. Temporary build/profile files are removed, including on failure. */
export async function countReferenceWork(fixture:string){
  const exec=promisify(execFile),directory=await mkdtemp(resolve(tmpdir(),'sts-work-counts-'));
  try{
    if((await exec('git',['rev-parse','HEAD'],{cwd:source})).stdout.trim()!==revision)throw Error('Reference revision changed');
    await exec('git',['diff','--exit-code','HEAD','--','src','include'],{cwd:source});
    if((await exec('git',['ls-files','--others','--exclude-standard','--','src','include'],{cwd:source})).stdout.trim())throw Error('Untracked reference rules');
    async function sources(path:string):Promise<string[]>{return(await Promise.all((await readdir(path,{withFileTypes:true})).map(e=>e.isDirectory()?sources(resolve(path,e.name)):[resolve(path,e.name)]))).flat();}
    const input=[...(await sources(resolve(source,'src'))).filter(f=>f.endsWith('.cpp')).sort(),fileURLToPath(new URL('./reference/raw-benchmark.cpp',import.meta.url))];
    const objects=input.map((_,i)=>resolve(directory,i+'.o')),compiler=process.env.CXX??'clang++';
    const flags=['-std=c++17','-O2','-ffp-contract=off','-fprofile-instr-generate','-fcoverage-mapping','-DSTS_COUNT_WORK','-Wno-header-guard','-Wno-shift-count-overflow','-Wno-switch','-I'+resolve(source,'include'),'-I'+resolve(source,'json/include')];
    let position=0;
    await Promise.all(Array.from({length:3},async()=>{for(;;){const index=position++;if(index>=input.length)return;await exec(compiler,[...flags,'-c',input[index]!,'-o',objects[index]!],{maxBuffer:4*1024*1024});}}));
    const binary=resolve(directory,'counts'),raw=resolve(directory,'counts.profraw'),profile=resolve(directory,'counts.profdata');
    await exec(compiler,['-fprofile-instr-generate',...objects,'-o',binary]);
    const completed=JSON.parse((await exec(binary,[fixture],{env:{...process.env,LLVM_PROFILE_FILE:raw}})).stdout);
    await exec('xcrun',['llvm-profdata','merge','-sparse',raw,'-o',profile]);
    const coverage=JSON.parse((await exec('xcrun',['llvm-cov','export',binary,'-instr-profile='+profile],{maxBuffer:128*1024*1024})).stdout);
    const functions=coverage.data.flatMap((unit:any)=>unit.functions).filter((f:any)=>f.count>0&&f.filenames.some((p:string)=>p.startsWith(source+'/src/')||p.startsWith(source+'/include/')));
    const names:string[]=[];
    for(let i=0;i<functions.length;i+=200)names.push(...(await exec('c++filt',functions.slice(i,i+200).map((f:any)=>f.name),{maxBuffer:8*1024*1024})).stdout.trim().split('\n'));
    return{...completed,reference:revision,functions:functions.map((f:any,i:number)=>({name:names[i],n:f.count,files:f.filenames.map((p:string)=>relative(source,p)),regions:f.regions}))};
  }finally{await rm(directory,{recursive:true,force:true});}
}
