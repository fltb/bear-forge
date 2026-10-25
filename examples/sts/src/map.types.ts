export type Room='SHOP'|'REST'|'EVENT'|'ELITE'|'MONSTER'|'TREASURE'|'BOSS'|'BOSS_TREASURE'|'NONE'|'INVALID';
export type MapNode={x:number;y:number;room:Room;edges:number[];parents:number[]};
export type SpireMap={nodes:MapNode[];burningEliteX:number;burningEliteY:number;burningEliteBuff:number};
/** Original map construction paused immediately before its next random draw.
 * Indices retain the selected destination even if a later adjustment changes
 * the proposed edge. No action history or native generator stack is stored. */
export type MapConstruction={
  map:SpireMap;ascension:number;burning:boolean;
  phase:'start'|'step'|'adjust'|'shuffle'|'elite'|'buff'|'done';
  path:number;first:number;x:number;y:number;next:number;destination:number;parent:number;
  rooms:Room[];shuffle:number;
};
export type MapDraw={start:number;end:number;counted:boolean};
