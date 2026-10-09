import type {z} from 'zod';
import type {FixedTable,ReadView,TableKeys} from '../internal/types.ts';
import type {PortShape,ProgramModule} from '../core/types.ts';
import type {ActionTable,InputOptions} from '../game/types.ts';
export type GameTypes={
  setup:unknown;ports:Record<string,PortShape>;programResult:unknown;view:unknown;
  actions:ActionTable;player:string;observation:unknown;event:unknown;playerEvent:unknown;result:unknown;
  control:never|{request:unknown;input:unknown};
};
export type RequestData<G extends GameTypes>={
  [K in TableKeys<G['actions']>]:{key:string;player:G['player'];type:K;data:G['actions'][K]['request']}
}[TableKeys<G['actions']>];
export type Prepared<T>={valid:false;reason:string}|{valid:true;output:T};
export type GameContract<G extends GameTypes>={
  schemas:FixedTable<G['actions']>&{[K in 'view'|'player'|'observation'|'event'|'playerEvent'|'result']:z.ZodType<G[K]>}&{
    actions:{[K in keyof G['actions']]:{[F in keyof G['actions'][K]]:z.ZodType<G['actions'][K][F]>}};
  };
  ports:FixedTable<G['ports']>&{[K in keyof G['ports']]:
    | {kind:'event';receive:(input:ReadView<G['ports'][K]['input']>)=>{events:G['event'][];output:G['ports'][K]['output']}}
    | {kind:'request';receive:(input:ReadView<G['ports'][K]['input']>)=>{view:G['view'];requests:RequestData<G>[]};
       respond:<A extends TableKeys<G['actions']>>(view:ReadView<G['view']>,request:ReadView<Extract<RequestData<G>,{type:A}>>,action:ReadView<G['actions'][A]['action']>)=>Prepared<G['ports'][K]['output']>;
       session?:[G['control']] extends [never]?never:{
         requestSchema:z.ZodType<G['control']['request']>;inputSchema:z.ZodType<G['control']['input']>;
         request:(view:ReadView<G['view']>)=>G['control']['request'];
         respond:(view:ReadView<G['view']>,input:ReadView<G['control']['input']>)=>Prepared<G['ports'][K]['output']>;
       };
      }
  };
  finish:(result:ReadView<G['programResult']>)=>{view:G['view'];result:G['result']};
  observe:(view:ReadView<G['view']>,player:G['player'])=>G['observation'];
  projectEvent:(event:ReadView<G['event']>,player:G['player'])=>{event:G['playerEvent']}|null;
  inputs:{[K in keyof G['actions']]:{
    options:z.ZodType<InputOptions<G['actions'][K]['action'],G['actions'][K]['description']>>;
    describe:(view:ReadView<G['view']>,request:ReadView<Extract<RequestData<G>,{type:K}>>)=>InputOptions<G['actions'][K]['action'],G['actions'][K]['description']>;
  }};
};
export type GameModule<G extends GameTypes>={program:ProgramModule<G['setup'],G['ports'],G['programResult']>;contract:GameContract<G>};
export type GameSDK<P extends {[K in keyof P]:PortShape}>=FixedTable<P>&{[K in keyof P]:(input:P[K]['input'])=>Promise<P[K]['output']>};
