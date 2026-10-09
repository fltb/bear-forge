# Instance 两侧协议：字段与需求映射

C01 交付公共协议、斗地主作者程序及 SDK、类型消费者、逐玩家原生消费者与测试。协议构造和归纳证明见 [协议证明](protocol-freeze-proof.md)。C02/C03 验收生产执行、绑定与完整保存分支。

## 边界与数据流

| 部分 | 持有状态 | 公开约定 |
| --- | --- | --- |
| Core | 执行提供者资源 | start；装载器提供 persistence/capture |
| Instance | 程序、栈、堆、闭包、SDK 状态、待决调用、记录 | bind/run/inspect/fork?/transfer/close |
| GameSDK | Instance 内的领域局部 | 声明端口的类型化库函数 |
| GameContract | 纯定义 | schemas/ports/finish/playerFor/observe/projectEvent/inputs/queries |
| BaseGame | Instance 控制权、玩家绑定及活动驱动 | bind/run 和边界读取；fork?/save?/close |
| 用户/脚本/模型 | 对应 player 的策略或界面状态 | observation/offers/playerEvent；回调返回 GameInput |
| 会话/训练/搜索 | 时钟、策略记忆、搜索树、实验配置 | 控制句柄、可选分析能力与同类型子游戏 |

路径：ProgramModule → loader → Core.start → Instance → binder → BaseGame。游戏内部 program → SDK → IO.call；外侧按 contract 投影到已绑定 player；合法回复经 respond 编码后回到同一个 Instance。

## 玩家协议

player 是游戏 schema 定义的字符串键；actor 是行动主体。playerFor(actor) 明确归属，多个 actor 可以由一个 player 控制。BaseGame.bind({player,onDecision?,onEvent?}) 替换该玩家项；只传 player 删除该项，null 清空全部。绑定函数引用可以复用。

输入请求为 {decisionId,observation,offers,acceptsSignal}。observation=observe(view,player)，offers 仅来自归属该玩家的 choices；signalPlayers 指定可回答信号的玩家。respond(view,input,player) 检查完整游戏输入并转换为端口返回。DecisionPolicy(offer,observation,control) 选择载荷，绑定函数补充交付数据。

event 是原始事件，playerEvent 是玩家可见事件。projectEvent(event,player) 返回 {event:playerEvent} 或 null。同一源事件可以对不同玩家产生不同载荷。事件去重按 (player,instanceId,callId,index)，原始事件和玩家字符串序决定交付顺序。

首个合法回复接受后撤销其余租约；非法回复保持规则现场。每次 run 的驱动状态和绑定表属于外部控制，fork/restore 后重新绑定。规则状态始终在 Instance。

## 斗地主真实路径

ProgramSetup={game:Setup,seed:uint32}。program.ts 创建 SDK；随机局部、规则 state、事件发布位置 published 均在程序现场。SDK.decision 通过声明端口请求 Frame→Input；SDK.event 发布 AuditEvent[]→null。确认后推进 published，结束前完成全部事件交付。

GameContract.receive 从 Frame 投影边界；playerFor 将 Seat 映射到同一 Seat；observe 投影本人手牌和可见历史；projectEvent 按原始 audience 投影 Event，历史与主动通知使用同一函数。respond 校验当前 player 对应 slot，将 Action 与 delivery 编码为 Input；timeout 用 slot/deadline 构造，内部 boundaryKey 从当前 Frame 补出。

原生消费者把同一个 onDecision/onEvent 分别绑定到三个席位，使用玩家请求完成正常及超时对局；每席位事件与最终可见历史逐条一致。跨玩家动作和超时被拒绝。rules.ts、patterns.ts、独立 oracle.ts、rules.test.ts 保持迁移基线哈希。

## 表达与组合证明索引

| 命题 | 构造 |
| --- | --- |
| 计算与交互表达 | 受控 TS 内部计算，await IO.call 表达输入/输出等待，return 表达终局 |
| 唯一规则状态 | 外侧纯投影来自 InstanceStop；清空缓存后可重建 |
| 玩家数据分离 | choices 按 playerFor 分组，observe 和 projectEvent 使用当前绑定键 |
| 输入归属与一次接受 | 当前租约、choice 归属或 signalPlayers、schema 和 respond 检查先于 Accept |
| 保存/分支充分 | 复制完整现场并隔离对象；相同未来输入下按归约步数证明轨迹等价 |
| 搜索闭合 | 同类型 fork/read/bind/run/close 可递归组合任意有限树 |
| 原生/受控路径 | 相同程序和显式回复，在语义保持前提下得到相同调用与结果轨迹 |
| 捕捉生命周期 | 提供者 capture 用稳定 id 读取，关闭后显式释放引用 |

详细前提、状态转换和不变量见 protocol-freeze-proof.md；所有导出与法则关联保存在 protocol-proof-index.json。

## 15 个压力场景

| 场景 | 表达及所属状态 |
| --- | --- |
| 同点双分支 | Instance.fork；父子 BaseGame 同类型 |
| 触发来源死亡 | 对象 ID、触发记录留在内侧堆 |
| 多恢复点接续 | 保存控制栈、闭包与待决调用 |
| 恢复后再分支 | restore→Instance→bind→fork |
| 私密选择分支 | 内侧封存，外侧纯可见投影 |
| 死亡目标 | respond/apply 同一规则拒绝 |
| 错人、错类型、非法数量 | player 归属检查、关联输入类型与内侧规则 |
| 重复或过期请求 | 当前 InstanceId/callId 校验 |
| 错分支凭证 | fork 新 InstanceId；旧凭证不匹配 |
| 同名对象重新进场 | 内侧实例 ID 与卡名分离 |
| 相同场面不同控制流 | 保存完整现场，不由 view 猜 PC |
| 提交中故障 | Instance fault/close；不能保存半现场 |
| 触发内部恢复 | 精确等待点继续，不重跑前半段 |
| 反制跳过内部选择 | 程序条件控制流决定是否调用端口 |
| 条件尾部跳过 | 普通内侧分支，不加 Core 领域规则 |


## 全部公共声明逐字段附录

### packages/contracts/src/authoring/types.ts

```ts
import type { z } from 'zod';
import type { FixedTable, ReadView, PortShape, ProgramModule } from '../core/types.ts';
import type { InteractionTable, Choice, GameInput, InputOptions, QueryShape } from '../game/types.ts';

/** Domain types are supplied by the game; execution locals are not schema slots. */
export type GameTypes = {
  setup: unknown;
  ports: Record<string, PortShape>;
  programResult: unknown;
  view: unknown;
  interactions: InteractionTable;
  actor: unknown;
  delivery: unknown;
  signal: unknown;
  player: string;
  observation: unknown;
  event: unknown;
  playerEvent: unknown;
  result: unknown;
};
export type Submission<G extends GameTypes> = GameInput<G['interactions'], G['delivery'], G['signal']>;
export type DecisionData<G extends GameTypes> = {
  view: G['view'];
  choices: Choice<G['interactions'], G['actor']>[];
  signalPlayers: G['player'][];
};
export type TerminalData<G extends GameTypes> = {
  view: G['view'];
  result: G['result'];
};
export type PreparedReturn<T> = { valid: false; reason: string } | { valid: true; output: T };
/** External ports have one game protocol role. Stateful services execute inside the program. */
export type GamePorts<G extends GameTypes> = FixedTable<G['ports']> & {
  [K in keyof G['ports']]:
    | {
        kind: 'event';
        receive: (input: ReadView<G['ports'][K]['input']>) => { events: G['event'][]; output: G['ports'][K]['output'] };
      }
    | {
        kind: 'decision';
        receive: (input: ReadView<G['ports'][K]['input']>) => DecisionData<G>;
        respond: (view: ReadView<G['view']>, input: ReadView<Submission<G>>, player: G['player']) => PreparedReturn<G['ports'][K]['output']>;
      };
};
export type GameSchemas<G extends GameTypes> = FixedTable<G['interactions']> & {
  [K in 'view' | 'actor' | 'delivery' | 'signal' | 'player' | 'observation' | 'event' | 'playerEvent' | 'result']: z.ZodType<G[K]>;
} & {
  interactions: {
    [K in keyof G['interactions']]: {
      [F in keyof G['interactions'][K]]: z.ZodType<G['interactions'][K][F]>;
    };
  };
};
export type GameInputDefinitions<G extends GameTypes> = {
  [K in keyof G['interactions']]: {
    options: z.ZodType<InputOptions<G['interactions'][K]['input'], G['interactions'][K]['description']>>;
    describe: (view: ReadView<G['view']>, choice: ReadView<{
      id: string; actor: G['actor']; type: K; request: G['interactions'][K]['request'];
    }>) => InputOptions<G['interactions'][K]['input'], G['interactions'][K]['description']>;
  };
};
export type GameQueryDefinition<G extends GameTypes, Q extends QueryShape> = {
  input: z.ZodType<Q['input']>;
  output: z.ZodType<Q['output']>;
  run: (view: ReadView<G['view']>, input: ReadView<Q['input']>) => Q['output'];
};
/** run executes the game; all adapter handlers are pure projections/conversions. */
export type GameContract<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = {
  schemas: GameSchemas<G>;
  ports: GamePorts<G>;
  finish: (result: ReadView<G['programResult']>) => TerminalData<G>;
  playerFor: (actor: ReadView<G['actor']>) => G['player'];
  observe: (view: ReadView<G['view']>, player: G['player']) => G['observation'];
  projectEvent: (event: ReadView<G['event']>, player: G['player']) => { event: G['playerEvent'] } | null;
  inputs: GameInputDefinitions<G>;
  queries: { [K in keyof Q]: GameQueryDefinition<G, Q[K]> } & FixedTable<Q>;
};
/** Author package joins one program with the shared inner/outer contract. */
export type GameModule<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = {
  program: ProgramModule<G['setup'], G['ports'], G['programResult']>;
  contract: GameContract<G, Q>;
};
/** Inner library signature: typed functions over the exact declared IO ports. */
export type GameSDK<P extends { [K in keyof P]: PortShape }> = FixedTable<P> & {
  [K in keyof P]: (input: P[K]['input']) => Promise<P[K]['output']>;
};
```

### packages/contracts/src/core/schemas.ts

```ts
import { z } from 'zod';

export const InstanceIdSchema = z.uuid().brand<'InstanceId'>();
export const CallIdSchema = z.uuid().brand<'CallId'>();
export const InstanceSnapshotSchema = z.strictObject({
  snapshotId: z.uuid().brand<'InstanceSnapshotId'>(),
});
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
export const RecordCursorSchema = z.number().safe().nonnegative();
export const RecordReadSchema = z.strictObject({
  after: RecordCursorSchema.nullable(),
  limit: z.number().safe().positive(),
});

export const PauseReasonSchema = z.enum(['requested', 'unbound', 'limit', 'cancelled', 'handler_failed', 'invalid_reply']);
export const InstanceRunLimitsSchema = z.strictObject({maxReplies:z.number().safe().nonnegative().optional()});
export const CallbackPauseSchema = z.strictObject({kind:z.literal('pause')});
```

### packages/contracts/src/core/types.ts

```ts
import type { z } from 'zod';
import type {
  InstanceIdSchema, CallIdSchema, InstanceSnapshotSchema,
  InstanceErrorSchema, RecordReadSchema, PauseReasonSchema, InstanceRunLimitsSchema, CallbackPauseSchema,
} from './schemas.ts';

export type InstanceId = z.infer<typeof InstanceIdSchema>;
export type CallId = z.infer<typeof CallIdSchema>;
export type InstanceSnapshot = z.infer<typeof InstanceSnapshotSchema>;
export type InstanceError = z.infer<typeof InstanceErrorSchema>;
export type InstanceFault = Extract<InstanceError, { kind: 'fault' }>;
export type RecordRead = z.infer<typeof RecordReadSchema>;
export type Outcome<T, E = InstanceError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

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

export type PortShape = { input: unknown; output: unknown };
export type PortCall<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; input: P[K]['input'] };
}[TableKeys<P>];
export type PortReturn<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; output: P[K]['output'] };
}[TableKeys<P>];
/** Correlate the entire argument, including when the port key is a union. */
export type IO<P extends { [K in keyof P]: PortShape }> = {
  call: <const A extends PortCall<P>>(call: A) => Promise<P[A['port']]['output']>;
};
export type PauseReason = z.infer<typeof PauseReasonSchema>;
export type CallbackPause = z.infer<typeof CallbackPauseSchema>;
export type CallbackReply<T> = {kind:'reply';value:T} | CallbackPause;
/** Host control only: never serialized into an Instance or sent to its program. */
export type CallbackControl = {signal:AbortSignal};
export type InstanceRunLimits = z.infer<typeof InstanceRunLimitsSchema>;
export type InstanceRunOptions = {limits?:InstanceRunLimits;signal?:AbortSignal};
export type PortBindings<P extends { [K in keyof P]: PortShape }> = FixedTable<P> & {
  [K in keyof P]?: (request:{instanceId:InstanceId;callId:CallId;input:P[K]['input']}, control:CallbackControl) => Promise<CallbackReply<P[K]['output']>>;
};
export type InstanceRunStop<P extends { [K in keyof P]: PortShape }, R> = {acceptedReplies:number} & (
  | {kind:'paused';reason:PauseReason;call:Extract<InstanceStop<P,R>,{kind:'call'}>;message?:string}
  | Extract<InstanceStop<P,R>,{kind:'done'|'fault'}>);
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
export type InstanceStop<P extends { [K in keyof P]: PortShape }, R> =
  | { kind: 'call'; callId: CallId; call: PortCall<P> }
  | { kind: 'done'; result: R }
  | { kind: 'fault'; error: InstanceFault };
/** A handle to one complete execution; no mutable heap or stack is exported. */
export type Instance<P extends { [K in keyof P]: PortShape }, R> = {
  readonly id: InstanceId;
  transfer: () => Promise<Outcome<Instance<P, R>>>;
  bind: (bindings: PortBindings<P> | null) => Promise<Outcome<void>>;
  run: (options?: InstanceRunOptions) => Promise<Outcome<InstanceRunStop<P, R>>>;
  inspect: () => Promise<Outcome<InstanceStop<P, R>>>;
  fork?: () => Promise<Outcome<Instance<P, R>>>;
  close: () => Promise<Outcome<void>>;
};
/** Bound to one admitted program; start runs to a stable stop before returning. */
export type Core<S, P extends { [K in keyof P]: PortShape }, R> = {
  start: (setup: S) => Promise<Outcome<Instance<P, R>>>;
};
/** Saves the complete execution including controlled SDK/device locals; no opaque host state. */
export type InstancePersistence<P extends { [K in keyof P]: PortShape }, R> = {
  save: (instance: Instance<P, R>) => Promise<Outcome<InstanceSnapshot>>;
  restore: (snapshot: InstanceSnapshot) => Promise<Outcome<Instance<P, R>>>;
  release: (snapshot: InstanceSnapshot) => Promise<Outcome<void>>;
};
export type InstanceRecord<S, P extends { [K in keyof P]: PortShape }, R> =
  | { sequence: number; kind: 'started'; setup: S }
  | { sequence: number; kind: 'called'; callId: CallId; call: PortCall<P> }
  | { sequence: number; kind: 'returned'; callId: CallId; reply: PortReturn<P> }
  | { sequence: number; kind: 'completed'; result: R }
  | { sequence: number; kind: 'faulted'; error: InstanceFault };
/** Provider-scoped audit authority, independent of transferable execution handles. */
export type InstanceCapture<S, P extends { [K in keyof P]: PortShape }, R> = {
  read: (instanceId: InstanceId, input: RecordRead) => Promise<Outcome<{
    records: InstanceRecord<S, P, R>[];
    next: number | null;
  }>>;
  release: (instanceId: InstanceId) => Promise<Outcome<void>>;
};
```

### packages/contracts/src/game/schemas.ts

```ts
import { z } from 'zod';

import { InstanceIdSchema, CallIdSchema } from '../core/schemas.ts';

export const DecisionIdSchema = z.strictObject({ instanceId: InstanceIdSchema, callId: CallIdSchema });
export const ChoiceIdSchema = z.string();
export const JsonValueSchema = z.json();
export const InputValidationSchema = z.discriminatedUnion('valid', [
  z.strictObject({ valid: z.literal(true) }),
  z.strictObject({ valid: z.literal(false), reason: z.string() }),
]);
export const InputOptionsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exact'), values: z.array(JsonValueSchema) }),
  z.strictObject({ kind: z.literal('construct'), description: JsonValueSchema }),
]);
export const GameErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rejected'), code: z.enum(['invalid_input', 'invalid_argument', 'decision_mismatch', 'choice_not_found', 'snapshot_incompatible']), message: z.string() }),
  z.strictObject({ kind: z.literal('conflict'), code: z.enum(['game_busy', 'game_closed', 'game_ended', 'view_unavailable']), message: z.string() }),
  z.strictObject({ kind: z.literal('unsupported'), code: z.literal('capability_unavailable'), message: z.string() }),
  z.strictObject({ kind: z.literal('fault'), code: z.enum(['invalid_output', 'program_failed', 'budget_exceeded']), message: z.string() }),
]);


export const GameRunLimitsSchema = z.strictObject({maxInputs:z.number().safe().nonnegative().optional()});
export const EventDeliveryIdSchema = z.strictObject({
  instanceId:InstanceIdSchema,
  callId:CallIdSchema,
  index:z.number().safe().nonnegative(),
});
```

### packages/contracts/src/game/types.ts

```ts
import type { z } from 'zod';
import type { FixedTable, TableKeys, Outcome, InstanceId, InstanceSnapshot, CallId, CallbackReply, CallbackControl, PauseReason } from '../core/types.ts';
import type { DecisionIdSchema, ChoiceIdSchema, GameErrorSchema, JsonValueSchema, InputValidationSchema, GameRunLimitsSchema, EventDeliveryIdSchema } from './schemas.ts';

export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type ChoiceId = z.infer<typeof ChoiceIdSchema>;
export type GameError = z.infer<typeof GameErrorSchema>;
export type JsonValue = z.infer<typeof JsonValueSchema>;
export type InputValidation = z.infer<typeof InputValidationSchema>;
export type GameOutcome<T> = Outcome<T, GameError>;
export type InputOptions<I extends JsonValue, D extends JsonValue = never> =
  | { kind: 'exact'; values: I[] }
  | ([D] extends [never] ? never : { kind: 'construct'; description: D });
/** One interaction's payload contract. Delivery data and session signals are separate. */
export type InteractionShape = { request: JsonValue; input: JsonValue; description: JsonValue };
export type InteractionTable = Record<string, InteractionShape>;
export type Choice<T extends InteractionTable, A> = {
  [K in TableKeys<T>]: { id: ChoiceId; actor: A; type: K; request: T[K]['request'] };
}[TableKeys<T>];
export type ChoiceInput<T extends InteractionTable> = {
  [K in TableKeys<T>]: { type: K; value: T[K]['input'] };
}[TableKeys<T>];
/** A pending choice is an actual game-declared input endpoint, not a query filter. */
export type GameBoundary<T extends InteractionTable, A, R> =
  | { kind: 'decision'; decisionId: DecisionId; choices: Choice<T, A>[] }
  | { kind: 'event'; callId: CallId }
  | { kind: 'ended'; result: R };
/** Session signals remain domain data; games with none use never. */
export type GameInput<T extends InteractionTable, D, S> =
  | { kind: 'choice'; choiceId: ChoiceId; input: ChoiceInput<T>; delivery: D }
  | ([S] extends [never] ? never : { kind: 'signal'; signal: S });
export type DescribeChoice<T extends InteractionTable> = {
  [K in TableKeys<T>]: { decisionId: DecisionId; choiceId: ChoiceId; type: K };
}[TableKeys<T>];
export type QueryShape = { input: unknown; output: unknown };
export type QueryCall<Q extends { [K in keyof Q]: QueryShape }> = {
  [K in TableKeys<Q>]: { name: K; args: Q[K]['input'] };
}[TableKeys<Q>];
/** An input endpoint and its complete payload options. */
export type DecisionOffer<T extends InteractionTable, A> = {
  [K in TableKeys<T>]: {
    choice:{id:ChoiceId;actor:A;type:K;request:T[K]['request']};
    options:InputOptions<T[K]['input'],T[K]['description']>;
  };
}[TableKeys<T>];
/** A policy selects a payload using one offer and its player observation. */
export type DecisionPolicy<T extends InteractionTable, A, V> = <const C extends DecisionOffer<T,A>>(
  offer:C, observation:V, control:CallbackControl
) => Promise<CallbackReply<T[C['choice']['type']]['input']>>;
export type GameRequest<T extends InteractionTable, A, V> = {
  decisionId:DecisionId;
  observation:V;
  offers:DecisionOffer<T,A>[];
  acceptsSignal:boolean;
};
export type EventDeliveryId = z.infer<typeof EventDeliveryIdSchema>;
export type EventDelivery<E> = {id:EventDeliveryId;event:E};
/** Callbacks registered for one game-defined player key. */
export type GameBindings<T extends InteractionTable, A, D, S, Player extends string, V, E> = {
  player:Player;
  onDecision?: (request:GameRequest<T,A,V>, control:CallbackControl & {player:Player}) => Promise<CallbackReply<GameInput<T,D,S>>>;
  onEvent?: (delivery:EventDelivery<E>, control:CallbackControl & {player:Player}) => Promise<CallbackReply<null>>;
};
export type GameRunLimits = z.infer<typeof GameRunLimitsSchema>;
export type GameRunOptions = {limits?:GameRunLimits;signal?:AbortSignal};
export type GameRunStop<T extends InteractionTable, A, R> = {acceptedInputs:number} & (
  | {kind:'paused';reason:PauseReason;boundary:Exclude<GameBoundary<T,A,R>,{kind:'ended'}>;message?:string}
  | {kind:'ended';result:R}
  | {kind:'fault';error:Extract<GameError,{kind:'fault'}>});
/** Exclusive outer facade of one Instance; no separate mutable game/service state. */
export type BaseGame<T extends InteractionTable, A, D, S, Player extends string, V, E, R, Q extends { [K in keyof Q]: QueryShape }> = FixedTable<T> & FixedTable<Q> & {
  readonly id: InstanceId;
  bind: (bindings: GameBindings<T,A,D,S,Player,V,E> | null) => Promise<GameOutcome<void>>;
  run: (options?: GameRunOptions) => Promise<GameOutcome<GameRunStop<T,A,R>>>;
  inspect: () => Promise<GameOutcome<GameBoundary<T, A, R>>>;
  observe: (input: { player: Player }) => Promise<GameOutcome<V>>;
  describe: <const C extends DescribeChoice<T>>(input: C) => Promise<GameOutcome<InputOptions<T[C['type']]['input'], T[C['type']]['description']>>>;
  validate: (input: { player: Player; decisionId: DecisionId; input: GameInput<T, D, S> }) => Promise<GameOutcome<InputValidation>>;
  query: <const C extends QueryCall<Q>>(call: C) => Promise<GameOutcome<Q[C['name']]['output']>>;
  fork?: () => Promise<GameOutcome<BaseGame<T, A, D, S, Player, V, E, R, Q>>>;
  save?: () => Promise<GameOutcome<InstanceSnapshot>>;
  close: () => Promise<GameOutcome<void>>;
};
/** Neutral search operations: the caller owns algorithms, actors and value meanings. */
export type StateTransition<S, I, V> = {
  inspect: (state: S) => Promise<V>;
  transition: (input: { state: S; input: I }) => Promise<{ state: S; view: V }>;
};
export type StateResources<S> = { release: (states: S[]) => Promise<void> };
export type StateConstruction<S, C, E, R> = { construct: (input: { source: S; config: C; entropy: E }) => Promise<R> };
export type Evaluation<S, C, V> = { evaluate: (input: { source: S; config: C }) => Promise<V> };
export type Encoding<S, E> = { encode: (source: S) => Promise<E> };
export type FactExtraction<S, C, F> = { extract: (input: { source: S; config: C }) => Promise<F[]> };
export type GameHistory<Setup, Configuration, Input, Update> = {
  setup: Setup;
  configuration: Configuration;
  initial: Update;
  transitions: { input: Input; output: Update }[];
};
```

### packages/contracts/src/runtime/schemas.ts

```ts
import { z } from 'zod';
export const CompiledProgramDataSchema = z.strictObject({
  kind: z.literal('controlled-program'),
  content: z.instanceof(Uint8Array),
});
```

### packages/contracts/src/runtime/types.ts

```ts
import type { z } from 'zod';
import type { Core, ProgramModule, PortShape, FixedTable, InstancePersistence, InstanceCapture, Instance, Outcome } from '../core/types.ts';
import type { BaseGame, QueryShape, GameOutcome } from '../game/types.ts';
import type { GameContract, GameTypes } from '../authoring/types.ts';
import type { CompiledProgramDataSchema } from './schemas.ts';

declare const programWitness: unique symbol;
export type CompiledProgram<S, P extends { [K in keyof P]: PortShape }, R> =
  z.infer<typeof CompiledProgramDataSchema> & FixedTable<P> & {
    readonly [programWitness]: (types: { setup: S; ports: P; result: R }) => { setup: S; ports: P; result: R };
  };
export type LoadedCore<S, P extends { [K in keyof P]: PortShape }, R> = {
  core: Core<S, P, R>;
  persistence?: InstancePersistence<P, R>;
  capture?: InstanceCapture<S, P, R>;
};
export type ControlledCoreLoader = {
  load: <S, P extends { [K in keyof P]: PortShape }, R>(program: CompiledProgram<S, P, R>) => Promise<Outcome<LoadedCore<S, P, R>>>;
};
/** Differential execution uses the same author source, without claiming continuation snapshots. */
export type NativeCoreLoader = {
  load: <S, P extends { [K in keyof P]: PortShape }, R>(program: ProgramModule<S, P, R>) => Promise<Outcome<LoadedCore<S, P, R>>>;
};
export type GameHandle<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = BaseGame<
  G['interactions'], G['actor'], G['delivery'], G['signal'], G['player'], G['observation'], G['playerEvent'], G['result'], Q
>;
/** Transfers exclusive driving authority; does not start another program or own services. */
export type BaseGameBinder = {
  bind: <G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }>(input: {
    instance: Instance<G['ports'], G['programResult']>;
    contract: GameContract<G, Q>;
    persistence?: InstancePersistence<G['ports'], G['programResult']>;
  }) => Promise<GameOutcome<GameHandle<G, Q>>>;
};
```
