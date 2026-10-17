import { card as c } from '@bear-forge/card-engine';
import { z } from 'zod';
import type { CardDefinition, CardStep } from '@bear-forge/card-engine';
import type { State, Setup } from './forge.schemas.ts';
import type { Ports } from './game.types.ts';
import { SetupSchema, StateSchema, gamePorts } from './forge.schemas.ts';
import { create, available, validateAction, startAction, finishAction, endTurn, payCard, placeCard, cardEffects, runCardStep, startAttack, attackDamage, counterDamage, deaths } from './rules.ts';

const op = c.operation<State>, invoke = c.invoke<State>, request = c.request<State>;
// Compile only this game's fixed pure data checks, never the card program.
const runtimeState = z.compile(StateSchema);
const effects: CardDefinition<State, Setup, Ports, State>['effects'] = [
  { id: 'game', steps: [c.repeat<State>(s => !s.state.result, [invoke('turn')]), invoke('publish'), c.return<State>(s => s.state)] },
  { id: 'publish', steps: [c.branch<State>(s => s.state.pending.length > 0, [request(s => ({ port: 'event', input: s.state.pending.splice(0) }))])] },
  { id: 'turn', steps: [op(s => available(s.state)), invoke('publish'), request(s => ({ port: 'decision', input: s.state }), 'action'), invoke('action', s => s.locals.action)] },
  { id: 'action', steps: [op(s => validateAction(s.state, s.input), 'action'), op(s => startAction(s.state)), invoke(s => s.locals.action.kind, s => s.locals.action), op(s => finishAction(s.state))] },
  { id: 'play', steps: [op(s => payCard(s.state, s.input), 'card'), op(s => placeCard(s.state, s.locals.card)),
    op(s => ({ seat: s.state.active, target: s.input.target, amount: cardEffects[s.locals.card.definition as keyof typeof cardEffects].amount }), 'effectInput'),
    c.forEach<State>(s => cardEffects[s.locals.card.definition as keyof typeof cardEffects].steps.map(step => ({ step, input: s.locals.effectInput })), 'card-step')] },
  { id: 'card-step', steps: [op(s => runCardStep(s.state, s.input.step, s.input.input))] },
  { id: 'attack', steps: [op(s => startAttack(s.state, s.input), 'attack'), invoke('attack.damage', s => s.locals.attack), invoke('attack.counter', s => s.locals.attack), invoke('attack.deaths')] },
  { id: 'attack.damage', steps: [op(s => attackDamage(s.state, s.input))] },
  { id: 'attack.counter', steps: [op(s => counterDamage(s.state, s.input))] },
  { id: 'attack.deaths', steps: [op(s => deaths(s.state))] },
  { id: 'end', steps: [op(s => endTurn(s.state))] },
];
/** Dedicated data-driven backend; the generic Program entry remains available. */
export const cardDefinition: CardDefinition<State, Setup, Ports, State> = {
  id: 'forge-duel-v1/card-core-1', schemas: { setup: SetupSchema, result: runtimeState,
    ports: { ...gamePorts, decision: { ...gamePorts.decision, input: runtimeState }, event: { ...gamePorts.event, input: z.compile(gamePorts.event.input) } } },
  initialize: create, entry: 'game', effects,
};
