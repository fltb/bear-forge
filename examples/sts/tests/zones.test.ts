import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,linkRules,CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import {portEffect} from '../../../packages/card-engine/src/rules-internal.ts';
import {createCardLoader} from '@bear-forge/runtime-card';
import {zones} from '../src/rules/zones.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineEntity,defineEffect,defineQuery,spawnEntity,sequence,call,query,forEach}=rules;
const members=defineRules({requires:[zones],build(m){return{exports:{kind:m.kind({config:z.undefined(),components:[zones.exports.member]})}};}});
const card=defineEntity(members.exports.kind,undefined),unbounded=defineEntity(zones.exports.kind,{capacity:null}),hand=defineEntity(zones.exports.kind,{capacity:10});
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const names=['draw','hand','discard','exhaust'] as const;
type Name=typeof names[number];
type Step={from:Name;to:Name;index:number;position?:number};
type Piles=Record<Name,readonly number[]>;
const stateSchema=z.object({draw:z.array(z.number()),hand:z.array(z.number()),discard:z.array(z.number()),exhaust:z.array(z.number())});
const views=defineRules({requires:[zones,members],build(){const view=defineQuery({input:z.object({draw:z.number(),hand:z.number(),discard:z.number(),exhaust:z.number()}),output:stateSchema,dependencies:[zones.exports.members],base:(r,ids)=>({
  draw:r.query(zones.exports.members,ids.draw),hand:r.query(zones.exports.members,ids.hand),discard:r.query(zones.exports.members,ids.discard),exhaust:r.query(zones.exports.members,ids.exhaust),
})});return{exports:{view}};}});
const {view}=views.exports;
function fixture(steps:readonly Step[]){
  const entry=defineEffect<void,Piles[]>(b=>{
    const cards=b.local<number[]>(),draw=b.local<number>(),inHand=b.local<number>(),discard=b.local<number>(),exhaust=b.local<number>(),history=b.local<Piles[]>();
    const ids={draw,hand:inHand,discard,exhaust};
    return sequence(b.assign(cards,[]),forEach([0,1,2,3],()=>{const id=b.local<number>();return sequence(b.assign(id,spawnEntity({definition:card,owner:null,scope:0})),b.assign(cards,b.read(v=>[...v.get(cards),v.get(id)])));}),
      b.assign(draw,spawnEntity({definition:unbounded,owner:null,scope:0})),b.assign(inHand,spawnEntity({definition:hand,owner:null,scope:0})),
      b.assign(discard,spawnEntity({definition:unbounded,owner:null,scope:0})),b.assign(exhaust,spawnEntity({definition:unbounded,owner:null,scope:0})),
      forEach(cards,id=>call(zones.exports.move,{entity:id,from:null,to:draw,index:b.read(v=>v.get(query(zones.exports.members,v.get(draw))).length)})),
      b.assign(history,[query(view,ids)]),...steps.flatMap(step=>[
        call(zones.exports.move,b.read(v=>{
          const from=v.get(ids[step.from]),to=v.get(ids[step.to]),source=v.get(query(zones.exports.members,from)),target=v.get(query(zones.exports.members,to));
          return{entity:source[step.index]!,from,to,index:step.position??target.length};
        })),b.assign(history,b.read(v=>[...v.get(history),v.get(query(view,{draw:v.get(draw),hand:v.get(inHand),discard:v.get(discard),exhaust:v.get(exhaust)}))])),
      ]),b.return(history),
    );
  });
  return linkRules({id:'sts/zone-fixture-1',schemas:{setup:z.undefined(),result:z.array(stateSchema),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[views]});
}

test('zone moves preserve exact CardManager order in C++ and both real Instance modes',async()=>{
  const steps:Step[]=[{from:'draw',to:'hand',index:3},{from:'draw',to:'hand',index:2},{from:'hand',to:'discard',index:0},
    {from:'hand',to:'exhaust',index:0},{from:'discard',to:'draw',index:0},{from:'draw',to:'hand',index:0},
    {from:'hand',to:'draw',index:0,position:0},{from:'exhaust',to:'discard',index:0}];
  const reference=await ReferenceClient.create();
  try{
    const expected=await reference.call({op:'zone-case',count:4,steps});
    for(const controlled of [false,true]){
      const loaded=unwrap(await createCardLoader({controlled}).load(fixture(steps))),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error(JSON.stringify(stop));assertSameState(expected,stop.result,`zones controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
    }
  }finally{await reference.close();}
});

test('a full destination cannot lose a source member, and reordering preserves the exact membership',async()=>{
  const singleton=defineEntity(zones.exports.kind,{capacity:1});
  const entry=defineEffect<void,unknown>(b=>{
    const a=b.local<number>(),c=b.local<number>(),source=b.local<number>(),target=b.local<number>(),legal=b.local<boolean>();
    return sequence(b.assign(a,spawnEntity({definition:card,owner:null,scope:0})),b.assign(c,spawnEntity({definition:card,owner:null,scope:0})),
      b.assign(source,spawnEntity({definition:unbounded,owner:null,scope:0})),b.assign(target,spawnEntity({definition:singleton,owner:null,scope:0})),
      call(zones.exports.move,{entity:a,from:null,to:target,index:0}),call(zones.exports.move,{entity:c,from:null,to:source,index:0}),
      b.assign(legal,query(zones.exports.canMove,{entity:c,from:source,to:target,index:1})),
      call(zones.exports.move,{entity:a,from:target,to:source,index:1}),call(zones.exports.reorder,{zone:source,order:[a,c]}),
      b.return({legal,source:query(zones.exports.members,source),target:query(zones.exports.members,target),locations:[query(zones.exports.location,a),query(zones.exports.location,c)]}),
    );
  });
  const definition=linkRules({id:'sts/zone-boundaries-1',schemas:{setup:z.undefined(),result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[members]});
  for(const controlled of [false,true]){
    const loaded=unwrap(await createCardLoader({controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
    const stop=unwrap(await instance.inspect());assert.deepEqual(stop.kind==='done'?stop.result:stop,{legal:false,source:[1,2],target:[],locations:[3,3]});
    await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);
  }
});

test('illegal movement and a non-permutation fail before changing either half of membership',()=>{
  const pause=portEffect<void,void>('pause'),singleton=defineEntity(zones.exports.kind,{capacity:1});
  for(const operation of ['move','reorder'] as const){
    const entry=defineEffect<void,void>(b=>{
      const a=b.local<number>(),c=b.local<number>(),source=b.local<number>(),target=b.local<number>();
      return sequence(b.assign(a,spawnEntity({definition:card,owner:null,scope:0})),b.assign(c,spawnEntity({definition:card,owner:null,scope:0})),
        b.assign(source,spawnEntity({definition:unbounded,owner:null,scope:0})),b.assign(target,spawnEntity({definition:singleton,owner:null,scope:0})),
        call(zones.exports.move,{entity:a,from:null,to:target,index:0}),call(zones.exports.move,{entity:c,from:null,to:source,index:0}),call(pause,undefined),
        operation==='move'?call(zones.exports.move,{entity:c,from:source,to:target,index:1}):call(zones.exports.reorder,{zone:source,order:[a]}),
      );
    });
    const definition=linkRules({id:'sts/zone-invalid-1',schemas:{setup:z.undefined(),result:z.undefined(),ports:{pause:{input:z.undefined(),output:z.undefined()}}},initialize:()=>({}),entry,definitions:[entry,pause],modules:[members]});
    const program=new CardProgram(definition),machine=new CardMachine(program,plainCardStorage(program.initial(undefined)));
    assert.equal(machine.advance().kind,'call');const before=structuredClone(machine.root.state);
    assert.equal(machine.advance(undefined).kind,'fault');assert.deepEqual(machine.root.state,before,'failed commit must preserve the entire module state');
  }
});
