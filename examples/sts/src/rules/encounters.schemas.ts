import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
import type {EnemyDefinition} from './enemies.types.ts';
export const encounterSetupSchema=z.object({run:entityId,miscRng:entityId,hpRng:entityId,scope:entityId,ascension:z.int32()}).strict();
export const enemyDefinitionSchema=z.custom<EnemyDefinition>();
export const encounterEnemySchema=z.object({definition:enemyDefinitionSchema,actor:entityId,parameters:z.array(z.int32())}).strict();
export const encounterRosterSchema=z.array(encounterEnemySchema.nullable()).min(1).max(5);
export type EncounterSetup=z.infer<typeof encounterSetupSchema>;
export type EncounterEnemy=z.infer<typeof encounterEnemySchema>;
