import assert from 'node:assert/strict';
import { CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
import { createCardLoader } from '../src/index.ts';
import { CardGraph } from '../src/graph.ts';
import { createGameBinder } from '@bear-forge/game-host';
import { Records } from '../../runtime/src/records.ts';
type Fixture = { setup: any; tape: { call: any; output: any }[]; result: any };
const unwrap = (r: any): any => { if (!r.ok) throw Error(JSON.stringify(r)); return r.value; };

/** Formal benchmark entry shared by game-owned scripts; no test assertions timed. */
export async function benchmarkCards(definition: any, fixtures: Fixture[], contract?: any, lane = process.argv[2] ?? 'card-controlled') {
  if (!['card-native', 'card-controlled', 'card-controlled-recorded', 'instance-native', 'instance-controlled', 'basegame-native', 'basegame-controlled'].includes(lane)) throw Error('Unknown lane');
  const program = new CardProgram(definition);
  const loaded: any = lane.startsWith('instance') || lane.startsWith('basegame') ? unwrap(await createCardLoader({ controlled: lane.endsWith('-controlled') }).load(definition)) : null;
  async function run(f: Fixture, validate: boolean) {
    const setup = structuredClone(f.setup), outputs = f.tape.map(row => structuredClone(row.output)); let index = 0, result: unknown;
    const decisions = lane.startsWith('basegame') ? f.tape.filter(row => row.call.port === 'decision') : [];
    const players = new Set<string>(); if (lane.startsWith('basegame')) for (const row of decisions) for (const request of contract.ports.decision.receive(row.call.input).requests) players.add(request.player);
    const begin = performance.now();
    if (lane.startsWith('basegame')) {
      if (!contract) throw Error('BaseGame benchmark needs its original contract');
      const instance = unwrap(await loaded.core.start(setup));
      const handle = unwrap(await createGameBinder().bind({ instance, contract }));
      for (const player of players) unwrap(await handle.bind({ player, async onRequest(request: any) {
        const row = decisions[index]; if (!row) throw Error('Replay decisions exhausted at ' + index);
        const output = row.output;
        // Multiple pending players are polled concurrently. Only the recorded
        // slot answers; a losing/cancelled callback must not consume the tape.
        if (output?.kind === 'action' && output.slotId !== request.id.key) return { kind: 'pause' };
        return { kind: 'reply', value: output?.kind === 'action' ? output.action : output };
      } }));
      let stop = unwrap(await handle.inspect());
      let turns = 0;
      while (!['ended', 'fault'].includes(stop.kind)) {
        if (++turns > f.tape.length + 10) throw Error('BaseGame tape stalled: ' + JSON.stringify({ index, stop }));
        const moved = unwrap(await handle.run()); if (moved.pause && !['requested'].includes(moved.pause)) throw Error('BaseGame replay paused: ' + JSON.stringify(moved));
        if (moved.accepted?.kind === 'action') index++;
        stop = moved.state;
      }
      if (stop.kind !== 'ended') throw Error(JSON.stringify(stop)); result = stop.result; await handle.close(); await loaded.capture?.release(instance.id);
    } else if (loaded) {
      const instance = unwrap(await loaded.core.start(setup)); let stop = unwrap(await instance.inspect());
      while (stop.kind === 'call') {
        if (validate) assert.deepEqual(stop.call, f.tape[index]!.call);
        const output = outputs[index++]; unwrap(await instance.bind({ [stop.call.port]: async () => ({ kind: 'reply', value: output }) })); stop = unwrap(await instance.run()).state;
      }
      if (stop.kind !== 'done') throw Error(JSON.stringify(stop)); result = stop.result; await instance.close(); await loaded.capture?.release(instance.id);
    } else {
      const root = program.initial(setup, lane.startsWith('card-controlled') ? 1_000_000 : Number.MAX_SAFE_INTEGER), storage = lane.startsWith('card-controlled') ? new CardGraph(root) : plainCardStorage(root, structuredClone);
      const trace = new Records();
      const machine = new CardMachine(program, storage, lane === 'card-controlled-recorded' ? event => trace.push(event) : undefined); let stop: any = machine.advance();
      while (stop.kind === 'call') { if (validate) assert.deepEqual(stop.call, f.tape[index]!.call); stop = machine.advance(outputs[index++]); }
      if (stop.kind !== 'done') throw Error(JSON.stringify(stop)); result = stop.result; storage.close?.();
    }
    const ms = performance.now() - begin;
    assert.equal(index, lane.startsWith('basegame') ? f.tape.filter(row => row.call.port === 'decision').length : f.tape.length);
    if (validate) assert.deepEqual(result, lane.startsWith('basegame') ? contract.finish(f.result).result : f.result); return ms;
  }
  for (const fixture of fixtures) await run(fixture, true);
  for (let i = 0; i < 8; i++) await run(fixtures[i % fixtures.length]!, false);
  const samples = []; for (let i = 0; i < 24; i++) samples.push(await run(fixtures[i % fixtures.length]!, false));
  const sorted = [...samples].sort((a, b) => a - b);
  const report = { rule: definition.id, lane, node: process.version, games: samples.length, medianMs: (sorted[11]! + sorted[12]!) / 2, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], peakRssMB: process.resourceUsage().maxRSS / 1024, heapUsedMB: process.memoryUsage().heapUsed / 1e6, samples };
  console.log(JSON.stringify(report)); return report;
}
