import { z } from 'zod';
export const SetupSchema = z.strictObject({
  variant: z.enum(['normal', 'empty-first', 'counter', 'return-wolf', 'double-prevent', 'fail-discard'])
});
export const SeatSchema = z.enum(['0', '1']);
export const ActionSchema = z.strictObject({
  kind: z.enum(['pass', 'counter', 'return', 'target', 'prevent', 'take', 'beneficiary']),
  value: z.string().nullable()
});
export const StateSchema = z.strictObject({
  hp: z.tuple([z.number(), z.number()]),
  mana: z.number(),
  hands: z.tuple([z.array(z.string()), z.array(z.string())]),
  deck: z.array(z.string()),
  discard: z.tuple([z.array(z.string()), z.array(z.string())]),
  board: z.array(z.strictObject({
    id: z.string(),
    owner: SeatSchema,
    hp: z.number()
  })),
  damage: z.number(),
  triggers: z.array(z.strictObject({
    id: z.string(),
    source: z.string(),
    owner: SeatSchema
  })),
  events: z.array(z.strictObject({
    key: z.string(),
    kind: z.string(),
    value: z.string().nullable(),
    owner: SeatSchema.nullable()
  }))
});
export const RequestSchema = z.strictObject({
  state: StateSchema,
  player: SeatSchema,
  kind: z.string(),
  options: z.array(ActionSchema)
});
export const ObservationSchema = z.strictObject({
  hp: z.tuple([z.number(), z.number()]),
  mana: z.number(),
  hand: z.array(z.string()),
  opponentHandCount: z.number(),
  deckCount: z.number(),
  board: StateSchema.shape.board,
  discard: StateSchema.shape.discard,
  events: StateSchema.shape.events
});
export type State = z.infer<typeof StateSchema>;
export type Action = z.infer<typeof ActionSchema>;
