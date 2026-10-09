import type { z } from 'zod';
import type { FixedTable, TableKeys } from '../internal/types.ts';
import type { Instance, Outcome } from '../instance/types.ts';
export type PortShape = { input: unknown; output: unknown };
export type PortCall<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; input: P[K]['input'] };
}[TableKeys<P>];
export type PortReturn<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; output: P[K]['output'] };
}[TableKeys<P>];
export type IO<P extends { [K in keyof P]: PortShape }> = {
  call: <const A extends PortCall<P>>(call: A) => Promise<P[A['port']]['output']>;
};
export type Program<S, P extends { [K in keyof P]: PortShape }, R> =
  (setup: S, io: IO<P>) => Promise<R>;
export type ProgramSchemas<S, P extends { [K in keyof P]: PortShape }, R> = FixedTable<P> & {
  setup: z.ZodType<S>;
  result: z.ZodType<R>;
  ports: { [K in keyof P]: { input: z.ZodType<P[K]['input']>; output: z.ZodType<P[K]['output']> } };
};
export type ProgramModule<S, P extends { [K in keyof P]: PortShape }, R> = {
  schemas: ProgramSchemas<S, P, R>;
  run: Program<S, P, R>;
};
export type Core<S, P extends { [K in keyof P]: PortShape }, R> = {
  start: (setup: S) => Promise<Outcome<Instance<P, R>>>;
};
