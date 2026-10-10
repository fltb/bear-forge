import { z } from 'zod';
import { createGameSDK } from '@bear-forge/game-sdk';
import type { IO } from '@bear-forge/contracts/core';
import type { GamePortDeclarations, GameSDK, GameContract } from '@bear-forge/contracts/authoring';
import type { DouDizhuTypes } from '../../games/doudizhu/src/types.ts';

type Ports={
  pick:{kind:'request';input:{count:number};output:number};
  name:{kind:'request';input:{prompt:string};output:string};
  notify:{kind:'event';input:string[];output:null};
};
const ports={
  pick:{kind:'request',input:z.strictObject({count:z.number()}),output:z.number()},
  name:{kind:'request',input:z.strictObject({prompt:z.string()}),output:z.string()},
  notify:{kind:'event',input:z.array(z.string()),output:z.null()},
} satisfies GamePortDeclarations<Ports>;

export async function author(io:IO<Ports>){
  const sdk:GameSDK<Ports>=createGameSDK(io,ports);
  const numeric:number=await sdk.pick({count:3});
  const text:string=await sdk.name({prompt:'name'});
  const ack:null=await sdk.notify([text]);
  // @ts-expect-error unknown port
  sdk.unknown(null);
  // @ts-expect-error parameters cannot be borrowed from a different request
  sdk.pick({prompt:'wrong'});
  // @ts-expect-error result remains tied to the called port
  const wrong:string=await sdk.pick({count:3});
  // @ts-expect-error inner SDK never exposes control-plane branching
  sdk.fork();
  void [numeric,text,ack,wrong];
}
// @ts-expect-error required declaration missing
const missing:GamePortDeclarations<Ports>={pick:ports.pick,name:ports.name};
const wrongKind:GamePortDeclarations<Ports>={...ports,
  // @ts-expect-error event cannot be declared as request
  notify:{...ports.notify,kind:'request'},
};
const wrongOutput:GamePortDeclarations<Ports>={...ports,
  // @ts-expect-error output schema must agree with the port
  pick:{...ports.pick,output:z.string()},
};
// @ts-expect-error finite, required string keys only
const open:GameSDK<Record<string,Ports['pick']>>={};
// @ts-expect-error optional port is not a fixed declaration
const optional:GamePortDeclarations<{pick?:Ports['pick']}>={};
// @ts-expect-error numeric keys cannot silently disappear from the SDK
const numeric:GamePortDeclarations<{1:Ports['pick']}>={1:ports.pick};
export function mismatchedContract(contract:GameContract<DouDizhuTypes>){
  const wrong:GameContract<DouDizhuTypes>={...contract,ports:{...contract.ports,
    // @ts-expect-error a declared request cannot be interpreted as an event outside
    decision:{kind:'event',receive:()=>({events:[],output:{kind:'clock',at:0}})},
  }};
  void wrong;
}
void [missing,wrongKind,wrongOutput,open,optional,numeric];

const ambiguous:GamePortDeclarations<{ask:{kind:'request'|'event';input:number;output:number}}>={
  // @ts-expect-error one port must have a single declared role
  ask:{kind:'request',input:z.number(),output:z.number()},
};
void ambiguous;
