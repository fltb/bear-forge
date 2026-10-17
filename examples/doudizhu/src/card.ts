import { card as c } from '@bear-forge/card-engine';
import { z } from 'zod';
import type { CardDefinition } from '@bear-forge/card-engine';
import type { State, ProgramSetup, Frame } from './schemas.ts';
import { ProgramSetupSchema, InputSchema, FrameSchema, StateSchema, programSchemas } from './schemas.ts';
import type { DouDizhuPorts } from './types.ts';
import { initialState } from './initial-state.ts';
import { dealState } from './deal.ts';
import { frame, validateInput, consumeInput, advanceClock, resolveBid, resolveDouble, resolveRedouble, resolvePass, resolvePlay } from './rules.ts';

export type CardWorld = { game: State; random: number; published: number };
const op = c.operation<CardWorld>, invoke = c.invoke<CardWorld>, request = c.request<CardWorld>;
// Preserve Frame consistency and alias normalization using public schemas.
const runtimeFrame = z.compile(FrameSchema.safeExtend({ state: z.compile(StateSchema) }));
function frameView(state: State, published: number): Frame {
  // Reachable rules preserve the structural/deck invariants. Only clocks and
  // lifetime counters can leave the schema's numeric range. Keep the original
  // validation (including its error and position before event IO) on that path.
  const safe = Number.isSafeInteger(state.deal) && Number.isSafeInteger(state.stageSequence)
    && Number.isSafeInteger(state.boundarySequence)
    && (state.stage === null || state.stage.slots.every(slot => Number.isSafeInteger(slot.deadline.atGameTime)));
  return safe ? { state, events: state.events.slice(published) } : frame(state, published);
}
export const cardDefinition: CardDefinition<CardWorld, ProgramSetup, DouDizhuPorts, Frame> = {
  id: 'competitive-2016-bear-1/card-core-1', schemas: { ...programSchemas, result: runtimeFrame,
    ports: { ...programSchemas.ports, decision: { ...programSchemas.ports.decision, input: runtimeFrame }, event: { ...programSchemas.ports.event, input: z.compile(programSchemas.ports.event.input) } } },
  project(stop) {
    // Zod's Frame representation intentionally separates repeated aliases
    // (e.g. last play vs. its audit event). Canonicalize only after export,
    // never by copying/admitting the live proxy world into a second graph.
    if (stop.kind === 'call' && stop.call.port === 'decision') return { kind: 'call', call: { port: 'decision', input: runtimeFrame.parse(stop.call.input) } };
    if (stop.kind === 'done') return { kind: 'done', result: runtimeFrame.parse(stop.result) };
    return stop;
  },
  initialize(input) { const setup = ProgramSetupSchema.parse(input); return { game: initialState(setup.game), random: setup.seed >>> 0, published: 0 }; },
  entry: 'game', effects: [
    { id: 'game', steps: [c.repeat<CardWorld>(() => true, [
      c.branch<CardWorld>(s => s.state.game.phase === 'dealing', [op(s => dealState(s.state.game, maximum => { s.state.random = (Math.imul(s.state.random, 1664525) + 1013904223) >>> 0; return s.state.random % maximum; }))]),
      // No world edit occurs between publishing and the decision. Keep one
      // world here; the machine exports a detached value at each IO boundary,
      // retaining Frame consistency checks and alias normalization at the boundary.
      op(s => frameView(s.state.game, s.state.published), 'output'),
      c.branch<CardWorld>(s => s.locals.output.events.length > 0, [request(s => ({ port: 'event', input: s.locals.output.events }))]),
      op(s => { s.state.published = s.state.game.events.length; s.locals.output.events = []; }),
      c.branch<CardWorld>(s => s.state.game.phase === 'ended', [c.return<CardWorld>(s => s.locals.output)]),
      request(s => ({ port: 'decision', input: s.locals.output }), 'reply'),
      invoke('input', s => InputSchema.parse(s.locals.reply)),
    ])] },
    { id: 'input', steps: [c.branch<CardWorld>(s => s.input.kind === 'clock', [op(s => advanceClock(s.state.game, s.input)), c.return<CardWorld>()]),
      op(s => validateInput(s.state.game, s.input), 'resolved'), op(s => consumeInput(s.state.game, s.locals.resolved)), invoke(s => s.locals.resolved.action.kind, s => s.locals.resolved)] },
    ...Object.entries({ bid: resolveBid, double: resolveDouble, redouble: resolveRedouble, pass: resolvePass, play: resolvePlay }).map(([id, resolve]) => ({ id, steps: [op(s => resolve(s.state.game, s.input))] })),
  ],
};
