import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
import {previewSchema,relicDefinitionSchema} from './adventures.schemas.ts';
export const shopSetupSchema=z.object({run:entityId,cards:z.array(previewSchema).length(7),relics:z.array(relicDefinitionSchema).length(3),potions:z.array(z.int32()).length(3),prices:z.array(z.int32()).length(13),removeCost:z.int32()}).strict();
export type ShopSetup=z.infer<typeof shopSetupSchema>;
export const shopPurchaseSchema=z.object({index:z.int32().min(0).max(2),price:z.int32(),relic:relicDefinitionSchema}).strict();
export const shopStateSchema=shopSetupSchema.extend({pending:shopPurchaseSchema.nullable()});
