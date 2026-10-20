import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
export const attackValueSchema=z.object({source:entityId,target:entityId,base:z.int32(),card:entityId.nullable()}).strict();
export const blockValueSchema=z.object({actor:entityId,base:z.int32()}).strict();
