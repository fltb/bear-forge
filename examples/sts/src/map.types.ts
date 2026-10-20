export type Room='SHOP'|'REST'|'EVENT'|'ELITE'|'MONSTER'|'TREASURE'|'BOSS'|'BOSS_TREASURE'|'NONE'|'INVALID';
export type MapNode={x:number;y:number;room:Room;edges:number[];parents:number[]};
export type SpireMap={nodes:MapNode[];burningEliteX:number;burningEliteY:number;burningEliteBuff:number};
