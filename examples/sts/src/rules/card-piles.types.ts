export type CardPilesSetup={actor:number;battle:number;draw:number;hand:number;discard:number;exhaust:number;shuffleRng:number;cardRng:number;actionScope:number};
export type CardPilesState=CardPilesSetup&{scope:number;drawn:number;discarded:number;initialized:boolean;nextUniqueId:number;registered:number[];auxiliary:number[]};
export type PileCard={piles:number;card:number};
export type CardDiscard=PileCard&{endTurn:boolean};
