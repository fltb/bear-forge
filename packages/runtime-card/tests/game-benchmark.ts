import assert from 'node:assert/strict';
import { createGameBinder } from '@bear-forge/game-host';
import { createNativeLoader } from '@bear-forge/runtime-native';
import { createCardLoader } from '../src/index.ts';

const unwrap = (result: any): any => { if (!result.ok) throw Error(JSON.stringify(result.error)); return result.value; };
export type GameWorkload = {
  definition: any;
  contract: any;
  reference: any;
  setups: any[];
  players: string[];
  choose: (request: any) => unknown;
};

/** Only drives the production GameHost interfaces. The optional transcript is
 * correctness evidence and is never built in timed runs. */
export async function interactiveGame(loaded: any, contract: any, setup: any, players: readonly string[], choose: GameWorkload['choose'], capture = false) {
  const instance = unwrap(await loaded.core.start(setup));
  const game = unwrap(await createGameBinder().bind({ instance, contract }));
  const transcript: any[] | undefined = capture ? [] : undefined;
  let requests = 0, events = 0, decisions = 0, eventKindBytes = 0;
  try {
    for (const player of players) unwrap(await game.bind({ player,
      async onRequest(request: any) {
        requests++;
        if (request.options.kind !== 'exact') throw Error('Workload requires complete exact choices');
        transcript?.push({ kind: 'request', player, key: request.id.key, type: request.type,
          data: request.data, observation: request.observation, options: request.options });
        return { kind: 'reply', value: choose(request) };
      },
      async onEvent(delivery: any) {
        events++;
        const kind = delivery.event.kind ?? delivery.event.type;
        eventKindBytes += typeof kind === 'string' ? kind.length : 0;
        transcript?.push({ kind: 'event', player, index: delivery.id.index, event: delivery.event });
        return { kind: 'reply', value: null };
      }
    }));
    let state = unwrap(await game.inspect()), turns = 0;
    while (state.kind !== 'ended' && state.kind !== 'fault') {
      if (++turns > 4000) throw Error('Game did not finish');
      const moved = unwrap(await game.run());
      if (moved.pause !== null) throw Error('Game paused: ' + moved.pause);
      if (moved.accepted) {
        decisions++;
        transcript?.push(moved.accepted.kind === 'action'
          ? { kind: 'accepted', player: moved.accepted.player, type: moved.accepted.reply.type, action: moved.accepted.reply.action }
          : { kind: 'control', input: moved.accepted.input });
      }
      state = moved.state;
    }
    if (state.kind !== 'ended') throw Error(JSON.stringify(state));
    transcript?.push({ kind: 'ended', result: state.result });
    return { result: state.result, requests, events, decisions, eventKindBytes, transcript };
  } finally {
    unwrap(await game.close());
    if (loaded.capture) unwrap(await loaded.capture.release(instance.id));
  }
}

export async function verifyInteractiveGames(workload: GameWorkload) {
  const reference = unwrap(await createNativeLoader().load(workload.reference.program));
  const native = unwrap(await createCardLoader({ controlled: false }).load(workload.definition));
  const controlled = unwrap(await createCardLoader({ controlled: true }).load(workload.definition));
  for (const setup of workload.setups) {
    const expected = await interactiveGame(reference, workload.reference.contract, structuredClone(setup), workload.players, workload.choose, true);
    assert.ok(expected.requests > 0); assert.ok(expected.events > 0); assert.ok(expected.decisions > 0);
    for (const loaded of [native, controlled]) {
      const actual = await interactiveGame(loaded, workload.contract, structuredClone(setup), workload.players, workload.choose, true);
      assert.deepEqual(actual, expected, 'complete requests, observations, options, events and accepted actions must match the independent game');
    }
  }
}

export async function benchmarkInteractiveGames(workload: GameWorkload, lane = process.argv[2] ?? 'game-controlled') {
  if (!['game-native', 'game-controlled'].includes(lane)) throw Error('Unknown full game lane');
  await verifyInteractiveGames(workload);
  const controlled = lane === 'game-controlled';
  const loaded = unwrap(await createCardLoader({ controlled }).load(workload.definition));
  const run = (setup: any) => interactiveGame(loaded, workload.contract, setup, workload.players, workload.choose);
  for (let i = 0; i < 8; i++) await run(structuredClone(workload.setups[i % workload.setups.length]));
  const samples: number[] = [], counts: any[] = [];
  for (let i = 0; i < 24; i++) {
    const setup = structuredClone(workload.setups[i % workload.setups.length]);
    const begin = performance.now(), result = await run(setup);
    samples.push(performance.now() - begin);
    counts.push({ decisions: result.decisions, requests: result.requests, events: result.events, eventKindBytes: result.eventKindBytes });
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((a, b) => a + b, 0), decisions = counts.reduce((a, b) => a + b.decisions, 0);
  const report = { rule: workload.definition.id, lane, node: process.version, games: samples.length,
    medianMs: (sorted[11]! + sorted[12]!) / 2, meanMs: total / samples.length, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    meanMsPerDecision: total / decisions, decisionsPerSecond: decisions * 1000 / total,
    peakRssMB: process.resourceUsage().maxRSS / 1024, heapUsedMB: process.memoryUsage().heapUsed / 1e6, counts, samples };
  console.log(JSON.stringify(report)); return report;
}
