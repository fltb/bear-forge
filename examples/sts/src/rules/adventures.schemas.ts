import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {entityId} from './resources.schemas.ts';
import {MapSchema} from '../game.schemas.ts';
/** Catalog labels are open; executable identity remains a typed definition reference. */
type CardId=string;
type RelicId=string;
import type {Room} from '../map.types.ts';
import type {PermanentCardDefinition} from './permanent-decks.types.ts';
import type {RelicDefinition} from './relics.ts';
export const cardDefinitionSchema=typedValue<PermanentCardDefinition>(),relicDefinitionSchema=typedValue<RelicDefinition>();
export const streamNames=['ai','cardRandom','card','event','mathUtil','merchant','misc','monsterHp','monster','neow','potion','relic','shuffle','treasure'] as const;
export const relicTiers=['common','uncommon','rare','shop','boss'] as const;
export const streamsSchema=z.object(Object.fromEntries(streamNames.map(key=>[key,entityId])) as Record<typeof streamNames[number],typeof entityId>);
export const catalogSchema=z.object({cards:z.array(z.object({id:typedValue<CardId>(),definition:cardDefinitionSchema})),relics:z.array(z.object({id:typedValue<RelicId>(),definition:relicDefinitionSchema}))});
const roomSchema=z.enum(['SHOP','REST','EVENT','ELITE','MONSTER','TREASURE','BOSS','BOSS_TREASURE','NONE','INVALID']);
const adventureMapSchema=MapSchema.extend({nodes:z.array(MapSchema.shape.nodes.element.extend({room:roomSchema}))});
const relicIds=z.array(typedValue<RelicId>());
const neowSchema=z.array(z.object({bonus:z.int32(),drawback:z.int32()}));
export const adventureSeedSchema=z.object({seed:z.bigint(),actor:entityId,deck:entityId,streams:streamsSchema,map:adventureMapSchema,neow:neowSchema,monsterList:z.array(z.int32()),eliteList:z.array(z.int32()),boss:z.int32(),secondBoss:z.int32(),relicPools:z.object({common:relicIds,uncommon:relicIds,rare:relicIds,shop:relicIds,boss:relicIds})});
export const adventureSetupSchema=z.object({start:adventureSeedSchema,initial:z.object({event:z.int32(),eventList:z.array(z.int32()),shrineList:z.array(z.int32()),oneTimeEvents:z.array(z.int32()),colorlessPool:z.array(typedValue<CardId>()),note:typedValue<CardId>()})}).strict();
export const previewSchema=z.object({definition:cardDefinitionSchema,upgraded:z.boolean(),misc:z.int32()}).strict();
// Generated previews have no permanent deck position; the source uses -1.
export const selectedSchema=z.object({card:previewSchema,deckIndex:z.int32().min(-1)}).strict();
export const selectionSchema=z.object({type:z.int32(),count:z.int32().nonnegative(),cards:z.array(selectedSchema),selected:z.array(selectedSchema),transformStream:entityId}).strict();
export const rewardsSchema=z.object({gold:z.array(z.int32()),cards:z.array(z.array(previewSchema)),relics:z.array(relicDefinitionSchema),potions:z.array(z.int32()),emeraldKey:z.boolean(),sapphireKey:z.boolean()}).strict();
export const adventureStateSchema=adventureSeedSchema.omit({relicPools:true}).extend({catalog:catalogSchema,scope:z.int32().nonnegative(),potions:entityId,ascension:z.int32(),act:z.int32(),floor:z.int32(),x:z.int32(),y:z.int32(),screen:z.string(),outcome:z.union([z.literal(0),z.literal(1),z.literal(2)]),room:typedValue<Room>(),lastRoom:typedValue<Room>(),event:z.int32(),eventData:z.int32(),hasContinuation:z.boolean(),keys:z.object({red:z.boolean(),green:z.boolean(),blue:z.boolean()}),
  relicPools:z.object(Object.fromEntries(relicTiers.map(key=>[key,z.array(relicDefinitionSchema)])) as Record<typeof relicTiers[number],z.ZodArray<typeof relicDefinitionSchema>>),colorlessPool:z.array(cardDefinitionSchema),eventList:z.array(z.int32()),shrineList:z.array(z.int32()),oneTimeEvents:z.array(z.int32()),monsterOffset:z.int32(),eliteOffset:z.int32(),cardRarityFactor:z.int32(),potionChance:z.int32(),monsterChance:z.number(),shopChance:z.number(),treasureChance:z.number(),shopRemoveCount:z.int32(),selection:selectionSchema,rewards:rewardsSchema,history:z.array(z.object({kind:z.union([z.literal('game'),z.literal('battle')]),bits:z.number().int().min(0).max(0xffffffff)})),published:z.int32().nonnegative(),
  stolenGold:z.int32().nonnegative(),speedrunPace:z.boolean(),skipBattles:z.boolean(),noteForYourself:previewSchema,
  bossRelics:z.array(relicDefinitionSchema),chest:z.object({size:z.int32(),haveGold:z.boolean(),tier:z.enum(relicTiers)}).nullable(),
});

// These are separate owner components. The complete schema above describes a
// publication/query value, never a second authoritative adventure component.
export const adventureBindingsSchema=adventureStateSchema.pick({seed:true,actor:true,deck:true,streams:true,scope:true,potions:true,ascension:true,neow:true});
export const adventurePositionSchema=adventureStateSchema.pick({act:true,floor:true,x:true,y:true,screen:true,outcome:true,room:true,lastRoom:true,event:true,eventData:true,hasContinuation:true,keys:true});
export const adventurePlanSchema=adventureStateSchema.pick({map:true,monsterList:true,eliteList:true,boss:true,secondBoss:true,monsterOffset:true,eliteOffset:true});
export const adventureEconomySchema=adventureStateSchema.pick({cardRarityFactor:true,potionChance:true,monsterChance:true,shopChance:true,treasureChance:true,shopRemoveCount:true,stolenGold:true,speedrunPace:true,skipBattles:true,noteForYourself:true});
export const adventurePoolsSchema=adventureStateSchema.pick({relicPools:true,colorlessPool:true,eventList:true,shrineList:true,oneTimeEvents:true});
export const adventureSelectionSchema=adventureStateSchema.pick({selection:true});
export const adventureRewardsSchema=adventureStateSchema.pick({rewards:true,bossRelics:true,chest:true});
export const adventureHistorySchema=adventureStateSchema.pick({history:true,published:true});
export const adventureCatalogSchema=adventureStateSchema.pick({catalog:true});
