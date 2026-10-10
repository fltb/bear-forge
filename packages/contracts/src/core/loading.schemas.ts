import { z } from 'zod';
export const CompiledProgramDataSchema = z.strictObject({
  kind: z.literal('controlled-program'),
  content: z.instanceof(Uint8Array),
});
