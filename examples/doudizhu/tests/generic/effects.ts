import { invoke, operation } from '@bear-forge/card-engine';
import type { EffectDefinition } from '@bear-forge/card-engine';
import type { State, Input, Action } from '../../src/schemas.ts';
import type { DouDizhuPorts } from '../../src/types.ts';
import { validateInput, advanceClock, consumeInput, resolveBid, resolveDouble, resolveRedouble, resolvePass, resolvePlay } from '../../src/rules.ts';
import type { ResolvedInput } from '../../src/rules.ts';
type Effect<A> = EffectDefinition<State, DouDizhuPorts, A, void>;
const bid: Effect<ResolvedInput> = { id: 'bid', async run(c, input) { operation(c, resolveBid, input); } };
const double: Effect<ResolvedInput> = { id: 'double', async run(c, input) { operation(c, resolveDouble, input); } };
const redouble: Effect<ResolvedInput> = { id: 'redouble', async run(c, input) { operation(c, resolveRedouble, input); } };
const pass: Effect<ResolvedInput> = { id: 'pass', async run(c, input) { operation(c, resolvePass, input); } };
const play: Effect<ResolvedInput> = { id: 'play', async run(c, input) { operation(c, resolvePlay, input); } };
const actions: Record<Action['kind'], Effect<ResolvedInput>> = { bid, double, redouble, pass, play };
const clock: Effect<Extract<Input, { kind: 'clock' }>> = { id: 'clock', async run(c, input) { operation(c, advanceClock, input); } };
export const inputEffect: Effect<Input> = { id: 'input', async run(c, input) {
  if (input.kind === 'clock') { await invoke(c, clock, input); return; }
  const resolved = operation(c, validateInput, input);
  operation(c, consumeInput, resolved);
  await invoke(c, actions[resolved.action.kind], resolved);
} };
