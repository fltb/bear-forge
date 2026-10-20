export type HitRequest={battle:number;source:number|null;target:number;amount:number;attack:boolean;selfDamage:boolean};
export type HitFacts={blockTarget:number;requested:number;blocked:number;hadBlock:boolean;unblocked:number};
export type HpDamageRequest={request:HitRequest;facts:HitFacts};
export type HitResult={battle:number;source:number|null;target:number;blockTarget:number;requested:number;blocked:number;unblocked:number;lost:number;attack:boolean};
