import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CardMachine, CardProgram, plainCardStorage, linkRules, rules } from '../src/index.ts';
import type { AtomSpec, Component, RuleEvent } from '../src/rules-module.types.ts';
const { defineRules,defineComponent,defineEvent,defineEffect,sequence,call } = rules;
const schema={setup:z.number(),result:z.number(),ports:{}};
function temperature(options:{badValue?:boolean;badResult?:boolean;duplicate?:boolean;mutateRead?:boolean}={}){
  return defineRules({requires:[],build(m){
    const heat=m.own(defineComponent({schema:z.object({value:z.number().min(-100).max(100)}),initial:()=>({value:0})}));
    const changed=m.own(defineEvent({payload:z.object({previous:z.number(),next:z.number()})}));
    const change=m.atom({input:z.number(),output:z.number(),reads:[heat],writes:[heat],emits:[changed],
      run(read,delta){
        const previous=read.component(0,heat);
        if(options.mutateRead)(previous as {value:number}).value=999;
        const next=options.badValue?101:Math.max(-100,Math.min(100,previous.value+delta));
        const write={entity:0,component:heat,value:{value:next}};
        return{writes:options.duplicate?[write,write]:[write],events:[{event:changed,payload:{previous:previous.value,next}}],result:options.badResult?'bad' as any:next};
      },
    });
    return{exports:{change,component:heat.public,changed:changed.public,}};
  }});
}
function create(module:ReturnType<typeof temperature>,input:number){
  const entry=defineEffect<number,number>(b=>{
    const result=b.local<number>();return sequence(b.assign(result,call(module.exports.change,b.input)),b.return(result));
  });
  const d=linkRules({id:'module-test',schemas:schema,initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(d),m=new CardMachine(program,plainCardStorage(program.initial(input)));
  return m;
}

test('owned component changes validate before commit and publish one precise fact',()=>{
  const module=temperature(),first=create(module,15),second=create(module,-9);
  assert.deepEqual(first.advance(),{kind:'done',result:15});
  assert.deepEqual(second.advance(),{kind:'done',result:-9});
  assert.deepEqual((first.root.state as any).$rules,{entities:{0:{components:{0:{value:15}},definition:null,scope:0,owner:null,phase:'active'}},outbox:[{id:1,event:1,payload:{previous:0,next:15},handlers:[],scheduled:[]}],registrations:{},nextRegistration:1,nextEvent:2,scopes:{0:{kind:null,parent:null,phase:'active'}},nextEntity:1,nextScope:1,sources:[],tasks:{},queues:{},nextTask:1});
  assert.deepEqual((second.root.state as any).$rules.entities[0].components[0],{value:-9});
});

for(const failure of ['badValue','badResult','duplicate','mutateRead'] as const)test(`rejected ${failure} leaves components and outbox unchanged`,()=>{
  const m=create(temperature({[failure]:true}),3);
  assert.equal(m.advance().kind,'fault');
  assert.deepEqual((m.root.state as any).$rules,{entities:{0:{components:{0:{value:0}},definition:null,scope:0,owner:null,phase:'active'}},outbox:[],registrations:{},nextRegistration:1,nextEvent:1,scopes:{0:{kind:null,parent:null,phase:'active'}},nextEntity:1,nextScope:1,sources:[],tasks:{},queues:{},nextTask:1});
});

test('dependency imports never grant component ownership or write authority',()=>{
  const a=temperature();
  assert.throws(()=>defineRules({requires:[a],build(m){m.own(a.exports.component);return{exports:{}};}}),/another module/);
  const b=defineRules({requires:[a],build(m){
    const intrude=m.atom({input:z.number(),output:z.number(),reads:[a.exports.component],writes:[{public:a.exports.component} as any],emits:[],
      run(_read,input){return{writes:[{entity:0,component:{public:a.exports.component} as any,value:{value:input}}],events:[],result:input};},
    });return{exports:{intrude}};
  }});
  const entry=defineEffect<number,number>(x=>{const r=x.local<number>();return sequence(x.assign(r,call(b.exports.intrude,x.input)),x.return(r));});
  assert.throws(()=>linkRules({id:'bad-owner',schemas:schema,initialize:()=>({}),entry,definitions:[entry],modules:[b],initialEntities:[0]}),/Unauthorized rule atom authority/);
});

test('undeclared proposal events and writes fail before any earlier candidate is applied',()=>{
  const module=defineRules({requires:[],build(m){
    const a=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const b=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const event=m.own(defineEvent({payload:z.number()}));
    // @ts-expect-error deliberately malformed proposal also tests enforcement after a caller bypasses types
    const change=m.atom({input:z.number(),output:z.number(),reads:[a,b],writes:[a],emits:[],run(_read,n){
      return{writes:[{entity:0,component:a,value:n},{entity:0,component:b,value:n}],events:[{event,payload:n}],result:n};
    }});return{exports:{change,component:a.public,changed:event.public,}};
  }});
  const m=create(module as any,7);assert.match(JSON.stringify(m.advance()),/Unauthorized rule proposal write/);
  assert.deepEqual((m.root.state as any).$rules.entities[0].components,{0:0,1:0});
  assert.deepEqual((m.root.state as any).$rules.outbox,[]);
});

test('module exports never contain a live instance graph',()=>{
  const module=temperature();assert.ok(Object.isFrozen(module));assert.ok(Object.isFrozen(module.exports));
  const m=create(module,8);m.advance();
  assert.deepEqual(Object.keys(module.exports).sort(),['change','changed','component']);
  assert.equal(JSON.stringify(module).includes('$rules'),false);
});

if(false){
  defineRules({requires:[],build(m){
    const heat=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    // @ts-expect-error component writes must have the component data type
    m.atom({input:z.number(),output:z.number(),reads:[heat],writes:[heat],emits:[],run(_read,n){return{
      writes:[{entity:0,component:heat,value:'bad'}],events:[],result:n,
    };}});
    const label=m.own(defineComponent({schema:z.string(),initial:()=>''}));
    // @ts-expect-error the output schema determines an atom result, rather than widening to include a bad result
    m.atom({input:z.number(),output:z.number(),reads:[],writes:[],emits:[],run(){return{writes:[],events:[],result:'bad'};}});
    // @ts-expect-error heterogeneous writes must preserve each component/value pair
    m.atom({input:z.number(),output:z.number(),reads:[heat,label],writes:[heat,label],emits:[],run(_read,n){return{
      writes:[{entity:0,component:heat,value:'bad'},{entity:0,component:label,value:n}],events:[],result:n,
    };}});
    return{exports:{}};
  }});
}

test('owner capabilities cannot leak through nested module exports',()=>{
  assert.throws(()=>defineRules({requires:[],build(m){
    const component=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    return{exports:{nested:{component}}};
  }}),/cannot export owner authority/);
});

test('unexported components cannot be read by a dependency consumer',()=>{
  let hidden:Component<number>;
  const a=defineRules({requires:[],build(m){hidden=m.own(defineComponent({schema:z.number(),initial:()=>0})).public;return{exports:{}};}});
  const b=defineRules({requires:[a],build(m){const read=m.atom({input:z.number(),output:z.number(),reads:[hidden],writes:[],emits:[],run(r){return{writes:[],events:[],result:r.component(0,hidden)};}});return{exports:{read}};}});
  const entry=defineEffect<number,number>(x=>{const r=x.local<number>();return sequence(x.assign(r,call(b.exports.read,x.input)),x.return(r));});
  assert.throws(()=>linkRules({id:'hidden-read',schemas:schema,initialize:()=>({}),entry,definitions:[entry],modules:[b],initialEntities:[0]}),/Unauthorized rule atom read/);
});

test('composed module effects and their private helpers are linked from explicit module construction',()=>{
  const module=defineRules({requires:[],build(m){
    const n=m.own(defineComponent({schema:z.number(),initial:()=>0}));
    const step=m.atom({input:z.number(),output:z.number(),reads:[n],writes:[n],emits:[],run(r,delta){const result=r.component(0,n)+delta;return{writes:[{entity:0,component:n,value:result}],events:[],result};}});
    const twice=defineEffect<number,number>(b=>{const result=b.local<number>();return sequence(call(step,b.input),b.assign(result,call(step,b.input)),b.return(result));});
    return{exports:{twice}};
  }});
  const entry=defineEffect<number,number>(b=>{const r=b.local<number>();return sequence(b.assign(r,call(module.exports.twice,b.input)),b.return(r));});
  const d=linkRules({id:'composed-module',schemas:schema,initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const p=new CardProgram(d),m=new CardMachine(p,plainCardStorage(p.initial(3)));
  assert.deepEqual(m.advance(),{kind:'done',result:6});
});

test('module implementation builders cannot add new authority or effects after construction',()=>{
  let captured:any;
  defineRules({requires:[],build(m){captured=m;return{exports:{}};}});
  assert.throws(()=>captured.own(defineComponent({schema:z.number(),initial:()=>0})),/construction has finished/);
  assert.throws(()=>captured.atom({input:z.number(),output:z.number(),reads:[],writes:[],emits:[],run(){return{writes:[],events:[],result:0};}}),/construction has finished/);
});
