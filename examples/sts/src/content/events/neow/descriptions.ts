/** The source rounds before multiplying; expose the exact cost, not an approximate percentage. */
export function neowHpLimit(hp:number){return Math.trunc(hp/10)*7;}
export function neowMaxHpAfterLoss(maxHp:number){return Math.trunc(Math.fround(Math.fround(.9)*Math.fround(maxHp)));}
export function describeNeowDrawback(drawback:number,state:{hp:number;maxHp:number;gold:number}):string{
  switch(drawback){
    case 0:case 1:return '无代价';
    case 2:{const maxHp=neowMaxHpAfterLoss(state.maxHp);return `失去${state.maxHp-maxHp}最大生命（${state.maxHp}→${maxHp}）${state.hp>maxHp?`，当前生命${state.hp}→${maxHp}`:''}`;}
    case 3:return `失去全部${state.gold}金币`;
    case 4:return '获得随机诅咒';
    case 5:{const hp=neowHpLimit(state.hp);return `失去${state.hp-hp}生命（${state.hp}→${hp}）`;}
    case 6:return '失去起始遗物';
    default:throw Error('Unknown Neow drawback '+drawback);
  }
}
