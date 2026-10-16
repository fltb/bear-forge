import { copy } from '@bear-forge/boundary';
import type { RequestId } from '@bear-forge/contracts/game';
export type Arrival = {
  at: number;
  ordinal: number;
  player: string;
  requestId: RequestId;
  type: string;
  action: unknown;
};
export type SessionState = {
  now: number;
  ordinal: number;
  pending: Arrival[];
  consumed: number[];
  rejected: {
    ordinal: number;
    reason: string;
  }[];
};
export class VirtualSession {
  private state: SessionState;
  constructor(state?: SessionState) {
    this.state = copy(state ?? {
      now: 0,
      ordinal: 0,
      pending: [],
      consumed: [],
      rejected: []
    });
  }
  snapshot() {
    return copy(this.state);
  }
  enqueue(input: Omit<Arrival, 'ordinal'>) {
    const admitted = copy(input);
    if (!Number.isSafeInteger(admitted.at) || admitted.at < this.state.now) throw Error('Arrival precedes virtual clock');
    const entry = { ...admitted, ordinal: this.state.ordinal };
    this.state.pending.push(entry);
    this.state.ordinal++;
    return entry.ordinal;
  }
  reject(ordinal: number, reason: string) {
    if (!this.state.pending.some(a => a.ordinal === ordinal)) return false;
    this.state.pending = this.state.pending.filter(a => a.ordinal !== ordinal);
    this.state.rejected.push({
      ordinal,
      reason
    });
    return true;
  }
  /** Caller provides game deadlines and encodes the selected timeout as a control input. */
  select(input: {
    at: number;
    requests: {
      id: RequestId;
      player: string;
      type: string;
    }[];
    deadlines: {
      key: string;
      at: number;
    }[];
  }) {
    if (!Number.isSafeInteger(input.at) || input.at < this.state.now) throw Error('Clock cannot go backwards');
    const identity = (a: RequestId, b: RequestId) => a.instanceId === b.instanceId && a.callId === b.callId && a.key === b.key;
    const arrivals = this.state.pending.filter(a => a.at <= input.at && input.requests.some(r => r.player === a.player && r.type === a.type && identity(r.id, a.requestId))).sort((a, b) => a.at - b.at || a.ordinal - b.ordinal);
    const timeout = input.deadlines.filter(d => d.at <= input.at).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))[0];
    const arrival = arrivals[0];
    if (timeout && (!arrival || timeout.at <= arrival.at)) return {
      kind: 'timeout' as const,
      key: timeout.key,
      at: timeout.at
    };
    if (arrival) return {
      kind: 'action' as const,
      arrival: copy(arrival)
    };
    return {
      kind: 'clock' as const,
      at: input.at
    };
  }
  /** Time/input consumption changes only after the game reports this input accepted. */
  commit(selection: ReturnType<VirtualSession['select']>) {
    if (selection.kind === 'action') {
      if (this.state.consumed.includes(selection.arrival.ordinal)) return false;
      this.state.consumed.push(selection.arrival.ordinal);
      this.state.pending = this.state.pending.filter(e => e.ordinal !== selection.arrival.ordinal);
      this.state.now = Math.max(this.state.now, selection.arrival.at);
    } else this.state.now = Math.max(this.state.now, selection.at);
    return true;
  }
}
