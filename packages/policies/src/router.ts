import { copy } from '@bear-forge/boundary';
import type { JsonValue, EventDelivery } from '@bear-forge/contracts/game';
import type { Policy, PolicyRequest, Proposal, RandomCursor } from './policy.types.ts';
export type ActorState = {
  memory: JsonValue;
  random: RandomCursor;
  history: EventDelivery<unknown>[];
};
export type RouterState = {
  actors: Record<string, ActorState>;
  lastCommitId: string | null;
};
export type Packet = {
  player: string;
  kind: 'request' | 'event';
  value: unknown;
};
type Candidate = {
  request: PolicyRequest;
  proposal: Proposal;
  eventCursor: number;
};
const requestKey = (r: PolicyRequest) => r.id.instanceId + '/' + r.id.callId + '/' + r.id.key;
const deliveryKey = (e: EventDelivery<unknown>) => typeof (e.event as any)?.key === 'string' ? 'game:' + String((e.event as any).key) : e.id.instanceId + '/' + e.id.callId + '/' + e.id.index;
/** Candidate generation never updates committed policy memory or random cursors. */
export class PolicyRouter {
  private state: RouterState;
  private candidates = new Map<string, Candidate>();
  private events: Packet[] = [];
  private packets: Packet[] = [];
  private readonly policies: Record<string, Policy>;
  constructor(policies: Record<string, Policy>, seed: number, restored?: RouterState) {
    this.policies = policies;
    let ordinal = 0;
    this.state = restored ? copy(restored) : {
      actors: Object.fromEntries(Object.keys(policies).sort().map(player => [player, {
        memory: {},
        random: {
          state: seed + Math.imul(++ordinal, 2654435761) >>> 0,
          position: 0
        },
        history: []
      }])),
      lastCommitId: null
    };
  }
  snapshot() {
    return copy(this.state);
  }
  begin() {
    this.candidates.clear();
    this.events = [];
    this.packets = [];
  }
  private memoryAt(player: string, cursor: number) {
    let memory = copy(this.state.actors[player]!.memory);
    const policy = this.policies[player]!;
    const seen = new Set(this.state.actors[player]!.history.map(deliveryKey));
    for (const packet of this.events.slice(0, cursor)) {
      if (packet.player !== player) continue;
      const event = packet.value as EventDelivery<unknown>,
        key = deliveryKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      if (policy.event) memory = copy(policy.event(memory, copy(event.event)));
    }
    return memory;
  }
  binding(player: string): any {
    if (!this.policies[player]) throw Error('Unknown policy actor');
    return {
      player,
      onRequest: async (request: PolicyRequest, control: {
        signal: AbortSignal;
      }) => {
        const saved = copy(request);
        if (saved.player !== player) throw Error('Wrong actor projection');
        this.packets.push({
          player,
          kind: 'request',
          value: saved
        });
        const actor = this.state.actors[player]!,
          cursor = this.events.length;
        const history = [...copy(actor.history), ...this.events.slice(0, cursor).filter(e => e.player === player).map(e => copy(e.value))];
        const proposal = await this.policies[player]!.decide({
          request: saved,
          visibleHistory: history,
          memory: this.memoryAt(player, cursor),
          random: copy(actor.random),
          signal: control.signal
        });
        if (control.signal.aborted) return {
          kind: 'pause'
        };
        this.candidates.set(requestKey(saved), {
          request: saved,
          proposal: copy(proposal),
          eventCursor: cursor
        });
        return {
          kind: 'reply',
          value: copy(proposal.action)
        };
      },
      onEvent: async (event: EventDelivery<unknown>, control: {
        signal: AbortSignal;
      }) => {
        if (control.signal.aborted) return {
          kind: 'pause'
        };
        const packet: Packet = {
          player,
          kind: 'event',
          value: copy(event)
        };
        this.events.push(packet);
        this.packets.push(packet);
        return {
          kind: 'reply',
          value: null
        };
      }
    };
  }
  prepare(accepted: any): {
    state: RouterState;
    packets: Packet[];
    candidate: Candidate | null;
  } {
    const next = copy(this.state);
    let selected: Candidate | null = null;
    if (accepted?.kind === 'action') {
      const key = accepted.reply.requestId.instanceId + '/' + accepted.reply.requestId.callId + '/' + accepted.reply.requestId.key;
      selected = this.candidates.get(key) ?? null;
      if (!selected || selected.request.player !== accepted.player || selected.request.type !== accepted.reply.type || JSON.stringify(selected.proposal.action) !== JSON.stringify(accepted.reply.action)) throw Error('Accepted action has no matching staged candidate');
      const actor = next.actors[accepted.player]!;
      actor.memory = copy(selected.proposal.nextMemory);
      actor.random = copy(selected.proposal.nextRandom);
    }
    for (const [player, actor] of Object.entries(next.actors)) {
      const seen = new Set(actor.history.map(deliveryKey));
      for (let i = 0; i < this.events.length; i++) {
        const packet = this.events[i]!;
        if (packet.player !== player) continue;
        const event = packet.value as EventDelivery<unknown>;
        const key = deliveryKey(event);
        if (seen.has(key)) continue;
        seen.add(key);
        actor.history.push(copy(event));
        if (this.policies[player]!.event && (!selected || selected.request.player !== player || i >= selected.eventCursor)) actor.memory = copy(this.policies[player]!.event!(actor.memory, copy(event.event)));
      }
    }
    return {
      state: next,
      packets: copy(this.packets),
      candidate: selected ? copy(selected) : null
    };
  }
  commit(commitId: string, next: RouterState) {
    const split = commitId.lastIndexOf(':'),
      step = Number(commitId.slice(split + 1));
    if (split < 1 || !Number.isSafeInteger(step) || step < 0) throw Error('Commit identity must include task and logical step');
    if (this.state.lastCommitId) {
      const old = this.state.lastCommitId,
        at = old.lastIndexOf(':');
      if (old.slice(0, at) !== commitId.slice(0, split)) throw Error('Commit belongs to another task');
      if (Number(old.slice(at + 1)) >= step) return false;
    }
    this.state = copy({
      ...next,
      lastCommitId: commitId
    });
    this.begin();
    return true;
  }
}
