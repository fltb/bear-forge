import test from 'node:test';
import assert from 'node:assert/strict';
import type { IO, PortCall } from '@bear-forge/contracts/core';
import { game, program, FrameSchema } from '../src/index.ts';
import type { DouDizhuPorts, DouDizhuRequest, SessionInput, Setup, Frame, Input, Seat, Action, AuditEvent } from '../src/index.ts';
import { legalActions, prepareAction, prepareControl, observe } from '../src/module.ts';
import { apply, settle, stage } from '../src/rules.ts';

const setup=(seat:Seat='0'):Setup=>({profile:'competitive-2016-bear-1',firstBidder:seat,initialGameTime:0});
const decisionPort=game.contract.ports.decision;
if(decisionPort.kind!=='request')throw new Error('expected declared decision port');
const decision=decisionPort;
type TestInput={kind:'action';request:DouDizhuRequest;action:Action}|{kind:'control';input:SessionInput};
const choice=(f:Frame,action:Action,index=0):TestInput=>({kind:'action',request:decision.receive(f).requests[index]!,action});
const timeout=(f:Frame):TestInput=>({kind:'control',input:{kind:'timeout',slotId:f.state.stage!.slots[0]!.slotId,at:f.state.stage!.slots[0]!.deadline.atGameTime}});
const prepare=(f:Frame,input:TestInput)=>input.kind==='action'?prepareAction(f,input.request,input.action):prepareControl(f,input.input);
const pick=(f:Frame):TestInput=>{
  const actor=f.state.stage!.slots[0]!.actor;
  const a:Action=f.state.phase==='bidding'?{kind:'bid',value:3}:f.state.phase==='doubling'?{kind:'double',value:false}:f.state.phase==='redoubling'?{kind:'redouble',value:true}:legalActions(f.state,actor).at(-1)!;
  return choice(f,a);
};
/** Native differential side only: call the real author function with typed bindings. */
async function run(seed=11,seat:Seat='0',override?:(frame:Frame,index:number)=>TestInput|null){
  const frames:Frame[]=[],inputs:Input[]=[],events:AuditEvent[]=[];
  let count=0;
  const io:IO<DouDizhuPorts>={async call<A extends PortCall<DouDizhuPorts>>(call:A):Promise<DouDizhuPorts[A['port']]['output']>{
    let output:Input|null;
    if(call.port==='event') {
      const port=game.contract.ports.event;
      assert.equal(port.kind,'event');if(port.kind!=='event')throw new Error();
      const delivered=port.receive(call.input);events.push(...delivered.events);
      output=delivered.output;
    }else {
      const f=FrameSchema.parse(call.input);frames.push(f);assert.ok(++count<600);
      const projected=decision.receive(f);
      assert.equal(projected.requests.length,f.state.stage!.slots.length);
      const input=override?.(f,count)??pick(f);
      const response=prepare(f,input);
      assert.ok(response.valid,response.valid?'':response.reason);
      if(!response.valid)throw new Error('invalid response');
      output=response.output;inputs.push(output);
    }
    // The discriminated switch above validates the port/result pairing; TS does not narrow A.
    return output as DouDizhuPorts[A['port']]['output'];
  }};
  const final=await program({game:setup(seat),seed},io);frames.push(final);
  const ended=game.contract.finish(final);
  return {frames,inputs,events,result:ended.result};
}
for(const [seed,seat] of [[1,'0'],[7,'1'],[123,'2']] as const)test(`new author ports drive complete Dou Dizhu: ${seed}/${seat}`,async()=>{
  const r=await run(seed,seat),initial=r.frames[0]!.state;
  assert.deepEqual(Object.values(initial.hands).map(h=>h.length),[17,17,17]);assert.equal(initial.bottom.length,3);
  const deck=[...Array.from({length:13},(_,i)=>Array<number>(4).fill(i+3)).flat(),16,17];
  for(const f of r.frames){const s=f.state,used=s.events.flatMap(e=>e.event.type==='play'?e.event.play.cards:[]);
    assert.deepEqual([...Object.values(s.hands).flat(),...(s.bottomRevealed?[]:s.bottom),...used].sort((a,b)=>a-b),deck);
  }
  assert.equal(Object.values(r.result.scores).reduce((a,b)=>a+b),0);
  assert.deepEqual(r.events,r.frames.at(-1)!.state.events);
  assert.ok(r.frames.every(f=>f.events.length===0));
  for(const player of ['0','1','2'] as const)assert.deepEqual(game.contract.observe(r.frames.at(-1)!,player).observation.result,r.result);
});
test('all-pass redeals and ordinary three-bid auction remain unchanged',async()=>{
  const a=await run(11,'0',(f,i)=>i<=3?choice(f,{kind:'bid',value:0}):null);
  assert.deepEqual(a.frames.slice(0,3).map(f=>f.state.turn),['0','1','2']);assert.equal(a.frames[3]!.state.deal,2);assert.equal(a.frames[3]!.state.firstBidder,'1');
  const b=await run(11,'0',(f,i)=>f.state.phase==='bidding'?choice(f,{kind:'bid',value:i===2?2:0}):null);
  assert.equal(b.result.landlord,'1');assert.equal(b.result.bid,2);
});
test('private simultaneous choices preserve the remaining endpoint and reveal bottom later',async()=>{
  const r=await run();const f=structuredClone(r.frames.find(f=>f.state.phase==='doubling')!);
  const first=choice(f,{kind:'double',value:true},1),second=choice(f,{kind:'double',value:false},0);
  const player=f.state.stage!.slots[0]!.actor,before=observe(f,player);
  const prepared=prepare(f,first);assert.ok(prepared.valid);if(!prepared.valid)throw new Error();apply(f.state,prepared.output);
  assert.deepEqual(observe(f,player),before);
  const remaining=prepare(f,second);assert.ok(remaining.valid);if(!remaining.valid)throw new Error();apply(f.state,remaining.output);
  assert.equal(f.state.phase,'redoubling');assert.equal(observe(f,'0').observation.hand.length,17);assert.equal(observe(f,'0').observation.bottom,null);
});
test('timeout signals drive a complete game without becoming fake action choices',async()=>{
  const r=await run(41,'0',f=>f.state.phase==='bidding'?null:timeout(f));
  assert.ok(r.inputs.some(i=>i.kind==='host'));assert.equal(r.frames.at(-1)!.state.phase,'ended');
});
test('all timeout defaults and two passes retain rule behavior',async()=>{
  const r=await run(),f=structuredClone(r.frames[0]!);
  const expire=()=>{const x=prepare(f,timeout(f));assert.ok(x.valid);if(!x.valid)throw new Error();apply(f.state,x.output);};
  expire();assert.equal(f.state.bidCount,1);assert.equal(f.state.highBid,0);
  const s=f.state;s.phase='doubling';s.landlord='0';s.highBid=3;stage(s,['1','2']);expire();assert.equal(s.doubles['1'],false);
  s.doubles['1']=true;expire();assert.equal(s.phase,'redoubling');expire();assert.equal(s.redoubled,false);assert.equal(s.phase,'playing');
  const minimum=Math.min(...s.hands['0']);expire();assert.equal(s.last!.play.cards[0],minimum);expire();assert.equal(s.passes,1);expire();assert.equal(s.last,null);assert.equal(s.turn,'0');
});
test('invalid request, action and session deadline fail before rule mutation',async()=>{
  const f=(await run()).frames[0]!,before=structuredClone(f),request=decision.receive(f).requests[0]!;
  for(const [r,action] of [[{...request,key:'other'},{kind:'bid',value:1}],[{...request,player:'1'},{kind:'bid',value:1}],[request,{kind:'pass'}]] as const){
    assert.equal(prepareAction(f,r,action).valid,false);assert.deepEqual(f,before);
  }
  const clock=prepareControl(f,{kind:'clock',at:25000});assert.ok(clock.valid);if(!clock.valid)throw new Error();apply(f.state,clock.output);
  assert.equal(prepareAction(f,request,{kind:'bid',value:1}).valid,false);
  assert.equal(prepareControl(f,{kind:'clock',at:24999}).valid,false);
  assert.deepEqual(game.contract.inputs.action.describe(before,request),{kind:'exact',values:[0,1,2,3].map(value=>({kind:'bid',value}))});
});
test('concurrent native games reproduce sequential traces with independent service streams',async()=>{
  const concurrent=await Promise.all([run(21,'0'),run(22,'1'),run(23,'2')]);
  const sequential=[await run(21,'0'),await run(22,'1'),await run(23,'2')];
  assert.deepEqual(concurrent,sequential);
});
test('every advertised legal payload prepares successfully without delivery metadata',async()=>{
  const r=await run();
  for(const f of r.frames.slice(0,-1))for(const c of decision.receive(f).requests){
    const options=game.contract.inputs.action.describe(f,c);assert.equal(options.kind,'exact');
    for(const action of options.values){const response=prepareAction(f,c,action);assert.ok(response.valid);}
  }
  const f=r.frames.find(f=>f.state.phase==='playing')!,c=decision.receive(f).requests[0]!,options=game.contract.inputs.action.describe(f,c);
  assert.equal(options.values.some(a=>a.kind==='pass'),false);
  assert.deepEqual(options.values.flatMap(a=>a.kind==='play'&&a.pattern.kind==='single'?a.cards:[]).sort((a,b)=>a-b),[...new Set(observe(f,c.player).observation.hand)].sort((a,b)=>a-b));
  const again=game.contract.inputs.action.describe(f,c);options.values.length=0;assert.ok(again.values.length>0);
});
test('all farmer multipliers and springs survive the protocol migration',async()=>{
  const r=await run(),s=structuredClone(r.frames[0]!.state);
  s.landlord='0';s.highBid=3;s.doubles={'0':null,'1':true,'2':false};s.redoubled=true;s.bombs=1;s.rockets=1;s.playCounts={'0':1,'1':5,'2':0};
  assert.deepEqual(settle(s,'1').scores,{'0':-120,'1':96,'2':24});assert.equal(settle(s,'1').reverseSpring,true);
  s.bombs=0;s.rockets=0;s.highBid=2;s.playCounts={'0':2,'1':2,'2':1};
  for(const a of [false,true])for(const b of [false,true])for(const redouble of [false,true]){s.doubles={'0':null,'1':a,'2':b};s.redoubled=redouble;const x=2*(a?(redouble?4:2):1),y=2*(b?(redouble?4:2):1);assert.deepEqual(settle(s,'2').scores,{'0':-x-y,'1':x,'2':y});}
  s.highBid=3;s.doubles={'0':null,'1':false,'2':false};s.playCounts={'0':5,'1':0,'2':0};assert.equal(settle(s,'0').spring,true);assert.deepEqual(settle(s,'0').scores,{'0':12,'1':-6,'2':-6});
});
test('terminal frames require an authoritative result, reject extra fields and enforce canonical cards',async()=>{
  const r=await run(),f=r.frames.at(-1)!;
  assert.equal(FrameSchema.safeParse({...f,state:{...f.state,result:null}}).success,false);
  assert.equal(FrameSchema.safeParse({...f,boundary:{kind:'ended',result:{}}}).success,false);
  const lead=r.frames.find(f=>f.state.phase==='playing')!,c=decision.receive(lead).requests[0]!;
  const canonical=game.contract.inputs.action.describe(lead,c).values.find(a=>a.kind==='play'&&new Set(a.cards).size>1);
  assert.ok(canonical&&canonical.kind==='play');
  assert.throws(()=>prepareAction(lead,c,{...canonical,cards:[...canonical.cards].reverse()}));
  assert.ok(prepareAction(lead,c,canonical).valid);
});

test('native inner SDK uses decision and event ports; seed is explicit controlled setup',async()=>{
  assert.deepEqual(Object.keys(game.program.schemas.ports),['decision','event']);
  assert.ok(game.program.schemas.setup.safeParse({game:setup(),seed:0}).success);
  for(const seed of [-1,0.5,4294967296,NaN])assert.equal(game.program.schemas.setup.safeParse({game:setup(),seed}).success,false);
  assert.equal(game.program.schemas.setup.safeParse(setup()).success,false);
  const a=await run(1),b=await run(2),again=await run(1);
  assert.deepEqual(a,again);
  assert.notDeepEqual(a.frames[0]!.state.hands,b.frames[0]!.state.hands);
});


test('complete games use pure action callbacks and independent optional timeout control',async()=>{
  const {nativeGame}=await import('../../../packages/contracts/tests/support/native-game.ts');
  for(const timed of [false,true]){
    const base=await nativeGame(game,{game:setup(),seed:31});
    assert.equal(base.fork,undefined);assert.equal(base.save,undefined);
    const seen:Record<Seat,AuditEvent['event'][]>={'0':[],'1':[],'2':[]};let acceptedActions=0,acceptedControls=0;
    const onRequest:NonNullable<Parameters<typeof base.bind>[0]>['onRequest']=async request=>{
      assert.equal(request.observation.observation.actor,request.player);
      assert.deepEqual(Object.keys(request.data),['actionSpec']);
      assert.ok(!('deadline' in request.data));
      if(request.data.actionSpec.phase==='bidding')return {kind:'reply',value:{kind:'bid',value:3}};
      if(timed)return {kind:'pause'};
      return {kind:'reply',value:request.options.values.at(-1)!};
    };
    const onEvent:NonNullable<Parameters<typeof base.bind>[0]>['onEvent']=async(delivery,control)=>{
      if(delivery.event.type==='doubleChosen')assert.equal(delivery.event.actor,control.player);
      seen[control.player].push(structuredClone(delivery.event));return {kind:'reply',value:null};
    };
    for(const player of ['0','1','2'] as const)await base.bind({player,onRequest,onEvent});
    if(timed){if(!base.bindControl)throw new Error('session control required');await base.bindControl(async request=>{
      const observation=await base.observe({player:'0'});assert.ok(observation.ok);
      if(observation.ok&&observation.value.observation.phase==='bidding')return {kind:'pause'};
      const deadline=request.data.deadlines[0]!;
      return {kind:'reply',value:{kind:'timeout',slotId:deadline.slotId,at:deadline.at}};
    });}
    let ended=false;
    for(let step=0;step<600;step++){
      const result=await base.run();assert.ok(result.ok);if(!result.ok)throw new Error("run failed");
      const {state,accepted,pause}=result.value;assert.equal(pause,null);
      if(accepted?.kind==='action'){
        acceptedActions++;
        assert.ok(!('delivery' in accepted.reply));assert.ok(!('receivedAtGameTime' in accepted.reply.action));
        assert.equal(accepted.reply.requestId.instanceId,base.id);
      }else if(accepted?.kind==='control')acceptedControls++;
      if(state.kind==='ended'){
        assert.equal(Object.values(state.result.scores).reduce((a,b)=>a+b),0);
        for(const player of ['0','1','2'] as const){const observation=await base.observe({player});assert.ok(observation.ok);if(observation.ok){assert.deepEqual(observation.value.events,seen[player]);assert.deepEqual(observation.value.observation.result,state.result);}}
        ended=true;break;
      }
      assert.equal(state.kind,'request');assert.ok(accepted);
    }
    assert.ok(ended);assert.ok(acceptedActions>0);assert.equal(acceptedControls>0,timed);await base.close();
  }
});

test('session clock advances independently and equality deadline rejects a pure action',async()=>{
  const {nativeGame}=await import('../../../packages/contracts/tests/support/native-game.ts');const base=await nativeGame(game,{game:setup(),seed:7});
  if(!base.bindControl)throw new Error('session control required');await base.bindControl(async request=>({kind:'reply',value:{kind:'clock',at:request.data.deadlines[0]!.at}}));
  const advanced=await base.run();assert.ok(advanced.ok);if(!advanced.ok)return;assert.equal(advanced.value.accepted?.kind,'control');
  assert.equal(advanced.value.state.kind,'request');if(advanced.value.state.kind!=='request')return;
  const request=advanced.value.state.requests[0]!;
  assert.deepEqual(request.options,{kind:'exact',values:[]});
  const validation=await base.validate({player:request.player,reply:{requestId:request.id,type:'action',action:{kind:'bid',value:3}}});
  assert.ok(validation.ok);if(validation.ok)assert.equal(validation.value.valid,false);
  if(!base.bindControl)throw new Error('session control required');await base.bindControl(async r=>({kind:'reply',value:{kind:'timeout',slotId:r.data.deadlines[0]!.slotId,at:r.data.now}}));
  const expired=await base.run();assert.ok(expired.ok);if(expired.ok)assert.equal(expired.value.accepted?.kind,'control');await base.close();
});

test('action schema rejects session metadata and timeout is never an action option',async()=>{
  const {ActionSchema}=await import('../src/index.ts');
  for(const input of [{kind:'bid',value:3,at:1},{kind:'pass',receivedAtGameTime:1},{kind:'timeout',slotId:'x',at:1}])assert.equal(ActionSchema.safeParse(input).success,false);
  const f=(await run()).frames[0]!,request=decision.receive(f).requests[0]!;
  assert.ok(game.contract.inputs.action.describe(f,request).values.every(value=>ActionSchema.safeParse(value).success));
});
