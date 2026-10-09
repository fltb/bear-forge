import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {InstanceIdSchema,CallIdSchema} from '@bear-forge/contracts';
import type {GameContract,GameBindings,DecisionData} from '@bear-forge/contracts';
import {playerConsumer} from './player-consumer.ts';

const Player=z.enum(['a','b']);
const Actor=z.strictObject({owner:Player,unit:z.string()});
const View=z.strictObject({hands:z.strictObject({a:z.array(z.string()),b:z.array(z.string())})});
const RawEvent=z.strictObject({owner:Player,card:z.string()});
const VisibleEvent=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('own'),card:z.string()}),
  z.strictObject({kind:z.literal('other'),count:z.number()}),
]);
type G={
  setup:null;ports:{};programResult:null;view:z.infer<typeof View>;
  interactions:{pick:{request:null;input:number;description:never}};
  actor:z.infer<typeof Actor>;player:z.infer<typeof Player>;delivery:null;signal:{tick:number};
  observation:{hand:string[]};event:z.infer<typeof RawEvent>;playerEvent:z.infer<typeof VisibleEvent>;result:null;
};
const contract:GameContract<G,{}>={
  schemas:{view:View,actor:Actor,player:Player,delivery:z.null(),signal:z.strictObject({tick:z.number()}),
    observation:z.strictObject({hand:z.array(z.string())}),event:RawEvent,playerEvent:VisibleEvent,result:z.null(),
    interactions:{pick:{request:z.null(),input:z.number(),description:z.never()}}},
  ports:{},finish:()=>({view:{hands:{a:[],b:[]}},result:null}),
  playerFor:actor=>actor.owner,
  observe:(view,player)=>({hand:[...view.hands[player]]}),
  projectEvent:(event,player)=>({event:event.owner===player?{kind:'own',card:event.card}:{kind:'other',count:1}}),
  inputs:{pick:{options:z.strictObject({kind:z.literal('exact'),values:z.array(z.number())}),describe:()=>({kind:'exact',values:[0,1]})}},
  queries:{},
};
const instanceId=InstanceIdSchema.parse('00000000-0000-4000-8000-000000000001');
const callId=CallIdSchema.parse('00000000-0000-4000-8000-000000000002');
const data:DecisionData<G>={view:{hands:{a:['secret-a'],b:['secret-b']}},signalPlayers:[],choices:[
  {id:'a1',actor:{owner:'a',unit:'one'},type:'pick',request:null},
  {id:'a2',actor:{owner:'a',unit:'two'},type:'pick',request:null},
  {id:'b1',actor:{owner:'b',unit:'one'},type:'pick',request:null},
]};
type Binding=GameBindings<G['interactions'],G['actor'],G['delivery'],G['signal'],G['player'],G['observation'],G['playerEvent']>;
const reply=(id:string)=>({kind:'reply' as const,value:{kind:'choice' as const,choiceId:id,input:{type:'pick' as const,value:0},delivery:null}});

test('same decision callback receives isolated player state and only its own actor offers',async()=>{
  const consumer=playerConsumer(contract,instanceId),seen:string[]=[];
  const callback:NonNullable<Binding['onDecision']>=async(request,control)=>{
    seen.push(control.player);
    assert.deepEqual(request.observation,{hand:[`secret-${control.player}`]});
    assert.ok(request.offers.every(offer=>offer.choice.actor.owner===control.player));
    assert.equal(request.offers.length,control.player==='a'?2:1);
    request.observation.hand.length=0;
    return {kind:'pause'};
  };
  consumer.bind({player:'a',onDecision:callback});consumer.bind({player:'b',onDecision:callback});
  assert.deepEqual(await consumer.decision(data,callId,()=>{throw new Error('pause must retain boundary');}),{kind:'paused',reason:'requested'});
  assert.deepEqual(seen,['a','b']);assert.deepEqual(data.view.hands,{a:['secret-a'],b:['secret-b']});
  assert.deepEqual(consumer.observe(data.view,'a'),{hand:['secret-a']});
});

test('same event callback receives distinct projections and private events can be hidden',async()=>{
  const consumer=playerConsumer(contract,instanceId),seen:unknown[]=[];
  const callback:NonNullable<Binding['onEvent']>=async(delivery,control)=>{seen.push([control.player,delivery.event]);return {kind:'reply',value:null};};
  for(const player of ['a','b'] as const)consumer.bind({player,onEvent:callback});
  await consumer.events([{owner:'a',card:'B'}],callId);
  assert.deepEqual(seen,[['a',{kind:'own',card:'B'}],['b',{kind:'other',count:1}]]);
  const hidden=playerConsumer({...contract,projectEvent:(event,player)=>event.owner===player?contract.projectEvent(event,player):null},instanceId);
  for(const player of ['a','b'] as const)hidden.bind({player,onEvent:callback});
  seen.length=0;await hidden.events([{owner:'a',card:'B'}],callId);
  assert.deepEqual(seen,[['a',{kind:'own',card:'B'}]]);
});

test('binding replaces only the same player; an empty binding removes that player',async()=>{
  const consumer=playerConsumer(contract,instanceId),seen:string[]=[];
  const callback=(label:string):NonNullable<Binding['onEvent']>=>async()=>{seen.push(label);return {kind:'reply',value:null};};
  consumer.bind({player:'a',onEvent:callback('old')});consumer.bind({player:'b',onEvent:callback('b')});
  consumer.bind({player:'a',onEvent:callback('new')});await consumer.events([{owner:'a',card:'x'}],callId);
  assert.deepEqual(seen,['new','b']);seen.length=0;consumer.bind({player:'a'});
  await consumer.events([{owner:'a',card:'x'}],callId);assert.deepEqual(seen,['b']);
  consumer.bind(null);seen.length=0;await consumer.events([{owner:'a',card:'x'}],callId);assert.deepEqual(seen,[]);
});

test('cross-player replies are rejected before the game responder runs',async()=>{
  const consumer=playerConsumer(contract,instanceId);let called=0;
  consumer.bind({player:'a',onDecision:async()=>reply('b1')});
  const result=await consumer.decision(data,callId,()=>{called++;return {valid:true,output:null};});
  assert.deepEqual(result,{kind:'paused',reason:'invalid_reply'});assert.equal(called,0);
});

test('signal-only waits include observation and target only the declared signal players',async()=>{
  const consumer=playerConsumer(contract,instanceId);let seen=0;
  consumer.bind({player:'a',onDecision:async()=>{throw new Error('a is not a signal recipient');}});
  consumer.bind({player:'b',onDecision:async request=>{
    seen++;assert.deepEqual(request.offers,[]);assert.equal(request.acceptsSignal,true);
    assert.deepEqual(request.observation,{hand:['secret-b']});
    return {kind:'reply',value:{kind:'signal',signal:{tick:3}}};
  }});
  const result=await consumer.decision({...data,choices:[],signalPlayers:['b']},callId,(_view,input,player)=>({valid:true,output:{input,player}}));
  assert.equal(result.kind,'accepted');assert.equal(seen,1);
  assert.equal(consumer.validate(data,'b',{kind:'signal',signal:{tick:3}}),false);
});

test('one accepted reply cancels competing waits and late replies never enter the responder',async()=>{
  const consumer=playerConsumer(contract,instanceId);let called=0,late!:()=>void,lateSignal:AbortSignal|undefined;
  consumer.bind({player:'a',onDecision:async()=>reply('a1')});
  consumer.bind({player:'b',onDecision:(_request,control)=>{lateSignal=control.signal;return new Promise(resolve=>{late=()=>resolve(reply('b1'));});}});
  const result=await consumer.decision(data,callId,()=>{called++;return {valid:true,output:1};});
  assert.equal(result.kind,'accepted');assert.equal(called,1);assert.equal(lateSignal?.aborted,true);
  late();await Promise.resolve();await Promise.resolve();assert.equal(called,1);
});

test('external cancellation releases an unresolved decision callback',async()=>{
  const consumer=playerConsumer(contract,instanceId),abort=new AbortController();let called=0;
  consumer.bind({player:'a',onDecision:async()=>new Promise(()=>{})});
  const pending=consumer.decision(data,callId,()=>{called++;return {valid:true,output:1};},abort.signal);
  abort.abort();assert.deepEqual(await pending,{kind:'paused',reason:'cancelled'});assert.equal(called,0);
});

test('a malformed or refused reply does not suppress another player valid reply',async()=>{
  for(const invalid of [undefined,{kind:'reply',value:null},reply('b1')]){
    const consumer=playerConsumer(contract,instanceId);
    consumer.bind({player:'a',onDecision:async()=>invalid as never});
    consumer.bind({player:'b',onDecision:async()=>reply('b1')});
    const result=await consumer.decision(data,callId,()=>({valid:true,output:null}));
    assert.equal(result.kind,'accepted');if(result.kind==='accepted')assert.equal(result.player,'b');
  }
});

test('event retry preserves source IDs and repeats earlier player acknowledgments',async()=>{
  const consumer=playerConsumer(contract,instanceId),seen:unknown[]=[];let pause=true;
  const callback:NonNullable<Binding['onEvent']>=async(delivery,control)=>{
    seen.push([control.player,delivery.id,delivery.event]);
    return control.player==='b'&&pause?{kind:'pause'}:{kind:'reply',value:null};
  };
  for(const player of ['a','b'] as const)consumer.bind({player,onEvent:callback});
  const events=[{owner:'a' as const,card:'Q'}];
  assert.deepEqual(await consumer.events(events,callId),{kind:'pause'});
  pause=false;assert.deepEqual(await consumer.events(events,callId),{kind:'reply',value:null});
  assert.deepEqual(seen.slice(0,2),seen.slice(2));
});
