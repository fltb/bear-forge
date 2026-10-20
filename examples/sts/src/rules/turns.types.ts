export type TurnSetup={battle:number;enemies:number[];drawPerTurn:number;energyPerTurn:number;extent?:number|undefined};
export type TurnState=TurnSetup&{extent:number;scope:number;retained:number;phase:0|1|2|3;cursor:number;skipEnemies:boolean};
export type TurnActor={controller:number;battle:number;actor:number};
