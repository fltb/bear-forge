import { z } from 'zod';

import { InstanceIdSchema, CallIdSchema } from '../core/schemas.ts';

export const DecisionIdSchema = z.strictObject({ instanceId: InstanceIdSchema, callId: CallIdSchema });
export const ChoiceIdSchema = z.string();
export const JsonValueSchema = z.json();
export const InputValidationSchema = z.discriminatedUnion('valid', [
  z.strictObject({ valid: z.literal(true) }),
  z.strictObject({ valid: z.literal(false), reason: z.string() }),
]);
export const InputOptionsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exact'), values: z.array(JsonValueSchema) }),
  z.strictObject({ kind: z.literal('construct'), description: JsonValueSchema }),
]);
export const GameErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rejected'), code: z.enum(['invalid_input', 'invalid_argument', 'decision_mismatch', 'choice_not_found', 'snapshot_incompatible']), message: z.string() }),
  z.strictObject({ kind: z.literal('conflict'), code: z.enum(['game_busy', 'game_closed', 'game_ended', 'view_unavailable']), message: z.string() }),
  z.strictObject({ kind: z.literal('unsupported'), code: z.literal('capability_unavailable'), message: z.string() }),
  z.strictObject({ kind: z.literal('fault'), code: z.enum(['invalid_output', 'program_failed', 'budget_exceeded']), message: z.string() }),
]);


export const GameRunLimitsSchema = z.strictObject({maxInputs:z.number().safe().nonnegative().optional()});
export const EventDeliveryIdSchema = z.strictObject({
  instanceId:InstanceIdSchema,
  callId:CallIdSchema,
  index:z.number().safe().nonnegative(),
});
