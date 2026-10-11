import { randomUUID } from 'node:crypto';
import { copy, read, keys, fields } from '@bear-forge/boundary';
import { InstanceIdSchema, CallIdSchema } from '@bear-forge/contracts/instance';
import type { Instance, InstanceStop, InstanceError, Outcome, PortBindings, PauseReason, InstanceRunStop } from '@bear-forge/contracts/instance';
import type { ProgramSchemas, PortShape } from '@bear-forge/contracts/core';
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
  dispose: () => void;
  snapshot?: () => string;
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
  records: InstanceRecord<S, P, R>[];
  bindings: PortBindings<P> | null = null;
  computing = false;
  driving = false;
  closed = false;
  owner = 0;
  forkHandler?: () => Promise<Outcome<Instance<P, R>>>;
  engine: Execution;
  schemas: ProgramSchemas<S, P, R>;
  constructor(engine: Execution, schemas: ProgramSchemas<S, P, R>, setup: S, restored?: {
    state: InstanceStop<P, R>;
    records: InstanceRecord<S, P, R>[];
  }) {
    this.engine = engine;
    this.schemas = schemas;
    this.records = restored ? copy(restored.records) : [{
      sequence: 0,
      kind: 'started',
      setup: copy(setup)
    }];
    if (restored) this.state = copy(restored.state);else this.refresh();
  }
  append(record: any) {
    this.records.push({
      sequence: this.records.length,
      ...copy(record)
    });
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
        this.state = {
          kind: 'call',
          callId,
          call
        } as InstanceStop<P, R>;
        this.append({
          kind: 'called',
          callId,
          call
        });
      } else if (raw.kind === 'done') {
        const result = read(this.schemas.result, raw.result);
        this.state = {
          kind: 'done',
          result
        };
        this.append({
          kind: 'completed',
          result
        });
      } else {
        this.state = copy(raw) as InstanceStop<P, R>;
        this.append({
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
    const raw = this.engine.current();
    if (raw?.kind === 'fault' && ['budget_exceeded','program_failed'].includes(raw.error.code)) {
      code = raw.error.code as typeof code;
      cause = raw.error.message;
    }
    this.state = {
      kind: 'fault',
      error: {
        kind: 'fault',
        code,
        message: String(cause)
      }
    };
    this.append({
      kind: 'faulted',
      error: this.state.error
    });
  }
  availability(token: number, stableOnly = false): Outcome<never> | null {
    if (token !== this.owner) return fail('instance_owned');
    if (this.closed) return fail('instance_closed');
    if (this.computing || stableOnly && this.driving) return fail('instance_busy');
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
        return e ?? ok(copy(self.state));
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
        self.schemas = {} as ProgramSchemas<S, P, R>;
        return ok(undefined);
      },
      async run(options) {
        const e = self.availability(token, true);
        if (e) return e;
        if (options !== undefined && (!fields(options, [], ['signal']) || options.signal !== undefined && !(options.signal instanceof AbortSignal))) return fail('invalid_argument');
        if (self.state.kind !== 'call') return ok({
          accepted: false,
          state: copy(self.state),
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
              const returned = await callback<unknown>(() => handler({
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
                    self.append({
                      kind: 'returned',
                      callId: current.callId,
                      reply: {
                        port: current.call.port,
                        output
                      }
                    });
                    self.computing = true;
                    try {
                      await self.engine.advance(output);
                      self.refresh();
                    } catch (cause) {
                      self.setFault(String(cause).includes('budget') || String(cause).includes('Script execution timed out') ? 'budget_exceeded' : 'program_failed', cause);
                    } finally {
                      self.computing = false;
                    }
                    if (aborter.signal.aborted && self.state.kind === 'call') pause = 'cancelled';
                  }
                }
              }
            }
          }
          return ok({
            accepted,
            state: copy(self.state),
            pause: self.state.kind === 'call' ? pause : null
          } as InstanceRunStop<P, R>);
        } finally {
          aborter.abort();
          options?.signal?.removeEventListener('abort', cancel);
          self.driving = false;
        }
      }
    };
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
