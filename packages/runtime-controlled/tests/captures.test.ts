import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

function start(body: string, setup = 0) {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){${body}}};`).content);
  const execution = new ProgramExecution(artifact);
  execution.start(setup);
  return { artifact, execution };
}

test('escaping closures retain shared cells but not completed frames or unrelated local data', () => {
  const { artifact, execution } = start(`
    function make(){
      const unrelated={marker:'unrelated-local-must-not-be-captured',data:new Array(10000).fill(8)};
      let count=setup;
      return {inc:()=>++count,read:()=>count};
    }
    const pair=make();
    const amount=await io.call({port:'step',input:pair.read()});
    for(let i=0;i<amount;i++)pair.inc();
    return pair.read();
  `, 3);
  const snapshot = execution.snapshot();
  assert.doesNotMatch(snapshot, /unrelated-local-must-not-be-captured/);
  const branch = execution.fork(), restored = new ProgramExecution(artifact);
  restored.restore(snapshot);
  execution.resume(2); branch.resume(4); restored.resume(6);
  assert.equal(execution.result.value, 5);
  assert.equal(branch.result.value, 7);
  assert.equal(restored.result.value, 9);
});

test('nested closure construction propagates ancestor capture needs and per-iteration identity', () => {
  const { execution } = start(`
    let count=setup;
    function outer(){return function middle(){return ()=>++count;};}
    const factory=outer();
    const functions=[];
    for(let i=0;i<3;i++)functions.push(()=>i+count);
    await io.call({port:'step',input:count});
    const inc=factory();inc();
    return [functions.map(f=>f()),count];
  `, 2);
  const branch=execution.fork();
  for (const instance of [execution,branch]) {
    instance.resume(null);
    assert.deepEqual(instance.result.value, [[3,4,5],3]);
  }
});

test('captured bindings support reassignment, mutual recursion and lexical this across restore', () => {
  const { execution } = start(`
    let shared={value:1};
    const object={value:5,make(){return ()=>this.value+shared.value;}};
    const read=object.make();
    function even(n){return n===0||odd(n-1);}
    function odd(n){return n!==0&&even(n-1);}
    shared={value:3};
    const reply=await io.call({port:'step',input:read()});
    object.value=reply;
    return [read(),even(12),odd(11)];
  `);
  const branch=execution.fork();
  execution.resume(10);branch.resume(20);
  assert.deepEqual(execution.result.value,[13,true,true]);
  assert.deepEqual(branch.result.value,[23,true,true]);
});

test('an uncaptured module object is not reachable through a run closure', () => {
  const artifact=decode(compileJavaScript(`
    const unrelated={marker:'unrelated-module-must-not-be-captured',data:new Array(10000).fill(8)};
    let count=0;
    export const program={schemas:{},async run(n,io){count++;await io.call({port:'step',input:count});return count;}};
  `).content);
  const execution=new ProgramExecution(artifact);execution.start(0);
  assert.doesNotMatch(execution.snapshot(), /unrelated-module-must-not-be-captured/);
  const branch=execution.fork();branch.resume(null);
  assert.equal(branch.result.value,1);
});

test('in-memory forks do not invoke the persistence encoder or decoder', () => {
  const { execution } = start('const n=await io.call({port:"step",input:setup});return n+setup;', 3);
  const serializer=execution.loaded.effects.S;
  const write=serializer.write,read=serializer.read;
  try {
    serializer.write=serializer.read=()=>{throw Error('fork called persistence codec');};
    const child=execution.fork();
    child.resume(9);execution.resume(2);
    assert.equal(child.result.value,12);
    assert.equal(execution.result.value,5);
  } finally { serializer.write=write;serializer.read=read; }
});

test('fork copies property descriptors, array holes, collection aliases and bound constructors', () => {
  const { execution } = start(`
    class Counter { constructor(value){this.value=value;} add(n){this.value+=n;} }
    const Bound=Counter.bind(null,setup);
    const item=new Bound();
    const sparse=[,item];
    const table=new Map([[item,sparse]]),set=new Set([item]);
    Object.defineProperty(item,'hidden',{value:sparse,enumerable:false,writable:false});
    const response=await io.call({port:'step',input:setup});
    item.add(response);
    const descriptor=Object.getOwnPropertyDescriptor(item,'hidden');
    return [item.value,0 in sparse,table.get(item)===sparse,set.has(item),descriptor.value===sparse,descriptor.writable];
  `, 3);
  const child=execution.fork();
  execution.resume(2);child.resume(7);
  assert.deepEqual(execution.result.value,[5,false,true,true,true,false]);
  assert.deepEqual(child.result.value,[10,false,true,true,true,false]);
  const saved=child.snapshot();
  assert.ok(saved.length>0);
});

test('catch and nested block captures survive scope exit, fork and persistence independently', () => {
  const { artifact, execution } = start(`
    const reads=[];
    let total=setup;
    for(let i=0;i<3;i++){
      try { throw {value:i+1}; }
      catch(error){
        const offset=i*10;
        if(i!==1){let local=offset;reads.push(n=>[error.value,++local,total+=n]);}
        else {let local=offset;reads.push(n=>[error.value,--local,total+=n]);}
      }
    }
    const reply=await io.call({port:'step',input:total});
    return reads.map(read=>read(reply));
  `, 5);
  const restored=new ProgramExecution(artifact);restored.restore(execution.snapshot());
  const branch=execution.fork();
  for(const [instance,reply]of [[execution,1],[branch,2],[restored,3]] as const){
    instance.resume(reply);
    assert.deepEqual(instance.result.value,[[1,1,5+reply],[2,9,5+2*reply],[3,21,5+3*reply]]);
  }
});

test('rest parameters captured by an escaping arrow survive fork and restore', () => {
  const { artifact, execution } = start(`
    function make(...values){return ()=>values[0];}
    const read=make({count:setup});
    const reply=await io.call({port:'step',input:setup});
    read().count+=reply;
    return read().count;
  `, 5);
  const restored=new ProgramExecution(artifact);restored.restore(execution.snapshot());
  const branch=execution.fork();
  execution.resume(1);branch.resume(2);restored.resume(3);
  assert.equal(execution.result.value,6);
  assert.equal(branch.result.value,7);
  assert.equal(restored.result.value,8);
});

test('await drops dead local payloads while preserving live aliases and closure cells', () => {
  const { artifact, execution }=start(`
    const temporary={marker:'dead-active-frame-payload',values:new Array(10000).fill(1)};
    let counter=setup;
    const read=()=>++counter;
    const live={value:temporary.values.length};
    const alias=live;
    await io.call({port:'step',input:temporary.values.length});
    return [read(),read(),live===alias,alias.value];
  `, 4);
  const saved=execution.snapshot();
  assert.doesNotMatch(saved,/dead-active-frame-payload/);
  const restored=new ProgramExecution(artifact);restored.restore(saved);
  for(const instance of [execution,execution.fork(),restored]){
    instance.resume(null);
    assert.deepEqual(instance.result.value,[5,6,true,10000]);
  }
});

test('await liveness keeps values needed by a backward loop edge and a finally handler', () => {
  for(const body of [
    `let total=0;let i=0;const payload={value:setup};while(i<3){total+=payload.value;await io.call({port:'step',input:total});i++;}return total;`,
    `const payload={value:setup};try{await io.call({port:'step',input:0});return payload.value;}finally{await io.call({port:'step',input:payload.value});}`
  ]){
    const {artifact,execution}=start(body,7);
    let current=execution;
    for(let i=0;i<3 && !current.result.status;i++){
      const restored=new ProgramExecution(artifact);restored.restore(current.snapshot());
      current=restored.fork();current.resume(null);
    }
    assert.equal(current.result.value,body.includes('while')?21:7);
  }
});

test('fork reads collection and RegExp internals without executing overridden accessors', () => {
  const { execution }=start(`
    const item={value:setup},map=new Map([['key',item]]),set=new Set([item]);
    let effects=0;
    map[Symbol.iterator]=()=>{effects++;return [][Symbol.iterator]();};
    set[Symbol.iterator]=()=>{effects++;return [][Symbol.iterator]();};
    const expression=/abc/gy;
    expression.lastIndex=2;
    Object.defineProperty(expression,'source',{get:()=>{effects++;return 'changed';}});
    Object.defineProperty(expression,'global',{get:()=>{effects++;return false;}});
    const reply=await io.call({port:'step',input:setup});
    item.value+=reply;
    return [effects,map.get('key')===item,set.has(item),item.value,expression.lastIndex,expression.test('xxabc')];
  `,4);
  const branch=execution.fork();
  execution.resume(1);branch.resume(3);
  assert.deepEqual(execution.result.value,[0,true,true,5,2,true]);
  assert.deepEqual(branch.result.value,[0,true,true,7,2,true]);
});

test('graph copying preserves shared byte storage without reading user constructor or buffer accessors', () => {
  const { execution }=start(`await io.call({port:'step',input:0});return 0;`);
  const {ArrayBuffer: BufferConstructor,Uint8Array: BytesConstructor,DataView: ViewConstructor}=execution.loaded.effects.globals;
  const buffer=new BufferConstructor(12),bytes=new BytesConstructor(buffer,2,4),view=new ViewConstructor(buffer,1,7);
  bytes[0]=17;
  let called=0;
  for(const name of ['constructor','buffer','byteOffset','length'])Object.defineProperty(bytes,name,{configurable:true,get(){called++;throw Error('copy invoked accessor');}});
  // Host getters are registered only for this internal copier test; game source
  // receives no additional capability or admission exception.
  const {S,prepareCopy}=execution.loaded.effects;
  for(const [name,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(bytes))){
    if(descriptor.get)S.regOpaqueObject(descriptor.get,'test.bytes.'+name,{props:false});
  }
  const copied=prepareCopy(Object.assign(execution.loaded.record(),{buffer,bytes,view}),[])();
  assert.equal(called,0);
  assert.notStrictEqual(copied.buffer,buffer);
  assert.equal(copied.bytes[0],17);
  copied.view.setUint8(1,23);
  assert.equal(copied.bytes[0],23);
  assert.equal(new Uint8Array(copied.buffer)[2],23);
  assert.equal(bytes[0],17);
});

test('bound function properties retain aliases and mutations across fork and persistence', () => {
  const {artifact,execution}=start(`
    function add(n){return setup+n;}
    const bound=add.bind(null,2),data={count:3};
    bound.data=data;bound.self=bound;
    Object.defineProperty(bound,'name',{value:'renamedBound',configurable:true});
    Object.defineProperty(add,'name',{value:'renamedAdd',configurable:true});
    Object.defineProperty(bound,'length',{value:8,configurable:true});
    const reply=await io.call({port:'step',input:0});
    bound.data.count+=reply;
    return [bound(),data.count,bound.self===bound,bound.name,add.name,bound.length];
  `,4);
  const restored=new ProgramExecution(artifact);restored.restore(execution.snapshot());
  const child=execution.fork();
  execution.resume(1);child.resume(2);restored.resume(3);
  assert.deepEqual(execution.result.value,[6,4,true,'renamedBound','renamedAdd',8]);
  assert.deepEqual(child.result.value,[6,5,true,'renamedBound','renamedAdd',8]);
  assert.deepEqual(restored.result.value,[6,6,true,'renamedBound','renamedAdd',8]);
});

test('unreachable async tasks are not snapshot roots while IO-linked frames remain restorable', () => {
  const make = (live: boolean) => decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    async function task(size){const payload=Array(size).fill('payload-owned-by-task');
      const reply=await ${live ? "io.call({port:'step',input:null})" : 'new Promise(()=>{})'};
      return payload.length+reply;
    }
    ${live ? 'return await task(n);' : "task(n);return await io.call({port:'step',input:null});"}
  }};`).content);
  for (const live of [false,true]) {
    const parent = new ProgramExecution(make(live)); parent.start(10000);
    assert.equal(parent.result.status,0,String(parent.result.value));
    const snapshot = parent.snapshot();
    assert.equal(snapshot.includes('payload-owned-by-task'),live);
    const restored = parent.fresh(); restored.restore(snapshot);
    for (const [index, current] of [parent,parent.fork(),restored].entries()) {
      current.resume(index+2);
      assert.equal(current.result.status,1,String(current.result.value));
      assert.equal(current.result.value,(live?10000:0)+index+2);
    }
  }
});

test('async frames reached through a retained resolver survive without a scheduler frame registry', () => {
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    let resolve;
    const gate=new Promise(callback=>{resolve=callback;});
    async function task(){const payload=Array(n).fill('retained-through-resolver');const value=await gate;return payload.length+value;}
    const pending=task();
    const reply=await io.call({port:'step',input:null});resolve(reply);return await pending;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(1000);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot();assert.ok(snapshot.includes('retained-through-resolver'));
  const restored=parent.fresh();restored.restore(snapshot);
  for(const [index,current]of [parent,parent.fork(),restored].entries()){
    current.resume(index+2);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.equal(current.result.value,1002+index);
  }
});

test('completed inline iteration releases tables and cursor temporaries before later IO', () => {
  const {artifact, execution} = start(`
    let total=0;
    for(let i=0;i<setup;i++){
      const table=new Map([[i,'completed-inline-iteration-payload']]);
      for(const [key]of table)total+=key;
    }
    return total+await io.call({port:'step',input:total});
  `,1000);
  const snapshot=execution.snapshot();
  assert.doesNotMatch(snapshot,/completed-inline-iteration-payload/);
  const branch=execution.fork(),restored=new ProgramExecution(artifact);
  restored.restore(snapshot);
  execution.resume(1);branch.resume(2);restored.resume(3);
  assert.equal(execution.result.value,499501);
  assert.equal(branch.result.value,499502);
  assert.equal(restored.result.value,499503);
});

test('await liveness retains rejection-only reads and closures used by catch or finally', () => {
  for(const cleanup of ['catch(error){return held.value+error;}','finally{return held.value+reader();}']){
    const {artifact,execution}=start(`
      const held={value:setup}, captured={value:20};
      const reader=()=>captured.value;
      async function fail(){const reply=await io.call({port:'step',input:null});throw reply;}
      try{await fail();return 0;}${cleanup}
    `,10);
    const branch=execution.fork(),restored=new ProgramExecution(artifact);
    restored.restore(execution.snapshot());
    execution.resume(1);branch.resume(2);restored.resume(3);
    const values=[execution,branch,restored].map(x=>x.result.value);
    assert.deepEqual(values,cleanup.startsWith('catch')?[11,12,13]:[30,30,30]);
    for(const instance of [execution,branch,restored])assert.equal(instance.result.status,1);
  }
});

test('common lexical ancestors share projection containers within each independent Context', () => {
  const {execution} = start(`await io.call({port:'step',input:null});return 0;`);
  execution.loaded.enter((execution as any).context, () => {
    const effects = execution.loaded.effects;
    const ancestor = effects.scope([null, 1]);
    const left = effects.scope([ancestor, 10]), right = effects.scope([ancestor, 20]);
    const a = effects.capture(null, left, [[0,1],[1]], 0).vars;
    const b = effects.capture(null, right, [[0,1],[1]], 0).vars;
    const c = effects.capture(null, left, [[0,1]], 0).vars;
    assert.notStrictEqual(a, b);
    assert.strictEqual(a[0], b[0]);
    assert.strictEqual(a[0], c[0]);
    assert.strictEqual(a[0][1], ancestor[1]);
    assert.notStrictEqual(a[1], b[1]);
    const root = Object.assign(execution.loaded.record(), {a,b,c});
    const plan = effects.prepareCopy(root);
    const copies = [plan(),plan(),effects.S.read(effects.S.write(root))];
    for (const [index, copy] of copies.entries()) {
      assert.strictEqual(copy.a[0], copy.b[0]);
      assert.strictEqual(copy.a[0], copy.c[0]);
      assert.notStrictEqual(copy.a[0], a[0]);
      copy.a[0][1].value = index + 2;
      copy.a[1].value += index;
      assert.equal(copy.b[0][1].value, index + 2);
      assert.equal(copy.c[0][1].value, index + 2);
      assert.equal(copy.b[1].value, 20);
    }
    assert.equal(ancestor[1].value, 1);
    assert.equal(left[1].value, 10);
    copies.forEach((copy: any,index: number) => assert.equal(copy.a[0][1].value,index+2));
  });
  execution.dispose();
});

test('flat local values and captured ancestor cells remain isolated across repeated IO forks and restore', () => {
  const { artifact, execution } = start(`
    let ancestor=setup;
    async function leaf(value){
      let local=value+1;
      const alias={value:local};
      const first=await io.call({port:'step',input:local+ancestor});
      local+=first;ancestor+=first;alias.value=local;
      const second=await io.call({port:'step',input:alias.value+ancestor});
      return local+alias.value+ancestor+second;
    }
    return await leaf(10);
  `, 3);
  const restored=new ProgramExecution(artifact);
  restored.restore(execution.snapshot());
  const branches=[execution,execution.fork(),restored];
  try {
    for(const [index,branch] of branches.entries()) {
      branch.resume(index+1);
      assert.equal(branch.result.status,0);
      const child=branch.fork(), recovered=new ProgramExecution(artifact);
      recovered.restore(branch.snapshot());
      try {
        branch.resume(10);child.resume(20);recovered.resume(30);
        const base=25+3*(index+1);
        assert.equal(branch.result.status,1);
        assert.equal(child.result.status,1);
        assert.equal(recovered.result.status,1);
        assert.equal(branch.result.value,base+10);
        assert.equal(child.result.value,base+20);
        assert.equal(recovered.result.value,base+30);
      } finally { child.dispose();recovered.dispose(); }
    }
  } finally { for(const branch of branches)branch.dispose(); }
});

test('flat synchronous locals stay transient while returned async work retains branch-local captures',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    let ancestor=setup;
    async function pending(value){
      ancestor+=await io.call({port:'step',input:value});
      return value+ancestor+await io.call({port:'step',input:ancestor});
    }
    function leaf(value){let local=value+1;ancestor+=2;return pending(local);}
    return await leaf(setup);
  }};`).content);
  const parent=new ProgramExecution(artifact),context=(parent as any).context;
  const state=parent.loaded.effects.State.context;
  const create=state.createFrame,frames:any[]=[];
  state.createFrame=(fields:any,transient:boolean)=>{const frame=create(fields,transient);frames.push(frame);return frame;};
  try {parent.start(3);} finally {state.createFrame=create;}
  assert.equal(parent.result.status,0);
  parent.loaded.enter(context,()=>{
    const leaf=frames.find(frame=>parent.loaded.read(frame.func,'name')==='leaf');
    const pending=frames.find(frame=>parent.loaded.read(frame.func,'name')==='pending');
    assert.ok(leaf&&pending);
    assert.ok(Object.hasOwn(leaf,'flags'),'synchronous control fields are transient');
    assert.equal(Object.hasOwn(pending,'flags'),false,'async control fields remain in Context');
    assert.equal(typeof Object.getOwnPropertyDescriptor(leaf.$,'1')?.get,'undefined');
    assert.equal(typeof Object.getOwnPropertyDescriptor(pending.$,'1')?.get,'function');
  });
  const restored=parent.fresh();restored.restore(parent.snapshot());
  const instances=[parent,parent.fork(),restored];
  try {
    for(const [index,instance] of instances.entries()){
      instance.resume(index+1);assert.equal(instance.result.status,0);
      instance.resume(10);assert.equal(instance.result.status,1);
      assert.equal(instance.result.value,20+index);
    }
  } finally {for(const instance of instances)instance.dispose();}
});

test('escaping strict arguments keep independent parameter values, brand and descriptors across copies',()=>{
  const {artifact,execution}=start(`
    function make(value){const saved=arguments;value=99;return saved;}
    const args=make(3);
    const reply=await io.call({port:'step',input:args[0]});
    let poison=false;try{args.callee;}catch(error){poison=error instanceof TypeError;}
    args[0]=reply;
    return [args[0],args.length,Object.prototype.toString.call(args),poison,
      Object.getOwnPropertyDescriptor(args,'callee').configurable,Array.from(args)[0]];
  `);
  assert.equal(execution.io.callData.input,3);
  const restored=new ProgramExecution(artifact);restored.restore(execution.snapshot());
  const instances=[execution,execution.fork(),restored];
  try {for(const [index,instance] of instances.entries()){
    instance.resume(index+7);assert.equal(instance.result.status,1,instance.message(instance.result.value));
    assert.deepEqual(instance.result.value,[index+7,1,'[object Arguments]',true,false,index+7]);
  }} finally {for(const instance of instances)instance.dispose();}
});

test('strict arguments codecs and copy plans preserve cycles, aliases and nonwritable indices',()=>{
  const {execution}=start(`
    function make(value){const saved=arguments;value=99;saved.self=saved;
      Object.defineProperty(saved,'0',{value:4,writable:false});return saved;}
    const args=make(3);return {args,alias:args};
  `);
  const context=(execution as any).context;
  execution.loaded.enter(context,()=>{
    const effects=execution.loaded.effects,ops=effects.operations,read=(value:any,key:string)=>execution.loaded.read(value,key);
    const root=effects.stateOf(context.result).value;
    for(const copied of [effects.prepareCopy(root)(),effects.S.read(effects.S.write(root))]){
      const args=read(copied,'args');
      assert.strictEqual(args,read(copied,'alias'));assert.strictEqual(args,read(args,'self'));
      assert.equal(read(args,'0'),4);assert.equal(read(args,'length'),1);
      assert.equal(ops.invoke(effects.globals.Object.prototype.toString,args,[]),'[object Arguments]');
      assert.equal(execution.loaded.inspection.getOwnPropertyDescriptor(args,'0')?.writable,false);
      assert.throws(()=>read(args,'callee'),/TypeError|callee|caller|arguments/);
    }
  });
  execution.dispose();
});

test('flat functions keep uncaptured local values direct beside escaping captured cells',()=>{
  const names=Array.from({length:64},(_,index)=>`local${index}`);
  const declarations=names.map((name,index)=>`const ${name}=setup+${index};`).join('');
  const artifact=decode(compileJavaScript(`async function mixed(setup,io){
    let captured=setup;${declarations}
    function read(){return captured;}
    captured+=await io.call({port:'step',input:read()});
    return [read(),${names.join('+')}];
  }
  export const program={schemas:{},async run(setup,io){return await mixed(setup,io);}};`).content);
  const parent=new ProgramExecution(artifact),state=parent.loaded.effects.State.context;
  const create=state.createFrame,frames:any[]=[];
  state.createFrame=(fields:any,transient:boolean)=>{const frame=create(fields,transient);frames.push(frame);return frame;};
  try{parent.start(3);}finally{state.createFrame=create;}
  assert.equal(parent.result.status,0,String(parent.result.value));
  parent.loaded.enter((parent as any).context,()=>{
    const frame=frames.find(frame=>parent.loaded.read(frame.func,'name')==='mixed');
    assert.ok(frame);
    const values=Object.values(frame.$);
    assert.ok(values.filter(value=>typeof value==='number').length>=64,
      'uncaptured locals occupy direct slots instead of individual variable cells');
  });
  const restored=parent.fresh();restored.restore(parent.snapshot());
  const executions=[parent,parent.fork(),restored];
  try{
    for(const [index,current]of executions.entries()){
      current.resume(index+1);
      assert.equal(current.result.status,1,String(current.result.value));
      assert.deepEqual(current.result.value,[4+index,64*3+63*64/2]);
    }
  }finally{for(const current of executions)current.dispose();}
});

test('grouped loop temporaries do not escape with per-iteration captured bindings',()=>{
  const {execution}=start(`
    function make(){
      const callbacks=[];let total=0;
      for(let i=0;i<3;i++){
        let captured=i;
        const unrelated={marker:'grouped-loop-payload-must-not-escape',data:new Array(1000).fill(i)};
        total+=unrelated.data.length;
        callbacks.push({read:()=>i+captured,add:value=>captured+=value});
      }
      return {callbacks,total};
    }
    const saved=make();
    const reply=await io.call({port:'step',input:saved.total});
    return [saved.total,saved.callbacks.map(pair=>{pair.add(reply);return pair.read();})];
  `);
  assert.equal(execution.result.status,0,String(execution.result.value));
  const snapshot=execution.snapshot();
  assert.doesNotMatch(snapshot,/grouped-loop-payload-must-not-escape/);
  const restored=execution.fresh();restored.restore(snapshot);
  const instances=[execution,execution.fork(),restored];
  try{
    for(const [index,current]of instances.entries()){
      current.resume(index+1);
      assert.equal(current.result.status,1,String(current.result.value));
      assert.deepEqual(current.result.value,[3000,[index+1,index+3,index+5]]);
    }
  }finally{for(const current of instances)current.dispose();}
});

test('synchronous loop scopes and exception frames finish while escaped async captures stay branch-local',()=>{
  const artifact=decode(compileJavaScript(`
    async function task(read,io){
      const reply=await io.call({port:'step',input:null});
      const first=read(reply);
      const second=await io.call({port:'step',input:first});
      return [first,read(second)];
    }
    function launch(seed,io){
      let shared=seed;const callbacks=[];
      for(let i=0;i<3;i++){
        let value=i;
        callbacks.push(delta=>{value+=delta;shared++;return value+shared;});
      }
      try{throw new Error('caught');}catch{shared+=2;}finally{shared++;}
      return task(delta=>callbacks.map(fn=>fn(delta)),io);
    }
    export const program={schemas:{},async run(setup,io){return await launch(setup,io);}};`).content);
  const parent=new ProgramExecution(artifact),state=parent.loaded.effects.State.context;
  const create=state.createFrame,frames:any[]=[];
  state.createFrame=(fields:any,transient:boolean)=>{const frame=create(fields,transient);frames.push(frame);return frame;};
  try{parent.start(10);}finally{state.createFrame=create;}
  assert.equal(parent.result.status,0,String(parent.result.value));
  parent.loaded.enter((parent as any).context,()=>{
    const launch=frames.find(frame=>parent.loaded.read(frame.func,'name')==='launch');
    const task=frames.find(frame=>parent.loaded.read(frame.func,'name')==='task');
    assert.ok(launch&&task);
    assert.equal(Object.hasOwn(launch,'flags'),true);
    assert.equal(Object.hasOwn(task,'flags'),false);
    assert.equal(typeof Object.getOwnPropertyDescriptor(launch.$,'0')?.get,'undefined');
  });
  const restored=parent.fresh();restored.restore(parent.snapshot());
  const instances=[parent,parent.fork(),restored];
  try{
    for(const [index,current]of instances.entries()){
      current.resume(index+1);assert.equal(current.result.status,0,String(current.result.value));
      const branch=current.fork();
      try{
        current.resume(10);branch.resume(20);
        assert.equal(current.result.status,1,String(current.result.value));
        assert.deepEqual(current.result.value,[[15+index,17+index,19+index],[28+index,30+index,32+index]]);
        assert.equal(branch.result.status,1,String(branch.result.value));
        assert.deepEqual(branch.result.value,[[15+index,17+index,19+index],[38+index,40+index,42+index]]);
      }finally{branch.dispose();}
    }
  }finally{for(const current of instances)current.dispose();}
});
