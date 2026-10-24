import type {PolicyRequest} from '@bear-forge/policies';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {Action, Observation, StsEvent} from '../game.schemas.ts';
import {ActionSchema, ObservationSchema, EventSchema} from '../game.schemas.ts';

export type PublicDecision = {observation: Observation; actions: Action[]; events: StsEvent[]};

// These fields are correlation handles published by detail-events.ts, not
// random evidence. Preserve alias relationships without retaining numeric gaps.
const entityFields = new Set(['entity','deck','piles','battle','actor','owner','source','target','enemy','card','registry','controller','scope','play']);
export function publicEvents(events: StsEvent[], identities = new Map<number, number>()): StsEvent[] {
  return events.map(event => {
    if (event.kind !== 'detail') return {...event};
    return {...event, data: Object.fromEntries(Object.entries(event.data).map(([key, value]) => {
      if (!entityFields.has(key) || typeof value !== 'number' || value < 0) return [key, value];
      let identity = identities.get(value);
      if (identity === undefined) {identity = identities.size; identities.set(value, identity);}
      return [key, identity];
    }))};
  });
}

/** Canonical data serialization; never includes delivery/request identities. */
export function publicData(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(publicData);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k,v]) => [k,publicData(v)]));
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return value;
  throw Error('Non-data public information');
}
export const publicKey = (value: unknown): string => JSON.stringify(publicData(value));
export function readVisibleEvents(visibleHistory:unknown[]):StsEvent[]{
  return visibleHistory.map(delivery=>{
    if(!delivery||typeof delivery!=='object'||!('event' in delivery))throw Error('Missing public event delivery');
    return EventSchema.parse(delivery.event);
  });
}
export function publicDecision(request: PolicyRequest, visibleHistory: unknown[]): PublicDecision {
  if (request.player !== '0' || request.type !== 'action' || request.options.kind !== 'exact') throw Error('Unsupported STS request');
  // Strict external schemas reject captures, seeds, RNG, and undeclared fields.
  const observation = ObservationSchema.parse(request.observation);
  const actions = request.options.values.map(action => ActionSchema.parse(action));
  if (publicKey(request.data) !== publicKey({screen: observation.game.screen})) throw Error('Inconsistent STS request screen');
  const events = readVisibleEvents(visibleHistory);
  return {observation, actions, events: publicEvents(events)};
}
/** The bits identify public candidate positions, never private entity numbers.
 * The current legal action domain supplies the identities. */
export const actionKey = (action: Action) => String(action.bits);
