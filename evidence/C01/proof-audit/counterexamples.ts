import type { GameContext, GameQueryCapability, GameTypes, InteractionRequest, LoadedGame, GameRef, BoundaryId } from '../../../packages/contracts/src/index.ts';
type T={
  left:{request:{left:number};input:number;context:{left:number};description:never};
  right:{request:{right:string};input:string;context:{right:string};description:never};
};
type G={setup:null;state:null;interactions:T;event:null;result:null};
// No any, assertions, ignored diagnostics or untyped values in these bad calls.
export const widenedRequest=(ctx:GameContext<G>)=>ctx.input.request<'left'|'right'>('left',{right:'wrong'});
export const dynamicRequest=(ctx:GameContext<G>,key:'left'|'right')=>ctx.input.request(key,{right:'wrong'});
export const widenedQuery=(queries:GameQueryCapability<{left:{input:number;output:number};right:{input:string;output:string}}>,game:GameRef)=>queries.query<'left'|'right'>({game,name:'left',args:'wrong'});
export const widenedOptions=(loaded:LoadedGame<G,{}>,game:GameRef,boundaryId:BoundaryId)=>loaded.inputs.describe<'left'|'right'>({game,boundaryId,type:'left',context:{right:'wrong'}});

// Nonempty numeric-key table satisfies the public constraint but has no request values.
type Numeric={setup:null;state:null;interactions:{0:T['left']};event:null;result:null};
export const acceptedNumeric=(value:Numeric):GameTypes=>value;
type NumericRequest=InteractionRequest<Numeric['interactions']>;
export const erasedNumeric=(value:NumericRequest):never=>value;
