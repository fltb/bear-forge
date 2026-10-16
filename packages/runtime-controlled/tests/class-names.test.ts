import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeProgram} from '@bear-forge/runtime-native';
import {compileNativeEntry,compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution,decode} from '../src/execution.ts';

const cases:Record<string,string>={
  'anonymous classes outside named evaluation':`return [
    (function(){return class {};})().name,
    [class {}][0].name,(true?class {}:class {}).name,
    (()=>{let object={};object.value=class{};return object.value.name;})()
  ];`,
  'destructuring default class keeps constructor identity':`let [value=class{}]=[];return value.name;`,
  'computed object key names class before static initialization':`
    let calls=0;const key={ [Symbol.toPrimitive](){calls++;return Symbol.for('class-key');} };
    const object={[key]:class{static initial=this.name;}};
    const value=object[Symbol.for('class-key')];return [calls,value.name,value.initial];`,
  'anonymous return class exposes empty name during static initialization':`
    const value=(()=>class{static initial=this.name;})();return [value.name,value.initial];`,
  'field initializers keep each class evaluation computed key':`
    function make(key){return class{[key]=class{static initial=this.name;};};}
    const First=make('first'),Second=make(Symbol.for('second'));
    const a=new First().first,b=new Second()[Symbol.for('second')];return [a.name,a.initial,b.name,b.initial];`,
  'computed field names belong to repeated class evaluations in a loop condition':`
    const classes=[];let index=0;
    while(index<3&&(classes.push(class{[index++]=class{static initial=this.name;};}),true)){}
    await io.call({port:'step',input:null});
    return classes.map(Type=>{const value=new Type(),key=Object.keys(value)[0];return [key,value[key].name,value[key].initial];});`,
  'computed fields retain their own key through later class evaluations and IO':`
    const classes=[];
    for(let index=0;index<3;index++)classes.push(class{[Symbol.for('field'+index)]=class{static initial=this.name;};});
    await io.call({port:'step',input:null});
    return classes.map(Type=>{const value=new Type(),key=Object.getOwnPropertySymbols(value)[0];return [key.description,value[key].name,value[key].initial];});`,
  'ordinary computed field keys use the same per-evaluation allocation':`
    const classes=[];let index=0;
    while(index<3&&(classes.push(class{[index++]=7;}),true)){}
    await io.call({port:'step',input:null});
    return classes.map(Type=>{const value=new Type();return Object.entries(value);});`,
  'named classes and authored static names retain precedence':`
    const object={key:class Explicit{static initial=this.name;}},value=class {static name(){return 7;}static initial=this.name();};
    return [object.key.name,object.key.initial,value.name(),value.initial];`
};
for(const [name,body]of Object.entries(cases))test(name,async()=>{
  const source=`async function run(_,io){await io.call({port:'step',input:null});${body}}`;
  const reference=Function(`"use strict";return (${source});`)();
  const expected=await reference(null,{call:async()=>null});
  const parent=new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},run:${source}};`).content));
  parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
  const saved=parent.snapshot(),restored=parent.fresh();restored.restore(saved);
  const executions=[parent,parent.fork(),restored];
  for(const execution of executions){
    execution.resume(null);
    if(execution.result.status===0){
      const saved=execution.snapshot(),restored=execution.fresh();restored.restore(saved);
      executions.push(execution.fork(),restored);
      while(execution.result.status===0)execution.resume(null);
    }
    assert.equal(execution.result.status,1,String(execution.result.value));
    assert.deepEqual(execution.result.value,expected);
  }
});


test('native production compiler preserves the same class naming and initialization rules',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-class-names-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ES2023',module:'NodeNext',skipLibCheck:true},include:['*.mjs']}));
    const source=`async function run(_,io){const cases=[${Object.values(cases).map(body=>`async function(io){${body}}`).join(',')}];
      const results=[];for(const example of cases)results.push(await example(io));return results;}`;
    const reference=Function(`"use strict";return (${source});`)();
    const expected=await reference(null,{call:async()=>null});
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`const schema={parse(value){return value;}};
      export const program={schemas:{setup:schema,result:schema,ports:{step:{input:schema,output:schema}}},run:${source}};`);
    const artifact=await compileNativeEntry(entry);
    assert.deepEqual(await (await nativeProgram(artifact)).run(null,{call:async()=>null} as any),expected);
  }finally{await rm(root,{recursive:true,force:true});}
});
