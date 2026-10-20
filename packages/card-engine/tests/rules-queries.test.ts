import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardProgram,CardMachine,plainCardStorage,linkRules,rules } from '../src/index.ts';
import type { Effect,Value } from '../src/rules.types.ts';
import type { Component } from '../src/rules-module.types.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,sequence,query,modify,install,uninstall}=rules;
const schemas={setup:z.number(),result:z.number(),ports:{}};
function fixture(){return defineRules({requires:[],build(m){
  const amount=m.own(defineComponent({schema:z.number(),initial:()=>8}));
  const attribute=defineQuery({input:z.object({base:z.number()}),output:z.number(),reads:[amount],base:(r,input)=>r.component(0,amount)+input.base});
  const enabled=defineQuery({input:z.any(),output:z.boolean(),base:(_r,input)=>input.environment.enabled===true});
  return{exports:{attribute,enabled,amount:amount.public}};
}});}
function run(entry:Effect<number,number>,module:ReturnType<typeof fixture>,input=0){
  const d=linkRules({id:'queries',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const p=new CardProgram(d);return new CardMachine(p,plainCardStorage(p.initial(input)));
}

test('ordered pure modifiers preserve noncommutative arithmetic and unregister independently',()=>{
  const m=fixture();
  const add=modify(m.exports.attribute,{order:0,transform:(_r,c)=>c.value+3});
  const multiply=modify(m.exports.attribute,{order:1,transform:(_r,c)=>c.value*2});
  const entry=defineEffect<number,number>(b=>{const first=b.local<number>(),second=b.local<number>();return sequence(
    install({source:0,owner:0,ability:multiply,environment:{},lifetime:0}),
    b.assign(second,install({source:0,owner:0,ability:add,environment:{},lifetime:0})),
    b.assign(first,query(m.exports.attribute,{base:1})),uninstall(second),
    b.return(b.read(v=>v.get(first)*100+v.get(query(m.exports.attribute,{base:1})))),
  );});
  assert.deepEqual(run(entry,m).advance(),{kind:'done',result:2418});
});

test('same modifier definition in two registrations contributes twice and eligibility uses source data',()=>{
  const m=fixture();
  const ability=modify(m.exports.attribute,{eligible:m.exports.enabled,transform:(_r,c)=>c.value+5});
  const entry=defineEffect<number,number>(b=>sequence(
    install({source:0,owner:0,ability,environment:{enabled:true},lifetime:0}),
    install({source:0,owner:0,ability,environment:{enabled:false},lifetime:0}),
    install({source:0,owner:0,ability,environment:{enabled:true},lifetime:0}),b.return(query(m.exports.attribute,{base:0})),
  ));
  assert.deepEqual(run(entry,m).advance(),{kind:'done',result:18});
});

test('a modifier cannot depend on the query it is modifying, even before runtime installation',()=>{
  const m=fixture();const cyclic=modify(m.exports.attribute,{dependencies:[m.exports.attribute],transform:(r,c)=>r.query(m.exports.attribute,c.input)});
  const entry=defineEffect<number,number>(b=>sequence(install({source:0,owner:0,ability:cyclic,environment:{},lifetime:0}),b.return(0)));
  assert.throws(()=>run(entry,m),/Cyclic rule query dependency/);
});

test('global query expressions validate their nested lexical references and do not retain mutable literal parameters',()=>{
  const m=fixture(),config={base:3};
  const value=query(m.exports.attribute,config);config.base=80;
  const entry=defineEffect<number,number>(b=>b.return(value));assert.deepEqual(run(entry,m).advance(),{kind:'done',result:11});
  let foreign:Value<number>;
  const other=defineEffect<number,number>(b=>{foreign=b.input;return b.return(0);});
  const bad=defineEffect<number,number>(b=>b.return(query(m.exports.attribute,{base:foreign})));
  assert.throws(()=>linkRules({id:'foreign-query-input',schemas,initialize:()=>({}),entry:bad,definitions:[other,bad],modules:[m],initialEntities:[0]}),/Foreign rule expression/);
});

test('third-layer modifiers can only read component views explicitly exported by their owner',()=>{
  let hidden:Component<number>;
  const m=defineRules({requires:[],build(owner){
    hidden=owner.own(defineComponent({schema:z.number(),initial:()=>2})).public;
    const attribute=defineQuery({input:z.number(),output:z.number(),base:(_r,input)=>input});
    return{exports:{attribute}};
  }});
  const ability=modify(m.exports.attribute,{reads:[hidden!],transform:r=>r.component(0,hidden)});
  const entry=defineEffect<number,number>(b=>sequence(install({source:0,owner:0,ability,environment:{},lifetime:0}),b.return(0)));
  assert.throws(()=>linkRules({id:'hidden-modifier',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[m],initialEntities:[0]}),/Unauthorized rule query read/);
});

test('declared component enumeration returns only current holders in numeric order and rejects undeclared reads',()=>{
  const module=defineRules({requires:[],build(m){
    const value=m.own(defineComponent({schema:z.number(),initial:()=>8}));
    const holders=defineQuery({input:z.undefined(),output:z.array(z.number()),reads:[value],base:r=>[...r.entities(value)]});
    const denied=defineQuery({input:z.undefined(),output:z.array(z.number()),base:r=>[...r.entities(value)]});
    return{exports:{holders,denied,empty:m.kind({config:z.undefined(),components:[]})}};
  }});
  const empty=rules.defineEntity(module.exports.empty,undefined);
  for(const denied of [false,true]){
    const entry=defineEffect<void,number[][]>(b=>{const before=b.local<number[]>();return sequence(
      rules.spawnEntity({definition:empty,owner:null,scope:0}),b.assign(before,query(denied?module.exports.denied:module.exports.holders,undefined)),rules.despawnEntity({entity:7,reason:'gone'}),b.return([before,query(module.exports.holders,undefined)]),
    );});
    const definition=linkRules({id:'enumerated-components',schemas:{setup:z.undefined(),result:z.array(z.array(z.number())),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[4294967298,7]});
    const program=new CardProgram(definition),stop=new CardMachine(program,plainCardStorage(program.initial(undefined))).advance();
    if(denied){assert.equal(stop.kind,'fault');if(stop.kind==='fault')assert.match(stop.error.message,/Undeclared rule query read/);}
    else assert.deepEqual(stop,{kind:'done',result:[[7,4294967298],[4294967298]]});
  }
});
