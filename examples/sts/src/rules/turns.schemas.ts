import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
export const turnSetupSchema=z.object({battle:entityId,enemies:z.array(entityId).min(1).max(5),drawPerTurn:z.int32().nonnegative(),energyPerTurn:z.int32().nonnegative(),extent:z.int32().min(0).max(5).optional()}).strict();
export const turnStateSchema=turnSetupSchema.extend({extent:z.int32().min(0).max(5),scope:z.int32().nonnegative(),retained:entityId,phase:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3)]),cursor:z.int32().nonnegative(),skipEnemies:z.boolean()});
export const turnActorSchema=z.object({controller:entityId,battle:entityId,actor:entityId}).strict();
