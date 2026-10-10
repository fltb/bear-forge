import { createGameSDK } from '@bear-forge/game-sdk';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import type {GameModule,GameContract,GamePortDeclarations} from '@bear-forge/contracts/authoring';
import {nativeGame} from './player-consumer.ts';
const Player=z.enum(['a','b']);
const View=z.strictObject({n:z.number(),hands:z.strictObject({a:z.array(z.string()),b:z.array(z.string())})});
const Raw=z.strictObject({owner:Player,value:z.number()});
const Visible=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('own'),value:z.number()}),z.strictObject({kind:z.literal('other'),count:z.number()})]);
type G={setup:null;ports:{ask:{kind:'request';input:z.infer<typeof View>;output:number};event:{kind:'event';input:z.infer<typeof Raw>[];output:null}};programResult:z.infer<typeof View>;view:z.infer<typeof View>;
 actions:{pick:{request:{unit:string};action:number;description:never}};player:z.infer<typeof Player>;observation:{hand:string[]};event:z.infer<typeof Raw>;playerEvent:z.infer<typeof Visible>;result:number;control:{request:{n:number};input:{tick:number}}};
const ports={ask:{kind:'request',input:View,output:z.number()},event:{kind:'event',input:z.array(Raw),output:z.null()}} satisfies GamePortDeclarations<G['ports']>;
const requests=[{key:'a1',player:'a' as const,type:'pick' as const,data:{unit:'one'}},{key:'a2',player:'a' as const,type:'pick' as const,data:{unit:'two'}},{key:'b1',player:'b' as const,type:'pick' as const,data:{unit:'one'}}];
function toy(options:{signalOnly?:boolean;failAfterInput?:boolean;hidden?:boolean;initialEvent?:boolean}={}):GameModule<G>{
 const contract:GameContract<G>={
  schemas:{view:View,player:Player,observation:z.strictObject({hand:z.array(z.string())}),event:Raw,playerEvent:Visible,result:z.number(),actions:{pick:{request:z.strictObject({unit:z.string()}),action:z.number(),description:z.never()}}},
  ports:{ask:{kind:'request',receive:view=>({view:structuredClone(view) as G['view'],requests:options.signalOnly?[]:requests}),respond:(_view,_request,action)=>action===0||action===1?{valid:true,output:action}:{valid:false,reason:'illegal number'},
    session:{requestSchema:z.strictObject({n:z.number()}),inputSchema:z.strictObject({tick:z.number()}),request:view=>({n:view.n}),respond:(_view,input)=>({valid:true,output:input.tick})}},
   event:{kind:'event',receive:events=>({events:structuredClone(events) as G['event'][],output:null})}},
  finish:view=>({view:structuredClone(view) as G['view'],result:view.n}),observe:(view,player)=>({hand:[...view.hands[player]]}),
  projectEvent:(event,player)=>options.hidden&&event.owner!==player?null:{event:event.owner===player?{kind:'own',value:event.value}:{kind:'other',count:1}},
  inputs:{pick:{options:z.strictObject({kind:z.literal('exact'),values:z.array(z.number())}),describe:()=>({kind:'exact',values:[0,1]})}},
 };
 return {contract,program:{schemas:{setup:z.null(),result:View,ports},run:async(_setup,io)=>{
  const sdk=createGameSDK<G['ports']>(io,ports);
  const state={n:0,hands:{a:['secret-a'],b:['secret-b']}};
  if(options.initialEvent)await sdk.event([{owner:'a',value:7}]);
  while(state.n<2){const value=await sdk.ask(state);state.n++;
   if(options.failAfterInput)throw new Error('rule failure after accepting input');
   await sdk.event([{owner:'a',value}]);
  }
  return state;
 }}};
}

test('same callback gets each request directly with its own player and observation',async()=>{
 const game=await nativeGame(toy(),null),seen:string[]=[];
 const callback:NonNullable<Parameters<typeof game.bind>[0]>['onRequest']=async r=>{
  seen.push(r.id.key);assert.deepEqual(r.observation,{hand:[`secret-${r.player}`]});r.observation.hand.length=0;return {kind:'pause'};
 };
 for(const player of ['a','b'] as const)await game.bind({player,onRequest:callback});
 const result=await game.run();assert.ok(result.ok);if(!result.ok)return;assert.equal(result.value.accepted,null);assert.equal(result.value.pause,'requested');assert.deepEqual(seen,['a1','a2','b1']);
 const view=await game.observe({player:'a'});assert.deepEqual(view,{ok:true,value:{hand:['secret-a']}});await game.close();
});
test('a run accepts one action, drains events and returns the exact accepted request',async()=>{
 const game=await nativeGame(toy(),null);let callbacks=0;
 await game.bind({player:'a',onRequest:async()=>{callbacks++;return {kind:'reply',value:1};}});
 const first=await game.run();assert.ok(first.ok);if(!first.ok)return;assert.equal(first.value.state.kind,'request');assert.equal(first.value.accepted?.kind,'action');
 if(first.value.accepted?.kind==='action'){assert.equal(first.value.accepted.player,'a');assert.equal(first.value.accepted.reply.action,1);assert.equal(first.value.accepted.reply.requestId.key,'a1');}
 assert.equal(callbacks,2);
 const second=await game.run();assert.ok(second.ok);if(second.ok)assert.deepEqual(second.value.state,{kind:'ended',result:2});await game.close();
});
test('event projection supports different data per player and hidden events',async()=>{
 for(const hidden of [false,true]){const game=await nativeGame(toy({hidden}),null),seen:unknown[]=[];
 const onEvent:NonNullable<Parameters<typeof game.bind>[0]>['onEvent']=async(delivery,control)=>{seen.push([control.player,delivery.event]);return {kind:'reply',value:null};};
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1}),onEvent});await game.bind({player:'b',onEvent});await game.run();
 assert.deepEqual(seen,hidden?[['a',{kind:'own',value:1}]]:[['a',{kind:'own',value:1}],['b',{kind:'other',count:1}]]);await game.close();}
});
test('replacing and removing one player binding preserves the others',async()=>{
 const game=await nativeGame(toy({initialEvent:true}),null),seen:string[]=[];
 const callback=(s:string)=>async()=>{seen.push(s);return {kind:'reply' as const,value:null};};
 await game.bind({player:'a',onEvent:callback('old')});await game.bind({player:'b',onEvent:callback('b')});await game.bind({player:'a',onEvent:callback('new')});
 await game.run();assert.deepEqual(seen,['new','b']);await game.bind({player:'a'});await game.bind({player:'b',onRequest:async()=>({kind:'reply',value:1}),onEvent:callback('b')});
 seen.length=0;await game.run();assert.deepEqual(seen,['b']);await game.bind(null);const paused=await game.run();assert.ok(paused.ok);if(paused.ok)assert.equal(paused.value.pause,'unbound');await game.close();
});
test('wrong player, stale call and foreign instance cannot validate an action',async()=>{
 const game=await nativeGame(toy(),null),other=await nativeGame(toy(),null);const current=await game.inspect(),foreign=await other.inspect();
 assert.ok(current.ok&&current.value.kind==='request'&&foreign.ok&&foreign.value.kind==='request');
 if(!current.ok||current.value.kind!=='request'||!foreign.ok||foreign.value.kind!=='request')return;
 const request=current.value.requests[0]!;
 const reply={requestId:request.id,type:'pick' as const,action:1};
 assert.deepEqual(await game.validate({player:'b',reply}),{ok:true,value:{valid:false,reason:'request_mismatch'}});
 assert.deepEqual(await other.validate({player:'a',reply}),{ok:true,value:{valid:false,reason:'request_mismatch'}});
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});await game.run();assert.deepEqual(await game.validate({player:'a',reply}),{ok:true,value:{valid:false,reason:'request_mismatch'}});await game.close();await other.close();
});
test('session-only input uses a separate callback with no fake player action',async()=>{
 const game=await nativeGame(toy({signalOnly:true}),null);let playerCalls=0;
 await game.bind({player:'a',onRequest:async()=>{playerCalls++;return {kind:'reply',value:1};}});
 if(!game.bindControl)throw new Error('session control required');await game.bindControl(async r=>{assert.equal(r.data.n,0);return {kind:'reply',value:{tick:5}};});
 const result=await game.run();assert.ok(result.ok);if(result.ok){assert.equal(result.value.accepted?.kind,'control');if(result.value.accepted?.kind==='control')assert.deepEqual(result.value.accepted.input,{tick:5});}
 assert.equal(playerCalls,0);await game.close();
});
test('malformed and illegal actions do not suppress another valid request',async()=>{
 for(const reply of [undefined,{kind:'reply',value:99}]){const game=await nativeGame(toy(),null);
 await game.bind({player:'a',onRequest:async()=>reply as never});await game.bind({player:'b',onRequest:async()=>({kind:'reply',value:0})});
 const result=await game.run();assert.ok(result.ok);if(result.ok&&result.value.accepted?.kind==='action')assert.equal(result.value.accepted.player,'b');else assert.fail('action not accepted');await game.close();}
});
test('cancelled and losing callbacks cannot answer the next request',async()=>{
 const game=await nativeGame(toy(),null);let late!:()=>void,signal:AbortSignal|undefined;
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});
 await game.bind({player:'b',onRequest:(_request,control)=>{signal=control.signal;return new Promise(resolve=>{late=()=>resolve({kind:'reply',value:0});});}});
 const result=await game.run();assert.ok(result.ok);assert.equal(signal?.aborted,true);const before=await game.inspect();late();await Promise.resolve();await Promise.resolve();assert.deepEqual(await game.inspect(),before);await game.close();
});
test('cancellation ends a pending callback with no accepted action',async()=>{
 const game=await nativeGame(toy(),null),abort=new AbortController();await game.bind({player:'a',onRequest:async()=>new Promise(()=>{})});
 const pending=game.run({signal:abort.signal});abort.abort();const result=await pending;assert.ok(result.ok);if(result.ok){assert.equal(result.value.pause,'cancelled');assert.equal(result.value.accepted,null);}await game.close();
});
test('accepted action survives subsequent event pause, retry and program failure',async()=>{
 for(const failAfterInput of [false,true]){const game=await nativeGame(toy({failAfterInput}),null),ids:unknown[]=[];let pause=true;
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1}),onEvent:async e=>{ids.push(e.id);return pause?{kind:'pause'}:{kind:'reply',value:null};}});
 const first=await game.run();assert.ok(first.ok);if(!first.ok)return;assert.equal(first.value.accepted?.kind,'action');assert.equal(first.value.state.kind,failAfterInput?'fault':'event');
 if(!failAfterInput){pause=false;await game.bind({player:'a',onEvent:async e=>{ids.push(e.id);return {kind:'reply',value:null};}});const second=await game.run();assert.ok(second.ok);if(second.ok)assert.equal(second.value.accepted,null);assert.deepEqual(ids[0],ids[1]);}await game.close();}
});
test('accepted action survives cancellation during event delivery',async()=>{
 const game=await nativeGame(toy(),null),abort=new AbortController();
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1}),onEvent:async()=>{abort.abort();return new Promise(()=>{});}});
 const result=await game.run({signal:abort.signal});assert.ok(result.ok);if(result.ok){assert.equal(result.value.accepted?.kind,'action');assert.equal(result.value.pause,'cancelled');assert.equal(result.value.state.kind,'event');}await game.close();
});

test('mutating callback request metadata cannot change its accepted identity',async()=>{
 const game=await nativeGame(toy(),null);
 await game.bind({player:'a',onRequest:async request=>{request.id.key='b1';request.player='b';return {kind:'reply',value:1};}});
 const result=await game.run();assert.ok(result.ok);if(result.ok&&result.value.accepted?.kind==='action'){
   assert.equal(result.value.accepted.player,'a');assert.equal(result.value.accepted.reply.requestId.key,'a1');
 }else assert.fail('expected accepted action');await game.close();
});

test('a game with no session or optional storage capability runs through the basic interface',async()=>{
 const source=toy();type Plain=Omit<G,'control'>&{control:never};
 const requestPort=source.contract.ports.ask;if(requestPort.kind!=='request')throw new Error();
 const {session,...plainPort}=requestPort;void session;
 const eventPort=source.contract.ports.event;if(eventPort.kind!=='event')throw new Error();
 const module:GameModule<Plain>={...source,contract:{...source.contract,ports:{event:eventPort,ask:plainPort}}};
 const game=await nativeGame(module,null);
 assert.equal('bindControl' in game,false);assert.equal('save' in game,false);assert.equal('fork' in game,false);
 await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1})});
 const first=await game.run(),second=await game.run();assert.ok(first.ok&&second.ok);if(second.ok)assert.deepEqual(second.value.state,{kind:'ended',result:2});await game.close();
});

test('contract failure after accepting an action preserves that action and closes the game',async()=>{
 const module=toy();module.contract.projectEvent=()=>({event:{kind:'own',value:'invalid'} as never});
 const game=await nativeGame(module,null);await game.bind({player:'a',onRequest:async()=>({kind:'reply',value:1}),onEvent:async()=>({kind:'reply',value:null})});
 const result=await game.run();assert.ok(result.ok);if(result.ok){assert.equal(result.value.accepted?.kind,'action');assert.equal(result.value.state.kind,'fault');if(result.value.state.kind==='fault')assert.equal(result.value.state.error.code,'invalid_output');}
 const next=await game.inspect();assert.equal(next.ok,false);if(!next.ok)assert.equal(next.error.code,'game_closed');await game.close();
});

test('malformed public validation input is rejected without closing or advancing the game',async()=>{
 const game=await nativeGame(toy(),null),before=await game.inspect();assert.ok(before.ok&&before.value.kind==='request');if(!before.ok||before.value.kind!=='request')return;
 const request=before.value.requests[0]!;
 for(const reply of [null,{requestId:null,type:'pick',action:1},{requestId:request.id,type:'unknown',action:1}]){
  const result=await game.validate({player:'a',reply:reply as never});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'invalid_input');assert.deepEqual(await game.inspect(),before);
 }
 await game.close();
});


test('inner SDK works with construct options and terminal observations through the same outer API',async()=>{
 type Construct=Omit<G,'actions'>&{actions:{pick:{request:{unit:string};action:number;description:{minimum:number;maximum:number}}}};
 const source=toy();
 const description=z.strictObject({minimum:z.number(),maximum:z.number()});
 const module:GameModule<Construct>={...source,contract:{...source.contract,
  schemas:{...source.contract.schemas,actions:{pick:{...source.contract.schemas.actions.pick,description}}},
  inputs:{pick:{options:z.strictObject({kind:z.literal('construct'),description}),describe:()=>({kind:'construct',description:{minimum:0,maximum:1}})}},
 }};
 const base=await nativeGame(module,null);
 await base.bind({player:'a',onRequest:async request=>{
  assert.equal(request.options.kind,'construct');
  if(request.options.kind!=='construct')throw new Error('expected construction description');
  return {kind:'reply',value:request.options.description.maximum};
 }});
 await base.run();const ended=await base.run();
 assert.ok(ended.ok);if(ended.ok)assert.deepEqual(ended.value.state,{kind:'ended',result:2});
 assert.deepEqual(await base.observe({player:'a'}),{ok:true,value:{hand:['secret-a']}});
 await base.close();
});
