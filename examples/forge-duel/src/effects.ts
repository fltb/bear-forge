import { invoke, operation, request, repeat, sequence } from '@bear-forge/card-engine';
import type { EffectDefinition } from '@bear-forge/card-engine';
import type { State, Action } from './forge.schemas.ts';
import type { Ports } from './game.types.ts';
import { available, validateAction, startAction, finishAction, endTurn, payCard, placeCard,
  cardEffects, runCardStep, startAttack, attackDamage, counterDamage, deaths } from './rules.ts';
import type { CardStep, CardEffectInput } from './rules.ts';

type Effect<A, R = void> = EffectDefinition<State, Ports, A, R>;
const damageEffect: Effect<CardEffectInput> = { id: 'damage', async run(c, input) { runCardStep(c.state, 'damage', input); } };
const deathsEffect: Effect<CardEffectInput> = { id: 'deaths', async run(c, input) { runCardStep(c.state, 'deaths', input); } };
const drawEffect: Effect<CardEffectInput> = { id: 'draw', async run(c, input) { runCardStep(c.state, 'draw', input); } };
const healEffect: Effect<CardEffectInput> = { id: 'heal', async run(c, input) { runCardStep(c.state, 'heal', input); } };
const steps: Record<CardStep, Effect<CardEffectInput>> = { damage: damageEffect, deaths: deathsEffect, draw: drawEffect, heal: healEffect };
const playEffect: Effect<Extract<Action, { kind: 'play' }>> = { id: 'play', async run(c, action) {
  const card = operation(c, payCard, action);
  operation(c, placeCard, card);
  const definition = cardEffects[card.definition];
  const input: CardEffectInput = { seat: c.state.active, target: action.target, amount: definition.amount };
  for (const step of definition.steps) await invoke(c, steps[step], input, card.id);
} };
type AttackInput = ReturnType<typeof startAttack>;
const damageTarget: Effect<AttackInput> = { id: 'attack.damage', async run(c, input) { operation(c, attackDamage, input); } };
const counter: Effect<AttackInput> = { id: 'attack.counter', async run(c, input) { operation(c, counterDamage, input); } };
const attackDeaths: Effect<AttackInput> = { id: 'attack.deaths', async run(c) { deaths(c.state); } };
const attackEffect: Effect<Extract<Action, { kind: 'attack' }>> = { id: 'attack', async run(c, action) {
  const input = operation(c, startAttack, action);
  await sequence(c, [damageTarget, counter, attackDeaths], input);
} };
const endEffect: Effect<undefined> = { id: 'end-turn', async run(c) { endTurn(c.state); } };
export const actionEffect: Effect<Action> = { id: 'action', async run(c, raw) {
  const action = operation(c, validateAction, raw);
  startAction(c.state);
  if (action.kind === 'play') await invoke(c, playEffect, action);
  else if (action.kind === 'attack') await invoke(c, attackEffect, action);
  else await invoke(c, endEffect, undefined);
  finishAction(c.state);
} };
const publish: Effect<undefined> = { id: 'publish', run: async function publishEvents(c) {
  if (c.state.pending.length) await request(c, { port: 'event', input: c.state.pending.splice(0) });
} };
const turn: Effect<undefined> = { id: 'decision', run: async function decisionTurn(c) {
  available(c.state);
  await invoke(c, publish, undefined);
  const action = await request(c, { port: 'decision', input: c.state });
  await invoke(c, actionEffect, action);
} };
export const gameEffect: Effect<undefined, State> = { id: 'forge-duel', run: async function resolveGame(c) {
  await repeat(c, s => !s.result, turn, undefined);
  await invoke(c, publish, undefined);
  return c.state;
} };
