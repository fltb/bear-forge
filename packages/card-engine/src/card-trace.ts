import type { CardTrace } from './card.types.ts';
export type TracePosition = Readonly<Omit<CardTrace, 'depth'>>;
export type TraceWriter = (position: TracePosition, depth: number) => void;
const writers = new WeakMap<(event: CardTrace) => void, TraceWriter>();
/** Private record transport. Public observers still receive the exact DTO at
 * the same logical instruction; storage can retain compact Program positions. */
export function bindTraceWriter(observer: (event: CardTrace) => void, write: TraceWriter): void { writers.set(observer, write); }
export function traceWriterFor(observer: ((event: CardTrace) => void) | undefined): TraceWriter | undefined { return observer && writers.get(observer); }
