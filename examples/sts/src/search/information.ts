import {deflateRawSync} from 'node:zlib';
import type {PolicyRequest} from '@bear-forge/policies';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {Action, Observation, StsEvent} from '../game.schemas.ts';

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
  return value as JsonValue;
}
export const publicKey = (value: unknown): string => JSON.stringify(publicData(value));
/** Lossless canonical-data key, not a hash or a reduced observation. Equality
 * still compares every original public field: decoding is a left inverse. */
export const compressedPublicKey = (value: unknown): string => deflateRawSync(publicKey(value),{level:1}).toString('base64');
export function readVisibleEvents(visibleHistory:unknown[]):StsEvent[]{
  return (visibleHistory as {event:StsEvent}[]).map(delivery=>delivery.event);
}
/** Host-owned typed requests are already projected by the original contract. */
export function publicDecision(request: PolicyRequest, visibleHistory: unknown[]): PublicDecision {
  return {observation:request.observation as Observation,
    actions:(request.options as {kind:'exact';values:Action[]}).values,
    events:publicEvents(readVisibleEvents(visibleHistory))};
}
/** The bits identify public candidate positions, never private entity numbers.
 * The current legal action domain supplies the identities. */
export const actionKey = (action: Action) => String(action.bits);
