import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,plainCardStorage,linkRules,rules} from '../src/index.ts';
import {ownRuleValue,readRuleValue,lowerRuleValue,detachRuleValue} from '../src/rules-values.ts';

test('borrowing preserves alias and cycle topology; only mutable transfers copy',()=>{
  const child={n:1}, source:{a:typeof child;b:typeof child;self?:unknown}={a:child,b:child}; source.self=source;
  const owned=ownRuleValue(source);
  assert.equal(readRuleValue(owned),owned); assert.equal(owned.a,owned.b); assert.equal(owned.self,owned);
  const lowered=lowerRuleValue({whole:owned,part:owned.a});
  assert.equal(lowered.whole,owned); assert.equal(lowered.part,owned.a);
  const writable=detachRuleValue(owned); writable.a.n=5;
  assert.equal(writable.b.n,5); assert.equal(writable.self,writable); assert.equal(owned.a.n,1);
});

test('queries borrow a component version and retained reads survive an owner update',()=>{
  const schema=z.object({rows:z.array(z.object({n:z.number()}))});
  const module=rules.defineRules({requires:[],build(m){
    const component=m.own(rules.defineComponent({schema,initial:()=>({rows:[{n:1}]})}));
    const current=rules.defineQuery({input:z.undefined(),output:schema,reads:[component],base:r=>r.component(0,component)});
    const append=m.atom({input:z.undefined(),output:z.undefined(),reads:[component],writes:[component],emits:[],run(r){
      const before=r.component(0,component);
      return{writes:[{entity:0,component,value:{rows:[...before.rows,{n:2}]}}],events:[],result:undefined};
    }});
    return{exports:{current,append}};
  }});
  const entry=rules.defineEffect<void,boolean>(b=>{
    const previous=b.local<z.output<typeof schema>>();
    return rules.sequence(b.assign(previous,rules.query(module.exports.current,undefined)),b.assign(b.local<boolean>(),b.read(v=>{
      assert.equal(v.get(previous),v.query(module.exports.current,undefined)); return true;
    })),rules.call(module.exports.append,undefined),b.return(b.read(v=>{
      const old=v.get(previous),next=v.query(module.exports.current,undefined);
      assert.notEqual(old,next); assert.equal(old.rows[0],next.rows[0]);
      return old.rows.length===1&&next.rows.length===2;
    })));
  });
  const definition=linkRules({id:'borrowed-query',schemas:{setup:z.undefined(),result:z.boolean(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,plainCardStorage(program.initial(undefined)));
  assert.deepEqual(machine.advance(),{kind:'done',result:true});
});

if(false){
  const component=rules.defineComponent({schema:z.object({rows:z.array(z.object({n:z.number()}))}),initial:()=>({rows:[]})});
  const query=rules.defineQuery({input:z.undefined(),output:z.array(z.object({n:z.number()})),reads:[component],base:r=>r.component(0,component).rows});
  rules.defineEffect<{rows:{n:number}[]},void>(b=>b.return(b.read(v=>{
    // @ts-expect-error effect input is a borrowed version, including its arrays
    v.input.rows.push({n:1});
    // @ts-expect-error query results do not expose mutable nested fields
    v.query(query,undefined)[0]!.n=2;
    const saved=rules.readComponent(0,component);
    // @ts-expect-error get cannot make a component projection writable
    v.get(saved).rows[0]!.n=3;
    return undefined;
  })));
}
