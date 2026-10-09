import { z } from 'zod';
const CounterSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SeatSchema = z.enum(['0', '1', '2']);
export type Seat = z.infer<typeof SeatSchema>;
export const seats: readonly Seat[] = ['0', '1', '2'];
export const RankSchema = z.number().int().min(3).max(17);
export const PatternSchema = z.strictObject({ kind: z.enum(['single','pair','triple','tripleSingle','triplePair','straight','pairs','airplane','airplaneSingle','airplanePair','fourSingles','fourPairs','bomb','rocket']), high: RankSchema, length: z.number().int().min(1).max(12) });
export const PlaySchema = z.strictObject({ kind: z.literal('play'), cards: z.array(RankSchema).min(1).max(20), pattern: PatternSchema }).refine(value => value.cards.every((rank,index) => index === 0 || value.cards[index-1]! <= rank));
export const ActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bid'), value: z.number().int().min(0).max(3) }),
  z.strictObject({ kind: z.literal('double'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('redouble'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('pass') }), PlaySchema,
]);
export type Action = z.infer<typeof ActionSchema>;
export const LegalActionsSchema = z.strictObject({kind:z.literal('exact'),values:z.array(ActionSchema)});
export type LegalActions = z.infer<typeof LegalActionsSchema>;
export const SetupSchema = z.strictObject({ profile: z.literal('competitive-2016-bear-1'), firstBidder: SeatSchema, initialGameTime: CounterSchema });
export const StageIdSchema = z.string().regex(/^deal[1-9][0-9]*:stage[1-9][0-9]*$/);
export const SlotIdSchema = z.string().regex(/^deal[1-9][0-9]*:stage[1-9][0-9]*:[012]$/);
export const BoundaryKeySchema = z.string().regex(/^boundary[0-9]+$/);
export const ActionSpecSchema = z.strictObject({ phase: z.enum(['bidding','doubling','redoubling','playing']), actor: SeatSchema });
export const TimeoutPayloadSchema = z.strictObject({slotId:SlotIdSchema});
export const SlotSchema = z.strictObject({
  slotId:SlotIdSchema, actor:SeatSchema, actionSpec:ActionSpecSchema,
  deadline:z.strictObject({atGameTime:CounterSchema,equality:z.literal('timeoutFirst'),timeoutRule:z.literal('competitive-2016-bear-1')}),
  onTimeout:z.strictObject({inputType:z.literal('timeout'),payload:TimeoutPayloadSchema}),
});
export const StageSchema = z.strictObject({stageId:StageIdSchema,boundaryKey:BoundaryKeySchema,hostInputs:z.array(z.literal('timeout')),slots:z.array(SlotSchema).min(1)}).refine(v=>new Set(v.slots.map(s=>s.slotId)).size===v.slots.length);
export const InputSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('action'),stageId:StageIdSchema,slotId:SlotIdSchema,actor:SeatSchema,receivedAtGameTime:CounterSchema,action:ActionSchema}),
  z.strictObject({kind:z.literal('host'),boundaryKey:BoundaryKeySchema,inputType:z.literal('timeout'),gameTime:CounterSchema,payload:TimeoutPayloadSchema}),
]);
const nums = z.strictObject({ '0': CounterSchema, '1': CounterSchema, '2': CounterSchema });
const doubles = z.strictObject({ '0': z.boolean().nullable(), '1': z.boolean().nullable(), '2': z.boolean().nullable() });
export const ResultSchema = z.strictObject({ winner: SeatSchema, winningSide: z.enum(['landlord','farmers']), landlord: SeatSchema, bid: z.number().int().min(1).max(3), bombs: CounterSchema, rockets: CounterSchema, spring: z.boolean(), reverseSpring: z.boolean(), doubles, redoubled: z.boolean(), scores: z.strictObject({ '0': z.number().int(), '1': z.number().int(), '2': z.number().int() }) });
export type Result = z.infer<typeof ResultSchema>;
export const EventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('deal'), deal: CounterSchema, firstBidder: SeatSchema }),
  z.strictObject({ type: z.literal('redeal') }),
  z.strictObject({ type: z.literal('bid'), actor: SeatSchema, value: z.number().int().min(0).max(3) }),
  z.strictObject({ type: z.literal('landlord'), actor: SeatSchema, bid: z.number().int().min(1).max(3) }),
  z.strictObject({ type: z.literal('doubleChosen'), actor: SeatSchema, value: z.boolean() }),
  z.strictObject({ type: z.literal('doublesRevealed'), values: doubles }),
  z.strictObject({ type: z.literal('redouble'), actor: SeatSchema, value: z.boolean() }),
  z.strictObject({ type: z.literal('bottom'), cards: z.array(RankSchema).length(3) }),
  z.strictObject({ type: z.literal('play'), actor: SeatSchema, play: PlaySchema }),
  z.strictObject({ type: z.literal('pass'), actor: SeatSchema }),
  z.strictObject({ type: z.literal('lastCard'), actor: SeatSchema, count: z.number().int().min(0).max(1) }),
  z.strictObject({ type: z.literal('result'), result: ResultSchema }),
]);
export const AuditEventSchema = z.strictObject({ audience: z.union([SeatSchema,z.literal('public')]), event: EventSchema });
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export const StateSchema = z.strictObject({
  setup: SetupSchema, phase: z.enum(['dealing','bidding','doubling','redoubling','playing','ended']),
  deal: CounterSchema, firstBidder: SeatSchema, hands: z.strictObject({ '0': z.array(RankSchema).max(20), '1': z.array(RankSchema).max(20), '2': z.array(RankSchema).max(20) }),
  bottom: z.array(RankSchema).max(3), bottomRevealed: z.boolean(), landlord: SeatSchema.nullable(),
  bidCount: CounterSchema.max(3), highBid: CounterSchema.max(3), turn: SeatSchema,
  doubles, doublesRevealed: z.boolean(), redoubled: z.boolean(),
  last: z.strictObject({ actor: SeatSchema, play: PlaySchema }).nullable(), passes: CounterSchema.max(2),
  bombs: CounterSchema, rockets: CounterSchema, playCounts: nums,
  now: CounterSchema, stageSequence: CounterSchema, boundarySequence: CounterSchema,
  stage: StageSchema.nullable(), delta: z.strictObject({ consumed: z.array(z.string()), invalidated: z.array(z.string()) }),
  events: z.array(AuditEventSchema), result: ResultSchema.nullable(),
});
export type State = z.infer<typeof StateSchema>;
export const ObservationSchema = z.strictObject({
  actor: SeatSchema, phase: StateSchema.shape.phase, deal: CounterSchema, hand: z.array(RankSchema), counts: nums,
  firstBidder: SeatSchema, landlord: SeatSchema.nullable(), highBid: CounterSchema.max(3),
  turn: SeatSchema.nullable(), bottom: z.array(RankSchema).nullable(),
  doubles: doubles.nullable(), ownDouble: z.boolean().nullable(), redoubled: z.boolean().nullable(),
  last: StateSchema.shape.last, result: ResultSchema.nullable(),
});

export const PendingSchema = z.strictObject({phase:ActionSpecSchema.shape.phase,stage:StageSchema,gameTime:CounterSchema});
// Trusted execution frame; terminal result has a single source in state.result.
export const FrameSchema = z.strictObject({state:StateSchema,events:z.array(AuditEventSchema)}).superRefine((v,ctx)=>{
  const s=v.state;
  if(s.phase==='dealing'||(s.phase==='ended' ? s.result===null||s.stage!==null : s.result!==null||s.stage===null))ctx.addIssue({code:'custom',message:'inconsistent boundary state'});
  if(JSON.stringify(s.events.slice(s.events.length-v.events.length))!==JSON.stringify(v.events))ctx.addIssue({code:'custom',message:'events are not the current history suffix'});
});
export const ObservedSchema = z.strictObject({observation:ObservationSchema,events:z.array(EventSchema)});
export type Setup = z.infer<typeof SetupSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Pending = z.infer<typeof PendingSchema>;
export type Observed = z.infer<typeof ObservedSchema>;

export const DeliverySchema = z.strictObject({receivedAtGameTime:CounterSchema});
export const SignalSchema = InputSchema.options[1].omit({boundaryKey:true});
export const ProgramSetupSchema = z.strictObject({game:SetupSchema,seed:z.number().int().min(0).max(4294967295)});
export type ProgramSetup = z.infer<typeof ProgramSetupSchema>;
export const programSchemas = {
  setup:ProgramSetupSchema, result:FrameSchema,
  ports:{
    decision:{input:FrameSchema,output:InputSchema},
    event:{input:z.array(AuditEventSchema),output:z.null()},
  },
};
export type Delivery = z.infer<typeof DeliverySchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type Slot = z.infer<typeof SlotSchema>;
