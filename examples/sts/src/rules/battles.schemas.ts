import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
import {cardStateSchema,int16} from './card-instances.schemas.ts';
export const playOptionsSchema=z.object({autoplay:z.boolean(),triggerOnUse:z.boolean(),purgeOnUse:z.boolean(),freeToPlay:z.boolean(),ignoreEnergyTotal:z.boolean(),randomTarget:z.boolean(),exhaustOnUse:z.boolean(),regretCardCount:z.int32()}).strict();
export const cardPlaySchema=playOptionsSchema.extend({id:entityId,card:entityId,state:cardStateSchema,target:entityId.nullable(),energyOnUse:z.int32().nonnegative(),vanished:z.boolean()});
export const cardOpportunitySchema=z.discriminatedUnion('kind',[z.object({kind:z.literal(0),play:cardPlaySchema}).strict(),z.object({kind:z.literal(1),id:entityId}).strict()]);
export const battleSetupSchema=z.object({actor:entityId,registry:entityId,enemies:z.array(entityId).min(1).max(5),masters:z.array(entityId).max(96),bottled:z.array(entityId).max(3),shuffleRng:entityId,cardRng:entityId,drawPerTurn:z.int32().nonnegative()}).strict();
export const battleStateSchema=z.object({actor:entityId,registry:entityId,enemies:z.array(entityId),piles:entityId,scope:z.int32().nonnegative(),actionScope:z.int32().nonnegative(),started:z.boolean(),turn:z.int32().positive(),queue:z.array(cardOpportunitySchema).max(10),current:cardPlaySchema.nullable(),currentIsEndTurn:z.boolean(),nextPlay:entityId,outcome:z.union([z.literal(0),z.literal(1),z.literal(2)]),endTurnQueued:z.boolean(),energyWasted:z.int32(),cardsPlayed:int16,attacksPlayed:int16,skillsPlayed:int16,lastTargeted:entityId.nullable()}).strict();
export const battleStorageSchema=battleStateSchema.extend({piles:entityId.nullable()});
export const queueCardSchema=z.object({battle:entityId,card:entityId,target:entityId.nullable(),energyOnUse:z.int32().nonnegative().optional(),options:playOptionsSchema.partial().optional(),state:cardStateSchema.optional(),front:z.boolean().optional(),afterFirst:z.boolean().optional()}).strict();
export const cardDestinationSchema=z.object({battle:entityId,play:entityId,destination:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3)])}).strict();

export const battleStatusSchema=battleStorageSchema.omit({queue:true,current:true,currentIsEndTurn:true,nextPlay:true});
export const battleOpportunitiesSchema=battleStorageSchema.pick({queue:true,current:true,currentIsEndTurn:true,nextPlay:true});
