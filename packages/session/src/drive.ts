import { copy } from '@bear-forge/boundary';
import type { VirtualSession } from './session.ts';
/** A caller supplies deadline extraction and control encoding; rules remain in the game. */
export async function driveSession(game: any, session: VirtualSession, input: {
  at: number;
  deadlines: {
    key: string;
    at: number;
  }[];
  control: (selection: {
    kind: 'timeout';
    key: string;
    at: number;
  } | {
    kind: 'clock';
    at: number;
  }) => unknown;
  onEvent?: (player: string, delivery: unknown) => Promise<void>;
}) {
  const inspected = await game.inspect();
  if (!inspected.ok) return inspected;
  if (inspected.value.kind !== 'request') return game.run();
  const requests = inspected.value.requests,
    selection = session.select({
      at: input.at,
      requests,
      deadlines: input.deadlines
    });
  if (selection.kind === 'action') {
    const validation = await game.validate({
      player: selection.arrival.player,
      reply: {
        requestId: selection.arrival.requestId,
        type: selection.arrival.type,
        action: selection.arrival.action
      }
    });
    if (!validation.ok || !validation.value.valid) {
      session.reject(selection.arrival.ordinal, validation.ok ? validation.value.reason : validation.error.code);
      return {
        ok: true,
        value: {
          state: inspected.value,
          accepted: null,
          pause: 'invalid_reply'
        }
      };
    }
  }
  for (const player of new Set<string>(requests.map((r: any) => r.player))) {
    const bound = await game.bind({
      player,
      async onRequest(request: any) {
        return selection.kind === 'action' && request.id.instanceId === selection.arrival.requestId.instanceId && request.id.callId === selection.arrival.requestId.callId && request.id.key === selection.arrival.requestId.key ? {
          kind: 'reply',
          value: copy(selection.arrival.action)
        } : {
          kind: 'pause'
        };
      },
      async onEvent(delivery: any) {
        await input.onEvent?.(player, copy(delivery));
        return {
          kind: 'reply',
          value: null
        };
      }
    });
    if (!bound.ok) return bound;
  }
  if (selection.kind !== 'action' && typeof game.bindControl !== 'function') throw Error('Game does not declare session control');
  if (typeof game.bindControl === 'function') {
    const bound = await game.bindControl(selection.kind === 'action' ? null : async () => ({
      kind: 'reply',
      value: input.control(selection)
    }));
    if (!bound.ok) return bound;
  }
  const result = await game.run();
  if (result.ok && result.value.accepted) {
    if (selection.kind === 'action' !== (result.value.accepted.kind === 'action')) throw Error('Unexpected accepted session input');
    session.commit(selection);
  }
  return result;
}
