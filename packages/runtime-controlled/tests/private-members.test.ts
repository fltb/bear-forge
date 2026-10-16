import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileJavaScript,compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProgramExecution,decode} from '../src/execution.ts';

async function compare(body:string){
  const source=`async function run(_,io){'use strict';${body}}`;
  const native=Function(`"use strict";return (${source});`)();
  const directory=await mkdtemp(join(tmpdir(),'bear-private-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`export const program={schemas:{setup:{parse:value=>value},result:{parse:value=>value},ports:{}},run:${source}};`);
    const nativeArtifact=await compileNativeEntry(entry);
    const linked=await compileEntry(entry);
    for(const artifact of [compileJavaScript(`export const program={schemas:{setup:{parse:value=>value},result:{parse:value=>value},ports:{}},run:${source}};`),linked]){
      const parent=new ProgramExecution(decode(artifact.content));
      const instances=[parent];
      try{
        parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
        const branch=parent.fork(),restored=parent.fresh();instances.push(branch,restored);
        restored.restore(parent.snapshot());
        for(const [i,instance]of instances.entries()){
          const expected=await native(null,{call:async()=>i+2});
          const nativeCompiled=await nativeProgram(nativeArtifact);
          assert.deepEqual(await nativeCompiled.run(null,{call:async()=>i+2} as any),expected);
          instance.resume(i+2);assert.equal(instance.result.status,1,String(instance.result.value));
          assert.deepEqual(instance.result.value,expected);
        }
      }finally{for(const instance of instances)instance.dispose();}
    }
  }finally{await rm(directory,{recursive:true,force:true});}
}

test('class static blocks retain initialization order, separate scopes, private state and super across recovery',async()=>{
  await compare(`
    const trace=[];
    class Base{static read(){return 4;}}
    class Counter extends Base{
      static first=(trace.push('field'),1);
      static #state={n:1};
      static{
        var local=2;let hidden=3;
        trace.push('first block');
        this.firstScope=()=>local;
        this.step=n=>{hidden+=n;this.#state.n+=n;return [hidden,this.#state.n,super.read()];};
      }
      static second=(trace.push('second field'),2);
      static{var local=7;trace.push('second block');this.secondScope=()=>local;}
    }
    const reply=await io.call({port:'step',input:null});
    return [trace,Counter.firstScope(),Counter.secondScope(),Counter.step(reply),Counter.first,Counter.second];
  `);
});

test('private fields, methods, accessors and brands retain aliases and branch isolation',async()=>{
  await compare(`
    class Counter {
      #state={n:1}; static #total=10;
      #increment(n){this.#state.n+=n;Counter.#total+=n;return this.#state;}
      get #value(){return this.#state.n;}set #value(n){this.#state.n=n;}
      update(n){this.#value++;return this.#increment(n);}
      state(){return this.#state;}value(){return this.#value;}static total(){return Counter.#total;}
      static has(o){return [#state in o,#increment in o,#value in o];}
    }
    const a=new Counter(),alias=a.state(),b=new Counter();
    const reply=await io.call({port:'step',input:a.value()});
    const changed=a.update(reply);
    const errors=[];for(const value of [{},Object.create(Counter.prototype)]){
      try{Counter.prototype.value.call(value);}catch(e){errors.push(e.name);}
    }
    try{Counter.has(1);}catch(e){errors.push(e.name);}
    return [a.value(),b.value(),alias.n,changed===alias,Counter.total(),Counter.has(a),Counter.has({}),Reflect.ownKeys(a),errors];
  `);
});

test('private callable reflection preserves names, source and nonconstructibility',async()=>{
  await compare(`
    class Methods {
      #method(){return this;}static #static(){return this;}
      read(){return this.#method;}static read(){return this.#static;}
    }
    const value=new Methods(),method=value.read(),staticMethod=Methods.read();
    await io.call({port:'step',input:null});
    const errors=[];for(const fn of [method,staticMethod]){try{new fn();}catch(e){errors.push(e.name);}}
    return [method.name,staticMethod.name,method.toString(),staticMethod.toString(),
      method.call(value)===value,staticMethod.call(Methods)===Methods,errors];
  `);
});


test('private brands are fresh per class evaluation and static methods exist during field initialization',async()=>{
  await compare(`
    const classes=[];
    for(let i=0;i<3;i++){if(i>=0){classes.push(class {
      #value=i;
      static initial=this.#read();
      static #read(){return i;}
      #readValue(){return i;}
      method(){return this.#readValue();}
      static has(o){return #value in o;}
      value(){return this.#value;}
    });}}
    const a=new classes[0](),b=new classes[1]();
    class Outer {
      #nested=class {read(){return 3;}};
      get(){return new this.#nested().read();}
    }
    const outer=new Outer();
    await io.call({port:'step',input:null});
    return [classes.map(C=>[C.has(a),C.has(b),C.initial]),a.value(),b.value(),a.method(),b.method(),outer.get()];
  `);
});

for(const loop of ['while((EXPR,i++<2)){}','do{}while((EXPR,i++<2));'])test(`private storage follows class evaluation in ${loop}`,async()=>{
  await compare(`
    const classes=[];let i=0;
    ${loop.replace('EXPR','classes.push(class {#x=i;static has(o){return #x in o;}get(){return this.#x;}})')}
    const values=classes.map(C=>new C());
    await io.call({port:'step',input:null});
    return classes.map(C=>values.map(value=>C.has(value)));
  `);
});
