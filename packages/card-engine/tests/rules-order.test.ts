import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,ruleModules,linkRules,CardProgram,CardMachine,plainCardStorage} from '../src/index.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineCheckpoint,defineEffect,sequence,call,query,install,modify,on,replace}=rules;
const early={},middle={},late={},outsider={};
const ordering={phases:[{phase:late,after:[middle]},{phase:middle},{phase:early,before:[middle]}],default:middle};
const lifetime={order:ordering};
const module=defineRules({requires:[],build(m){
  const log=m.own(defineComponent({schema:z.array(z.number()),initial:()=>[]}));
  const append=m.atom({input:z.number(),output:z.undefined(),reads:[log],writes:[log],emits:[],run(r,n){return{writes:[{entity:0,component:log,value:[...r.component(0,log),n]}],events:[],result:undefined};}});
  const event=m.own(defineEvent({payload:z.undefined(),dispatch:'immediate',order:ordering}));
  const checkpoint=m.own(defineCheckpoint({input:z.number(),output:z.number(),order:ordering}));
  const calc=defineQuery({input:z.undefined(),output:z.number(),order:ordering,base:()=>2});
  const history=defineQuery({input:z.undefined(),output:z.array(z.number()),reads:[log],base:r=>r.component(0,log)});
  const fire=m.atom({input:z.undefined(),output:z.undefined(),reads:[],writes:[],emits:[event],run(){return{writes:[],events:[{event,payload:undefined}],result:undefined};}});
  const resolve=defineEffect<number,rules.ReplacementResult<number>>(b=>{const result=b.local<rules.ReplacementResult<number>>();return sequence(b.assign(result,m.resolve(checkpoint,b.input)),b.return(result));});
  for(const [phase,n] of [[late,3],[early,1],[middle,2]] as const)m.lifecycle(lifetime,{
    order:phase,initialize:defineEffect(b=>call(append,n*10)),dispose:defineEffect(b=>call(append,n*10+1)),
  });
  return{exports:{calc,history,fire,append,resolve,event:event.public,checkpoint:checkpoint.public}};
}});
function execute(entry:rules.Effect<void,unknown>){
  const schemas={setup:z.undefined(),result:z.unknown(),ports:{}};
  const definition=linkRules({id:'phases',schemas,initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition);return new CardMachine(program,plainCardStorage(program.initial(undefined))).advance();
}
const transforms=[{phase:late,fn:(n:number)=>Math.floor(n/3)},{phase:middle,fn:(n:number)=>n*4},{phase:early,fn:(n:number)=>n+3}];

test('query phase constraints order noncommutative operations independently of installation order',()=>{
  const abilities=transforms.map(t=>modify(module.exports.calc,{order:t.phase,transform:(_r,c)=>t.fn(c.value)}));
  const entry=defineEffect<void,unknown>(b=>sequence(...abilities.map(ability=>install({ability,source:0,owner:0,environment:{},lifetime:0})),b.return(query(module.exports.calc,undefined))));
  assert.deepEqual(execute(entry),{kind:'done',result:6});
});

test('event and replacement dispatch share the declared phase contract and stable within-phase priority',()=>{
  const eventAbilities=[
    on(module.exports.event,{order:late,effect:defineEffect(b=>call(module.exports.append,3))}),
    on(module.exports.event,{order:{phase:early,priority:2},effect:defineEffect(b=>call(module.exports.append,12))}),
    on(module.exports.event,{order:middle,effect:defineEffect(b=>call(module.exports.append,2))}),
    on(module.exports.event,{order:{phase:early,priority:1},effect:defineEffect(b=>call(module.exports.append,11))}),
  ];
  const replacements=transforms.map(t=>replace(module.exports.checkpoint,{order:t.phase,effect:defineEffect<rules.ReplacementContext<number>,rules.ReplacementResult<number>>(b=>b.return({kind:'change',value:b.read(v=>t.fn(v.input.value))}))}));
  const entry=defineEffect<void,unknown>(b=>{const result=b.local<rules.ReplacementResult<number>>();return sequence(
    ...[...eventAbilities,...replacements].map(ability=>install({ability,source:0,owner:0,environment:{},lifetime:0})),
    call(module.exports.fire,undefined),b.assign(result,call(module.exports.resolve,2)),b.return({history:query(module.exports.history,undefined),result}),
  );});
  assert.deepEqual(execute(entry),{kind:'done',result:{history:[11,12,2,3],result:{kind:'change',value:6}}});
});

test('lifecycle initialization follows phase constraints and disposal unwinds their reverse order',()=>{
  const entry=defineEffect<void,unknown>(b=>{const scope=b.local<number>();return sequence(b.assign(scope,ruleModules.openScope(lifetime,0)),ruleModules.closeScope(scope),b.return(query(module.exports.history,undefined)));});
  assert.deepEqual(execute(entry),{kind:'done',result:[10,20,30,31,21,11]});
});

test('phase references belong to the target; duplicate, missing and cyclic constraints fail before execution',()=>{
  assert.throws(()=>modify(module.exports.calc,{order:outsider,transform:(_r,c)=>c.value}),/undeclared phase/);
  assert.throws(()=>on(module.exports.event,{order:outsider,effect:defineEffect(b=>b.return(undefined))}),/undeclared phase/);
  const make=(order:rules.RuleOrdering)=>defineQuery({input:z.undefined(),output:z.number(),base:()=>0,order});
  assert.throws(()=>make({phases:[{phase:early},{phase:early}],default:early}),/duplicate phases/);
  assert.throws(()=>make({phases:[{phase:early,before:[outsider]}],default:early}),/undeclared phase/);
  assert.throws(()=>make({phases:[{phase:early,before:[middle]},{phase:middle,before:[early]}],default:early}),/Cyclic/);
  assert.throws(()=>make({phases:[{phase:early}],default:outsider}),/default phase/);
});
