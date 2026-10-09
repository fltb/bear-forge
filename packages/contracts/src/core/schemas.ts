import { z } from 'zod';

export const InstanceIdSchema = z.uuid().brand<'InstanceId'>();
export const CallIdSchema = z.uuid().brand<'CallId'>();
export const InstanceSnapshotSchema = z.strictObject({
  snapshotId: z.uuid().brand<'InstanceSnapshotId'>(),
});
export const InstanceErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rejected'),
    code: z.enum(['invalid_input', 'invalid_argument', 'snapshot_not_found', 'snapshot_incompatible', 'records_not_found']),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('conflict'),
    code: z.enum(['instance_busy', 'instance_closed', 'instance_owned']),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('unsupported'),
    code: z.literal('capability_unavailable'),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('fault'),
    code: z.enum(['invalid_output', 'budget_exceeded', 'program_failed']),
    message: z.string(),
  }),
]);
export const RecordCursorSchema = z.number().safe().nonnegative();
export const RecordReadSchema = z.strictObject({
  after: RecordCursorSchema.nullable(),
  limit: z.number().safe().positive(),
});

export const PauseReasonSchema = z.enum(['requested', 'unbound', 'limit', 'cancelled', 'handler_failed', 'invalid_reply']);
export const InstanceRunLimitsSchema = z.strictObject({maxReplies:z.number().safe().nonnegative().optional()});
export const CallbackPauseSchema = z.strictObject({kind:z.literal('pause')});
