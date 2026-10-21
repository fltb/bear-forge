/** Catalog labels are open; executable identity remains a typed definition reference. */
type CardId=string;
type RelicId=string;
import type {SpireMap,Room} from '../map.types.ts';
import type {MonsterPlan} from '../encounters.types.ts';
import type {NeowOption} from '../neow.types.ts';
import type {PermanentCardDefinition} from './permanent-decks.types.ts';
import type {RelicDefinition} from './relics.ts';
export type StartStream='ai'|'cardRandom'|'card'|'event'|'mathUtil'|'merchant'|'misc'|'monsterHp'|'monster'|'neow'|'potion'|'relic'|'shuffle'|'treasure';
export type RelicTier='common'|'uncommon'|'rare'|'shop'|'boss';
export type AdventureSeed=MonsterPlan&{seed:bigint;actor:number;deck:number;streams:Record<StartStream,number>;map:SpireMap;neow:NeowOption[];relicPools:Record<RelicTier,RelicId[]>};
export type CharacterCardPools={color:number;rarity:readonly (readonly string[])[];typeRarity:readonly (readonly (readonly string[])[])[];random:readonly string[];transform:readonly string[];combat:readonly (readonly string[])[];startingBasics:readonly string[]};
export type AdventureCatalog={starterRelic:RelicDefinition|null;cardPools:CharacterCardPools;cards:{id:CardId;definition:PermanentCardDefinition}[];relics:{id:RelicId;definition:RelicDefinition}[]};
export type CardPreview={definition:PermanentCardDefinition;upgraded:boolean;misc:number};
export type AdventureSelected={card:CardPreview;deckIndex:number};
export type AdventureSelection={type:number;count:number;cards:AdventureSelected[];selected:AdventureSelected[];transformStream:number};
export type AdventureRewards={gold:number[];cards:CardPreview[][];relics:RelicDefinition[];potions:number[];emeraldKey:boolean;sapphireKey:boolean};
export type AdventureSetup={start:AdventureSeed;initial:{event:number;eventList:number[];shrineList:number[];oneTimeEvents:number[];colorlessPool:CardId[];note:CardId}};
export type AdventureState=Omit<AdventureSeed,'relicPools'>&{
  catalog:AdventureCatalog;scope:number;potions:number;ascension:number;act:number;floor:number;x:number;y:number;screen:string;outcome:0|1|2;room:Room;lastRoom:Room;event:number;eventData:number;hasContinuation:boolean;
  keys:{red:boolean;green:boolean;blue:boolean};relicPools:Record<RelicTier,RelicDefinition[]>;colorlessPool:PermanentCardDefinition[];eventList:number[];shrineList:number[];oneTimeEvents:number[];monsterOffset:number;eliteOffset:number;
  cardRarityFactor:number;potionChance:number;monsterChance:number;shopChance:number;treasureChance:number;shopRemoveCount:number;selection:AdventureSelection;rewards:AdventureRewards;history:{kind:'game'|'battle';bits:number}[];published:number;
  stolenGold:number;speedrunPace:boolean;skipBattles:boolean;noteForYourself:CardPreview;
  bossRelics:RelicDefinition[];chest:{size:number;haveGold:boolean;tier:RelicTier}|null;
};
