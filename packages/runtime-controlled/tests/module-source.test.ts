import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '@bear-forge/runtime-native';
import {ProgramExecution,decode} from '../src/execution.ts';

test('prelink callable text survives module collisions, methods, classes, IO, forks and restoration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-callable-origins-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ES2023',module:'NodeNext',skipLibCheck:true},include:['*.mjs','*.cjs']}));
    await writeFile(join(root,'a.mjs'),`
      export function same (value = 1) { /* origin-comment-A */ return value + 1; }
      export const arrow = value=>value+2;
      export function nested(value){return ()=>()=>value;}
      export function labelled(){outer: inner: while(true){break inner;}return 1;}
      let keys=0;
      const key=()=>{keys++;return 'item';};
      export const object={ [key()](value=1){return value;}, get value(){return keys;}, set value(next){keys=next;} };
      export class Base { method(){return keys;} static /* static prefix */ get value(){return keys;} }
      export class Child extends Base { constructor(){super();} method(){return super.method();} }
      export class Implicit extends Base {}
    `);
    await writeFile(join(root,'b.mjs'),`export function same(value=3){ /* origin-comment-B */ return value+4; } export class Base { static self(){return Base;} }`);
    await writeFile(join(root,'common.mjs'),`export class Box { method(){return 5;} } export function fn(){return 6;}`);
    await writeFile(join(root,'default-function.mjs'),`export default function (value=1){ /* anonymous default */ return value+8; }`);
    await writeFile(join(root,'default-class.mjs'),`export default class { static initialName=this.name; method(){return 9;} }`);
    await writeFile(join(root,'name-method.mjs'),`export default class { static ['name'](){return 10;} static seen=this.name(); }`);
    await writeFile(join(root,'name-getter.mjs'),`export default class { static get name(){return 'getter';} static seen=this.name; }`);
    await writeFile(join(root,'name-field.mjs'),`export default class { static before=this.name; static name='field'; static after=this.name; }`);
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`
      import {same as first,arrow,nested,labelled,object,Base,Child,Implicit} from './a.mjs';
      import {same as second,Base as OtherBase} from './b.mjs';
      import * as common from './common.mjs';
      import DefaultFunction from './default-function.mjs';
      import DefaultClass from './default-class.mjs';
      import NameMethod from './name-method.mjs';
      import NameGetter from './name-getter.mjs';
      import NameField from './name-field.mjs';
      const schema={parse(value){return value;}};
      export const program={schemas:{setup:schema,result:schema,ports:{step:{input:schema,output:schema}}},async run(_,io){
        const descriptor=Object.getOwnPropertyDescriptor(object,'value');
        const functions=[first,second,arrow,nested,nested(4),nested(4)(),DefaultFunction,DefaultClass,DefaultClass.prototype.method,labelled,common.fn,common.Box,common.Box.prototype.method,object.item,descriptor.get,descriptor.set,Base,Base.prototype.method,
          Object.getOwnPropertyDescriptor(Base,'value').get,Child,Child.prototype.method,Implicit,OtherBase,OtherBase.self];
        const before=object.value;
        if(OtherBase.self()!==OtherBase)throw Error('Class self binding changed');
        object.value=await io.call({port:'step',input:null});
        return {before,className:DefaultClass.initialName,classOverrides:[NameMethod.seen,NameMethod.name(),NameGetter.seen,NameGetter.name,NameField.before,NameField.after,NameField.name],values:[first(),second(),arrow(3),labelled(),new common.Box().method(),object.item(),new Child().method()],
          functions:functions.map(fn=>[fn.name,fn.toString(),String(fn)])};
      }};
    `);
    const reference=(await import(pathToFileURL(entry).href)).program;
    const referenceObject=(await import(pathToFileURL(join(root,'a.mjs')).href)).object;
    const controlled=decode((await compileEntry(entry)).content),native=await compileNativeEntry(entry);
    const parent=new ProgramExecution(controlled);parent.start(null);
    assert.equal(parent.result.status,0,String(parent.result.value));
    const snapshot=parent.snapshot();assert.equal(snapshot.includes('origin-comment-A'),false);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
    assert.equal(parent.loaded.statistics.initializations,1);
    for(const [index,instance]of[parent,fork,restored].entries()){
      referenceObject.value=1;
      const reply=index+7;
      const expected=await reference.run(null,{call:async()=>reply});
      instance.resume(reply);assert.equal(instance.result.status,1,String(instance.result.value));
      assert.deepEqual(instance.result.value,expected);
      assert.deepEqual(await (await nativeProgram(native)).run(null,{call:async()=>reply} as never),expected);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
