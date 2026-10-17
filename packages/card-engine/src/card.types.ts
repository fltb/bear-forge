import type { ProgramSchemas, PortShape, PortCall } from '@bear-forge/contracts/core';

export type CardFrame = { block: number; index: number; input: any; locals: Record<string, any>; call: number; target: string | null; items: any[] | null; item: number };
export type CardScope<S> = { state: S; input: any; locals: Record<string, any> };
export type CardExpression<S, T = any> = (scope: CardScope<S>) => T;
export type CardStep<S> =
  | { kind: 'operation'; run: CardExpression<S>; to: string | null }
  | { kind: 'invoke'; effect: string | CardExpression<S, string>; input: CardExpression<S>; to: string | null }
  | { kind: 'request'; call: CardExpression<S>; to: string | null }
  | { kind: 'branch'; test: CardExpression<S, boolean>; yes: readonly CardStep<S>[]; no: readonly CardStep<S>[] }
  | { kind: 'repeat'; test: CardExpression<S, boolean>; body: readonly CardStep<S>[] }
  | { kind: 'each'; items: CardExpression<S, readonly any[]>; effect: string }
  | { kind: 'return'; value: CardExpression<S> };
export type CardEffect<S> = { id: string; steps: readonly CardStep<S>[] };
export type CardDefinition<S, Setup, P extends { [K in keyof P]: PortShape }, R> = {
  id: string;
  schemas: ProgramSchemas<Setup, P, R>;
  initialize: (setup: Setup) => S;
  entry: string;
  effects: readonly CardEffect<S>[];
  /** Pure projection of an already detached stop, never of the live world. */
  project?: (stop: CardStop<P, R>) => CardStop<P, R>;
};
export type CardStop<P extends { [K in keyof P]: PortShape }, R> =
  | { kind: 'call'; call: PortCall<P> }
  | { kind: 'done'; result: R }
  | { kind: 'fault'; error: { kind: 'fault'; code: 'program_failed' | 'budget_exceeded'; message: string } };
export type CardRoot<S> = { state: S; frames: CardFrame[]; nextCall: number; waiting: { frame: number; to: string | null; call: any } | null; stop: any; budget: number };
/** All mutable machine values live in one graph, including locals and pending IO. */
export type CardStorage<T> = {
  readonly root: T;
  own: <V>(value: V) => V;
  export: <V>(value: V) => V;
  boundary?: () => void;
  close?: () => void;
};
export type CardTrace = { effect: string; block: number; index: number; kind: CardStep<any>['kind']; depth: number };
