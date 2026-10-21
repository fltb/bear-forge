import {isolatedDataSchema} from '../../../packages/boundary/src/compiled-schema.ts';
import {z} from 'zod';
import {CombatPrivateSchema} from "./program/combat-state.ts";
export const SetupSchema=z.strictObject({seed:z.string().regex(/^\d+$/).refine(v=>BigInt(v)<=0xffffffffffffffffn)});
export const ActionSchema=isolatedDataSchema(z.strictObject({bits:z.number().int().min(0).max(0xffffffff)}));
export const EventSchema=isolatedDataSchema(z.strictObject({kind:z.enum(['game','battle']),bits:z.number().int().min(0).max(0xffffffff)}));
const object=z.record(z.string(),z.json());
const n=z.number(),i=z.number().int(),flag=z.boolean(),s=z.string();
const CardSchema=z.strictObject({id:s,misc:i,upgraded:flag});
const CombatCardSchema=z.strictObject({id:s,uniqueId:i,specialData:i,cost:i,costForTurn:i,upgraded:flag,freeToPlayOnce:flag,retain:flag});
const SelectedSchema=z.strictObject({card:CardSchema,deckIndex:i});
const RngSchema=z.strictObject({counter:i,seed0:s.regex(/^\d+$/),seed1:s.regex(/^\d+$/)});
const NodeSchema=z.strictObject({x:i,y:i,room:s,edges:z.array(i),parents:z.array(i)});
export const MapSchema=z.strictObject({nodes:z.array(NodeSchema),burningEliteX:i,burningEliteY:i,burningEliteBuff:i});
const RewardsSchema=z.strictObject({gold:z.array(i),cards:z.array(z.array(CardSchema)),relics:z.array(i),potions:z.array(i),emeraldKey:flag,sapphireKey:flag});
const ShopSchema=z.strictObject({prices:z.array(i),removeCost:i,cards:z.array(CardSchema),potions:z.array(i),relics:z.array(i)});
export const GameViewSchema=z.strictObject({
  seed:s,ascension:i,act:i,floor:i,screen:s,outcome:i,room:s,event:i,eventName:s,boss:i,secondBoss:i,x:i,y:i,hp:i,maxHp:i,gold:i,
  keys:z.strictObject({red:flag,green:flag,blue:flag}),relics:z.array(z.strictObject({id:s,data:i})),potions:z.array(i),deck:z.array(CardSchema),bottles:z.array(i),
  rng:z.record(s,RngSchema),map:MapSchema,monsterList:z.array(i),monsterOffset:i,eliteList:z.array(i),eliteOffset:i,
  cardRarityFactor:i,potionChance:i,monsterChance:n,shopChance:n,treasureChance:n,shopRemoveCount:i,hasContinuation:flag,
  lastRoom:s,speedrunPace:flag,skipBattles:flag,potionCount:i,potionCapacity:i,allPotions:z.array(i),noteForYourself:CardSchema,
  deckCounts:z.array(i),upgradeableCount:i,transformableCount:i,relicBits:z.array(s),eventList:z.array(i),shrineList:z.array(i),oneTimeEvents:z.array(i),
  relicPools:z.record(s,z.array(i)),colorlessPool:z.array(i),eventData:i.optional(),
  neow:z.array(z.strictObject({bonus:i,drawback:i,description:s})).optional(),rewards:RewardsSchema.optional(),
  shop:ShopSchema.optional(),
  bossRelics:z.array(i).optional(),chestSize:i.optional(),
  select:z.strictObject({type:i,remaining:i,cards:z.array(SelectedSchema),selected:z.array(SelectedSchema),transformRng:i}).optional(),
});
const PlayerSchema=z.strictObject({hp:i,maxHp:i,energy:i,energyPerTurn:i,block:i,strength:i,dexterity:i,artifact:i,statusBits0:s,statusBits1:i,
  statuses:z.array(z.array(i)),justApplied:i,cardsPlayed:i,attacksPlayed:i,skillsPlayed:i,gold:i,focus:i,cardDrawPerTurn:i,cardsDiscarded:i,
  lastTargetedMonster:i,lastAttackUnblockedDamage:i,timesDamaged:i});
const MonsterSchema=z.strictObject({index:i,id:i,name:s,hp:i,maxHp:i,block:i,moves:z.array(i),miscInfo:i,statusBits:s,strength:i,weak:i,vulnerable:i,
  artifact:i,poison:i,uniquePower0:i,uniquePower1:i,halfDead:flag,escaping:flag,escapeNext:flag,damage:i,hits:i});
const PlaySchema=z.strictObject({card:CombatCardSchema,target:i,energyOnUse:i,isEndTurn:flag,triggerOnUse:flag,ignoreEnergyTotal:flag,freeToPlay:flag,
  randomTarget:flag,autoplay:flag,regretCardCount:i,purgeOnUse:flag,exhaustOnUse:flag});
export const BattleViewSchema=z.strictObject({encounter:i,turn:i,input:i,outcome:i,monsterTurnIndex:i,seed:s,floor:i,ascension:i,endTurnQueued:flag,turnHasEnded:flag,skipMonsterTurn:flag,
  future:z.strictObject({haveUsedDiscoveryAction:flag,undefinedBehaviorEvoked:flag,player:CombatPrivateSchema}),
  player:PlayerSchema,monsters:z.array(MonsterSchema),
  cards:z.strictObject({hand:z.array(CombatCardSchema),draw:z.array(CombatCardSchema),discard:z.array(CombatCardSchema),exhaust:z.array(CombatCardSchema),stasis:z.array(CombatCardSchema),nextUniqueId:i,counters:z.strictObject({handNormalityCount:i,handPainCount:i,strikeCount:i,handBloodCardCount:i,drawPileBloodCardCount:i,discardPileBloodCardCount:i})}),
  actionQueueSize:i,cardQueueSize:i,rng:z.record(s,RngSchema),potions:z.array(i),allPotions:z.array(i),potionCount:i,potionCapacity:i,current:PlaySchema.nullable(),
  select:z.strictObject({task:s,pickCount:i,canPickZero:flag,canPickAnyNumber:flag}).optional(),
});
export const PublicGameSchema=GameViewSchema.pick({ascension:true,act:true,floor:true,screen:true,outcome:true,room:true,eventName:true,boss:true,x:true,y:true,hp:true,maxHp:true,gold:true,
  keys:true,relics:true,potions:true,deck:true,bottles:true,neow:true,rewards:true,bossRelics:true,chestSize:true}).extend({
  map:MapSchema.omit({burningEliteBuff:true}),select:GameViewSchema.shape.select.unwrap().omit({transformRng:true}).optional(),
  shop:z.strictObject({prices:z.array(i),removeCost:i,cards:z.array(CardSchema),potions:z.array(i),relics:z.array(i)}).optional(),
});
const PublicBattleSchema=z.strictObject({turn:i,player:PlayerSchema,monsters:z.array(MonsterSchema.omit({id:true,miscInfo:true,halfDead:true,escaping:true,escapeNext:true})),
  hand:z.array(CombatCardSchema),drawCount:i,discard:z.array(CombatCardSchema),exhaust:z.array(CombatCardSchema),draw:z.array(CombatCardSchema).optional(),select:BattleViewSchema.shape.select,
});
export const FrameSchema=isolatedDataSchema(z.strictObject({game:PublicGameSchema,battle:PublicBattleSchema.nullable(),actions:z.array(ActionSchema),decisions:i.nonnegative(),heartDefeated:flag,history:z.array(EventSchema)}));
export const ObservationSchema=isolatedDataSchema(FrameSchema.pick({game:true,battle:true,history:true,heartDefeated:true}));
export const ResultSchema=isolatedDataSchema(z.strictObject({outcome:z.enum(['death','victory']),heartDefeated:z.boolean(),act:z.number(),floor:z.number(),hp:z.number()}));
export type Setup=z.infer<typeof SetupSchema>;
export type Action=z.infer<typeof ActionSchema>;
export type Frame=z.infer<typeof FrameSchema>;
export type GameEvent=z.infer<typeof EventSchema>;
export type Observation=z.infer<typeof ObservationSchema>;
export type Result=z.infer<typeof ResultSchema>;
export type Ports={decision:{kind:'request';input:Frame;output:Action};event:{kind:'event';input:GameEvent[];output:null}};
export const programSchemas={setup:SetupSchema,result:FrameSchema,ports:{
  decision:{kind:'request' as const,input:FrameSchema,output:ActionSchema},event:{kind:'event' as const,input:z.array(EventSchema),output:z.null()},
}};
