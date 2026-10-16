import type { IO, PortCall } from '@bear-forge/contracts/core';
import type { GamePortShape, GamePortDeclarations, GameSDK } from '@bear-forge/contracts/authoring';

/** Create inside the program. No bindings, host state, scheduling or implicit calls. */
export function createGameSDK<P extends { [K in keyof P]: GamePortShape }>(
  io: IO<P>,
  declarations: GamePortDeclarations<P>,
): GameSDK<P> {
  const methods: Record<string, (input: unknown) => Promise<unknown>> = Object.create(null);
  for (const port of Object.keys(declarations) as Array<Extract<keyof P, string>>) {
    // A method captures one fixed key. Its public parameter/result pair comes
    // from the same P[key]; enumeration is the only type-erased operation.
    methods[port] = input => io.call({ port, input } as unknown as PortCall<P>);
  }
  return Object.freeze(methods) as GameSDK<P>;
}
