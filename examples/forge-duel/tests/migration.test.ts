import { runCard } from '@bear-forge/runtime-card/tests/run-support';
import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import { baseDeck } from './reference/rules.ts';

function projection(module: any, call: any) {
  const contract = module.contract;
  const port = contract.ports[call.port];
  const received = port.receive(structuredClone(call.input));
  if (port.kind === 'event') return {
    received,
    players: ['0', '1'].map(p => received.events.map((e: any) => contract.projectEvent(e, p))),
  };
  return {
    received,
    players: ['0', '1'].map(p => contract.observe(received.view, p)),
    options: received.requests.map((r: any) => contract.inputs.move.describe(received.view, r)),
  };
}

for (const seed of [87, 991]) for (const first of ['0', '1'] as const) {
  test(`frozen reference: independently driven Forge games, seed ${seed}, first ${first}`, async () => {
    const setup = { profile: 'forge-duel-v1' as const, seed, first, decks: { '0': [...baseDeck], '1': [...baseDeck] } };
    const transcript: Array<{ call: any; output: any; projection: any }> = [];
    const answer=(module:any,call:any)=>{
      if(call.port==='event')return null;
      const port=module.contract.ports.decision,{view,requests}=port.receive(call.input),request=requests[0];
      const options=module.contract.inputs.move.describe(view,request);assert.equal(options.kind,'exact');
      const reply=port.respond(view,request,options.values[0]);assert.equal(reply.valid,true);return reply.output;
    };
    const expected=await reference.program.run(setup,{async call(call:any){
      assert.ok(transcript.length<600,'reference must terminate');
      const output=answer(reference,call);
      transcript.push({call:structuredClone(call),output:structuredClone(output),projection:projection(reference,call)});return output;
    }} as any);
    let cursor = 0;
    const actual = await runCard(game.definition, structuredClone(setup), {
      async call(call: any) {
        const recorded = transcript[cursor++];
        assert.ok(recorded, 'candidate emitted extra call');
        assert.deepEqual(call, recorded.call, `call ${cursor}`);
        assert.deepEqual(projection(game, call), recorded.projection, `projection ${cursor}`);
        const output=answer(game,call);
        assert.deepEqual(output,recorded.output,'independently chosen current reply');
        return output;
      },
    } as any);
    assert.equal(cursor, transcript.length);
    assert.deepEqual(actual, expected);
    assert.deepEqual(game.contract.finish(actual), reference.contract.finish(expected));
  });
}
