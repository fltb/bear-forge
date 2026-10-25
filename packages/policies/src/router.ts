import { copy } from '@bear-forge/boundary';
import type { JsonValue, EventDelivery } from '@bear-forge/contracts/game';
import type { Policy, PolicyRequest, Proposal, RandomCursor } from './policy.types.ts';
import {PolicyWorkSuspended,policyWork,notePolicySuspension} from './search/work.ts';
import {registerEventReceipt} from '../../runtime/src/continuation.ts';
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
/** Private transaction data. These are pending deliveries and proposals, not
 * instructions to execute again and not accepted JSON policy memory. */
export type RouterPending={version:1;candidates:Candidate[];events:Packet[];packets:Packet[];retainedRequests:PolicyRequest[]};
const requestKey = (r: Pick<PolicyRequest, 'id'>) => JSON.stringify([r.id.instanceId, r.id.callId, r.id.key]);
const deliveryKey = (e: EventDelivery<unknown>) => JSON.stringify([e.id.instanceId, e.id.callId, e.id.index]);
/** Candidate generation never updates committed policy memory or random cursors. */
export class PolicyRouter {
  private state: RouterState;
  private candidates = new Map<string, Candidate>();
  private events: Packet[] = [];
  private packets: Packet[] = [];
  private retainedRequests = new Map<string,PolicyRequest>();
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
  savePending():RouterPending{
    return copy({version:1 as const,candidates:[...this.candidates.values()],events:this.events,packets:this.packets,retainedRequests:[...this.retainedRequests.values()]});
  }
  restorePending(input:RouterPending):void{
    const saved=copy(input);
    this.candidates=new Map(saved.candidates.map(candidate=>[requestKey(candidate.request),candidate]));
    this.retainedRequests=new Map(saved.retainedRequests.map(request=>[requestKey(request),request]));
    this.events=saved.events;this.packets=saved.packets;
  }
  begin() {
    this.candidates.clear();
    this.events = [];
    this.packets = [];
    this.retainedRequests.clear();
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
  private visibleHistoryAt(player: string, cursor: number): EventDelivery<unknown>[] {
    const history = copy(this.state.actors[player]!.history);
    const seen = new Set(history.map(deliveryKey));
    for (const packet of this.events.slice(0, cursor)) {
      if (packet.player !== player) continue;
      const event = packet.value as EventDelivery<unknown>;
      const key = deliveryKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      history.push(copy(event));
    }
    return history;
  }
  binding(player: string): any {
    const binding = {
      player,
      onRequest: async (request: PolicyRequest, control: {
        signal: AbortSignal;
      }) => {
        const saved = copy(request);

        // A scheduling yield revisits the same waiting request without a
        // player action. Keep one request packet for that logical delivery.
        const retained=policyWork(this.policies[player]!),key=requestKey(saved),prior=retained?this.retainedRequests.get(key):undefined;

        if(!prior){this.packets.push({player,kind:'request',value:saved});if(retained)this.retainedRequests.set(key,saved);}
        const actor = this.state.actors[player]!,
          cursor = this.events.length;
        let proposal:Proposal;
        notePolicySuspension(this.policies[player]!,null);
        try{proposal = await this.policies[player]!.decide({
          request: saved,
          visibleHistory: this.visibleHistoryAt(player, cursor),
          memory: this.memoryAt(player, cursor),
          random: copy(actor.random),
          signal: control.signal
        });}catch(error){
          if(control.signal.aborted){
            if(retained)notePolicySuspension(this.policies[player]!,'cancelled');
            return{kind:'pause' as const};
          }
          if(error instanceof PolicyWorkSuspended&&policyWork(this.policies[player]!)){notePolicySuspension(this.policies[player]!,error.reason);return{kind:'pause' as const};}
          throw error;
        }
        if (control.signal.aborted) {
          if(retained)notePolicySuspension(this.policies[player]!,'cancelled');
          return {kind:'pause'};
        }
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
    // Every router event handler performs this same synchronous local receipt,
    // including actors without search work in a mixed-policy transaction.
    registerEventReceipt(binding.onEvent);
    return binding;
  }
  prepare(accepted: any): {
    state: RouterState;
    packets: Packet[];
    candidate: Candidate | null;
  } {
    const next = copy(this.state);
    let selected: Candidate | null = null;
    if (accepted?.kind === 'action') {
      const key = requestKey({ id: accepted.reply.requestId });
      selected = this.candidates.get(key)!;

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

    if (this.state.lastCommitId) {
      const old = this.state.lastCommitId,
        at = old.lastIndexOf(':');

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
