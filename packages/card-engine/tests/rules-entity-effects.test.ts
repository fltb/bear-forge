import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,linkRules,CardMachine,CardProgram,plainCardStorage} from '../src/index.ts';
import {portEffect} from '../src/rules-internal.ts';
import type {Effect} from '../src/rules.types.ts';
const {defineRules,defineEffect,defineEntity,defineComponent,sequence,call,spawnEntity,entityEffect,definitionOf,updateLocalComponent,readComponent,despawnEntity}=rules;
const choose=portEffect<number,number>('choose');
const module=defineRules({requires:[],build(m){return{exports:{kind:m.kind({config:z.object({play:z.custom<Effect<number,number>>()}),components:[]})}};}});
const counter=defineComponent({schema:z.number(),initial:()=>0});
const plusOne=defineEffect<number,number>(b=>b.return(b.read(v=>v.input+1)));
const plusFive=defineEffect<number,number>(b=>b.return(b.read(v=>v.input+5)));
const one=defineEntity(module.exports.kind,{play:plusOne}),five=defineEntity(module.exports.kind,{play:plusFive});
const schemas={setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}};
function run(entry:Effect<number,number>){const d=linkRules({id:'entity-effects',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[module]});const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(7)));}

test('a common caller selects typed card code from entity definitions without names or callbacks in state',()=>{
  const entry=defineEffect<number,number>(b=>{const a=b.local<number>(),c=b.local<number>(),x=b.local<number>(),y=b.local<number>();return sequence(
    b.assign(a,spawnEntity({definition:one,owner:null,scope:0})),b.assign(c,spawnEntity({definition:five,owner:null,scope:0})),
    b.assign(x,call(entityEffect(module.exports.kind,a,c=>c.play),b.input)),b.assign(y,call(entityEffect(module.exports.kind,c,c=>c.play),b.input)),b.return(b.read(v=>v.get(x)*100+v.get(y))),
  );});
  assert.deepEqual(run(entry).advance(),{kind:'done',result:812});
});

test('a selected effect reference remains data in a local across a request and restores with the same target',()=>{
  const entry=defineEffect<number,number>(b=>{const entity=b.local<number>(),selected=b.local<Effect<number,number>>(),result=b.local<number>();return sequence(
    b.assign(entity,spawnEntity({definition:five,owner:null,scope:0})),b.assign(selected,entityEffect(module.exports.kind,entity,c=>c.play)),call(choose,1),
    b.assign(result,call(selected,b.input)),b.return(result),
  );});
  const parent=run(entry);assert.equal(parent.advance().kind,'call');
  const restored=new CardMachine(parent.program,plainCardStorage(structuredClone(parent.root)));
  assert.deepEqual(parent.advance(0),{kind:'done',result:12});assert.deepEqual(restored.advance(3),{kind:'done',result:12});
});

test('entity-selected code establishes its source for private hooks and rejects a departed source',()=>{
  const effect=defineEffect<number,number>(b=>sequence(updateLocalComponent(b.input,counter,n=>n+1),b.return(readComponent(b.input,counter))));
  const definition=defineEntity(module.exports.kind,{play:effect},{components:[counter]});
  const entry=defineEffect<number,number>(b=>{const entity=b.local<number>(),result=b.local<number>();return sequence(
    b.assign(entity,spawnEntity({definition,owner:null,scope:0})),b.assign(result,call(entityEffect(module.exports.kind,entity,c=>c.play),entity)),b.return(result),
  );});
  assert.deepEqual(run(entry).advance(),{kind:'done',result:1});
  const stale=defineEffect<number,number>(b=>{const entity=b.local<number>(),selected=b.local<Effect<number,number>>(),result=b.local<number>();return sequence(
    b.assign(entity,spawnEntity({definition,owner:null,scope:0})),b.assign(selected,entityEffect(module.exports.kind,entity,c=>c.play)),despawnEntity({entity,reason:'gone'}),b.assign(result,call(selected,entity)),b.return(result),
  );});
  assert.match(JSON.stringify(run(stale).advance()),/Invalid dynamic rule effect reference/);
});

test('a runtime definition choice and an existing entity copy share static code across restore',()=>{
  const entry=defineEffect<number,number>(b=>{
    const catalog=b.local<readonly rules.EntityDefinition<{play:Effect<number,number>}>[]>(),choice=b.local<number>(),selected=b.local<rules.EntityDefinition<{play:Effect<number,number>}>>();
    const a=b.local<number>(),copy=b.local<number>(),x=b.local<number>(),y=b.local<number>();
    return sequence(b.assign(catalog,[one,five]),b.assign(choice,call(choose,2)),b.assign(selected,b.read(v=>v.get(catalog)[v.get(choice)]!)),
      b.assign(a,spawnEntity({kind:module.exports.kind,definition:selected,owner:null,scope:0})),
      b.assign(copy,spawnEntity({kind:module.exports.kind,definition:definitionOf(module.exports.kind,a),owner:null,scope:0})),
      b.assign(x,call(entityEffect(module.exports.kind,a,c=>c.play),b.input)),b.assign(y,call(entityEffect(module.exports.kind,copy,c=>c.play),b.input)),b.return(b.read(v=>v.get(x)*100+v.get(y))),
    );
  });
  const parent=run(entry);assert.equal(parent.advance().kind,'call');
  const restored=new CardMachine(parent.program,plainCardStorage(structuredClone(parent.root)));
  assert.deepEqual(parent.advance(0),{kind:'done',result:808});assert.deepEqual(restored.advance(1),{kind:'done',result:1212});
  const forged=defineEffect<number,number>(b=>{
    const invalid=b.local<rules.EntityDefinition<{play:Effect<number,number>}>>();return sequence(
      b.assign(invalid,b.read(()=>({program:'foreign',definition:0} as unknown as rules.EntityDefinition<{play:Effect<number,number>}>))),
      spawnEntity({kind:module.exports.kind,definition:invalid,owner:null,scope:0}),b.return(0),
    );
  });
  const bad=run(forged);assert.match(JSON.stringify(bad.advance()),/Invalid entity definition reference/);assert.deepEqual(Object.keys((bad.root.state as any).$rules.entities),[]);
});

test('a source-scoped dynamic disposal hook can wait and restore before its entity is finally deleted',()=>{
  type Exit=rules.EntityLifecycle&{reason:unknown};
  const life=defineRules({requires:[],build(m){
    const result=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const save=m.atom({input:z.number(),output:z.undefined(),reads:[],writes:[result],emits:[],run(_r,value){return{writes:[{entity:0,component:result,value}],events:[],result:undefined};}});
    const dispose=defineEffect<Exit,void>(b=>call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.exit),b.input));
    const kind:rules.EntityKind<{exit:Effect<Exit,void>}>=m.kind({config:z.object({exit:z.custom<Effect<Exit,void>>()}),components:[],dispose});
    const exit=defineEffect<Exit,void>(b=>{const answer=b.local<number>();return sequence(b.assign(answer,call(choose,b.read(v=>v.input.entity))),
      updateLocalComponent(b.read(v=>v.input.entity),counter,b.read(v=>v.get(answer))),call(save,readComponent(b.read(v=>v.input.entity),counter)),
    );});
    const current=rules.defineQuery({input:z.undefined(),output:z.number(),reads:[result],base:r=>r.component(0,result)});
    return{exports:{kind,exit,current}};
  }});
  const definition=defineEntity(life.exports.kind,{exit:life.exports.exit},{components:[counter]});
  const entry=defineEffect<number,number>(b=>{const entity=b.local<number>();return sequence(b.assign(entity,spawnEntity({definition,owner:0,scope:0})),despawnEntity({entity,reason:'done'}),b.return(rules.query(life.exports.current,undefined)));});
  const linked=linkRules({id:'dynamic-disposal',schemas,initialize:()=>({}),entry,definitions:[entry,choose],modules:[life],initialEntities:[0]});
  const program=new CardProgram(linked),parent=new CardMachine(program,plainCardStorage(program.initial(0)));
  assert.deepEqual(parent.advance(),{kind:'call',call:{port:'choose',input:1}});
  const child=new CardMachine(program,plainCardStorage(structuredClone(parent.root)));
  assert.deepEqual(parent.advance(7),{kind:'done',result:7});assert.deepEqual(child.advance(9),{kind:'done',result:9});
  for(const machine of [parent,child]){assert.deepEqual(Object.keys((machine.root.state as any).$rules.entities),['0']);assert.deepEqual((machine.root.state as any).$rules.sources,[]);}
});

if(false){
  defineEffect<void,void>(b=>{
    const entity=b.local<number>();
    // @ts-expect-error selected entity effect requires a number input
    return call(entityEffect(module.exports.kind,entity,c=>c.play),'bad');
  });
  defineEffect<void,void>(b=>{
    const selected=b.local<rules.EntityDefinition<{play:Effect<number,number>}>>();
    // @ts-expect-error dynamic spawn must declare the expected kind
    return spawnEntity({definition:selected,owner:null,scope:0});
  });
}
