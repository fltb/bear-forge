import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCardLoader } from '@bear-forge/runtime-card';
import { createGameBinder } from '@bear-forge/game-host';
import { VirtualSession, driveSession } from '@bear-forge/session';
import { game as module } from '../src/index.ts';
import type { DouDizhuTypes } from '../src/types.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('real game session converts virtual deadline to accepted timeout control, not player action', async () => {
  const loaded = unwrap(await createCardLoader({controlled:false}).load(module.definition)),
    instance = unwrap(await loaded.core.start({
      game: {
        profile: 'competitive-2016-bear-1',
        firstBidder: '0',
        initialGameTime: 0
      },
      seed: 19
    })),
    game = unwrap(await createGameBinder().bind({
      instance,
      contract: module.contract
    }));
  for (const player of ['0', '1', '2']) unwrap(await game.bind({
    player,
    async onEvent() {
      return {
        kind: 'reply',
        value: null
      };
    }
  }));
  const current = unwrap(await game.run());
  assert.equal(current.state.kind, 'request');
  let sessionData: any;
  unwrap(await game.bindControl(async (request: any) => {
    sessionData = request.data;
    return {
      kind: 'pause'
    };
  }));
  await game.run();
  const deadline = sessionData.deadlines[0],
    session = new VirtualSession();
  const request = current.state.requests[0];
  session.enqueue({
    at: deadline.at,
    player: request.player,
    requestId: request.id,
    type: request.type,
    action: request.options.values[0]
  });
  const result = unwrap(await driveSession(game, session, {
    at: deadline.at,
    deadlines: [{
      key: deadline.slotId,
      at: deadline.at
    }],
    control: s => s.kind === 'timeout' ? {
      kind: 'timeout',
      slotId: s.key,
      at: s.at
    } : {
      kind: 'clock',
      at: s.at
    }
  }));
  assert.equal(result.accepted.kind, 'control');
  assert.equal(result.accepted.input.kind, 'timeout');
  assert.equal(session.snapshot().now, deadline.at);
  await game.close();
});

test('session driver preserves a real adapter fault instead of inventing an invalid-action pause',async()=>{
  const loaded=unwrap(await createCardLoader({controlled:false}).load(module.definition));
  const instance=unwrap(await loaded.core.start({game:{profile:'competitive-2016-bear-1',firstBidder:'0',initialGameTime:0},seed:19}));
  const contract={...module.contract,ports:{...module.contract.ports,decision:{...module.contract.ports.decision,
    respond(){throw new Error('adapter failure');}
  }}};
  const game=unwrap(await createGameBinder().bind<DouDizhuTypes>({instance,contract}));
  try {
    for(const player of ['0','1','2'])unwrap(await game.bind({player,onEvent:async()=>({kind:'reply',value:null})}));
    const current=unwrap(await game.run());assert.equal(current.state.kind,'request');
    const request=current.state.requests[0],session=new VirtualSession();
    session.enqueue({at:0,player:request.player,requestId:request.id,type:request.type,action:request.options.values[0]});
    const before=session.snapshot();
    const result=await driveSession(game,session,{at:0,deadlines:[],control:s=>({kind:'clock',at:s.at})});
    assert.equal(result.ok,false);
    if(!result.ok)assert.equal(result.error.code,'invalid_output');
    const after=await game.inspect();assert.equal(after.ok,false);
    if(!after.ok)assert.equal(after.error.code,'game_closed');
    assert.deepEqual(session.snapshot(),before);
  }finally{await game.close();}
});
