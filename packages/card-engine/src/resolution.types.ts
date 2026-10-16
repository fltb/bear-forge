import type { IO, PortShape } from '@bear-forge/contracts/core';

/** Data-only provenance. Execution positions belong to the existing runtime. */
export type ResolutionFrame = {
  definition: string;
  input: unknown;
  source: string | null;
};
export type ResolutionContext<S, P extends { [K in keyof P]: PortShape }> = {
  state: S;
  io: IO<P>;
  frames: ResolutionFrame[];
};
/** Define once in Program; mutable captures must belong to the current instance. */
export type EffectDefinition<S, P extends { [K in keyof P]: PortShape }, A, R> = {
  readonly id: string;
  readonly run: (context: ResolutionContext<S, P>, input: A) => Promise<R>;
};
