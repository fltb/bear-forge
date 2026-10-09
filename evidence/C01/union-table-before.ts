import { z } from 'zod';
import type { GameSchemas, FiniteTableGuard, InteractionRequest } from '@bear-forge/contracts';
type Entry={request:null;input:null;context:null;description:never};
type UnionTable={left:Entry}|{right:Entry};
type G={setup:null;state:null;event:null;result:null;interactions:UnionTable};
export const acceptedUnion:GameSchemas<G>={setup:z.null(),state:z.null(),event:z.null(),result:z.null(),interactions:{left:{request:z.null(),input:z.null(),context:z.null(),description:z.never()}}};
export const lostKeys:InteractionRequest<UnionTable> extends never ? true:false=true;
