import { z } from 'zod';

/** A TS-only slot, with exactly the acceptance of z.custom<T>() with no
 * predicate. Real refinements remain explicit schemas. Using unknown exposes
 * the absence of runtime work to the rule linker without inspecting functions. */
export function typedValue<T>(): z.ZodType<T> {
  return z.unknown() as z.ZodType<T>;
}
