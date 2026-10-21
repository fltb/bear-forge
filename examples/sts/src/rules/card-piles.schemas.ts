import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
export const cardPilesSetupSchema=z.object({actor:entityId,battle:entityId,draw:entityId,hand:entityId,discard:entityId,exhaust:entityId,shuffleRng:entityId,cardRng:entityId,actionScope:z.int32().nonnegative()}).strict();
export const cardPilesStateSchema=cardPilesSetupSchema.extend({scope:z.int32().nonnegative(),drawn:z.int32(),discarded:z.int32(),initialized:z.boolean(),nextUniqueId:z.int32(),registered:z.array(entityId),auxiliary:z.array(entityId)});
export const pileCardSchema=z.object({piles:entityId,card:entityId}).strict();
export const cardDiscardSchema=pileCardSchema.extend({endTurn:z.boolean()});

export const pileBindingsSchema=cardPilesSetupSchema.extend({scope:z.int32().nonnegative()});
export const pileCountersSchema=cardPilesStateSchema.pick({drawn:true,discarded:true,initialized:true,nextUniqueId:true});
export const pileMembershipSchema=cardPilesStateSchema.pick({registered:true,auxiliary:true});
