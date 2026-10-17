import { copyOwned } from '../../boundary/src/values.ts';

// Private composition capabilities, deliberately absent from package exports.
// Wrappers and retained caller DTOs are never trusted by shape.
const methods = new WeakMap<object, { inspect: Function; run: Function }>();
const apply = Reflect.apply;
const receivers = new WeakMap<object, { handle: object; operation: 'inspect' | 'run' }>();
const inputlessReplies = new WeakSet<Function>();
export function registerStopOwner(handle: { inspect: Function; run: Function }): void {
  methods.set(handle, { inspect: handle.inspect, run: handle.run });
}
/** Internal composition of the existing public methods. Only an exact registered
 * method receives the private receiver; wrappers keep ordinary mutable DTOs. */
export function invokeOwnedStop<H extends { inspect: (...args: any[]) => any; run: (...args: any[]) => any }, O extends 'inspect' | 'run'>(handle: H, operation: O, ...args: Parameters<H[O]>): ReturnType<H[O]> {
  const invoked = handle[operation];
  if (methods.get(handle)?.[operation] !== invoked) return apply(invoked, handle, args);
  const receiver = {};
  receivers.set(receiver, { handle, operation });
  // Return the original Promise: wrapping/awaiting it would insert another
  // microtask between Instance completion and BaseGame's cancellation check.
  // Early rejection leaves only a weak key; successful delivery consumes it.
  return apply(invoked, receiver, args);
}
/** The receiver never reaches user code. All normal calls keep fresh copies. */
export function exportStop<T extends object>(handle: object, operation: 'inspect' | 'run', stop: T, receiver?: object): T {
  const borrowed = receiver && receivers.get(receiver);
  if (borrowed && borrowed.handle === handle && borrowed.operation === operation) {
    receivers.delete(receiver!);
    return stop;
  }
  return copyOwned(stop);
}
/** This factory accepts data, never an author function. Its exact closure does
 * not inspect the call or context, so constructing either argument is redundant. */
export function inputlessReply<T>(value: T): () => Promise<{ kind: 'reply'; value: T }> {
  const handler = async () => ({ kind: 'reply' as const, value });
  inputlessReplies.add(handler);
  return handler;
}
export function isInputlessReply(handler: Function): boolean { return inputlessReplies.has(handler); }
