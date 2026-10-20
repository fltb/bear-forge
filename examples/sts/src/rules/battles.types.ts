import type {CardState} from './card-instances.types.ts';
export type BattleSetup={actor:number;registry:number;enemies:number[];masters:number[];bottled:number[];shuffleRng:number;cardRng:number;drawPerTurn:number};
export type PlayOptions={autoplay:boolean;triggerOnUse:boolean;purgeOnUse:boolean;freeToPlay:boolean;ignoreEnergyTotal:boolean;randomTarget:boolean;exhaustOnUse:boolean;regretCardCount:number};
export type CardPlay=PlayOptions&{id:number;card:number;state:CardState;target:number|null;energyOnUse:number;vanished:boolean};
export type CardOpportunity={kind:0;play:CardPlay}|{kind:1;id:number};
export type BattleState={actor:number;registry:number;enemies:number[];piles:number;scope:number;actionScope:number;started:boolean;turn:number;queue:CardOpportunity[];current:CardPlay|null;currentIsEndTurn:boolean;nextPlay:number;outcome:0|1|2;endTurnQueued:boolean;energyWasted:number;cardsPlayed:number;attacksPlayed:number;skillsPlayed:number;lastTargeted:number|null};
export type QueueCard={battle:number;card:number;target:number|null;energyOnUse?:number;options?:Partial<PlayOptions>;state?:CardState;front?:boolean;afterFirst?:boolean};
export type CardDestination={battle:number;play:number;destination:0|1|2|3};
