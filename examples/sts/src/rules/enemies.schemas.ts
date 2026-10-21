import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
export const enemySetupSchema=z.object({actor:entityId,battle:entityId,aiRng:entityId,ascension:z.int32().min(0).max(20),slot:z.int32().nonnegative().optional(),hpRng:entityId.optional(),parameters:z.array(z.int32()).optional(),deferInitialRoll:z.boolean().optional()}).strict();
export const enemyHealthSchema=z.object({minimum:z.int32().positive(),maximum:z.int32().positive(),draw:z.boolean(),discard:z.array(z.object({minimum:z.int32(),maximum:z.int32()})),parameters:z.array(z.object({minimum:z.int32(),maximum:z.int32()}))}).strict();
export const enemyStateSchema=enemySetupSchema.extend({history:z.tuple([z.int32(),z.int32()]),opportunityTurn:z.int32().positive(),claimed:z.boolean(),prepared:z.boolean(),escaped:z.boolean(),halfDead:z.boolean()});
export const enemyIntentSchema=z.object({attack:z.boolean(),damage:z.int32().nonnegative(),hits:z.int32().nonnegative()}).strict();
export const enemyActionSchema=z.object({enemy:entityId,actor:entityId,battle:entityId,turn:z.int32().positive(),move:z.int32(),attack:z.boolean()}).strict();
export const enemyRollSchema=z.object({enemy:entityId,roll:z.int32().min(0).max(99)}).strict();
export const enemyActionReceiptSchema=z.object({action:enemyActionSchema.nullable(),performed:z.boolean(),absorbed:z.int32().nonnegative(),blockSpent:z.int32().nonnegative()}).strict();
