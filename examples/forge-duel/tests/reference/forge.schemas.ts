import { z } from 'zod';
export const SeatSchema = z.enum(['0', '1']);
export type Seat = z.infer<typeof SeatSchema>;
export const definitions = ['scout', 'guard', 'beast', 'witness', 'spark', 'blast', 'supply', 'repair'] as const;
export const DefinitionSchema = z.enum(definitions);
export type Definition = z.infer<typeof DefinitionSchema>;
export const DeckSchema = z.array(DefinitionSchema).length(12).superRefine((deck, ctx) => {
  for (const name of definitions) if (deck.filter(x => x === name).length > 2) ctx.addIssue({
    code: 'custom',
    message: 'At most two copies of ' + name
  });
});
export const SetupSchema = z.strictObject({
  profile: z.literal('forge-duel-v1'),
  seed: z.number().int().min(0).max(4294967295),
  first: SeatSchema,
  decks: z.strictObject({
    '0': DeckSchema,
    '1': DeckSchema
  })
});
export type Setup = z.infer<typeof SetupSchema>;
export const CardSchema = z.strictObject({
  id: z.string(),
  definition: DefinitionSchema
});
export type Card = z.infer<typeof CardSchema>;
export const UnitSchema = z.strictObject({
  id: z.string(),
  card: CardSchema,
  attack: z.number().int().positive(),
  hp: z.number().int(),
  ready: z.boolean()
});
export type Unit = z.infer<typeof UnitSchema>;
export const EventSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(['carry', 'draw', 'burn', 'available', 'play', 'attack', 'damage', 'heal', 'death', 'turn', 'result']),
  actor: SeatSchema,
  decision: z.string(),
  cause: z.string().nullable(),
  definition: DefinitionSchema.nullable(),
  cardId: z.string().nullable(),
  target: z.string().nullable(),
  amount: z.number().nullable(),
  visibility: z.enum(['public', 'owner', 'audit'])
});
export type Event = z.infer<typeof EventSchema>;
export const ResultSchema = z.strictObject({
  winner: SeatSchema.nullable(),
  reason: z.enum(['lethal', 'turn-limit']),
  scores: z.strictObject({
    '0': z.number(),
    '1': z.number()
  })
});
export type Result = z.infer<typeof ResultSchema>;
export const HeroSchema = z.strictObject({
  hp: z.number().int().max(20),
  mana: z.number().int().min(0).max(6),
  maxMana: z.number().int().min(0).max(6),
  turns: z.number().int().min(0).max(30),
  fatigue: z.number().int().nonnegative(),
  deck: z.array(CardSchema),
  hand: z.array(CardSchema).max(8),
  board: z.array(UnitSchema).max(4),
  discard: z.array(CardSchema)
});
export type Hero = z.infer<typeof HeroSchema>;
export const StateSchema = z.strictObject({
  setup: SetupSchema,
  heroes: z.strictObject({
    '0': HeroSchema,
    '1': HeroSchema
  }),
  active: SeatSchema,
  random: z.number().int(),
  entity: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  cause: z.string().nullable(),
  result: ResultSchema.nullable(),
  history: z.array(EventSchema),
  pending: z.array(EventSchema)
});
export type State = z.infer<typeof StateSchema>;
export const ActionSchema = z.discriminatedUnion('kind', [z.strictObject({
  kind: z.literal('play'),
  cardId: z.string(),
  target: z.string().nullable()
}), z.strictObject({
  kind: z.literal('attack'),
  unitId: z.string(),
  target: z.string()
}), z.strictObject({
  kind: z.literal('end')
})]);
export type Action = z.infer<typeof ActionSchema>;
export const ObservationSchema = z.strictObject({
  player: SeatSchema,
  active: SeatSchema,
  hand: z.array(CardSchema),
  heroes: z.strictObject({
    '0': z.strictObject({
      hp: z.number(),
      mana: z.number(),
      maxMana: z.number(),
      turns: z.number(),
      fatigue: z.number(),
      deckCount: z.number(),
      handCount: z.number(),
      board: z.array(UnitSchema),
      discard: z.array(CardSchema)
    }),
    '1': z.strictObject({
      hp: z.number(),
      mana: z.number(),
      maxMana: z.number(),
      turns: z.number(),
      fatigue: z.number(),
      deckCount: z.number(),
      handCount: z.number(),
      board: z.array(UnitSchema),
      discard: z.array(CardSchema)
    })
  }),
  history: z.array(EventSchema),
  result: ResultSchema.nullable()
});
export type Observation = z.infer<typeof ObservationSchema>;
export const OptionsSchema = z.strictObject({
  kind: z.literal('exact'),
  values: z.array(ActionSchema)
});
export const RequestSchema = z.strictObject({
  decision: z.string()
});
export const gamePorts = {
  decision: {
    kind: 'request' as const,
    input: StateSchema,
    output: ActionSchema
  },
  event: {
    kind: 'event' as const,
    input: z.array(EventSchema),
    output: z.null()
  }
};
