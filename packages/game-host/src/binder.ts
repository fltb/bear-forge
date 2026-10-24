import { fields } from '@bear-forge/boundary';
import { types } from 'node:util';
import { copyOwned as copy, readOwned as read, retainOwned, isOwned, isOwnedTree, isDenseTree } from '../../boundary/src/values.ts';
import { callback, exceptionMessage } from '@bear-forge/runtime';
import { invokeOwnedStop, inputlessReply } from '../../runtime/src/stop-ownership.ts';
import { RequestIdSchema, GameErrorSchema, JsonValueSchema, InputOptionsSchema } from '@bear-forge/contracts/game';
import type { BaseGameBinder } from '@bear-forge/contracts/loading';
import {registerCurrentFork,registerCurrentAccess} from './current.ts';
/** GameContract adapters only read stable published data. Unknown provider
 * values first become private DTOs; players and parsers still receive copies. */
function adapterValue<T>(value: T): T {
  return isOwned(value) ? value : retainOwned(copy(value));
}
function requireAcyclic(value: unknown, ancestors?: Set<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (isOwnedTree(value)) return;
  const path = ancestors ?? new Set<object>();
  if (path.has(value)) throw new TypeError('Cyclic JSON value');
  path.add(value);
  for (const key of Object.keys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, 'value')) throw new TypeError('Invalid JSON value');
    requireAcyclic(field.value, path);
  }
  path.delete(value);
}
function jsonValue(value: unknown) {
  const checked = read(JsonValueSchema, value);
  requireAcyclic(checked);
  return checked;
}
const ok = (value: any) => ({
  ok: true as const,
  value
});
function reject(code: string, message = code): any {
  const kind = ['game_busy', 'game_closed', 'game_ended', 'view_unavailable'].includes(code) ? 'conflict' : code === 'capability_unavailable' ? 'unsupported' : ['invalid_output', 'program_failed', 'budget_exceeded'].includes(code) ? 'fault' : 'rejected';
  return {
    ok: false,
    error: GameErrorSchema.parse({
      kind,
      code,
      message
    })
  };
}
function checkedPrepared(value: any) {
  if (!fields(value, ['valid'], ['output', 'reason']) || typeof value.valid !== 'boolean' || (value.valid
    ? !fields(value, ['valid', 'output'])
    : !fields(value, ['valid', 'reason']) || typeof value.reason !== 'string')) throw Error('Invalid respond result');
  return value.valid ? { valid: true, output: copy(value.output) } : { valid: false, reason: value.reason };
}
function dataArray(value: unknown): unknown[] {
  if (types.isProxy(value) || !Array.isArray(value)) throw Error('Invalid array projection');
  return value;
}
function* dataItems(values: unknown[]): Iterable<unknown> {
  for (let i = 0; i < values.length; i++) {
    const field = Object.getOwnPropertyDescriptor(values, String(i));
    if (field && !Object.hasOwn(field, 'value')) throw Error('Invalid array item');
    yield field?.value;
  }
}
const equal = (a: any, b: any) => a.instanceId === b.instanceId && a.callId === b.callId && a.key === b.key;
/** Owns an Instance through its public transfer/bind/run interfaces. */
type Derived = { view: any; hasView: boolean; state: any; raw: any; requests: any[]; events: any[]; eventOutput: any; port: any };
async function bindGame(input: any, shared?: Derived): Promise<any> {
      if (!fields(input, ['instance', 'contract'], ['persistence']) || !input.instance || typeof input.instance.transfer !== 'function' || !input.contract) return reject('invalid_argument');
      const ownership = await input.instance.transfer();
      if (!ownership.ok) return reject('invalid_argument', ownership.error.message);
      const instance = ownership.value,
        contract = input.contract;
      const playerValue = (value: unknown): string => {
        const player = read(contract.schemas.player, value);
        if (typeof player !== 'string') throw Error('Invalid player');
        return player;
      };
      const bindings = new Map<string, any>();
      let controlHandler: any = null,
        closed = false,
        driving = false,
        computing = false;
      let activeDriver: AbortController | null = null;
      let view: any,
        hasView = false,
        state: any,
        raw: any,
        requests: any[] = [],
        events: any[] = [],
        eventOutput: any,
        port: any;
      const availability = (stable = false) => closed ? reject('game_closed') : computing || stable && driving ? reject('game_busy') : null;
      async function fault(error: any) {
        state = {
          kind: 'fault',
          error
        };
        closed = true;
        view = raw = eventOutput = port = undefined;
        hasView = false; requests = []; events = [];
        bindings.clear(); controlHandler = null;
        activeDriver?.abort();
        await instance.close();
        return copy(state);
      }
      async function refresh(stop?: any): Promise<any> {
        if (stop === undefined) {
          const inspected = await invokeOwnedStop(instance, 'inspect');
          if (!inspected.ok) throw Error(inspected.error.message);
          raw = inspected.value;
        } else raw = stop;
        if (raw.kind === 'fault') {
          // Program termination remains readable. Only adapter contract failures
          // revoke the owned instance and close the game handle.
          state = copy(raw);
          view = eventOutput = port = undefined; hasView = false; requests = []; events = [];
          return state;
        }
        try {
          if (raw.kind === 'done') {
            const ended = contract.finish(adapterValue(raw.result));
            if (!fields(ended, ['view', 'result'])) throw Error('Invalid finish result');
            view = read(contract.schemas.view, ended.view);
            hasView = true;
            state = {
              kind: 'ended',
              result: read(contract.schemas.result, ended.result)
            };
            retainOwned(state, isOwnedTree(state.result), isDenseTree(state.result));
            requests = []; events = []; eventOutput = port = undefined;
            return state;
          }
          if (!Object.hasOwn(contract.ports, raw.call.port)) throw Error('Undeclared game port');
          port = contract.ports[raw.call.port];
          if (!port || !['request', 'event'].includes(port.kind)) throw Error('Invalid game port');
          if (port.kind === 'event') {
            requests = [];
            const received = port.receive(adapterValue(raw.call.input));
            if (!fields(received, ['events', 'output'])) throw Error('Invalid event result');
            events = Array.from(dataItems(dataArray(received.events)), (e: any) => read(contract.schemas.event, e));
            eventOutput = copy(received.output);
            state = {
              kind: 'event',
              callId: raw.callId
            };
            return state;
          }
          events = []; eventOutput = undefined;
          const received = port.receive(adapterValue(raw.call.input));
          if (!fields(received, ['view', 'requests'])) throw Error('Invalid request result');
          const declarations = dataArray(received.requests);
          if (!declarations.length && !port.session) throw Error('Invalid request result');
          view = read(contract.schemas.view, received.view);
          hasView = true;
          const keys = new Set();
          requests = Array.from(dataItems(declarations), (r: any) => {
            if (!fields(r, ['key', 'player', 'type', 'data']) || typeof r.key !== 'string' || typeof r.type !== 'string' || keys.has(r.key) || !Object.hasOwn(contract.schemas.actions, r.type)) throw Error('Invalid request declaration');
            keys.add(r.key);
            const player = playerValue(r.player),
              data = read(contract.schemas.actions[r.type].request, jsonValue(r.data));
            const request = {
              key: r.key,
              player,
              type: r.type,
              data
            };
            const options = read(InputOptionsSchema,
              read(contract.inputs[r.type].options, contract.inputs[r.type].describe(adapterValue(view), request)));
            requireAcyclic(options);
            if (options.kind === 'exact') {
              // Options are already an isolated private graph. Each advertised
              // value can be borrowed as a schema baseline, never as callback
              // input; read still invokes the action parser on its own copy.
              for (const value of options.values) read(contract.schemas.actions[r.type].action, retainOwned(value, isOwnedTree(options), isDenseTree(options)));
            }
            const id = RequestIdSchema.parse({
                instanceId: instance.id,
                callId: raw.callId,
                key: r.key
              });
            const observation = read(contract.schemas.observation, contract.observe(adapterValue(view), player));
            return retainOwned({
              id,
              player,
              type: r.type,
              data,
              observation,
              options
            }, isOwnedTree(data) && isOwnedTree(observation) && isOwnedTree(options), isDenseTree(data) && isDenseTree(observation) && isDenseTree(options));
          });
          // Each request's data/observation/options was independently isolated;
          // the new identity shells contain only scalar fields.
          retainOwned(requests, requests.every(isOwnedTree), requests.every(isDenseTree));
          state = retainOwned({
            kind: 'request',
            requests
          }, isOwnedTree(requests), isDenseTree(requests));
          return state;
        } catch (e) {
          return fault(reject('invalid_output', exceptionMessage(e)).error);
        }
      }
      async function prepare(player: any, reply: any): Promise<any> {
        try {
          player = playerValue(player);
          if (!fields(reply, ['requestId', 'type', 'action'])) return reject('invalid_input');
          const id = RequestIdSchema.parse(reply.requestId);
          if (typeof reply.type !== 'string' || !Object.hasOwn(contract.schemas.actions, reply.type)) return reject('invalid_input');
          if (state.kind === 'fault') return { ok: false, error: copy(state.error) };
          if (state.kind === 'event') return reject('view_unavailable');
          if (state.kind === 'ended') return reject('game_ended');
          const request = requests.find(r => equal(r.id, id) && r.player === player && r.type === reply.type);
          if (!request) return ok({ valid: false, reason: 'request_mismatch' });
          let action;
          try {
            action = read(contract.schemas.actions[reply.type].action, jsonValue(reply.action));
          } catch {
            return ok({
              valid: false,
              reason: 'invalid_action'
            });
          }
          const authorRequest = {
            key: request.id.key,
            player: request.player,
            type: request.type,
            data: adapterValue(request.data)
          };
          let prepared;
          try {
            prepared = checkedPrepared(port.respond(adapterValue(view), authorRequest, adapterValue(action)));
          } catch (e) {
            const rejected = reject('invalid_output', exceptionMessage(e));
            await fault(rejected.error);
            return rejected;
          }
          if (!prepared.valid) return ok({
            valid: false,
            reason: String(prepared.reason)
          });
          return ok({
            valid: true,
            // checkedPrepared already detached this output from the adapter.
            // Only the private driver receives it; no second graph is needed.
            output: prepared.output,
            accepted: {
              kind: 'action',
              player,
              reply: copy(reply)
            }
          });
        } catch (e) {
          return reject('invalid_input', exceptionMessage(e));
        }
      }
      async function choose(signal: AbortSignal): Promise<any> {
        const candidates = requests.filter(r => bindings.get(r.player)?.onRequest);
        const hasControl = port.session && controlHandler;
        if (!candidates.length && !hasControl) return {
          pause: 'unbound'
        };
        let controlRequest: unknown;
        if (hasControl) {
          try {
            controlRequest = {
              instanceId: instance.id,
              callId: raw.callId,
              data: read(port.session.requestSchema, port.session.request(adapterValue(view)))
            };
          } catch (e) {
            await fault(reject('invalid_output', exceptionMessage(e)).error);
            return { pause: null };
          }
        }
        const cancellation = new AbortController();
        const abort = () => cancellation.abort();
        signal.addEventListener('abort', abort, {
          once: true
        });
        if (signal.aborted) abort();
        try {
          return await new Promise(resolve => {
            let pending = candidates.length + (hasControl ? 1 : 0),
              winner = false;
            const pauses: string[] = [];
            const finish = (x: any) => {
              if (winner) return;
              if (state.kind !== 'fault' && signal.aborted) x = { pause: 'cancelled' };
              if (state.kind === 'fault' || x.accepted) {
                winner = true;
                cancellation.abort();
                resolve(x);
                return;
              }
              pauses.push(x.pause);
              if (--pending === 0) {
                winner = true;
                resolve({
                  pause: pauses.includes('cancelled') ? 'cancelled' : pauses.includes('invalid_reply') ? 'invalid_reply' : pauses.includes('handler_failed') ? 'handler_failed' : 'requested'
                });
              }
            };
            // Callback waits run concurrently; validation/selection has one owner.
            // A resolved prepare promise must not let a later candidate convert
            // or fault the game before the earlier valid candidate is selected.
            let checking = Promise.resolve();
            const check = (work: () => Promise<void>) => {
              checking = checking.then(async () => {
                if (winner) return;
                if (signal.aborted && state.kind !== 'fault') {
                  finish({ pause: 'cancelled' });
                  return;
                }
                try {
                  await work();
                } catch (e) {
                  await fault(reject('invalid_output', exceptionMessage(e)).error);
                  finish({ pause: null });
                }
              });
              return checking;
            };
            for (const request of candidates) {
              const handler = bindings.get(request.player).onRequest;
              void callback<any>(() => handler(copy(request), {
                signal: cancellation.signal
              }), cancellation.signal).then(reply => check(async () => {
                if (winner) return;
                if ('pause' in reply) {
                  finish(reply);
                  return;
                }
                const candidate = {
                  requestId: request.id,
                  type: request.type,
                  action: reply.value
                };
                const prepared = await prepare(request.player, candidate);
                finish(prepared.ok && prepared.value.valid ? prepared.value : {
                  pause: 'invalid_reply'
                });
              }));
            }
            if (hasControl) void callback<any>(() => controlHandler(copy(controlRequest), {
              signal: cancellation.signal
            }), cancellation.signal).then(reply => check(async () => {
              if (winner) return;
              if ('pause' in reply) {
                finish(reply);
                return;
              }
              let value;
              try {
                value = read(port.session.inputSchema, reply.value);
              } catch {
                finish({ pause: 'invalid_reply' });
                return;
              }
              try {
                const prepared = checkedPrepared(port.session.respond(adapterValue(view), adapterValue(value)));
                finish(prepared.valid ? {
                  output: prepared.output,
                  accepted: {
                    kind: 'control',
                    callId: raw.callId,
                    input: value
                  }
                } : { pause: 'invalid_reply' });
              } catch (e) {
                await fault(reject('invalid_output', exceptionMessage(e)).error);
                finish({ pause: null });
              }
            }));
          });
        } finally {
          signal.removeEventListener('abort', abort);
          cancellation.abort();
        }
      }
      async function deliver(signal: AbortSignal) {
        const recipients = [...bindings].filter(([, binding]) => binding.onEvent)
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        const indices = new Map<string, number>();
        for (const event of events) {
          for (const [player, binding] of recipients) {
            let projected,
              visible = false;
            try {
              const packet = contract.projectEvent(adapterValue(event), player);
              visible = packet !== null;
              if (visible) {
                if (!fields(packet, ['event'])) throw Error('Invalid event projection');
                projected = read(contract.schemas.playerEvent, packet.event);
              }
            } catch (e) {
              await fault(reject('invalid_output', exceptionMessage(e)).error);
              return {
                pause: null
              };
            }
            if (!visible) continue;
            const index = indices.get(player) ?? 0;
            indices.set(player, index + 1);
            const delivery = {
              id: {
                instanceId: instance.id,
                callId: raw.callId,
                index
              },
              event: projected
            };
            const reply = await callback<any>(() => binding.onEvent(copy(delivery), {
              player,
              signal
            }), signal);
            if ('pause' in reply) return reply;
            if (reply.value !== null) return {
              pause: 'invalid_reply'
            };
          }
        }
        return {
          output: eventOutput
        };
      }
      const game: any = {
        id: instance.id,
        async bind(value: any) {
          const error = availability(true);
          if (error) return error;
          try {
            if (value === null) bindings.clear();else {
              if (!fields(value, ['player'], ['onRequest', 'onEvent'])) return reject('invalid_argument');
              const player = playerValue(value.player);
              for (const key of ['onRequest', 'onEvent']) if (value[key] !== undefined && typeof value[key] !== 'function') return reject('invalid_argument');
              bindings.set(player as string, {
                ...value
              });
            }
            return ok(undefined);
          } catch (e) {
            return reject('invalid_argument', exceptionMessage(e));
          }
        },
        async bindControl(handler: any) {
          const error = availability(true);
          if (error) return error;
          if (handler !== null && typeof handler !== 'function') return reject('invalid_argument');
          controlHandler = handler;
          return ok(undefined);
        },
        async inspect() {
          const error = availability();
          return error ?? ok(copy(state));
        },
        async observe(value: any) {
          const error = availability();
          if (error) return error;
          let player;
          try {
            if (!fields(value, ['player'])) return reject('invalid_input');
            player = playerValue(value.player);
          } catch (e) {
            return reject('invalid_input', exceptionMessage(e));
          }
          if (state.kind === 'fault') return { ok: false, error: copy(state.error) };
          if (state.kind === 'event' || !hasView) return reject('view_unavailable');
          try {
            return ok(copy(read(contract.schemas.observation, contract.observe(adapterValue(view), player))));
          } catch (e) {
            const rejected = reject('invalid_output', exceptionMessage(e));
            await fault(rejected.error);
            return rejected;
          }
        },
        async describe(value: any) {
          const error = availability();
          if (error) return error;
          try {
            if (!fields(value, ['requestId', 'type'])) return reject('invalid_input');
            const id = RequestIdSchema.parse(value.requestId);
            if (typeof value.type !== 'string' || !Object.hasOwn(contract.schemas.actions, value.type)) return reject('invalid_input');
            if (state.kind === 'fault') return { ok: false, error: copy(state.error) };
            if (state.kind === 'event') return reject('view_unavailable');
            if (state.kind === 'ended') return reject('game_ended');
            const request = requests.find(r => equal(r.id, id) && r.type === value.type);
            if (state.kind !== 'request' || !request) return reject('request_mismatch');
            return ok(copy(request.options));
          } catch {
            return reject('invalid_input');
          }
        },
        async validate(value: any) {
          const error = availability();
          if (error) return error;
          if (!fields(value, ['player', 'reply'])) return reject('invalid_input');
          const prepared = await prepare(value.player, value.reply);
          return prepared.ok ? ok(prepared.value.valid ? {
            valid: true
          } : {
            valid: false,
            reason: prepared.value.reason
          }) : prepared;
        },
        async run(options: any = {}) {
          const error = availability(true);
          if (error) return error;
          if (!fields(options, [], ['signal']) || options.signal !== undefined && !(options.signal instanceof AbortSignal)) return reject('invalid_argument');
          if (state.kind === 'ended' || state.kind === 'fault') return ok({
            state: copy(state),
            accepted: null,
            pause: null
          });
          driving = true;
          let accepted: any = null;
          const driver = new AbortController();
          activeDriver = driver;
          const abort = () => driver.abort();
          options.signal?.addEventListener('abort', abort, { once: true });
          if (options.signal?.aborted) abort();
          const signal = driver.signal;
          try {
            while (true) {
              if (state.kind === 'ended' || state.kind === 'fault') return ok({
                state: copy(state),
                accepted: copy(accepted),
                pause: null
              });
              if (signal.aborted) return ok({
                state: copy(state),
                accepted: copy(accepted),
                pause: 'cancelled'
              });
              if (accepted && state.kind === 'request') return ok({
                state: copy(state),
                accepted: copy(accepted),
                pause: null
              });
              const next = state.kind === 'event' ? await deliver(signal) : await choose(signal);
              if (state.kind === 'fault') return ok({
                state: copy(state),
                accepted: copy(accepted),
                pause: null
              });
              if ('pause' in next) return ok({
                state: copy(state),
                accepted: copy(accepted),
                pause: next.pause
              });
              computing = true;
              const bound = await instance.bind({
                [raw.call.port]: inputlessReply(next.output)
              });
              if (!bound.ok) throw Error(bound.error.message);
              const step = await invokeOwnedStop(instance, 'run', { signal });
              if (!step.ok) throw Error(step.error.message);
              if (step.value.accepted && next.accepted) accepted = next.accepted;
              if (!step.value.accepted) {
                computing = false;
                if (step.value.pause === 'invalid_reply') {
                  await fault(reject('invalid_output', 'Game adapter produced an invalid port reply').error);
                  return ok({
                    state: copy(state),
                    accepted: copy(accepted),
                    pause: null
                  });
                }
                return ok({
                  state: copy(state),
                  accepted: copy(accepted),
                  pause: step.value.pause
                });
              }
              await refresh(step.value.state);
              computing = false;
            }
          } catch (e) {
            computing = false;
            await fault(reject('program_failed', exceptionMessage(e)).error);
            return ok({
              state: copy(state),
              accepted: copy(accepted),
              pause: null
            });
          } finally {
            options.signal?.removeEventListener('abort', abort);
            activeDriver = null;
            driver.abort();
            driving = false;
            computing = false;
          }
        },
        async close() {
          const error = availability(true);
          if (error) return error;
          closed = true;
          bindings.clear();
          controlHandler = null;
          view = raw = state = eventOutput = port = undefined;
          hasView = false; requests = []; events = [];
          const result = await instance.close();
          return result.ok ? ok(undefined) : reject('program_failed', result.error.message);
        }
      };
      if (instance.fork) game.fork = async () => {
        const error = availability(true);
        if (error) return error;
        if (state.kind === 'fault') return { ok: false, error: copy(state.error) };
        const fork = await instance.fork();
        return fork.ok ? bindGame({ ...input, instance: fork.value }, { view, hasView, state, raw, requests, events, eventOutput, port }) : reject(fork.error.code === 'capability_unavailable' ? 'capability_unavailable' : 'program_failed', fork.error.message);
      };
      if (!Object.values(contract.ports).some((p: any) => p.kind === 'request' && p.session)) delete game.bindControl;
      if (input.persistence) game.save = async () => {
        const error = availability(true);
        if (error) return error;
        if (state.kind === 'fault') return { ok: false, error: copy(state.error) };
        const saved = await input.persistence.save(instance);
        return saved.ok ? saved : reject('program_failed', saved.error.message);
      };
      try {
        if (shared) {
          ({ view, hasView, raw, events, eventOutput, port } = shared);
          requests = shared.requests.map(request => retainOwned({ ...request,
            id: { ...request.id, instanceId: instance.id }
          }, isOwnedTree(request), isDenseTree(request)));
          retainOwned(requests, requests.every(isOwnedTree), requests.every(isDenseTree));
          state = shared.state.kind === 'request' ? retainOwned({ kind: 'request', requests }, isOwnedTree(requests), isDenseTree(requests)) : shared.state;
        } else await refresh();
        if(!closed)registerCurrentAccess(game,async operation=>{
          const error=availability(true);if(error)throw Error(error.error.code+': '+error.error.message);
          computing=true;try{return await operation(instance);}finally{computing=false;}
        });
        if(!closed&&instance.fork)registerCurrentFork(game,async()=>{
          const error=availability(true);
          if(error)return error;
          if(state.kind==='fault')return{ok:false,error:copy(state.error)};
          return instance.fork!();
        });
        return closed ? {
          ok: false,
          error: state.error
        } : ok(game);
      } catch (e) {
        await instance.close();
        return reject('invalid_output', exceptionMessage(e));
      }
  }
export function createGameBinder(): BaseGameBinder {
  return { bind: bindGame };
}
