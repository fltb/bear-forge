import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {createCardLoader} from '@bear-forge/runtime-card';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {linkRules,ruleModules,CardMachine,CardProgram} from '@bear-forge/card-engine';
import {rules} from '../src/rules/execution.ts';
import {effectTrace,fromSource,OriginKind,type Cause} from '../src/rules/effect-trace.ts';
import {EffectKind,effectPolicy} from '../src/rules/effect-policy.ts';
import {typedValue} from '../src/rules/value.schemas.ts';
import {powers} from '../src/rules/powers.ts';
import type {PowerChange,PowerMerge,PowerMutable,PowerReduction,PowerState,PowerApplication,PowerLifecycle} from '../src/rules/powers.types.ts';

const queue={label:'trace-fixture'};
const wait=ruleModules.portEffect<number,number>('wait');
function fixture(){
  const module=rules.defineRules({requires:[],build(m){
    const log=m.own(rules.defineComponent({schema:z.array(typedValue<Cause>()),initial:()=>[]}));
    const kind=m.kind({config:z.undefined(),components:[]});
    const identity=rules.defineEntity(kind,undefined);
    const event=m.own(rules.defineEvent({payload:z.number(),dispatch:'queued'}));
    const publish=m.atom({input:z.number(),output:z.undefined(),reads:[],writes:[],emits:[event],run:(_r,value)=>({writes:[],events:[{event,payload:value}],result:undefined})});
    const append=m.atom({input:typedValue<Cause>(),output:z.undefined(),reads:[log],writes:[log],emits:[],run:(r,cause)=>({writes:[{entity:0,component:log,value:[...r.component(0,log),cause]}],events:[],result:undefined})});
    const history=rules.defineQuery({input:z.undefined(),output:z.array(typedValue<Cause>()),reads:[log],base:r=>r.component(0,log)});
    const record=rules.defineEffect<void,void>(b=>rules.call(append,rules.query(effectTrace.exports.current,undefined)));
    const delayed=rules.defineEffect<void,void>(b=>rules.sequence(rules.call(wait,7),rules.call(record,undefined)));
    const response=rules.on(event.public,{effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.sequence(
      rules.call(record,undefined),rules.enqueue(delayed,undefined,{queue,lifetime:0,source:b.read(v=>v.input.source),eligible:'captured'}),
    ))});
    const install=fromSource(rules.defineEffect<{source:number;owner:number},void>(b=>rules.install({ability:response,source:b.read(v=>v.input.source),owner:b.read(v=>v.input.owner),environment:{},lifetime:0})),v=>({source:v.input.source,owner:v.input.owner,registration:null,kind:OriginKind.Entity}));
    const publishFromCard=fromSource(rules.defineEffect<{card:number;owner:number},void>(b=>rules.sequence(rules.call(record,undefined),rules.call(publish,5))),v=>({source:v.input.card,owner:v.input.owner,registration:null,kind:OriginKind.Card,action:11}));
    return{exports:{identity,history,install,publishFromCard,record}};
  }});
  const entry=rules.defineEffect<void,{log:Cause[];card:number;relic:number;active:Cause}>(b=>{
    const card=b.local<number>(),relic=b.local<number>();return rules.sequence(
      b.assign(card,rules.spawnEntity({definition:module.exports.identity,owner:0,scope:0})),
      b.assign(relic,rules.spawnEntity({definition:module.exports.identity,owner:0,scope:0})),
      rules.call(module.exports.install,{source:relic,owner:0}),rules.call(module.exports.publishFromCard,{card,owner:0}),
      rules.call(ruleModules.dispatchQueuedEvents,undefined),
      ruleModules.drainQueue(queue),rules.call(module.exports.record,undefined),
      b.return({log:rules.query(module.exports.history,undefined),card,relic,active:rules.query(effectTrace.exports.current,undefined)}),
    );
  });
  return linkRules({id:'sts/effect-trace',schemas:{setup:z.undefined(),result:typedValue<{log:Cause[];card:number;relic:number;active:Cause}>(),ports:{wait:{input:z.number(),output:z.number()}}},initialize:()=>({}),entry,definitions:[entry,wait],modules:[module],initialEntities:[0]});
}
test('queued reaction keeps trigger and installation origins across a suspended task and independent context copies',()=>{
  const program=new CardProgram(fixture()),parent=new CardMachine(program,privateCardGraph(program.initial(undefined)));
  assert.deepEqual(parent.advance(),{kind:'call',call:{port:'wait',input:7}});
  const restored=new CardMachine(program,(parent.storage as ReturnType<typeof privateCardGraph<typeof parent.root>>).fork());
  for(const machine of [parent,restored]){
    const stop=machine.advance(1);assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
    const {log,card,relic,active}=stop.result;
    assert.deepEqual(active,[]);assert.equal(log.length,4);
    assert.equal(log[0]!.at(-1)!.source,card);
    assert.equal(log[1]![0]!.source,card);assert.equal(log[1]!.at(-1)!.source,relic);
    assert.equal(log[1]!.at(-1)!.installation.at(-1)!.source,relic);
    assert.deepEqual(log[2],log[1]);assert.deepEqual(log[3],[]);
  }
});

test('effect declarations qualify automatically from the active source',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const prevent=rules.modify(effectPolicy.exports.allowed,{transform:(_r,c)=>c.value&&c.input.effect!==EffectKind.Special});
    const kind=m.kind({config:z.undefined(),components:[]}),definition=rules.defineEntity(kind,undefined);
    const special=rules.defineEffect<void,number>({effect:EffectKind.Special,suppressed:0},b=>b.return(9));
    const attack=rules.defineEffect<void,number>({effect:EffectKind.Attack,suppressed:0},b=>b.return(7));
    return{exports:{prevent,definition,special,attack}};
  }});
  const executeBody=rules.defineEffect<number,number[]>(b=>{const special=b.local<number>(),attack=b.local<number>();return rules.sequence(
    b.assign(special,rules.call(module.exports.special,undefined)),b.assign(attack,rules.call(module.exports.attack,undefined)),b.return([special,attack]),
  );});
  const execute=fromSource(executeBody,v=>({source:v.input,owner:0,registration:null,kind:OriginKind.Card}));
  const entry=rules.defineEffect<void,number[]>(b=>{const source=b.local<number>(),result=b.local<number[]>();return rules.sequence(
    b.assign(source,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
    rules.install({ability:module.exports.prevent,source,owner:0,environment:{},lifetime:0}),
    b.assign(result,rules.call(execute,source)),b.return(result),
  );});
  const definition=linkRules({id:'sts/effect-declaration',schemas:{setup:z.undefined(),result:z.array(z.number()),ports:{}},initialize:()=>({}),entry,definitions:[entry,execute,executeBody],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));
  assert.deepEqual(machine.advance(),{kind:'done',result:[0,7]});
});

test('dynamic references retain their source after assignment, queueing and source cancellation',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const log=m.own(rules.defineComponent({schema:z.array(typedValue<Cause>()),initial:()=>[]}));
    const append=m.atom({input:typedValue<Cause>(),output:z.undefined(),reads:[log],writes:[log],emits:[],run:(r,cause)=>({writes:[{entity:0,component:log,value:[...r.component(0,log),cause]}],events:[],result:undefined})});
    const record=rules.defineEffect<void,void>(b=>rules.call(append,rules.query(effectTrace.exports.current,undefined)));
    const kind=m.kind({config:z.object({execute:typedValue<rules.Effect<void,void>>()}),components:[]});
    const definition=rules.defineEntity(kind,{execute:record});
    const history=rules.defineQuery({input:z.undefined(),output:z.array(typedValue<Cause>()),reads:[log],base:r=>r.component(0,log)});
    return{exports:{kind,definition,history}};
  }});
  const entry=rules.defineEffect<void,{log:Cause[];survivor:number}>(b=>{
    const survivor=b.local<number>(),removed=b.local<number>(),reference=b.local<rules.Effect<void,void>>();return rules.sequence(
      b.assign(survivor,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
      b.assign(removed,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
      b.assign(reference,rules.entityEffect(module.exports.kind,survivor,c=>c.execute)),
      rules.call(reference,undefined),rules.enqueue(reference,undefined,{queue,lifetime:0}),
      rules.enqueue(rules.entityEffect(module.exports.kind,removed,c=>c.execute),undefined,{queue,lifetime:0,eligible:'captured'}),
      rules.despawnEntity({entity:removed,reason:{done:true}}),ruleModules.drainQueue(queue),
      b.return({log:rules.query(module.exports.history,undefined),survivor}),
    );
  });
  const definition=linkRules({id:'sts/dynamic-trace',schemas:{setup:z.undefined(),result:typedValue<{log:Cause[];survivor:number}>(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined))),stop=machine.advance();
  assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
  assert.equal(stop.result.log.length,2);
  for(const cause of stop.result.log)assert.equal(cause.at(-1)!.source,stop.result.survivor);
});

test('scheduled work preserves the scheduling source while matching the original event payload',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const log=m.own(rules.defineComponent({schema:typedValue<Cause>(),initial:()=>[]}));
    const tick=m.own(rules.defineEvent({payload:z.number(),publicEmit:true}));
    const kind=m.kind({config:z.undefined(),components:[]}),definition=rules.defineEntity(kind,undefined);
    const record=m.atom({input:typedValue<Cause>(),output:z.undefined(),reads:[],writes:[log],emits:[],run:(_r,cause)=>({writes:[{entity:0,component:log,value:cause}],events:[],result:undefined})});
    const work=rules.defineEffect<number,void>(b=>rules.call(record,rules.query(effectTrace.exports.current,undefined)));
    const matches=rules.defineQuery({input:typedValue<{event:number;input:number;source:number|null}>(),output:z.boolean(),base:(_r,i)=>i.event===i.input});
    const history=rules.defineQuery({input:z.undefined(),output:typedValue<Cause>(),reads:[log],base:r=>r.component(0,log)});
    const prepare=fromSource(rules.defineEffect<number,void>(b=>rules.schedule(work,5,{queue,lifetime:0,source:b.input,at:{event:tick.public,condition:matches}})),v=>({source:v.input,owner:0,registration:null,kind:OriginKind.Card,action:18}));
    return{exports:{definition,prepare,tick:tick.public,history}};
  }});
  const entry=rules.defineEffect<void,{cause:Cause;source:number}>(b=>{const source=b.local<number>();return rules.sequence(
    b.assign(source,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),rules.call(module.exports.prepare,source),
    rules.emit(module.exports.tick,3),ruleModules.drainQueue(queue),rules.emit(module.exports.tick,5),ruleModules.drainQueue(queue),
    b.return({cause:rules.query(module.exports.history,undefined),source}),
  );});
  const definition=linkRules({id:'sts/scheduled-trace',schemas:{setup:z.undefined(),result:typedValue<{cause:Cause;source:number}>(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined))),stop=machine.advance();
  assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
  assert.equal(stop.result.cause.at(-1)!.source,stop.result.source);assert.equal(stop.result.cause.at(-1)!.action,18);
});

test('implicit static task sources obey source-present cancellation while captured tasks keep their cause',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const log=m.own(rules.defineComponent({schema:z.array(typedValue<Cause>()),initial:()=>[]}));
    const append=m.atom({input:typedValue<Cause>(),output:z.undefined(),reads:[log],writes:[log],emits:[],run:(r,cause)=>({writes:[{entity:0,component:log,value:[...r.component(0,log),cause]}],events:[],result:undefined})});
    const record=rules.defineEffect<void,void>(b=>rules.call(append,rules.query(effectTrace.exports.current,undefined)));
    const kind=m.kind({config:z.undefined(),components:[]}),definition=rules.defineEntity(kind,undefined);
    const prepare=fromSource(rules.defineEffect<number,void>(b=>rules.sequence(
      rules.enqueue(record,undefined,{queue,lifetime:0}),
      rules.enqueue(record,undefined,{queue,lifetime:0,eligible:'captured'}),
    )),v=>({source:v.input,owner:0,registration:null,kind:OriginKind.Card}));
    const history=rules.defineQuery({input:z.undefined(),output:z.array(typedValue<Cause>()),reads:[log],base:r=>r.component(0,log)});
    return{exports:{definition,prepare,history}};
  }});
  const entry=rules.defineEffect<void,{log:Cause[];source:number}>(b=>{const source=b.local<number>();return rules.sequence(
    b.assign(source,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
    rules.call(module.exports.prepare,source),rules.despawnEntity({entity:source,reason:{done:true}}),
    ruleModules.drainQueue(queue),b.return({log:rules.query(module.exports.history,undefined),source}),
  );});
  const definition=linkRules({id:'sts/static-task-trace',schemas:{setup:z.undefined(),result:typedValue<{log:Cause[];source:number}>(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined))),stop=machine.advance();
  assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
  assert.equal(stop.result.log.length,1);assert.equal(stop.result.log[0]!.at(-1)!.source,stop.result.source);
});

const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};

test('persistent provenance ignores no-op merges and retains causes when inactive stacks are reused',()=>{
  const module=rules.defineRules({requires:[powers],build(m){
    const kind=m.kind({config:z.undefined(),components:[]}),source=rules.defineEntity(kind,undefined);
    const definition=rules.defineEntity(powers.exports.kind,{
      initial:rules.defineQuery({input:typedValue<PowerChange>(),output:typedValue<PowerMutable>(),base:(_r,c)=>({level:c.amount,active:true,justApplied:false})}),
      merge:rules.defineQuery({input:typedValue<PowerMerge>(),output:typedValue<PowerMutable>(),base:(_r,c)=>c.change.amount===0?{level:c.state.level,active:c.state.active,justApplied:c.state.justApplied}:{level:c.state.level+c.change.amount,active:true,justApplied:false}}),
      reduce:rules.defineQuery({input:typedValue<PowerReduction>(),output:typedValue<PowerMutable>(),base:(_r,c)=>({level:c.state.level-c.amount,active:true,justApplied:false})}),
      polarity:rules.defineQuery({input:typedValue<PowerState>(),output:z.literal(1),base:()=>1 as const}),
      attach:rules.defineEffect<PowerLifecycle,void>(b=>b.return(undefined)),
    });
    const apply=fromSource(powers.exports.apply,v=>({source:v.input.source,owner:0,registration:null,kind:OriginKind.Card}));
    return{exports:{source,definition,apply}};
  }});
  const registryDefinition=rules.defineEntity(powers.exports.registryKind,undefined);
  const entry=rules.defineEffect<void,{sources:(number|null)[];level:number;first:number;second:number}>(b=>{
    const first=b.local<number>(),second=b.local<number>(),registry=b.local<number>(),power=b.local<number|null>();
    const application=(source:rules.Input<number>,amount:number):rules.Input<PowerApplication>=>({registry,actor:0,definition:module.exports.definition,scope:0,source,amount,debuff:false});
    return rules.sequence(
      b.assign(first,rules.spawnEntity({definition:module.exports.source,owner:0,scope:0})),
      b.assign(second,rules.spawnEntity({definition:module.exports.source,owner:0,scope:0})),
      b.assign(registry,rules.spawnEntity({definition:registryDefinition,owner:0,scope:0})),
      b.assign(power,rules.call(module.exports.apply,application(first,3))),
      rules.call(module.exports.apply,application(second,0)),
      rules.call(powers.exports.deactivate,b.read(v=>v.get(power)!)),
      rules.call(module.exports.apply,application(second,0)),
      rules.call(module.exports.apply,application(second,2)),
      b.return(b.read(v=>({sources:v.query(powers.exports.provenance,v.get(power)!).map(p=>p.source),level:v.query(powers.exports.level,v.get(power)!),first:v.get(first),second:v.get(second)}))),
    );
  });
  const definition=linkRules({id:'sts/persistent-trace',schemas:{setup:z.undefined(),result:typedValue<{sources:(number|null)[];level:number;first:number;second:number}>(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined))),stop=machine.advance();
  assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
  assert.deepEqual(stop.result.sources,[stop.result.first,stop.result.second]);assert.equal(stop.result.level,5);
});

test('staged task groups retain their cause and restore the unrelated draining caller',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const log=m.own(rules.defineComponent({schema:z.array(typedValue<Cause>()),initial:()=>[]}));
    const append=m.atom({input:typedValue<Cause>(),output:z.undefined(),reads:[log],writes:[log],emits:[],run:(r,cause)=>({writes:[{entity:0,component:log,value:[...r.component(0,log),cause]}],events:[],result:undefined})});
    const record=rules.defineEffect<void,void>(b=>rules.call(append,rules.query(effectTrace.exports.current,undefined)));
    const history=rules.defineQuery({input:z.undefined(),output:z.array(typedValue<Cause>()),reads:[log],base:r=>r.component(0,log)});
    const kind=m.kind({config:z.undefined(),components:[]}),definition=rules.defineEntity(kind,undefined);
    const stage=rules.defineEffect<void,void>(b=>rules.enqueue(record,undefined,{queue,lifetime:0}));
    const prepare=fromSource(rules.defineEffect<number,number[]>(b=>{
      const group=b.local<ruleModules.StagedTaskGroup<void>>();return rules.sequence(
        b.assign(group,ruleModules.stageTaskGroup(queue,stage,undefined)),b.return(b.read(v=>v.get(group).tasks)),
      );
    }),v=>({source:v.input,owner:0,registration:null,kind:OriginKind.Card,action:21}));
    const resume=fromSource(rules.defineEffect<{source:number;tasks:number[]},void>(b=>rules.sequence(
      rules.call(record,undefined),ruleModules.resumeTaskGroup(queue,b.read(v=>v.input.tasks),undefined),rules.call(record,undefined),
    )),v=>({source:v.input.source,owner:0,registration:null,kind:OriginKind.Card,action:22}));
    return{exports:{definition,prepare,resume,history}};
  }});
  const entry=rules.defineEffect<void,{log:Cause[];first:number;second:number;active:Cause}>(b=>{
    const first=b.local<number>(),second=b.local<number>(),tasks=b.local<number[]>();return rules.sequence(
      b.assign(first,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
      b.assign(second,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
      b.assign(tasks,rules.call(module.exports.prepare,first)),rules.call(module.exports.resume,{source:second,tasks}),
      b.return({log:rules.query(module.exports.history,undefined),first,second,active:rules.query(effectTrace.exports.current,undefined)}),
    );
  });
  const definition=linkRules({id:'sts/staged-trace',schemas:{setup:z.undefined(),result:typedValue<{log:Cause[];first:number;second:number;active:Cause}>(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined))),stop=machine.advance();
  assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
  assert.deepEqual(stop.result.log.map(c=>c.at(-1)!.source),[stop.result.second,stop.result.first,stop.result.second]);
  assert.deepEqual(stop.result.log.map(c=>c.at(-1)!.action),[22,21,22]);
  assert.deepEqual(stop.result.log[0],stop.result.log[2]);assert.deepEqual(stop.result.active,[]);
});

test('checkpoint replacements retain installation and caller causes without leaking into the caller',()=>{
  const module=rules.defineRules({requires:[],build(m){
    const checkpoint=m.own(rules.defineCheckpoint({input:z.number(),output:z.number()}));
    const log=m.own(rules.defineComponent({schema:z.array(typedValue<Cause>()),initial:()=>[]}));
    const append=m.atom({input:typedValue<Cause>(),output:z.undefined(),reads:[log],writes:[log],emits:[],run:(r,cause)=>({writes:[{entity:0,component:log,value:[...r.component(0,log),cause]}],events:[],result:undefined})});
    const record=rules.defineEffect<void,void>(b=>rules.call(append,rules.query(effectTrace.exports.current,undefined)));
    const replacement=rules.replace(checkpoint.public,{
      condition:rules.defineQuery({input:typedValue<rules.ReplacementContext<number,{increment:number}>>(),output:z.boolean(),base:(_r,c)=>c.environment.increment===2}),
      effect:rules.defineEffect<rules.ReplacementContext<number,{increment:number}>,rules.ReplacementResult<number>>(b=>rules.sequence(
        rules.call(record,undefined),b.return({kind:'change',value:b.read(v=>v.input.value+v.input.environment.increment)}),
      )),
    });
    const kind=m.kind({config:z.undefined(),components:[]}),definition=rules.defineEntity(kind,undefined);
    const install=fromSource(rules.defineEffect<number,void>(b=>rules.install({ability:replacement,source:b.input,owner:0,environment:{increment:2},lifetime:0})),v=>({source:v.input,owner:0,registration:null,kind:OriginKind.Entity}));
    const resolve=fromSource(rules.defineEffect<number,rules.ReplacementResult<number>>(b=>{
      const result=b.local<rules.ReplacementResult<number>>();return rules.sequence(
        rules.call(record,undefined),b.assign(result,m.resolve(checkpoint,5)),rules.call(record,undefined),b.return(result),
      );
    }),v=>({source:v.input,owner:0,registration:null,kind:OriginKind.Card,action:31}));
    const history=rules.defineQuery({input:z.undefined(),output:z.array(typedValue<Cause>()),reads:[log],base:r=>r.component(0,log)});
    return{exports:{definition,install,resolve,history}};
  }});
  const entry=rules.defineEffect<void,{log:Cause[];card:number;relic:number;result:rules.ReplacementResult<number>;active:Cause}>(b=>{
    const card=b.local<number>(),relic=b.local<number>(),result=b.local<rules.ReplacementResult<number>>();return rules.sequence(
      b.assign(card,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
      b.assign(relic,rules.spawnEntity({definition:module.exports.definition,owner:0,scope:0})),
      rules.call(module.exports.install,relic),b.assign(result,rules.call(module.exports.resolve,card)),
      b.return({log:rules.query(module.exports.history,undefined),card,relic,result,active:rules.query(effectTrace.exports.current,undefined)}),
    );
  });
  const definition=linkRules({id:'sts/replacement-trace',schemas:{setup:z.undefined(),result:typedValue<{log:Cause[];card:number;relic:number;result:rules.ReplacementResult<number>;active:Cause}>(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined))),stop=machine.advance();
  assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
  const {log,card,relic,result,active}=stop.result;
  assert.notEqual(result.kind,'cancel');if(result.kind==='cancel')throw Error('Unexpected cancellation');assert.equal(result.value,7);
  assert.equal(log.length,3);assert.deepEqual(log[0],log[2]);assert.deepEqual(active,[]);
  assert.equal(log[1]![0]!.source,card);assert.equal(log[1]!.at(-1)!.source,relic);
  assert.equal(log[1]!.at(-1)!.kind,OriginKind.Replacement);assert.notEqual(log[1]!.at(-1)!.registration,null);
  assert.equal(log[1]!.at(-1)!.installation.at(-1)!.source,relic);
});

for(const controlled of [true])test(`effect origins survive loader suspension${controlled?", fork and saved-context restoration":""}; controlled=${controlled}`,async()=>{
  const loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(fixture())),parent=unwrap(await loaded.core.start(undefined));
  const instances=[parent];
  const snapshot=loaded.persistence?unwrap(await loaded.persistence.save(parent)):null;
  try{
    const first=unwrap(await parent.inspect());assert.equal(first.kind,'call');
    if(controlled){assert.ok(parent.fork);assert.ok(loaded.persistence);instances.push(unwrap(await parent.fork()));}
    if(snapshot)instances.push(unwrap(await loaded.persistence!.restore(snapshot)));
    const results=[];
    for(const instance of instances){
      unwrap(await instance.bind({wait:async()=>({kind:'reply',value:1})}));unwrap(await instance.run());
      const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Expected done');
      results.push(done.result);assert.deepEqual(done.result.active,[]);
      assert.deepEqual(done.result.log[2],done.result.log[1]);
      assert.equal(done.result.log[1]!.at(-1)!.source,done.result.relic);
      assert.equal(done.result.log[1]![0]!.source,done.result.card);
    }
    for(const result of results.slice(1))assert.deepEqual(results[0],result);
  }finally{for(const instance of instances){await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);}if(snapshot)await loaded.persistence!.release(snapshot);}
});

test('an emitting sorting kernel shares original event dispatch and origin envelopes',async()=>{
  const {withProbability}=await import('../src/rules/execution.ts');
  const fixture=rules.defineRules({requires:[],build(m){
    const log=m.own(rules.defineComponent({schema:z.array(z.object({value:z.number(),cause:typedValue<Cause>()})),initial:()=>[]}));
    const event=m.own(rules.defineEvent({payload:z.number(),dispatch:'immediate'}));
    const record=m.atom({input:z.object({value:z.number(),cause:typedValue<Cause>()}),output:z.undefined(),reads:[log],writes:[log],emits:[],run(r,i){return{writes:[{entity:0,component:log,value:[...r.component(0,log),i]}],events:[],result:undefined};}});
    const reaction=rules.on(event.public,{effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.call(record,{value:b.read(v=>v.input.event),cause:rules.query(effectTrace.exports.current,undefined)}))});
    const publish=withProbability(m.atom({input:z.number(),output:z.number(),reads:[],writes:[],emits:[event],run:(_r,i)=>({writes:[],events:[{event,payload:i}],result:i})}),{
      space:()=>({kind:'uniform',size:2n}),run:(_r,i,c)=>({writes:[],events:[{event,payload:i+Number(c)}],result:i+Number(c)}),
    });
    const history=rules.defineQuery({input:z.undefined(),output:z.unknown(),reads:[log],base:r=>r.component(0,log)});
    return{exports:{publish,history,reaction}};
  }});
  const body=rules.defineEffect<void,unknown>(b=>rules.sequence(
    rules.install({ability:fixture.exports.reaction,source:0,owner:0,environment:{},lifetime:0}),
    rules.call(fixture.exports.publish,5),b.return(rules.query(fixture.exports.history,undefined)),
  ));
  const entry=fromSource(body,()=>({source:0,owner:0,registration:null,kind:OriginKind.Card,action:77}));
  const definition=linkRules({id:'sts/probability-event-origin',schemas:{setup:z.undefined(),result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry,body],modules:[fixture],initialEntities:[0]});
  const program=new CardProgram(definition);
  for(const probability of [false,true]){
    const machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));
    try{
      let stop=probability?machine.advanceProbability():machine.advance();
      if(probability){assert.deepEqual(stop,{kind:'chance',space:{kind:'uniform',size:2n}});stop=machine.advanceProbability(1n);}
      assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected event completion');
      const history=stop.result as {value:number;cause:Cause}[];assert.equal(history.length,1);assert.equal(history[0]!.value,probability?6:5);
      assert.equal(history[0]!.cause[0]!.action,77);assert.equal(history[0]!.cause[0]!.kind,OriginKind.Card);
    }finally{machine.storage.close?.();}
  }
});
