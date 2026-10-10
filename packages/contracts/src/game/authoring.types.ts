import type {z} from 'zod';
import type {EmptyTableGuard,FixedTable,ReadView,TableKeys} from '../internal/type-utils.ts';
import type {PortShape,ProgramModule} from '../core/program.types.ts';
import type {ActionTable,InputOptions} from './game.types.ts';
/** Game-only metadata; Core continues to consume input/output shapes alone. */
export type GamePortShape=PortShape&{kind:'request'|'event'};
export type GamePortDeclarations<P extends {[K in keyof P]:GamePortShape}>=FixedTable<P>&EmptyTableGuard<P>&{
  readonly [K in keyof P]:{
    readonly kind:'request' extends P[K]['kind']
      ? 'event' extends P[K]['kind'] ? never : 'request'
      : 'event';
    readonly input:z.ZodType<P[K]['input']>;
    readonly output:z.ZodType<P[K]['output']>;
  }
};
export type GameTypes={
  setup:unknown;ports:Record<string,GamePortShape>;programResult:unknown;view:unknown;
  actions:ActionTable;player:string;observation:unknown;event:unknown;playerEvent:unknown;result:unknown;
  control:never|{request:unknown;input:unknown};
};
export type RequestData<G extends GameTypes>={
  [K in TableKeys<G['actions']>]:{key:string;player:G['player'];type:K;data:G['actions'][K]['request']}
}[TableKeys<G['actions']>];
export type Prepared<T>={valid:false;reason:string}|{valid:true;output:T};
export type GameContract<G extends GameTypes>={
  schemas:FixedTable<G['actions']>&{[K in 'view'|'player'|'observation'|'event'|'playerEvent'|'result']:z.ZodType<G[K]>}&{
    actions:EmptyTableGuard<G['actions']>&{[K in keyof G['actions']]:{[F in keyof G['actions'][K]]:z.ZodType<G['actions'][K][F]>}};
  };
  ports:FixedTable<G['ports']>&EmptyTableGuard<G['ports']>&{[K in keyof G['ports']]:
    | ({kind:'event';receive:(input:ReadView<G['ports'][K]['input']>)=>{events:G['event'][];output:G['ports'][K]['output']}} & ([G['ports'][K]['kind']] extends ['request']?never:unknown))
    | ({kind:'request';receive:(input:ReadView<G['ports'][K]['input']>)=>{view:G['view'];requests:RequestData<G>[]};
       respond:<A extends TableKeys<G['actions']>>(view:ReadView<G['view']>,request:ReadView<Extract<RequestData<G>,{type:A}>>,action:ReadView<G['actions'][A]['action']>)=>Prepared<G['ports'][K]['output']>;
       session?:[G['control']] extends [never]?never:{
         requestSchema:z.ZodType<G['control']['request']>;inputSchema:z.ZodType<G['control']['input']>;
         request:(view:ReadView<G['view']>)=>G['control']['request'];
         respond:(view:ReadView<G['view']>,input:ReadView<G['control']['input']>)=>Prepared<G['ports'][K]['output']>;
       };
      } & ([G['ports'][K]['kind']] extends ['event']?never:unknown))
  };
  finish:(result:ReadView<G['programResult']>)=>{view:G['view'];result:G['result']};
  observe:(view:ReadView<G['view']>,player:G['player'])=>G['observation'];
  projectEvent:(event:ReadView<G['event']>,player:G['player'])=>{event:G['playerEvent']}|null;
  inputs:EmptyTableGuard<G['actions']>&{[K in keyof G['actions']]:{
    options:z.ZodType<InputOptions<G['actions'][K]['action'],G['actions'][K]['description']>>;
    describe:(view:ReadView<G['view']>,request:ReadView<Extract<RequestData<G>,{type:K}>>)=>InputOptions<G['actions'][K]['action'],G['actions'][K]['description']>;
  }};
};
export type GameModule<G extends GameTypes>={
  program:ProgramModule<G['setup'],G['ports'],G['programResult']>&{schemas:{ports:GamePortDeclarations<G['ports']>}};
  contract:GameContract<G>;
};
/** Construct inside Program.run; all effectful methods delegate to declared IO. */
export type GameSDK<P extends {[K in keyof P]:GamePortShape}>=FixedTable<P>&EmptyTableGuard<P>&{readonly [K in keyof P]:(input:P[K]['input'])=>Promise<P[K]['output']>};
