import type { IO, PortCall, PortShape } from '@bear-forge/contracts/core';
import type { EffectDefinition, ResolutionContext } from './resolution.types.ts';

export function createResolution<S, P extends { [K in keyof P]: PortShape }>(state: S, io: IO<P>): ResolutionContext<S, P> {
  return { state, io, frames: [] };
}

/** Native async continuation is compiled by the existing controlled backend. */
export async function invoke<S, P extends { [K in keyof P]: PortShape }, A, R>(
  context: ResolutionContext<S, P>, definition: EffectDefinition<S, P, A, R>, input: A, source: string | null = null,
): Promise<R> {
  const frame = { definition: definition.id, input, source };
  context.frames.push(frame);
  try {
    return await definition.run(context, input);
  } finally {
    if (context.frames.at(-1) === frame) context.frames.pop();
    else {
      // A sibling doing automatic work may finish while another effect waits.
      // Release this activation, never the sibling's still-live provenance.
      const index = context.frames.indexOf(frame);
      if (index !== -1) context.frames.splice(index, 1);
    }
  }
}

export async function sequence<S, P extends { [K in keyof P]: PortShape }, A>(
  context: ResolutionContext<S, P>, definitions: readonly EffectDefinition<S, P, A, unknown>[], input: A,
): Promise<void> {
  for (const definition of definitions) await invoke(context, definition, input);
}

export async function branch<S, P extends { [K in keyof P]: PortShape }, A, R>(
  context: ResolutionContext<S, P>, predicate: (state: S, input: A) => boolean,
  yes: EffectDefinition<S, P, A, R>, no: EffectDefinition<S, P, A, R>, input: A,
): Promise<R> {
  return await invoke(context, predicate(context.state, input) ? yes : no, input);
}

/** Re-evaluates the condition after each fully completed child, including IO. */
export async function repeat<S, P extends { [K in keyof P]: PortShape }, A>(
  context: ResolutionContext<S, P>, predicate: (state: S, input: A) => boolean,
  body: EffectDefinition<S, P, A, unknown>, input: A,
): Promise<void> {
  while (predicate(context.state, input)) await invoke(context, body, input);
}

/** Captures membership/order on entry, retaining original element identities. */
export async function forEach<S, P extends { [K in keyof P]: PortShape }, A>(
  context: ResolutionContext<S, P>, items: readonly A[], body: EffectDefinition<S, P, A, unknown>,
): Promise<void> {
  const captured = items.slice();
  for (const item of captured) await invoke(context, body, item);
}

/** Bounded synchronous rule work; this does not create a transaction or IO. */
export function operation<S, P extends { [K in keyof P]: PortShape }, A, R>(
  context: ResolutionContext<S, P>, run: (state: S, input: A) => R, input: A,
): R {
  return run(context.state, input);
}

/** Choice policy and candidate validation remain in the original game contract. */
export async function request<S, P extends { [K in keyof P]: PortShape }, const A extends PortCall<P>>(
  context: ResolutionContext<S, P>, call: A,
): Promise<P[A['port']]['output']> {
  return await context.io.call(call);
}
