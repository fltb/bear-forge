import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardMachine,CardProgram,plainCardStorage,linkRules,rules} from '../src/index.ts';
import {ownRuleValue,readRuleValue,lowerRuleValue,ownLoweredRuleValue,detachRuleValue,immutableRuleBirth} from '../src/rules-values.ts';

test('borrowing preserves alias and cycle topology; only mutable transfers copy',()=>{
  const child={n:1}, source:{a:typeof child;b:typeof child;self?:unknown}={a:child,b:child}; source.self=source;
  const owned=ownRuleValue(source);
  assert.equal(readRuleValue(owned),owned); assert.equal(owned.a,owned.b); assert.equal(owned.self,owned);
  const lowered=lowerRuleValue({whole:owned,part:owned.a});
  assert.equal(lowered.whole,owned); assert.equal(lowered.part,owned.a);
  const writable=detachRuleValue(owned); writable.a.n=5;
  assert.equal(writable.b.n,5); assert.equal(writable.self,writable); assert.equal(owned.a.n,1);
});

test('shallow ownership preserves scalar values and shares only already-owned child blocks',()=>{
  const child=ownRuleValue({n:1}),source={nil:null,missing:undefined,negativeZero:-0,nan:NaN,infinite:Infinity,large:3n,left:child,right:child};
  const owned=ownRuleValue(source);
  assert.notEqual(owned,source);assert.deepEqual(owned,source);assert.ok(Object.isFrozen(owned));
  assert.equal(owned.left,child);assert.equal(owned.left,owned.right);assert.ok(Object.is(owned.negativeZero,-0));
  source.left=ownRuleValue({n:9});assert.equal(owned.left.n,1);
  const lowered=lowerRuleValue({child});assert.equal(lowered.child,child);assert.equal(Object.isFrozen(lowered),false);
  const detached=detachRuleValue(owned);assert.notEqual(detached.left,child);assert.equal(detached.left,detached.right);
  detached.left.n=7;assert.equal(child.n,1);assert.equal(Object.isFrozen(detached),false);
});

test('entering graph copying after scalar fields preserves self cycles and reads each field once',()=>{
  const shared=ownRuleValue({stable:true}),source:Record<string,unknown>={prefix:1,shared};
  const reads=new Map<PropertyKey,number>();
  const input=new Proxy(source,{getOwnPropertyDescriptor(target,key){reads.set(key,(reads.get(key)??0)+1);return Reflect.getOwnPropertyDescriptor(target,key);}});
  const child={parent:input,n:2};source.first=child;source.second=child;source.self=input;
  const output=ownRuleValue(input) as {prefix:number;shared:typeof shared;first:typeof child;second:typeof child;self:unknown};
  assert.equal(output.shared,shared);assert.notEqual(output.first,child);assert.equal(output.first,output.second);
  assert.equal(output.self,output);assert.equal(output.first.parent,output);
  // Object.keys asks once for enumerability, then copying asks once for value.
  assert.deepEqual([...reads],Object.keys(source).map(key=>[key,2]));
  child.n=9;assert.equal(output.first.n,2);
  const self:Record<string,unknown>={prefix:1};self.last=self;
  const copied=ownRuleValue(self);assert.equal(copied.last,copied);
});

test('shallow copies preserve array holes, null-prototype input and prototype-named data fields',()=>{
  const child=ownRuleValue({n:1}),source=Object.create(null) as Record<string,unknown>;
  Object.defineProperty(source,'__proto__',{value:child,enumerable:true});
  Object.defineProperty(source,'constructor',{value:'data',enumerable:true});source.value=4;
  const object=ownRuleValue(source);
  assert.equal(Object.getPrototypeOf(object),Object.prototype);assert.ok(Object.hasOwn(object,'__proto__'));
  assert.equal(object.__proto__,child);assert.equal(object.constructor,'data');
  const array=new Array<unknown>(5);array[2]=undefined;array[4]=child;
  for(const [key,value] of [['__proto__',child],['constructor','stored constructor'],['map','stored method']] as const)
    Object.defineProperty(array,key,{value,enumerable:true});
  const owned=ownRuleValue(array),fields=owned as unknown as Record<string,unknown>;
  assert.equal(owned.length,5);assert.deepEqual(Object.keys(owned),['2','4','__proto__','constructor','map']);
  assert.equal(Object.hasOwn(owned,0),false);assert.equal(Object.hasOwn(owned,1),false);assert.equal(Object.hasOwn(owned,3),false);
  assert.equal(owned[2],undefined);assert.equal(owned[4],child);assert.equal(fields.__proto__,child);
  assert.equal(fields.constructor,'stored constructor');assert.equal(fields.map,'stored method');assert.ok(Object.isFrozen(owned));
  const detached=detachRuleValue(owned),detachedFields=detached as unknown as Record<string,unknown>;
  assert.notEqual(detached[4],child);assert.equal(detached[4],detachedFields.__proto__);
  assert.deepEqual(Object.keys(detached),Object.keys(owned));assert.equal(detached.length,5);
});

test('graph copying retains reverse breadth-first immutable admission order',()=>{
  const shared=ownRuleValue({n:1}),birth=immutableRuleBirth(shared);
  const output=ownRuleValue({prefix:1,shared,left:{leaf:{}},right:{leaf:{}}});
  const nodes=[output.right.leaf,output.left.leaf,output.right,output.left,output];
  const births=nodes.map(node=>{assert.ok(Object.isFrozen(node));return immutableRuleBirth(node)!;});
  assert.ok(births.every((value,index)=>index===0||births[index-1]!<value));
  assert.equal(immutableRuleBirth(shared),birth);assert.equal(output.shared,shared);
});

test('lazy graph copying retains static-handle lowering aliases and callback order',()=>{
  const handle=rules.defineEffect<void,void>(b=>b.return(undefined)),replacement={n:3};let calls=0;
  const source={prefix:1,first:handle,again:handle,direct:replacement};
  const output=ownLoweredRuleValue(source,value=>{assert.equal(value,handle);calls++;return replacement;}) as unknown as {prefix:number;first:typeof replacement;again:typeof replacement;direct:typeof replacement};
  assert.equal(calls,1);assert.equal(output.first,output.again);assert.equal(output.first,output.direct);
  assert.notEqual(output.first,replacement);assert.ok(Object.isFrozen(output.first));
  calls=0;
  const primitive=lowerRuleValue({first:handle,again:handle},()=>++calls) as unknown as {first:number;again:number};
  assert.deepEqual(primitive,{first:1,again:2});assert.equal(calls,2);
  const self=ownLoweredRuleValue(handle,()=>({self:handle})) as unknown as {self:unknown};assert.equal(self.self,self);
  const root:Record<string,unknown>={prefix:1,handle};
  const rootAlias=ownLoweredRuleValue(root,()=>root);assert.equal(rootAlias.handle,rootAlias);
  const order:string[]=[];
  const second=rules.defineEffect<void,void>(b=>b.return(undefined));
  lowerRuleValue({child:{handle},sibling:second},value=>{order.push(value===handle?'child':'sibling');return 1;});
  assert.deepEqual(order,['sibling','child']);
  assert.throws(()=>ownRuleValue({prefix:1,handle}),/Static rule handle cannot enter runtime data/);
  assert.throws(()=>lowerRuleValue(handle,value=>value),/Static rule handle was not lowered/);
});

test('shallow and graph copies reject non-data values and accessors without invoking getters',()=>{
  for(const value of [()=>0,Symbol('value')]){
    assert.throws(()=>ownRuleValue(value),/Rule values must be data/);
    assert.throws(()=>ownRuleValue({prefix:1,value}),/Rule values must be data/);
    assert.throws(()=>ownRuleValue({child:{},value}),/Rule values must be data/);
    assert.throws(()=>ownRuleValue({child:{value}}),/Rule values must be data/);
  }
  let calls=0;
  for(const input of [{prefix:1},{child:{}}]){
    Object.defineProperty(input,'value',{enumerable:true,get(){calls++;return 7;}});
    assert.throws(()=>ownRuleValue(input),/Rule values cannot contain accessors/);
  }
  assert.equal(calls,0);
  const foreign=new(class{n=1;})();
  assert.throws(()=>ownRuleValue(foreign),/Rule values must be plain data/);
  assert.throws(()=>ownRuleValue({prefix:1,foreign}),/Rule values must be plain data/);
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
