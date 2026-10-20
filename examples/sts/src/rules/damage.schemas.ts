import {z} from 'zod';
import {entityId,amount} from './resources.schemas.ts';
export const hitRequestSchema=z.object({battle:entityId,source:entityId.nullable(),target:entityId,amount,attack:z.boolean(),selfDamage:z.boolean()}).strict();
export const hitFactsSchema=z.object({blockTarget:entityId,requested:amount,blocked:amount,hadBlock:z.boolean(),unblocked:amount}).strict();
export const hpDamageSchema=z.object({request:hitRequestSchema,facts:hitFactsSchema}).strict();
export const hitResultSchema=z.object({battle:entityId,source:entityId.nullable(),target:entityId,blockTarget:entityId,requested:amount,blocked:amount,unblocked:amount,lost:amount,attack:z.boolean()}).strict();
