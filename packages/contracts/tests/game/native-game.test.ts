import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import type {GameModule} from '@bear-forge/contracts/authoring';
import {nativeGame} from '../support/native-game.ts';

type G={setup:null;ports:{ask:{kind:'request';input:number;output:number};events:{kind:'event';input:{hidden:boolean;text:string}[];output:null}};programResult:number;view:number;actions:{pick:{request:null;action:number;description:never}};player:'a'|'b';observation:number;event:{hidden:boolean;text:string};playerEvent:string;result:number;control:never};
const Event=z.strictObject({hidden:z.boolean(),text:z.string()});
function fixture(events:G['event'][]=[]):GameModule<G>{return {
 program:{schemas:{setup:z.null(),result:z.number(),ports:{ask:{kind:'request',input:z.number().nonnegative(),output:z.number()},events:{kind:'event',input:z.array(Event),output:z.null()}}},run:async(_,io)=>{
  if(events.length)await io.call({port:'events',input:events});return await io.call({port:'ask',input:0});
 }},
 contract:{schemas:{view:z.number(),player:z.enum(['a','b']),observation:z.number(),event:Event,playerEvent:z.string(),result:z.number(),actions:{pick:{request:z.null(),action:z.number(),description:z.never()}}},
  ports:{ask:{kind:'request',receive:view=>({view,requests:[{key:'pick',player:'a',type:'pick',data:null}]}),respond:(_v,_r,a)=>a===1?{valid:true,output:a}:{valid:false,reason:'only one'}},events:{kind:'event',receive:events=>({events:[...events],output:null})}},
  finish:result=>({view:result,result}),observe:view=>view,projectEvent:(e,p)=>e.hidden&&p==='a'?null:{event:e.text},
  inputs:{pick:{options:z.strictObject({kind:z.literal('exact'),values:z.array(z.number())}),describe:()=>({kind:'exact',values:[1]})}},
 },
};}
const publicEvent=(text:string)=>({hidden:false,text});
const hiddenEvent={hidden:true,text:'secret'};

test('hidden event insertion cannot change the visible ordinal stream',async()=>{
 const streams=[];
 for(const batch of [[publicEvent('first'),publicEvent('second')],[hiddenEvent,publicEvent('first'),hiddenEvent,publicEvent('second'),hiddenEvent]]){
  const game=await nativeGame(fixture(batch),null),seen:unknown[]=[];
  await game.bind({player:'a',onEvent:async d=>{seen.push([d.id.index,d.event]);return {kind:'reply',value:null};}});
  await game.run();streams.push(seen);await game.close();
 }
 assert.deepEqual(streams,[[[0,'first'],[1,'second']],[[0,'first'],[1,'second']]]);
});

test('visible ordinals are per player and stable after partial delivery and rebinding',async()=>{
 const game=await nativeGame(fixture([hiddenEvent,publicEvent('first'),publicEvent('second')]),null);
 const a:unknown[]=[],b:unknown[]=[];let pause=true;
 await game.bind({player:'a',onEvent:async d=>{a.push(d);return pause&&d.id.index===1?{kind:'pause'}:{kind:'reply',value:null};}});
 await game.bind({player:'b',onEvent:async d=>{b.push([d.id.index,d.event]);return {kind:'reply',value:null};}});
 const first=await game.run();assert.ok(first.ok);if(first.ok)assert.equal(first.value.pause,'requested');
 pause=false;await game.bind({player:'b'});await game.run();
 assert.deepEqual(a.slice(0,2),a.slice(2));
 assert.deepEqual(b,[[0,'secret'],[1,'first']]);await game.close();
});

test('program results are checked before an adapter can hide an invalid result',async()=>{
 const m=fixture();let finished=false;m.program.schemas.result=z.literal(0);m.program.run=async()=>1;
 m.contract.finish=()=>{finished=true;return {view:0,result:0};};
 const game=await nativeGame(m,null),state=await game.inspect();
 assert.ok(state.ok&&state.value.kind==='fault');if(state.ok&&state.value.kind==='fault')assert.equal(state.value.error.code,'invalid_output');
 assert.equal(finished,false);await game.close();
});

test('invalid port input faults before any game adapter or callback receives it',async()=>{
 const m=fixture();let received=false;m.program.run=async(_,io)=>io.call({port:'ask',input:-1});
 m.contract.ports.ask.receive=()=>{received=true;return {view:0,requests:[]};};
 const game=await nativeGame(m,null),state=await game.inspect();
 assert.ok(state.ok&&state.value.kind==='fault');if(state.ok&&state.value.kind==='fault')assert.equal(state.value.error.code,'invalid_output');
 assert.equal(received,false);await game.close();
});

test('a program cannot catch an invalid port call and turn it into a successful result',async()=>{
 const m=fixture();m.program.run=async(_,io)=>{try{await io.call({port:'ask',input:-1});}catch{}return 1;};
 const game=await nativeGame(m,null);await Promise.resolve();const state=await game.inspect();assert.ok(state.ok&&state.value.kind==='fault');await game.close();
});

test('a rejected host action preserves the same request for a valid retry',async()=>{
 const game=await nativeGame(fixture(),null),before=await game.inspect();
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:99})});
 const rejected=await game.run();assert.ok(rejected.ok);if(rejected.ok){assert.equal(rejected.value.pause,'invalid_reply');assert.equal(rejected.value.accepted,null);}
 assert.deepEqual(await game.inspect(),before);
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});const accepted=await game.run();assert.ok(accepted.ok&&accepted.value.accepted?.kind==='action');await game.close();
});

test('program faults remain faults for all state readers, never busy',async()=>{
 const m=fixture();m.program.run=async(_,io)=>{await io.call({port:'ask',input:0});throw new Error('failure');};
 const game=await nativeGame(m,null),before=await game.inspect();assert.ok(before.ok&&before.value.kind==='request');if(!before.ok||before.value.kind!=='request')return;
 const request=before.value.requests[0]!;
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});
 const result=await game.run();assert.ok(result.ok&&result.value.accepted?.kind==='action'&&result.value.state.kind==='fault');
 for(const read of [()=>game.observe({player:'a'}),()=>game.describe({requestId:request.id,type:'pick'}),()=>game.validate({player:'a',reply:{requestId:request.id,type:'pick',action:1}})]){
  const value=await read();assert.equal(value.ok,false);if(!value.ok)assert.equal(value.error.code,'program_failed');
 }
 const rerun=await game.run();assert.ok(rerun.ok&&rerun.value.state.kind==='fault'&&rerun.value.accepted===null);
 assert.ok((await game.close()).ok);const closed=await game.run();assert.ok(!closed.ok&&closed.error.code==='game_closed');
});

test('empty requests without session are a contract fault rather than an unbound wait',async()=>{
 const m=fixture();m.contract.ports.ask.receive=view=>({view,requests:[]});
 const game=await nativeGame(m,null),result=await game.run();
 assert.ok(result.ok&&result.value.state.kind==='fault'&&result.value.state.error.code==='invalid_output');
 const closed=await game.inspect();assert.ok(!closed.ok&&closed.error.code==='game_closed');
});

test('a converter cannot claim a valid output outside the port schema',async()=>{
 const m=fixture();m.program.schemas.ports.ask.output=z.literal(0);
 const game=await nativeGame(m,null);await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});
 const result=await game.run();assert.ok(result.ok&&result.value.state.kind==='fault'&&result.value.accepted===null);
 const closed=await game.inspect();assert.ok(!closed.ok&&closed.error.code==='game_closed');
});

test('a finish projection fault preserves accepted input and closes the game',async()=>{
 const m=fixture();m.contract.finish=()=>{throw new Error('bad projection');};
 const game=await nativeGame(m,null);await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});
 const result=await game.run();assert.ok(result.ok&&result.value.state.kind==='fault'&&result.value.accepted?.kind==='action');
 const closed=await game.inspect();assert.ok(!closed.ok&&closed.error.code==='game_closed');
});

test('malformed envelopes and binding values never throw or mutate the request',async()=>{
 const game=await nativeGame(fixture(),null),before=await game.inspect();
 for(const raw of [null,123,{},[],{player:'a',extra:true}]){
  assert.equal((await game.observe(raw as never)).ok,false);assert.equal((await game.validate(raw as never)).ok,false);assert.equal((await game.describe(raw as never)).ok,false);
 }
 for(const raw of [123,{},[],{player:'a',onRequest:123}])assert.equal((await game.bind(raw as never)).ok,false);
 for(const raw of [null,123,{signal:123},{other:1}])assert.equal((await game.run(raw as never)).ok,false);
 assert.deepEqual(await game.inspect(),before);await game.close();
});

test('a schema may not transform an observed boundary value',async()=>{
 const m=fixture();m.contract.schemas.observation=z.number().transform(n=>n+1);
 const game=await nativeGame(m,null),result=await game.inspect();assert.ok(!result.ok&&result.error.code==='invalid_output');
});

test('terminal programs with no ports or actions remain usable',async()=>{
 type Empty={setup:null;ports:{};programResult:null;view:null;actions:{};player:'a';observation:null;event:null;playerEvent:null;result:null;control:never};
 const m:GameModule<Empty>={program:{schemas:{setup:z.null(),result:z.null(),ports:{}},run:async()=>null},contract:{schemas:{view:z.null(),player:z.literal('a'),observation:z.null(),event:z.null(),playerEvent:z.null(),result:z.null(),actions:{}},ports:{},inputs:{},finish:()=>({view:null,result:null}),observe:()=>null,projectEvent:()=>null}};
 const game=await nativeGame(m,null),result=await game.run();assert.ok(result.ok&&result.value.state.kind==='ended'&&result.value.accepted===null);
 assert.deepEqual(await game.observe({player:'a'}),{ok:true,value:null});await game.close();
});

test('an invalid prepared output found by a reader revokes an active driver',async()=>{
 const m=fixture();m.program.schemas.ports.ask.output=z.literal(0);
 const game=await nativeGame(m,null),state=await game.inspect();assert.ok(state.ok&&state.value.kind==='request');if(!state.ok||state.value.kind!=='request')return;
 const r=state.value.requests[0]!;
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 await game.bind({player:'a',onRequest:async()=>{started();return new Promise(()=>{});}});
 const driving=game.run();await ready;
 const check=await game.validate({player:'a',reply:{requestId:r.id,type:'pick',action:1}});assert.ok(!check.ok&&check.error.code==='invalid_output');
 const result=await driving;assert.ok(result.ok&&result.value.state.kind==='fault');if(result.ok){assert.equal(result.value.accepted,null);assert.equal(result.value.pause,null);}
 const closed=await game.inspect();assert.ok(!closed.ok&&closed.error.code==='game_closed');
});

test('frozen request projection objects are valid and are never mutated by the adapter',async()=>{
 const m=fixture();m.contract.ports.ask.receive=view=>Object.freeze({view,requests:[{key:'pick',player:'a' as const,type:'pick' as const,data:null}]});
 const game=await nativeGame(m,null),state=await game.inspect();assert.ok(state.ok&&state.value.kind==='request');await game.close();
});

test('a bad program result after an action retains accepted and faults instead of ending',async()=>{
 const m=fixture();m.program.schemas.result=z.literal(0);
 const game=await nativeGame(m,null);await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});
 const result=await game.run();assert.ok(result.ok&&result.value.accepted?.kind==='action'&&result.value.state.kind==='fault');
 if(result.ok&&result.value.state.kind==='fault')assert.equal(result.value.state.error.code,'invalid_output');await game.close();
});

test('lifecycle conflicts precede malformed arguments and repeated close is closed',async()=>{
 const game=await nativeGame(fixture(),null);await game.close();
 for(const read of [()=>game.observe(null as never),()=>game.describe(null as never),()=>game.validate(null as never),()=>game.run(null as never),()=>game.bind(123 as never),()=>game.close()]){
  const result=await read();assert.ok(!result.ok&&result.error.code==='game_closed');
 }
});

test('invalid setup is rejected before the author program runs',async()=>{
 const m=fixture();let started=false;m.program.run=async()=>{started=true;return 0;};
 await assert.rejects(nativeGame(m,123 as never));assert.equal(started,false);
});

test('unknown ports and overlapping calls cannot silently replace a pending request',async()=>{
 for(const overlap of [false,true]){
  const m=fixture();m.program.run=async(_,io)=>{
   if(!overlap)return io.call({port:'unknown',input:0} as never);
   await Promise.all([io.call({port:'ask',input:0}),io.call({port:'ask',input:0})]);return 0;
  };
  const game=await nativeGame(m,null),state=await game.inspect();assert.ok(state.ok&&state.value.kind==='fault');
  if(state.ok&&state.value.kind==='fault')assert.equal(state.value.error.code,overlap?'program_failed':'invalid_output');await game.close();
 }
});

test('fault values returned to readers cannot mutate the stored terminal fault',async()=>{
 const m=fixture();m.program.run=async()=>{throw new Error('original');};
 const game=await nativeGame(m,null),before=await game.inspect();
 const observed=await game.observe({player:'a'});assert.equal(observed.ok,false);if(!observed.ok)observed.error.message='mutated';
 assert.deepEqual(await game.inspect(),before);await game.close();
});
