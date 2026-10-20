import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
export const zoneMoveSchema=z.object({entity:entityId,from:entityId.nullable(),to:entityId.nullable(),index:z.int32().nonnegative()}).strict();
export const zoneMovedSchema=zoneMoveSchema.extend({previousIndex:z.int32().min(-1)});
export const zoneContentsSchema=z.array(entityId);
export const zoneReorderSchema=z.object({zone:entityId,order:zoneContentsSchema}).strict();
