import test from 'node:test';
import assert from 'node:assert/strict';
import { sameData } from '@bear-forge/boundary';
import { createCardLoader, fileSnapshotStore } from '@bear-forge/runtime-card';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceRestoredProcess } from '../../../packages/runtime-card/tests/process-support.ts';
import { cardDefinition } from '../src/card.ts';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import { baseDeck } from './reference/rules.ts';
import { createGameBinder } from '@bear-forge/game-host';
import { createNativeLoader } from '@bear-forge/runtime-native';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

for (const seed of [87, 991]) for (const controlled of [false, true]) {
  test(`dedicated Forge core matches independent reference including projections, controlled ${controlled}, seed ${seed}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'forge-card-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const setup = { profile: 'forge-duel-v1' as const, seed, first: '0' as const, decks: { '0': [...baseDeck], '1': [...baseDeck] } };
    const choose=(contract:any,call:any)=>{
      if(call.port==='event')return null;
      const port=contract.ports.decision,{view,requests}=port.receive(call.input),request=requests[0];
      const options=contract.inputs.move.describe(view,request),reply=port.respond(view,request,options.values[0]);
      assert.equal(reply.valid,true);return reply.output;
    };
    const oracleLoaded:any=unwrap(await createNativeLoader().load(reference.program)),oracle=unwrap(await oracleLoaded.core.start(structuredClone(setup)));
    const loaded:any=unwrap(await createCardLoader({controlled,recordCore:true,snapshots:fileSnapshotStore(directory)}).load(cardDefinition));
    let instance=unwrap(await loaded.core.start(setup)),i=0;
    t.after(async()=>{await instance.close();await loaded.capture.release(instance.id);await oracle.close();await oracleLoaded.capture.release(oracle.id);});
    for(;;i++){
      const stop=unwrap(await instance.inspect()),expected=unwrap(await oracle.inspect());
      assert.equal(stop.kind,expected.kind);
      if(stop.kind!=='call'){
        assert.equal(stop.kind,'done');assert.deepEqual(stop.result,expected.result);break;
      }
      assert.deepEqual(stop.call,expected.call);
      if(stop.call.port==='decision')for(const player of ['0','1'] as const){
        const actualObservation=game.contract.observe(stop.call.input,player),expectedObservation=reference.contract.observe(expected.call.input,player);
        assert.deepEqual(actualObservation,expectedObservation);
        assert.equal(sameData(actualObservation,expectedObservation),true,'observation aliases must match the independent live reference');
      }
      const expectedReply=choose(reference.contract,expected.call);
      if(controlled&&i%13===0){
        const snapshot=unwrap(await loaded.persistence.save(instance));
        unwrap(await instance.close());unwrap(await loaded.capture.release(instance.id));
        if(i===13&&seed===87){
          const next=await advanceRestoredProcess(directory,new URL('../src/card.ts',import.meta.url),snapshot,call=>{
            assert.deepEqual(call,stop.call);const reply=choose(game.contract,call);assert.deepEqual(reply,expectedReply);return reply;
          });
          instance=unwrap(await loaded.persistence.restore(next.snapshot));
          assert.deepEqual(unwrap(await instance.inspect()),next.stop);
          unwrap(await loaded.persistence.release(next.snapshot));
        }else{
          instance=unwrap(await loaded.persistence.restore(snapshot));
          assert.deepEqual(unwrap(await instance.inspect()),stop);
          const reply=choose(game.contract,unwrap(await instance.inspect()).call);assert.deepEqual(reply,expectedReply);
          unwrap(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:reply})}));
          assert.equal(unwrap(await instance.run()).accepted,true);
        }
        unwrap(await loaded.persistence.release(snapshot));
      }else{
        const parent=instance;
        if(controlled&&i%13===1)instance=unwrap(await parent.fork());
        const reply=choose(game.contract,unwrap(await instance.inspect()).call);assert.deepEqual(reply,expectedReply);
        unwrap(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:reply})}));
        assert.equal(unwrap(await instance.run()).accepted,true);
        if(instance!==parent){assert.deepEqual(unwrap(await parent.inspect()),stop);unwrap(await parent.close());unwrap(await loaded.capture.release(parent.id));}
      }
      unwrap(await oracle.bind({[expected.call.port]:async()=>({kind:'reply',value:expectedReply})}));
      assert.equal(unwrap(await oracle.run()).accepted,true);
    }
    const done=unwrap(await instance.inspect()),records=unwrap(await loaded.capture.read(instance.id,{after:null,limit:10000})).records;
    assert.equal(records.at(-1).kind,'completed');assert.deepEqual(records.at(-1).result,done.result);
  });
}

test('Forge card Instance uses the unchanged BaseGame contract and rejects foreign replies', async () => {
  const loaded: any = unwrap(await createCardLoader().load(cardDefinition)); const instance = unwrap(await loaded.core.start({ profile: 'forge-duel-v1', seed: 87, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } }));
  const handle = unwrap(await createGameBinder().bind({ instance, contract: game.contract, persistence: loaded.persistence }));
  unwrap(await handle.run());
  const peer = unwrap(await handle.fork());
  const before = unwrap(await handle.inspect()), peerBefore = unwrap(await peer.inspect());
  const request = before.requests[0];
  // The caller's pre-transfer Instance is revoked; use the public game view.
  assert.equal((await instance.inspect()).ok, false);
  const options = unwrap(await handle.describe({ requestId: request.id, type: request.type }));
  const reply = { requestId: request.id, type: request.type, action: options.values[0] };
  assert.equal(unwrap(await handle.validate({ player: request.player, reply })).valid, true);
  assert.equal(unwrap(await peer.validate({ player: request.player, reply })).valid, false);
  assert.equal(unwrap(await handle.validate({ player: request.player === '0' ? '1' : '0', reply })).valid, false);
  assert.deepEqual(unwrap(await handle.inspect()), before); assert.deepEqual(unwrap(await peer.inspect()), peerBefore);
  await peer.close(); await handle.close();
});
