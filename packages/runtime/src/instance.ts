import { randomUUID } from 'node:crypto';
import { exceptionMessage } from './exception.ts';
import { Records } from './records.ts';
import {ExecutionSuspended} from './continuation.ts';
import { registerStopOwner, exportStop, isInputlessReply } from './stop-ownership.ts';
import { keys, fields } from '@bear-forge/boundary';
import { copyOwned as copy, readOwned as read, retainOwned, isOwnedTree, isDenseTree } from '../../boundary/src/values.ts';
import { InstanceIdSchema, CallIdSchema } from '@bear-forge/contracts/instance';
import type { Instance, InstanceStop, InstanceError, Outcome, PortBindings, PauseReason, InstanceRunStop } from '@bear-forge/contracts/instance';
import type { PortShape } from '@bear-forge/contracts/core';
import type { InstanceRecord } from '@bear-forge/contracts/capture';
export type RawStop = {
  kind: 'call';
  call: {
    port: string;
    input: unknown;
  };
} | {
  kind: 'done';
  result: unknown;
} | {
  kind: 'fault';
  error: Extract<InstanceError, {
    kind: 'fault';
  }>;
};
export type Execution = {
  current: () => RawStop;
  advance: (output: unknown) => Promise<void>;
  /** Private provider continuation of an already consumed reply. Never call
   * advance with a saved reply to implement this capability. */
  resume?: () => Promise<void>;
  discardOutput?: () => void;
  dispose: () => void;
  snapshot?: () => string;
};
type AcceptedPhase = { callId: string; phase: 'advance' | 'publish' | 'ready' };
/** Private host data paired with a provider's current instruction Context.
 * The public Instance persistence protocol still accepts only stable IO/done. */
export type ControllerContinuation<S, P extends { [K in keyof P]: PortShape }, R> = {
  state: InstanceStop<P, R>;
  records: InstanceRecord<S, P, R>[];
  recording: boolean;
  accepted: AcceptedPhase;
};
type Parser<T> = { parse(value: unknown): T };
type RuntimeSchemas<S, P extends { [K in keyof P]: PortShape }, R> = {
  setup: Parser<S>;
  result: Parser<R>;
  ports: { [K in keyof P]: { input: Parser<P[K]['input']>; output: Parser<P[K]['output']> } };
};
export function ok<T>(value: T): Outcome<T> {
  return {
    ok: true,
    value
  };
}
export function fail(code: InstanceError['code'], message: string = code): Outcome<never> {
  const kind = ['invalid_input', 'invalid_argument', 'snapshot_not_found', 'snapshot_incompatible', 'records_not_found'].includes(code) ? 'rejected' : code === 'capability_unavailable' ? 'unsupported' : ['invalid_output', 'budget_exceeded', 'program_failed'].includes(code) ? 'fault' : 'conflict';
  return {
    ok: false,
    error: {
      kind,
      code,
      message
    } as InstanceError
  };
}
export async function callback<T>(invoke: () => Promise<unknown>, signal: AbortSignal): Promise<{
  value: T;
} | {
  pause: PauseReason;
}> {
  return new Promise(resolve => {
    let live = true;
    const finish = (x: {
      value: T;
    } | {
      pause: PauseReason;
    }) => {
      if (!live) return;
      live = false;
      signal.removeEventListener('abort', cancel);
      resolve(x);
    };
    const cancel = () => finish({
      pause: 'cancelled'
    });
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, {
      once: true
    });
    Promise.resolve().then(() => live ? invoke() : {
      kind: 'pause'
    }).then(reply => {
      if (!live) return;
      if (fields(reply, ['kind']) && (reply as any).kind === 'pause') finish({
        pause: 'requested'
      });else if (fields(reply, ['kind', 'value']) && (reply as any).kind === 'reply') {
        try {
          finish({
            value: copy((reply as any).value)
          });
        } catch {
          finish({
            pause: 'invalid_reply'
          });
        }
      } else finish({
        pause: 'invalid_reply'
      });
    }, () => finish({
      pause: 'handler_failed'
    }));
  });
}
export class Controller<S, P extends { [K in keyof P]: PortShape }, R> {
  readonly id = InstanceIdSchema.parse(randomUUID());
  state!: InstanceStop<P, R>;
  records: Records<InstanceRecord<S, P, R>> | null;
  bindings: PortBindings<P> | null = null;
  computing = false;
  driving = false;
  closed = false;
  owner = 0;
  private accepted: AcceptedPhase | null = null;
  forkHandler?: () => Promise<Outcome<Instance<P, R>>>;
  engine: Execution;
  schemas: RuntimeSchemas<S, P, R>;
  constructor(engine: Execution, schemas: RuntimeSchemas<S, P, R>, setup: S, restored?: {
    state: InstanceStop<P, R>;
    records: InstanceRecord<S, P, R>[] | Records<InstanceRecord<S, P, R>>;
    /** Internal provider capability: state is an already detached, never mutated
     * stop value. Host reads still copy it. This avoids copying a whole pending
     * game view during an in-memory fork. Not a public protocol option. */
    shareState?: true;
    /** Private restore only, alongside the provider's consumed continuation. */
    accepted?: AcceptedPhase;
  }, recording = true) {
    this.engine = engine;
    this.schemas = schemas;
    if (restored?.accepted) {
      const accepted = restored.accepted;
      if (!fields(accepted, ['callId', 'phase']) || !['advance', 'publish', 'ready'].includes(accepted.phase)) throw Error('Invalid accepted continuation');
      CallIdSchema.parse(accepted.callId);
      if (accepted.phase !== 'ready' && (restored.state.kind !== 'call' || restored.state.callId !== accepted.callId)) throw Error('Accepted continuation disagrees with waiting call');
      if (accepted.phase === 'ready' && restored.state.kind === 'call' && restored.state.callId === accepted.callId) throw Error('Published continuation still names the consumed call');
      if (accepted.phase === 'advance' && !engine.resume) throw Error('Provider cannot resume a consumed reply');
      if (restored.state.kind === 'fault') throw Error('A fault is not a pending continuation');
      this.accepted = { ...accepted };
    }
    this.records = recording ? restored?.records instanceof Records ? restored.records.fork() : new Records() : null;
    if (this.records) {
      if (restored && !(restored.records instanceof Records)) {
        for (const record of copy(restored.records)) this.records.push(record);
      } else if (!restored) this.records.push({ sequence: 0, kind: 'started', setup: copy(setup) });
    }
    if (restored) this.state = restored.shareState ? restored.state : copy(restored.state);else this.refresh();
  }
  /** Called synchronously by the provider at a committed instruction boundary.
   * Saving these records does not call handlers, parsers or the interpreter. */
  saveContinuation(): ControllerContinuation<S, P, R> {
    if (this.closed || !this.accepted || this.state.kind === 'fault') throw Error('No accepted continuation to save');
    return copy({ state: this.state, records: this.records?.slice() ?? [], recording: this.records !== null, accepted: this.accepted });
  }
  get hasContinuation(): boolean { return this.accepted !== null; }
  get continuationCallId(): string {
    if (!this.accepted) throw Error('No accepted continuation');
    return this.accepted.callId;
  }
  /** Private ownership handoff of a suspended current. The new public handle
   * stays busy; the provider must register its continuation capability too. */
  transferContinuation(): Instance<P, R> {
    if (this.closed || this.driving || this.computing || !this.accepted) throw Error('Accepted continuation is unavailable');
    this.owner++; this.bindings = null; return this.handle();
  }
  async closeContinuation(): Promise<void> {
    if (this.closed || this.driving || this.computing || !this.accepted) throw Error('Accepted continuation is unavailable');
    this.accepted = null;
    const result = await this.handle().close();
    if (!result.ok) throw Error(result.error.message);
  }
  private publishAccepted(): void {
    if (this.accepted?.phase === 'publish') {
      this.refresh();
      this.accepted.phase = 'ready';
    }
  }
  /** Private cold continuation. Public run/inspect/transfer remain busy until
   * the old accepted edge has produced its next real IO/terminal result.
   * On a provider publication failure keep the phase for a subsequent retry. */
  async resumeContinuation(): Promise<InstanceRunStop<P, R>> {
    if (this.closed || this.driving || this.computing || !this.accepted) throw Error('Accepted continuation is unavailable');
    this.driving = this.computing = true;
    try {
      if (this.accepted.phase === 'advance') {
        if (!this.engine.resume) throw Error('Provider cannot resume a consumed reply');
        await this.engine.resume();
        this.accepted.phase = 'publish';
      }
      this.publishAccepted();
      const result = { accepted: true, state: copy(this.state), pause: null } as InstanceRunStop<P, R>;
      this.accepted = null;
      return result;
    } finally {
      this.computing = this.driving = false;
    }
  }
  append(record: any) {
    if (!this.records) return;
    this.records.push({
      sequence: this.records.length,
      ...copy(record)
    });
  }
  /** read() owns and isolates these payloads before they enter state/records.
   * Private payloads are never edited; inspect, handlers and capture copy on
   * exit. Replies stay private here; advance receives an unbranded copy. */
  private appendOwned(record: any) {
    this.records!.push({ sequence: this.records!.length, ...record });
  }
  refresh() {
    if (this.state?.kind === 'fault') return;
    const raw = this.engine.current();
    try {
      if (raw.kind === 'call') {
        if (!fields(raw.call, ['port', 'input']) || !Object.hasOwn(this.schemas.ports, raw.call.port)) throw new Error('Undeclared port');
        const call = {
          port: raw.call.port,
          input: read((this.schemas.ports as any)[raw.call.port].input, raw.call.input)
        };
        const callId = CallIdSchema.parse(randomUUID());
        this.state = retainOwned({
          kind: 'call',
          callId,
          call
        }, isOwnedTree(call.input), isDenseTree(call.input)) as InstanceStop<P, R>;
        if (this.records) this.appendOwned({
          kind: 'called',
          callId,
          call
        });
      } else if (raw.kind === 'done') {
        const result = read(this.schemas.result, raw.result);
        this.state = retainOwned({
          kind: 'done',
          result
        }, isOwnedTree(result), isDenseTree(result));
        if (this.records) this.appendOwned({
          kind: 'completed',
          result
        });
      } else {
        this.state = copy(raw) as InstanceStop<P, R>;
        if (this.records) this.append({
          kind: 'faulted',
          error: raw.error
        });
      }
    } catch (e) {
      this.setFault('invalid_output', e);
    }
  }
  setFault(code: 'invalid_output' | 'program_failed' | 'budget_exceeded', cause: unknown) {
    if (this.state?.kind === 'fault') return;
    try {
      const raw = this.engine.current();
      if (raw.kind === 'fault') {
        code = raw.error.code;
        cause = raw.error.message;
      }
    } catch { /* Preserve the original failure if execution state cannot be read. */ }
    this.state = {
      kind: 'fault',
      error: {
        kind: 'fault',
        code,
        message: exceptionMessage(cause)
      }
    };
    if (this.records) this.append({
      kind: 'faulted',
      error: this.state.error
    });
  }
  availability(token: number, stableOnly = false): Outcome<never> | null {
    if (token !== this.owner) return fail('instance_owned');
    if (this.closed) return fail('instance_closed');
    if (this.accepted || this.computing || stableOnly && this.driving) return fail('instance_busy');
    return null;
  }
  handle(): Instance<P, R> {
    const token = this.owner,
      self = this;
    const handle: Instance<P, R> = {
      id: this.id,
      async transfer() {
        const e = self.availability(token, true);
        if (e) return e;
        self.owner++;
        self.bindings = null;
        return ok(self.handle());
      },
      async bind(bindings) {
        const e = self.availability(token, true);
        if (e) return e;
        try {
          if (bindings !== null) {
            const names = keys(bindings);
            if (names.some(k => !Object.hasOwn(self.schemas.ports, k) || typeof (bindings as any)[k] !== 'function')) return fail('invalid_argument');
          }
          self.bindings = bindings === null ? null : {
            ...bindings
          };
          return ok(undefined);
        } catch {
          return fail('invalid_argument');
        }
      },
      async inspect() {
        const e = self.availability(token);
        return e ?? ok(exportStop(handle, 'inspect', self.state, this));
      },
      async close() {
        const e = self.availability(token, true);
        if (e) return e;
        self.closed = true;
        self.bindings = null;
        self.engine.dispose();
        delete self.forkHandler;
        self.engine = {
          current() {
            throw Error('Instance closed');
          },
          async advance() {},
          dispose() {}
        };
        self.schemas = {} as RuntimeSchemas<S, P, R>;
        // Closed handles stay callable (and return instance_closed), but must
        // not retain a second full pending view outside the capture records.
        self.state = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: 'Instance closed' } };
        return ok(undefined);
      },
      async run(options) {
        const e = self.availability(token, true);
        if (e) return e;
        if (options !== undefined && (!fields(options, [], ['signal']) || options.signal !== undefined && !(options.signal instanceof AbortSignal))) return fail('invalid_argument');
        if (self.state.kind !== 'call') return ok({
          accepted: false,
          state: exportStop(handle, 'run', self.state, this),
          pause: null
        });
        self.driving = true;
        const aborter = new AbortController();
        const cancel = () => aborter.abort();
        options?.signal?.addEventListener('abort', cancel, {
          once: true
        });
        if (options?.signal?.aborted) aborter.abort();
        let accepted = false;
        let pause: PauseReason | null = null;
        try {
          const current = self.state;
          if (aborter.signal.aborted) pause = 'cancelled';else {
            const handler = (self.bindings as any)?.[current.call.port];
            if (!handler) pause = 'unbound';else {
              const returned = await callback<unknown>(() => isInputlessReply(handler) ? handler() : handler({
                instanceId: self.id,
                callId: current.callId,
                input: copy(current.call.input)
              }, {
                signal: aborter.signal
              }), aborter.signal);
              if ('pause' in returned) pause = returned.pause;else {
                let output: unknown,
                  budgetFault = false;
                try {
                  output = read((self.schemas.ports as any)[current.call.port].output, returned.value);
                } catch (error) {
                  const raw = self.engine.current();
                  if (raw?.kind === 'fault' && ['budget_exceeded','program_failed'].includes(raw.error.code)) {
                    budgetFault = true;
                    self.setFault(raw.error.code as 'budget_exceeded'|'program_failed', error);
                  } else pause = 'invalid_reply';
                }
                if (pause === null && !budgetFault) {
                  if (aborter.signal.aborted) pause = 'cancelled';else {
                    accepted = true;
                    // The execution provider may mutate an accepted reply or
                    // publish it in its next call. Keep the immutable original
                    // in records and hand off an unbranded, independent copy.
                    const engineOutput = copy(output);
                    if (self.records) self.appendOwned({
                      kind: 'returned',
                      callId: current.callId,
                      reply: {
                        port: current.call.port,
                        output
                      }
                    });
                    self.computing = true;
                    self.accepted = { callId: current.callId, phase: 'advance' };
                    try {
                      await self.engine.advance(engineOutput);
                      self.accepted.phase = 'publish';
                      self.publishAccepted();
                    } catch (cause) {
                      if (cause instanceof ExecutionSuspended && self.engine.resume) throw cause;
                      self.setFault('program_failed', cause);
                      self.accepted = null;
                    } finally {
                      self.computing = false;
                    }
                    if (aborter.signal.aborted && self.state.kind === 'call') pause = 'cancelled';
                  }
                }
              }
            }
          }
          const result = ok({
            accepted,
            state: exportStop(handle, 'run', self.state, this),
            pause: self.state.kind === 'call' ? pause : null
          } as InstanceRunStop<P, R>);
          self.accepted = null;
          return result;
        } finally {
          self.engine.discardOutput?.();
          aborter.abort();
          options?.signal?.removeEventListener('abort', cancel);
          self.driving = false;
        }
      }
    };
    registerStopOwner(handle);
    if (this.forkHandler) handle.fork = async () => {
      const e = self.availability(token);
      if (e) return e;
      if (self.state.kind === 'fault') return {
        ok: false,
        error: copy(self.state.error)
      };
      return self.forkHandler!();
    };
    return handle;
  }
}
