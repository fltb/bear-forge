import test from 'node:test';
import assert from 'node:assert/strict';
import { sameData } from '@bear-forge/boundary';
import { createCardLoader, fileSnapshotStore } from '@bear-forge/runtime-card';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceRestoredProcess } from '../../../packages/runtime-card/tests/process-support.ts';
import { createGameBinder } from '@bear-forge/game-host';
import { createNativeLoader } from '@bear-forge/runtime-native';
import { cardDefinition } from '../src/card.ts';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

for (const controlled of [false, true]) for (const scenario of ['initial', 'clock', 'timeout', 'exact-limit'] as const) {
  test(`DDZ preserves validation failure before event IO at extreme time: ${scenario}, controlled ${controlled}`, async () => {
    const setup = { game: { profile: 'competitive-2016-bear-1' as const, firstBidder: '0' as const, initialGameTime: scenario === 'initial' ? Number.MAX_SAFE_INTEGER : scenario === 'exact-limit' ? Number.MAX_SAFE_INTEGER - 25000 : 0 }, seed: 31 };
    const picker=()=>{let advanced=false;return(call:any)=>{
      if(call.port==='event')return null;
      const state=call.input.state,slot=state.stage.slots[0];
      if(scenario==='clock'&&!advanced){advanced=true;return{kind:'clock',at:Number.MAX_SAFE_INTEGER-1};}
      return{kind:'host',boundaryKey:state.stage.boundaryKey,inputType:'timeout',gameTime:Number.MAX_SAFE_INTEGER,payload:{slotId:slot.slotId}};
    };};
    const choose=picker(),referenceChoose=picker(),calls:any[]=[];
    const oracleLoaded:any=unwrap(await createNativeLoader().load(reference.program)),oracle=unwrap(await oracleLoaded.core.start(structuredClone(setup)));
    const loaded:any=unwrap(await createCardLoader({controlled,recordCore:true}).load(cardDefinition)),instance=unwrap(await loaded.core.start(setup));
    try{
      for(;;){
        const stop=unwrap(await instance.inspect()),expected=unwrap(await oracle.inspect());assert.equal(stop.kind,expected.kind);
        if(stop.kind!=='call'){
          assert.equal(stop.kind,'fault');assert.equal(stop.error.kind,expected.error.kind);assert.equal(stop.error.code,expected.error.code);
          // The generic sandbox exposes the error family; Card Core retains
          // the schema issues. Require the exact failing field and bound as
          // well as identical IO timing, rather than equate those formats.
          assert.equal(expected.error.message,'ZodError');
          assert.deepEqual(JSON.parse(stop.error.message).map((issue:any)=>({code:issue.code,origin:issue.origin,path:issue.path,maximum:issue.maximum})),
            ['int','number'].map(origin=>({code:'too_big',origin,path:['state','stage','slots',0,'deadline','atGameTime'],maximum:Number.MAX_SAFE_INTEGER})));
          break;
        }
        assert.ok(calls.length<10,'extreme-time fixture must fail before ten IO calls');assert.deepEqual(stop.call,expected.call);calls.push(stop.call);
        const reply=choose(stop.call),expectedReply=referenceChoose(expected.call);assert.deepEqual(reply,expectedReply);
        unwrap(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());
        unwrap(await oracle.bind({[expected.call.port]:async()=>({kind:'reply',value:expectedReply})}));unwrap(await oracle.run());
      }
      const stop=unwrap(await instance.inspect()),records=unwrap(await loaded.capture.read(instance.id,{after:null,limit:100})).records;
      assert.deepEqual(records.filter((r:any)=>r.kind==='called').map((r:any)=>r.call),calls);
      assert.equal(records.at(-1).kind,'faulted');assert.deepEqual(records.at(-1).error,stop.error);
    }finally{await instance.close();await loaded.capture.release(instance.id);await oracle.close();await oracleLoaded.capture.release(oracle.id);}
  });
}

for (const reverse of [false, true]) for (const controlled of [false, true]) {
  test(`dedicated DDZ core matches redeal, clock, timeout, slots and projections; controlled ${controlled}, reverse ${reverse}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'ddz-card-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const setup = { game: { profile: 'competitive-2016-bear-1' as const, firstBidder: '0' as const, initialGameTime: 0 }, seed: 31 };
    const picker=(contract:any)=>{
      const state={clock:false,timeout:false};
      return{state,choose(call:any){
        if(call.port==='event')return null;
        const port=contract.ports.decision,{view,requests}=port.receive(call.input),req=reverse?requests.at(-1):requests[0];let reply:any;
        if(view.state.deal>1&&!state.clock){state.clock=true;reply=port.session.respond(view,{kind:'clock',at:view.state.now+1});}
        else if(view.state.deal>1&&!state.timeout){state.timeout=true;const slot=view.state.stage.slots[0];reply=port.session.respond(view,{kind:'timeout',slotId:slot.slotId,at:slot.deadline.atGameTime});}
        else{
          const opts=contract.inputs.action.describe(view,req),action=view.state.deal===1?opts.values[0]:reverse?opts.values.at(-1):opts.values.find((a:any)=>a.kind==='play')??opts.values.at(-1);
          reply=port.respond(view,req,action);
        }
        assert.equal(reply.valid,true);return reply.output;
      }};
    };
    const player=picker(game.contract),referencePlayer=picker(reference.contract);
    const oracleLoaded:any=unwrap(await createNativeLoader().load(reference.program)),oracle=unwrap(await oracleLoaded.core.start(structuredClone(setup)));
    const loaded:any=unwrap(await createCardLoader({controlled,recordCore:true,snapshots:fileSnapshotStore(directory)}).load(cardDefinition));
    let instance=unwrap(await loaded.core.start(setup)),i=0;
    t.after(async()=>{await instance.close();await loaded.capture.release(instance.id);await oracle.close();await oracleLoaded.capture.release(oracle.id);});
    for(;;i++){
      const stop=unwrap(await instance.inspect()),expected=unwrap(await oracle.inspect());assert.equal(stop.kind,expected.kind);
      if(stop.kind!=='call'){assert.equal(stop.kind,'done');assert.deepEqual(stop.result,expected.result);break;}
      assert.ok(i<600,'redeal fixture must terminate before 600 IO calls');assert.deepEqual(stop.call,expected.call);
      if(stop.call.port==='decision'){
        for(const seat of ['0','1','2'] as const){
          const actualObservation=game.contract.observe(stop.call.input,seat),expectedObservation=reference.contract.observe(expected.call.input,seat);
          assert.deepEqual(actualObservation,expectedObservation);assert.equal(sameData(actualObservation,expectedObservation),true);
        }
        const a=game.contract.ports.decision.receive(stop.call.input),b=reference.contract.ports.decision.receive(expected.call.input);
        for(let j=0;j<a.requests.length;j++)assert.deepEqual(game.contract.inputs.action.describe(a.view,a.requests[j]!),reference.contract.inputs.action.describe(b.view,b.requests[j]!));
      }
      const expectedReply=referencePlayer.choose(expected.call);
      if(controlled&&i%17===0){
        const snapshot=unwrap(await loaded.persistence.save(instance));
        unwrap(await instance.close());unwrap(await loaded.capture.release(instance.id));
        if(i===17&&!reverse){
          const next=await advanceRestoredProcess(directory,new URL('../src/card.ts',import.meta.url),snapshot,call=>{
            assert.deepEqual(call,stop.call);const reply=player.choose(call);assert.deepEqual(reply,expectedReply);return reply;
          });
          instance=unwrap(await loaded.persistence.restore(next.snapshot));assert.deepEqual(unwrap(await instance.inspect()),next.stop);
          unwrap(await loaded.persistence.release(next.snapshot));
        }else{
          instance=unwrap(await loaded.persistence.restore(snapshot));assert.deepEqual(unwrap(await instance.inspect()),stop);
          const reply=player.choose(unwrap(await instance.inspect()).call);assert.deepEqual(reply,expectedReply);
          unwrap(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:reply})}));assert.equal(unwrap(await instance.run()).accepted,true);
        }
        unwrap(await loaded.persistence.release(snapshot));
      }else{
        const parent=instance;if(controlled&&i%17===1)instance=unwrap(await parent.fork());
        const reply=player.choose(unwrap(await instance.inspect()).call);assert.deepEqual(reply,expectedReply);
        unwrap(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:reply})}));assert.equal(unwrap(await instance.run()).accepted,true);
        if(instance!==parent){assert.deepEqual(unwrap(await parent.inspect()),stop);unwrap(await parent.close());unwrap(await loaded.capture.release(parent.id));}
      }
      unwrap(await oracle.bind({[expected.call.port]:async()=>({kind:'reply',value:expectedReply})}));assert.equal(unwrap(await oracle.run()).accepted,true);
    }
    assert.deepEqual(player.state,{clock:true,timeout:true});assert.deepEqual(referencePlayer.state,player.state);
    const done=unwrap(await instance.inspect()),records=unwrap(await loaded.capture.read(instance.id,{after:null,limit:10000})).records;
    assert.equal(records.at(-1).kind,'completed');assert.deepEqual(records.at(-1).result,done.result);
  });
}

test('dedicated DDZ BaseGame rejects wrong players, foreign and stale credentials without advancing', async () => {
  const loaded: any = unwrap(await createCardLoader().load(cardDefinition));
  const instance = unwrap(await loaded.core.start({ game: { profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0 }, seed: 31 }));
  const handle = unwrap(await createGameBinder().bind({ instance, contract: game.contract, persistence: loaded.persistence }));
  unwrap(await handle.run()); const before = unwrap(await handle.inspect()), peer = unwrap(await handle.fork()), peerBefore = unwrap(await peer.inspect());
  const request = before.requests[0], options = unwrap(await handle.describe({ requestId: request.id, type: request.type }));
  const reply = { requestId: request.id, type: request.type, action: options.values.at(-1) };
  assert.equal(unwrap(await handle.validate({ player: request.player, reply })).valid, true);
  assert.equal(unwrap(await handle.validate({ player: '1', reply })).valid, false);
  assert.equal(unwrap(await peer.validate({ player: request.player, reply })).valid, false);
  assert.deepEqual(unwrap(await handle.inspect()), before); assert.deepEqual(unwrap(await peer.inspect()), peerBefore);
  unwrap(await handle.bind({ player: request.player, async onRequest() { return { kind: 'reply', value: reply.action }; } }));
  assert.equal(unwrap(await handle.run()).accepted.kind, 'action');
  const after = unwrap(await handle.inspect()); assert.equal(unwrap(await handle.validate({ player: request.player, reply })).valid, false); assert.deepEqual(unwrap(await handle.inspect()), after);
  assert.deepEqual(unwrap(await peer.inspect()), peerBefore); await peer.close(); await handle.close();
});
