# 三层与横向能力：当前字段报告

默认包入口公开十个日常类型。完整功能按 core/instance/game/authoring/session/persistence/branching/capture/loading 子路径导入；内部类型工具不作为包入口导出。

## 审核矩阵

| 层 | 必需能力 | 可选能力 |
| --- | --- | --- |
| Core | 程序、端口、创建 | 装载时提供保存与捕捉资源 |
| Instance | bind/run/inspect/close，单次端口接受 | fork、保存、记录；transfer 用于接线 |
| BaseGame | 玩家请求、纯动作、合法动作、事件与接受反馈 | 会话控制、同类型分支、实例保存 |

程序与 SDK 在 Instance 内；纯 GameContract、玩家/会话回调在外侧。规则状态与随机流由程序持有，外侧只持有驱动和可重建投影。

## 主要变化与业务依据

| 内容 | 当前表达 | 验证 |
| --- | --- | --- |
| 输入入口 | Request{id,player,type,data,observation,options} | 多玩家与多请求测试 |
| 请求身份 | id={instanceId,callId,key} | 错玩家、过期、跨实例拒绝 |
| 玩家回复 | onRequest 返回纯 Action | ActionSchema 拒绝时间字段 |
| 选项和检查 | exact/construct 对应同一动作类型 | 斗地主完整合法动作 oracle |
| 时间与超时 | 独立 SessionControl.bindControl | 完整超时对局和截止点测试 |
| 一步推进 | 接受一个规则输入，交付随后事件，到下一请求 | 原生 Game.run 实际测试 |
| 接受反馈 | 具体请求、玩家、动作或控制输入 | 后续暂停、取消、程序/契约故障保留 |
| 基本运行 | 无保存、分支、会话能力仍可运行 | basic interface 测试 |
| 原生差分入口 | 同一 ProgramModule.run + IO | 实际游戏与消费者 |
| 模块隔离 | 基础模块不依赖可选目录 | 源码依赖图检查 |

训练、搜索、分析的业务类型由各上层模块按自身输入输出声明；基础包只提供它们实际消费的游戏和执行协议。

## 斗地主

纯动作保持 bid/double/redouble/pass/play。内部动作输入去掉接收时间，规则校验读取 state.now。可选控制 clock 单调推进 now；timeout 校验期限并执行既有默认行为。原有叫分、加倍、出牌、牌型与计分路径保留；规则文件中只调整时间接入，验证脚本反向归一化后核对原基线哈希。

原生消费者以公开 IO 启动真实程序，并实现对应 BaseGame 接线用于协议验收。三个席位共享函数而分别收到自己的数据；正常和超时对局均完成，主动事件与最终玩家历史一致。生产受控执行和完整保存分支由 C02/C03 验收。

## 15 个压力场景

| 场景 | 表达及所属状态 |
| --- | --- |
| 同点双分支 | Instance.fork；父子 BaseGame 同类型 |
| 触发来源死亡 | 对象 ID、触发记录留在内侧堆 |
| 多恢复点接续 | 保存控制栈、闭包与待决调用 |
| 恢复后再分支 | restore→Instance→bind→fork |
| 私密选择分支 | 内侧封存，外侧纯可见投影 |
| 死亡目标 | respond/apply 同一规则拒绝 |
| 错人、错类型、非法数量 | 请求 player、请求身份及内侧动作规则 |
| 重复或过期请求 | 当前 instanceId/callId/key 校验 |
| 错分支凭证 | fork 新 InstanceId；旧凭证不匹配 |
| 同名对象重新进场 | 内侧实例 ID 与卡名分离 |
| 相同场面不同控制流 | 保存完整现场，不由 view 猜 PC |
| 提交中故障 | Instance fault/close；不能保存半现场 |
| 触发内部恢复 | 精确等待点继续，不重跑前半段 |
| 反制跳过内部选择 | 程序条件控制流决定是否调用端口 |
| 条件尾部跳过 | 普通内侧分支，不加 Core 领域规则 |


## 声明与内部类型工具原文

### packages/contracts/src/authoring/types.ts

```ts
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
```

### packages/contracts/src/branching/types.ts

```ts
import type {Outcome,InstanceError} from '../instance/types.ts';
export type Branching<S,E=InstanceError>={fork:()=>Promise<Outcome<S,E>>};
```

### packages/contracts/src/capture/schemas.ts

```ts
import {z} from 'zod';
export const RecordCursorSchema=z.number().safe().nonnegative();
export const RecordReadSchema=z.strictObject({after:RecordCursorSchema.nullable(),limit:z.number().safe().positive()});
```

### packages/contracts/src/capture/types.ts

```ts
import type {z} from 'zod';
import type {RecordReadSchema} from './schemas.ts';
import type {PortShape,PortCall,PortReturn} from '../core/types.ts';
import type {InstanceId,CallId,Outcome,InstanceFault} from '../instance/types.ts';
export type RecordRead = z.infer<typeof RecordReadSchema>;
export type InstanceRecord<S, P extends { [K in keyof P]: PortShape }, R> =
  | { sequence: number; kind: 'started'; setup: S }
  | { sequence: number; kind: 'called'; callId: CallId; call: PortCall<P> }
  | { sequence: number; kind: 'returned'; callId: CallId; reply: PortReturn<P> }
  | { sequence: number; kind: 'completed'; result: R }
  | { sequence: number; kind: 'faulted'; error: InstanceFault };
export type InstanceCapture<S, P extends { [K in keyof P]: PortShape }, R> = {
  read: (instanceId: InstanceId, input: RecordRead) => Promise<Outcome<{
    records: InstanceRecord<S, P, R>[];
    next: number | null;
  }>>;
  release: (instanceId: InstanceId) => Promise<Outcome<void>>;
};
```

### packages/contracts/src/core/types.ts

```ts
import type { z } from 'zod';
import type { FixedTable, TableKeys } from '../internal/types.ts';
import type { Instance, Outcome } from '../instance/types.ts';
export type PortShape = { input: unknown; output: unknown };
export type PortCall<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; input: P[K]['input'] };
}[TableKeys<P>];
export type PortReturn<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; output: P[K]['output'] };
}[TableKeys<P>];
export type IO<P extends { [K in keyof P]: PortShape }> = {
  call: <const A extends PortCall<P>>(call: A) => Promise<P[A['port']]['output']>;
};
export type Program<S, P extends { [K in keyof P]: PortShape }, R> =
  (setup: S, io: IO<P>) => Promise<R>;
export type ProgramSchemas<S, P extends { [K in keyof P]: PortShape }, R> = FixedTable<P> & {
  setup: z.ZodType<S>;
  result: z.ZodType<R>;
  ports: { [K in keyof P]: { input: z.ZodType<P[K]['input']>; output: z.ZodType<P[K]['output']> } };
};
export type ProgramModule<S, P extends { [K in keyof P]: PortShape }, R> = {
  schemas: ProgramSchemas<S, P, R>;
  run: Program<S, P, R>;
};
export type Core<S, P extends { [K in keyof P]: PortShape }, R> = {
  start: (setup: S) => Promise<Outcome<Instance<P, R>>>;
};
```

### packages/contracts/src/game/schemas.ts

```ts
import {z} from 'zod';
import {InstanceIdSchema,CallIdSchema} from '../instance/schemas.ts';
export const RequestIdSchema=z.strictObject({instanceId:InstanceIdSchema,callId:CallIdSchema,key:z.string()});
export const JsonValueSchema=z.json();
export const InputValidationSchema=z.discriminatedUnion('valid',[
  z.strictObject({valid:z.literal(true)}),z.strictObject({valid:z.literal(false),reason:z.string()}),
]);
export const InputOptionsSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('exact'),values:z.array(JsonValueSchema)}),
  z.strictObject({kind:z.literal('construct'),description:JsonValueSchema}),
]);
export const GameErrorSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('rejected'),code:z.enum(['invalid_input','invalid_argument','request_mismatch','snapshot_incompatible']),message:z.string()}),
  z.strictObject({kind:z.literal('conflict'),code:z.enum(['game_busy','game_closed','game_ended','view_unavailable']),message:z.string()}),
  z.strictObject({kind:z.literal('unsupported'),code:z.literal('capability_unavailable'),message:z.string()}),
  z.strictObject({kind:z.literal('fault'),code:z.enum(['invalid_output','program_failed','budget_exceeded']),message:z.string()}),
]);
export const EventDeliveryIdSchema=z.strictObject({instanceId:InstanceIdSchema,callId:CallIdSchema,index:z.number().safe().nonnegative()});
```

### packages/contracts/src/game/types.ts

```ts
import type {z} from 'zod';
import type {FixedTable,TableKeys} from '../internal/types.ts';
import type {Outcome,InstanceId,PauseReason,CallbackReply,CallbackControl,CallId} from '../instance/types.ts';
import type {RequestIdSchema,GameErrorSchema,JsonValueSchema,InputValidationSchema,EventDeliveryIdSchema} from './schemas.ts';

export type RequestId=z.infer<typeof RequestIdSchema>;
export type GameError=z.infer<typeof GameErrorSchema>;
export type JsonValue=z.infer<typeof JsonValueSchema>;
export type InputOptions<A extends JsonValue,D extends JsonValue=never>=
  | {kind:'exact';values:A[]}
  | ([D] extends [never]?never:{kind:'construct';description:D});
export type InputValidation=z.infer<typeof InputValidationSchema>;
export type ActionTable=Record<string,{request:JsonValue;action:JsonValue;description:JsonValue}>;
/** Each request names its player and one action type. */
export type Request<T extends ActionTable,P extends string,V>={
  [K in TableKeys<T>]:{id:RequestId;player:P;type:K;data:T[K]['request'];observation:V;options:InputOptions<T[K]['action'],T[K]['description']>}
}[TableKeys<T>];
export type ActionReply<T extends ActionTable>={
  [K in TableKeys<T>]:{requestId:RequestId;type:K;action:T[K]['action']}
}[TableKeys<T>];
export type Accepted<T extends ActionTable,P extends string,C=never>=
  | {kind:'action';player:P;reply:ActionReply<T>}
  | ([C] extends [never]?never:{kind:'control';callId:CallId;input:C});
export type GameState<T extends ActionTable,P extends string,V,R>=
  | {kind:'request';requests:Request<T,P,V>[]}
  | {kind:'event';callId:CallId}
  | {kind:'ended';result:R}
  | {kind:'fault';error:Extract<GameError,{kind:'fault'}>};
export type EventDelivery<E>={id:z.infer<typeof EventDeliveryIdSchema>;event:E};
export type GameBindings<T extends ActionTable,P extends string,V,E>={
  player:P;
  onRequest?:<K extends TableKeys<T>>(request:Extract<Request<T,P,V>,{type:K}>,control:CallbackControl)=>Promise<CallbackReply<T[K]['action']>>;
  onEvent?:(delivery:EventDelivery<E>,control:CallbackControl&{player:P})=>Promise<CallbackReply<null>>;
};
/** One rules input per call, followed by event delivery to the next request or end. */
export type BaseGame<T extends ActionTable,P extends string,V,E,R,C=never>=FixedTable<T>&{
  readonly id:InstanceId;
  bind:(bindings:GameBindings<T,P,V,E>|null)=>Promise<Outcome<void,GameError>>;
  run:(options?:{signal?:AbortSignal})=>Promise<Outcome<{
    state:GameState<T,P,V,R>;accepted:Accepted<T,P,C>|null;pause:PauseReason|null;
  },GameError>>;
  inspect:()=>Promise<Outcome<GameState<T,P,V,R>,GameError>>;
  observe:(input:{player:P})=>Promise<Outcome<V,GameError>>;
  describe:<K extends TableKeys<T>>(input:{requestId:RequestId;type:K})=>Promise<Outcome<InputOptions<T[K]['action'],T[K]['description']>,GameError>>;
  validate:(input:{player:P;reply:ActionReply<T>})=>Promise<Outcome<InputValidation,GameError>>;
  close:()=>Promise<Outcome<void,GameError>>;
};
```

### packages/contracts/src/instance/schemas.ts

```ts
import { z } from 'zod';

export const InstanceIdSchema = z.uuid().brand<'InstanceId'>();
export const CallIdSchema = z.uuid().brand<'CallId'>();
export const InstanceErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rejected'),
    code: z.enum(['invalid_input', 'invalid_argument', 'snapshot_not_found', 'snapshot_incompatible', 'records_not_found']),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('conflict'),
    code: z.enum(['instance_busy', 'instance_closed', 'instance_owned']),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('unsupported'),
    code: z.literal('capability_unavailable'),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('fault'),
    code: z.enum(['invalid_output', 'budget_exceeded', 'program_failed']),
    message: z.string(),
  }),
]);
export const PauseReasonSchema = z.enum(['requested', 'unbound', 'cancelled', 'handler_failed', 'invalid_reply']);
export const CallbackPauseSchema = z.strictObject({kind:z.literal('pause')});
```

### packages/contracts/src/instance/types.ts

```ts
import type { z } from 'zod';
import type { PortShape, PortCall } from '../core/types.ts';
import type { FixedTable } from '../internal/types.ts';
import type { InstanceIdSchema, CallIdSchema, InstanceErrorSchema, PauseReasonSchema, CallbackPauseSchema } from './schemas.ts';
export type InstanceId = z.infer<typeof InstanceIdSchema>;
export type CallId = z.infer<typeof CallIdSchema>;
export type InstanceError = z.infer<typeof InstanceErrorSchema>;
export type InstanceFault = Extract<InstanceError, { kind: 'fault' }>;
export type Outcome<T, E = InstanceError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
export type PauseReason = z.infer<typeof PauseReasonSchema>;
export type CallbackPause = z.infer<typeof CallbackPauseSchema>;
export type CallbackReply<T> = {kind:'reply';value:T} | CallbackPause;
export type CallbackControl = {signal:AbortSignal};
export type PortBindings<P extends { [K in keyof P]: PortShape }> = FixedTable<P> & {
  [K in keyof P]?: (request:{instanceId:InstanceId;callId:CallId;input:P[K]['input']}, control:CallbackControl) => Promise<CallbackReply<P[K]['output']>>;
};
export type InstanceStop<P extends { [K in keyof P]: PortShape }, R> =
  | { kind: 'call'; callId: CallId; call: PortCall<P> }
  | { kind: 'done'; result: R }
  | { kind: 'fault'; error: InstanceFault };
export type InstanceRunStop<P extends {[K in keyof P]:PortShape},R> = {accepted:boolean;state:InstanceStop<P,R>;pause:PauseReason|null};
export type Instance<P extends { [K in keyof P]: PortShape }, R> = {
  readonly id: InstanceId;
  transfer: () => Promise<Outcome<Instance<P, R>>>;
  bind: (bindings: PortBindings<P> | null) => Promise<Outcome<void>>;
  run: (options?: {signal?:AbortSignal}) => Promise<Outcome<InstanceRunStop<P, R>>>;
  inspect: () => Promise<Outcome<InstanceStop<P, R>>>;
  fork?: () => Promise<Outcome<Instance<P, R>>>;
  close: () => Promise<Outcome<void>>;
};
```

### packages/contracts/src/internal/types.ts

```ts
export type ReadView<T> = T extends object
  ? { readonly [K in keyof T]: ReadView<T[K]> }
  : T;
type IsUnion<T, Whole = T> = T extends unknown
  ? [Whole] extends [T] ? false : true
  : never;
type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
export type FixedTable<T> = true extends IsUnion<T> ? never
  : string extends keyof T ? never
  : Exclude<keyof T, string> extends never
    ? [OptionalKeys<T>] extends [never] ? unknown : never
    : never;
export type TableKeys<T> = FixedTable<T> extends never ? never : keyof T & string;
```

### packages/contracts/src/loading/schemas.ts

```ts
import { z } from 'zod';
export const CompiledProgramDataSchema = z.strictObject({
  kind: z.literal('controlled-program'),
  content: z.instanceof(Uint8Array),
});
```

### packages/contracts/src/loading/types.ts

```ts
import type {z} from 'zod';
import type {Core,ProgramModule,PortShape} from '../core/types.ts';
import type {FixedTable} from '../internal/types.ts';
import type {Instance,Outcome} from '../instance/types.ts';
import type {InstancePersistence,InstanceSnapshot} from '../persistence/types.ts';
import type {InstanceCapture} from '../capture/types.ts';
import type {BaseGame,GameError} from '../game/types.ts';
import type {GameContract,GameTypes} from '../authoring/types.ts';
import type {SessionControl} from '../session/types.ts';
import type {CompiledProgramDataSchema} from './schemas.ts';
declare const programWitness:unique symbol;
export type CompiledProgram<S,P extends {[K in keyof P]:PortShape},R>=z.infer<typeof CompiledProgramDataSchema>&FixedTable<P>&{
 readonly [programWitness]:(types:{setup:S;ports:P;result:R})=>{setup:S;ports:P;result:R};
};
export type LoadedCore<S,P extends {[K in keyof P]:PortShape},R>={core:Core<S,P,R>;persistence?:InstancePersistence<P,R>;capture?:InstanceCapture<S,P,R>};
export type NativeCoreLoader={load:<S,P extends {[K in keyof P]:PortShape},R>(program:ProgramModule<S,P,R>)=>Promise<Outcome<LoadedCore<S,P,R>>>};
export type ControlledCoreLoader={load:<S,P extends {[K in keyof P]:PortShape},R>(program:CompiledProgram<S,P,R>)=>Promise<Outcome<LoadedCore<S,P,R>>>};
export type GameHandle<G extends GameTypes>=BaseGame<G['actions'],G['player'],G['observation'],G['playerEvent'],G['result'],G['control']['input']>&{
 fork?:()=>Promise<Outcome<GameHandle<G>,GameError>>;
 save?:()=>Promise<Outcome<InstanceSnapshot,GameError>>;
}&([G['control']] extends [never]?{}:Partial<SessionControl<G['control']['request'],G['control']['input']>>);
/** The caller supplies the matching author contract for the loaded program. */
export type BaseGameBinder={bind:<G extends GameTypes>(input:{instance:Instance<G['ports'],G['programResult']>;contract:GameContract<G>;persistence?:InstancePersistence<G['ports'],G['programResult']>})=>Promise<Outcome<GameHandle<G>,GameError>>};
```

### packages/contracts/src/persistence/schemas.ts

```ts
import {z} from 'zod';
export const InstanceSnapshotSchema=z.strictObject({snapshotId:z.uuid().brand<'InstanceSnapshotId'>()});
```

### packages/contracts/src/persistence/types.ts

```ts
import type {z} from 'zod';
import type {InstanceSnapshotSchema} from './schemas.ts';
import type {PortShape} from '../core/types.ts';
import type {Instance,Outcome} from '../instance/types.ts';
export type InstanceSnapshot = z.infer<typeof InstanceSnapshotSchema>;
export type InstancePersistence<P extends { [K in keyof P]: PortShape }, R> = {
  save: (instance: Instance<P, R>) => Promise<Outcome<InstanceSnapshot>>;
  restore: (snapshot: InstanceSnapshot) => Promise<Outcome<Instance<P, R>>>;
  release: (snapshot: InstanceSnapshot) => Promise<Outcome<void>>;
};
```

### packages/contracts/src/session/types.ts

```ts
import type {CallbackReply,CallbackControl,CallId,InstanceId,Outcome} from '../instance/types.ts';
import type {GameError} from '../game/types.ts';
/** Optional host/session input, separate from all player actions. */
export type SessionControl<Q,I>={
  bindControl:(handler:((request:{instanceId:InstanceId;callId:CallId;data:Q},control:CallbackControl)=>Promise<CallbackReply<I>>)|null)=>Promise<Outcome<void,GameError>>;
};
```
