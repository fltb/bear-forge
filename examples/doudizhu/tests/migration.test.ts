import { runCard } from '@bear-forge/runtime-card/tests/run-support';
import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import type { ProgramSetup, Seat } from '../src/schemas.ts';

// Test-local erasure lets the same recorder inspect both independent contracts.
function projection(module: any, call: any) {
  const contract = module.contract;
  const port = contract.ports[call.port];
  const received = port.receive(structuredClone(call.input));
  if (port.kind === 'event') return {
    received,
    players: ['0', '1', '2'].map(p => received.events.map((e: any) => contract.projectEvent(e, p))),
  };
  return {
    received,
    players: ['0', '1', '2'].map(p => contract.observe(received.view, p)),
    options: received.requests.map((r: any) => contract.inputs.action.describe(received.view, r)),
    session: port.session.request(received.view),
  };
}

for (const firstBidder of ['0', '1', '2'] as Seat[]) for (const reverse of [false, true]) {
  test(`frozen reference: independently driven DDZ games, first ${firstBidder}, reverse slots ${reverse}`, async () => {
    const setup: ProgramSetup = {
      game: { profile: 'competitive-2016-bear-1', firstBidder, initialGameTime: 0 }, seed: 31,
    };
    const transcript: Array<{ call: any; output: any; projection: any }> = [];
    const player=(module:any)=>{
      const state={clockSent:false,timeoutSent:false};
      return{state,answer(call:any){
        if(call.port==='event')return null;
        const port=module.contract.ports.decision,{view,requests}=port.receive(call.input),request=reverse?requests.at(-1):requests[0];let prepared:any;
        if(view.state.deal>1&&!state.clockSent){state.clockSent=true;prepared=port.session.respond(view,{kind:'clock',at:view.state.now+1});}
        else if(view.state.deal>1&&!state.timeoutSent){state.timeoutSent=true;const slot=view.state.stage.slots[0];prepared=port.session.respond(view,{kind:'timeout',slotId:slot.slotId,at:slot.deadline.atGameTime});}
        else{
          const options=module.contract.inputs.action.describe(view,request);assert.equal(options.kind,'exact');
          const action=view.state.deal===1?options.values[0]:reverse?options.values.at(-1):options.values.find((a:any)=>a.kind==='play')??options.values.at(-1);
          prepared=port.respond(view,request,action);
        }
        assert.equal(prepared.valid,true);return prepared.output;
      }};
    };
    const oldPlayer=player(reference),newPlayer=player(game);
    const expected=await reference.program.run(setup,{async call(call:any){
      assert.ok(transcript.length<600,'reference must terminate');const output=oldPlayer.answer(call);
      transcript.push({call:structuredClone(call),output:structuredClone(output),projection:projection(reference,call)});return output;
    }} as any);
    assert.deepEqual(oldPlayer.state,{clockSent:true,timeoutSent:true});assert.ok(expected.state.deal>=2);
    let cursor = 0;
    const actual = await runCard(game.definition, structuredClone(setup), {
      async call(call: any) {
        const recorded = transcript[cursor++];
        assert.ok(recorded, 'candidate emitted extra call');
        assert.deepEqual(call, recorded.call, `call ${cursor}`);
        assert.deepEqual(projection(game, call), recorded.projection, `projection ${cursor}`);
        const output=newPlayer.answer(call);
        assert.deepEqual(output,recorded.output,'independently chosen current reply');return output;
      },
    } as any);
    assert.equal(cursor, transcript.length);
    assert.deepEqual(newPlayer.state,oldPlayer.state);
    assert.deepEqual(actual, expected);
    assert.deepEqual(game.contract.finish(actual), reference.contract.finish(expected));
  });
}
