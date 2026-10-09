import test from 'node:test';
import assert from 'node:assert/strict';
import { InstanceIdSchema, CallIdSchema } from '@bear-forge/contracts';
import type { IO, PortCall } from '@bear-forge/contracts';
import { game, program, FrameSchema } from '../../games/doudizhu/src/index.ts';
import type { DouDizhuPorts, DouDizhuSubmission, Setup, Frame, Input, Seat, Action, AuditEvent } from '../../games/doudizhu/src/index.ts';
import { legalActions, prepareInput, observe } from '../../games/doudizhu/src/implementation.ts';
import { apply, settle, stage } from '../../games/doudizhu/src/rules.ts';

const setup=(seat:Seat='0'):Setup=>({profile:'competitive-2016-bear-1',firstBidder:seat,initialGameTime:0});
const decisionPort=game.contract.ports.decision;
if(decisionPort.kind!=='decision')throw new Error('expected declared decision port');
const decision=decisionPort;
const choice=(f:Frame,a:Action,index=0):DouDizhuSubmission=>({kind:'choice',choiceId:f.state.stage!.slots[index]!.slotId,input:{type:'action',value:a},delivery:{receivedAtGameTime:f.state.now}});
const timeout=(f:Frame):DouDizhuSubmission=>({kind:'signal',signal:{kind:'host',inputType:'timeout',gameTime:f.state.stage!.slots[0]!.deadline.atGameTime,payload:{slotId:f.state.stage!.slots[0]!.slotId}}});
const pick=(f:Frame):DouDizhuSubmission=>{
  const actor=f.state.stage!.slots[0]!.actor;
  const a:Action=f.state.phase==='bidding'?{kind:'bid',value:3}:f.state.phase==='doubling'?{kind:'double',value:false}:f.state.phase==='redoubling'?{kind:'redouble',value:true}:legalActions(f.state,actor).at(-1)!;
  return choice(f,a);
};
/** Native differential side only: call the real author function with typed bindings. */
async function run(seed=11,seat:Seat='0',override?:(frame:Frame,index:number)=>DouDizhuSubmission|null){
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
      assert.equal(projected.choices.length,f.state.stage!.slots.length);
      const input=override?.(f,count)??pick(f);
      const slotId=input.kind==='choice'?input.choiceId:input.signal.payload.slotId;
      const player=f.state.stage!.slots.find(slot=>slot.slotId===slotId)!.actor;
      const response=decision.respond(f,input,player);
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
  const prepared=prepareInput(f,first,f.state.stage!.slots[1]!.actor);assert.ok(prepared.valid);if(!prepared.valid)throw new Error();apply(f.state,prepared.output);
  assert.deepEqual(observe(f,player),before);
  const remaining=prepareInput(f,second,player);assert.ok(remaining.valid);if(!remaining.valid)throw new Error();apply(f.state,remaining.output);
  assert.equal(f.state.phase,'redoubling');assert.equal(observe(f,'0').observation.hand.length,17);assert.equal(observe(f,'0').observation.bottom,null);
});
test('timeout signals drive a complete game without becoming fake action choices',async()=>{
  const r=await run(41,'0',f=>f.state.phase==='bidding'?null:timeout(f));
  assert.ok(r.inputs.some(i=>i.kind==='host'));assert.equal(r.frames.at(-1)!.state.phase,'ended');
});
test('all timeout defaults and two passes retain rule behavior',async()=>{
  const r=await run(),f=structuredClone(r.frames[0]!);
  const expire=()=>{const x=prepareInput(f,timeout(f),f.state.stage!.slots[0]!.actor);assert.ok(x.valid);if(!x.valid)throw new Error();apply(f.state,x.output);};
  expire();assert.equal(f.state.bidCount,1);assert.equal(f.state.highBid,0);
  const s=f.state;s.phase='doubling';s.landlord='0';s.highBid=3;stage(s,['1','2']);expire();assert.equal(s.doubles['1'],false);
  s.doubles['1']=true;expire();assert.equal(s.phase,'redoubling');expire();assert.equal(s.redoubled,false);assert.equal(s.phase,'playing');
  const minimum=Math.min(...s.hands['0']);expire();assert.equal(s.last!.play.cards[0],minimum);expire();assert.equal(s.passes,1);expire();assert.equal(s.last,null);assert.equal(s.turn,'0');
});
test('invalid choice, illegal action and equality deadline fail before rule mutation',async()=>{
  const r=await run(),f=r.frames[0]!,before=structuredClone(f),good=choice(f,{kind:'bid',value:1});
  if(good.kind!=='choice')throw new Error();
  for(const input of [{...good,choiceId:'other'}, {...good,delivery:{receivedAtGameTime:25000}}, choice(f,{kind:'pass'})]){
    assert.equal(prepareInput(f,input,f.state.stage!.slots[0]!.actor).valid,false);assert.deepEqual(f,before);
  }
  const c=decision.receive(f).choices[0]!;
  assert.deepEqual(game.contract.inputs.action.describe(f,c),{kind:'exact',values:[0,1,2,3].map(value=>({kind:'bid',value}))});
});
test('concurrent native games reproduce sequential traces with independent service streams',async()=>{
  const concurrent=await Promise.all([run(21,'0'),run(22,'1'),run(23,'2')]);
  const sequential=[await run(21,'0'),await run(22,'1'),await run(23,'2')];
  assert.deepEqual(concurrent,sequential);
});
test('every advertised legal payload prepares successfully with valid delivery data',async()=>{
  const r=await run();
  for(const f of r.frames.slice(0,-1))for(const c of decision.receive(f).choices){
    const options=game.contract.inputs.action.describe(f,c);assert.equal(options.kind,'exact');
    for(const action of options.values){const response=prepareInput(f,{kind:'choice',choiceId:c.id,input:{type:'action',value:action},delivery:{receivedAtGameTime:f.state.now}},c.actor);assert.ok(response.valid);}
  }
  const f=r.frames.find(f=>f.state.phase==='playing')!,c=decision.receive(f).choices[0]!,options=game.contract.inputs.action.describe(f,c);
  assert.equal(options.values.some(a=>a.kind==='pass'),false);
  assert.deepEqual(options.values.flatMap(a=>a.kind==='play'&&a.pattern.kind==='single'?a.cards:[]).sort((a,b)=>a-b),[...new Set(observe(f,c.actor).observation.hand)].sort((a,b)=>a-b));
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
test('terminal result has one authoritative source and canonical card encoding stays enforced',async()=>{
  const r=await run(),f=r.frames.at(-1)!;
  assert.equal(FrameSchema.safeParse({...f,state:{...f.state,result:null}}).success,false);
  assert.equal(FrameSchema.safeParse({...f,boundary:{kind:'ended',result:{}}}).success,false);
  const lead=r.frames.find(f=>f.state.phase==='playing')!,c=decision.receive(lead).choices[0]!;
  const canonical=game.contract.inputs.action.describe(lead,c).values.find(a=>a.kind==='play'&&new Set(a.cards).size>1);
  assert.ok(canonical&&canonical.kind==='play');
  assert.throws(()=>prepareInput(lead,choice(lead,{...canonical,cards:[...canonical.cards].reverse()}),c.actor));
  assert.ok(prepareInput(lead,choice(lead,canonical),c.actor).valid);
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

test('player callbacks drive complete games from projected requests and events',async()=>{
  const {playerConsumer}=await import('../contracts/player-consumer.ts');
  for(const useTimeouts of [false,true]){
    const consumer=playerConsumer(game.contract,InstanceIdSchema.parse('00000000-0000-4000-8000-000000000001'));
    const received:Record<Seat,AuditEvent['event'][]>={'0':[],'1':[],'2':[]};
    const decisions=new Set<Seat>();let calls=0;
    const onDecision:NonNullable<Parameters<typeof consumer.bind>[0]>['onDecision']=async(request,control)=>{
      const player=control.player;decisions.add(player);
      assert.equal(request.observation.observation.actor,player);
      assert.ok(request.offers.length>0);
      assert.ok(request.offers.every(offer=>offer.choice.actor===player));
      assert.equal(request.acceptsSignal,true);
      const offer=request.offers[0]!,slot=offer.choice.request;
      if(useTimeouts&&slot.actionSpec.phase!=='bidding')return {kind:'reply',value:{kind:'signal',signal:{
        kind:'host',inputType:slot.onTimeout.inputType,payload:slot.onTimeout.payload,gameTime:slot.deadline.atGameTime,
      }}};
      const action=slot.actionSpec.phase==='bidding'?{kind:'bid' as const,value:3}:offer.options.values.at(-1)!;
      return {kind:'reply',value:{kind:'choice',choiceId:offer.choice.id,input:{type:'action',value:action},delivery:{receivedAtGameTime:slot.deadline.atGameTime-1}}};
    };
    const onEvent:NonNullable<Parameters<typeof consumer.bind>[0]>['onEvent']=async(delivery,control)=>{
      received[control.player].push(structuredClone(delivery.event));
      if(delivery.event.type==='doubleChosen')assert.equal(delivery.event.actor,control.player);
      return {kind:'reply',value:null};
    };
    for(const player of ['0','1','2'] as const)consumer.bind({player,onDecision,onEvent});
    const io:IO<DouDizhuPorts>={async call<A extends PortCall<DouDizhuPorts>>(call:A):Promise<DouDizhuPorts[A['port']]['output']>{
      assert.ok(++calls<1200);const callId=CallIdSchema.parse(`00000000-0000-4000-8000-${String(calls).padStart(12,'0')}`);
      if(call.port==='event'){
        const reply=await consumer.events(call.input as AuditEvent[],callId);assert.equal(reply.kind,'reply');
        return null as DouDizhuPorts[A['port']]['output'];
      }
      const response=await consumer.decision(decision.receive(call.input as Frame),callId,decision.respond);
      assert.equal(response.kind,'accepted');if(response.kind!=='accepted')throw new Error('expected accepted response');
      return response.output as DouDizhuPorts[A['port']]['output'];
    }};
    const final=await program({game:setup(),seed:31},io);
    assert.equal(final.state.phase,'ended');assert.equal(decisions.size,3);
    for(const player of ['0','1','2'] as const){
      const expected=final.state.events.flatMap(event=>{const projection=game.contract.projectEvent(event,player);return projection?[projection.event]:[];});
      assert.deepEqual(received[player],expected);
      assert.deepEqual(consumer.observe(final,player).events,expected);
    }
  }
});

test('another player cannot answer a choice or its timeout',async()=>{
  const f=(await run()).frames[0]!,before=structuredClone(f);
  for(const input of [choice(f,{kind:'bid',value:3}),timeout(f)]){
    assert.equal(prepareInput(f,input,'1').valid,false);
    assert.deepEqual(f,before);
  }
});
