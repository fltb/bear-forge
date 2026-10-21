import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,linkRules,CardProgram,CardMachine,plainCardStorage} from '../src/index.ts';
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,spawnEntity,query,definitionOf}=rules;
type Config={policy:rules.Query<number,number>};
const policies=defineRules({requires:[],build(m){
  const kind=m.kind({config:z.object({policy:z.custom<rules.Query<number,number>>()}),components:[]});
  const selection={kind,select:(config:Readonly<Config>)=>config.policy};
  const apply=defineQuery({input:z.object({entity:z.number(),value:z.number()}),output:z.number(),selections:[selection],base:(r,input)=>r.selected(selection,input.entity,input.value)});
  const equal=defineQuery({input:z.tuple([z.custom<rules.EntityDefinition<Config>>(),z.custom<rules.EntityDefinition<Config>>()]),output:z.boolean(),base:(r,input)=>r.sameDefinition(input[0],input[1])});
  return{exports:{kind,apply,equal,selection}};
}});
const add=defineQuery({input:z.number(),output:z.number(),base:(_r,n)=>n+3}),multiply=defineQuery({input:z.number(),output:z.number(),dependencies:[add],base:(r,n)=>r.query(add,n)*2});
const one=defineEntity(policies.exports.kind,{policy:add}),two=defineEntity(policies.exports.kind,{policy:multiply});
function run(entry:rules.Effect<void,unknown>,modules:readonly rules.RuleModule<any>[]=[policies]){
  const definition=linkRules({id:'selected-queries',schemas:{setup:z.undefined(),result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules});
  const program=new CardProgram(definition);return new CardMachine(program,plainCardStorage(program.initial(undefined)));
}
test('typed pure strategies select finite static queries, close their dependencies, and compare data definition identities',()=>{
  const entry=defineEffect<void,unknown>(b=>{const a=b.local<number>(),c=b.local<number>();return sequence(
    b.assign(a,spawnEntity({definition:one,owner:null,scope:0})),b.assign(c,spawnEntity({definition:two,owner:null,scope:0})),
    b.return({a:query(policies.exports.apply,{entity:a,value:4}),b:query(policies.exports.apply,{entity:c,value:4}),
      same:query(policies.exports.equal,[definitionOf(policies.exports.kind,a),one]),different:query(policies.exports.equal,[one,two])}),
  );});
  assert.deepEqual(run(entry).advance(),{kind:'done',result:{a:7,b:14,same:true,different:false}});
});
test('undeclared selections and selected dependency cycles cannot enter a pure query',()=>{
  const invalid=defineRules({requires:[policies],build(){return{exports:{query:defineQuery({input:z.number(),output:z.number(),base:(r,entity)=>r.selected(policies.exports.selection,entity,1)})}};}});
  const entry=defineEffect<void,unknown>(b=>{const entity=b.local<number>();return sequence(b.assign(entity,spawnEntity({definition:one,owner:null,scope:0})),b.return(query(invalid.exports.query,entity)));});
  assert.match(JSON.stringify(run(entry,[invalid]).advance()),/Undeclared entity query selection/);
  const cyclic=defineRules({requires:[],build(m){
    const kind=m.kind({config:z.object({policy:z.custom<rules.Query<number,number>>()}),components:[]});
    const selection={kind,select:(config:Readonly<Config>)=>config.policy};
    const query=defineQuery({input:z.number(),output:z.number(),selections:[selection],base:(r,input)=>r.selected(selection,input,input)});
    return{exports:{kind,query}};
  }});
  const entity=defineEntity(cyclic.exports.kind,{policy:cyclic.exports.query}),cycleEntry=defineEffect<void,unknown>(b=>sequence(spawnEntity({definition:entity,owner:null,scope:0}),b.return(0)));
  assert.throws(()=>run(cycleEntry,[cyclic]),/Cyclic rule query dependency/);
});

test('definition configuration reads require the declared kind and a current Program reference without allocating entities',()=>{
  const m=defineRules({requires:[],build(builder){
    const kind=builder.kind({config:z.object({value:z.number()}),components:[]}),other=builder.kind({config:z.object({value:z.number()}),components:[]});
    const read=defineQuery({input:z.custom<rules.EntityDefinition<{value:number}>>(),output:z.number(),kinds:[kind],base:(r,ref)=>r.definitionConfiguration(ref,kind).value});
    const invalid=defineQuery({input:z.custom<rules.EntityDefinition<{value:number}>>(),output:z.number(),base:(r,ref)=>r.definitionConfiguration(ref,kind).value});
    return{exports:{kind,other,read,invalid}};
  }});
  const value=defineEntity(m.exports.kind,{value:42}),wrong=defineEntity(m.exports.other,{value:9});
  const entry=defineEffect<void,unknown>(b=>b.return(query(m.exports.read,value))),machine=run(entry,[m]);
  assert.deepEqual(machine.advance(),{kind:'done',result:42});assert.equal(Object.keys((machine.root.state as {$rules:{entities:object}}).$rules.entities).length,0);
  const undeclared=defineEffect<void,unknown>(b=>b.return(query(m.exports.invalid,value)));
  assert.match(JSON.stringify(run(undeclared,[m]).advance()),/Undeclared entity configuration read/);
  const mismatch=defineEffect<void,unknown>(b=>b.return(query(m.exports.read,wrong)));
  assert.match(JSON.stringify(run(mismatch,[m]).advance()),/Definition kind does not match/);
  const foreign=defineEffect<void,unknown>(b=>b.return(query(m.exports.read,{program:'foreign',definition:0} as unknown as typeof value)));
  assert.match(JSON.stringify(run(foreign,[m]).advance()),/Definition kind does not match/);
});

test('static catalog references link transitively; direct ReadView queries use the same executor',()=>{
  const m=defineRules({requires:[],build(builder){
    const kind=builder.kind({config:z.object({value:z.number()}),components:[]});
    const item=defineEntity(kind,{value:11});
    const catalogKind=builder.kind({config:z.object({item:z.custom<typeof item>()}),components:[]});
    const catalog=defineEntity(catalogKind,{item});
    assert.equal(rules.entityConfiguration(kind,item).value,11);
    assert.throws(()=>rules.entityConfiguration(kind,catalog as unknown as typeof item),/kind mismatch/);
    const selected=defineQuery({input:z.number(),output:z.custom<typeof item>(),kinds:[catalogKind],base:(r,id)=>r.configuration(id,catalogKind).item});
    const value=defineQuery({input:z.custom<typeof item>(),output:z.number(),kinds:[kind],base:(r,definition)=>r.definitionConfiguration(definition,kind).value});
    const entry=defineEffect<void,unknown>(b=>{const id=b.local<number>();return sequence(b.assign(id,spawnEntity({definition:catalog,owner:null,scope:0})),b.return(b.read(v=>v.query(value,v.query(selected,v.get(id))))));});
    return{exports:{entry}};
  }});
  assert.deepEqual(run(m.exports.entry,[m]).advance(),{kind:'done',result:11});
});
