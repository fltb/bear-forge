# Instance 两侧游戏协议：迁移与条件证明

本轮交付公共协议、内侧斗地主 SDK/程序、类型消费与原生测试。没有生产执行器、保存/分支实现或搜索器。以下证明针对协议表达和组合；运行实现必须满足列明的前提，不能由导出数量或 TS 编译通过推出。

## 固定边界与字段映射

| 需求 | 当前表达 | 证据 |
| --- | --- | --- |
| 唯一完整运行态 | Instance 包含调用现场、SDK 闭包、对象图和输入记录 | core/types、controlled-program-spec 与下述 P1/P4 |
| 内外 SDK 共享约定 | GameModule={program,contract}，GameSDK 映射声明端口 | authoring/types、斗地主 program/sdk/implementation |
| 必須持有实际 Instance | binder.bind({instance,contract,persistence?}) | runtime/types；无启动第二套程序的 factory |
| 同类型分支 | Instance.fork→Instance；BaseGame.fork→BaseGame | instance-types/basegame-types 正向消费 |
| 统一读取 | inspect/observe/describe/validate/query 只读自身绑定现场 | 类型反例拒绝旧 target/branching |
| 保存恢复 | save→InstanceSnapshot，provider.restore→Instance→bind | actualBinding 类型消费者 |
| 直接运行 | 无 fork/save 仍能符合 BaseGame | directPlay 消费者 |
| 多席位与同时等待 | 多 Choice；内侧保存尚未完成的阶段 | 斗地主私有加倍及剩余入口测试 |
| 合法动作 | exact 或 construct；delivery/signal 单列 | 全对局合法载荷测试、关联类型反例 |
| 内侧随机状态 | ProgramSetup.seed→program 内 createSDK 的闭包 | 并行/顺序完整轨迹一致及独立 seed 用例 |
| 搜索 | fork/read/submit/close，调用方拥有遍历/评价 | walk 递归类型消费者；不引入运行实现 |
| 数据与训练 | 真实边界/事件/结果，策略与分析在调用方 | R05–R08 保留；无第二套规则 |

## P1：表达力不因边界收敛而减少

令程序现场 C=(控制栈、环境、堆、受控能力引用、待决调用、记录前缀)。内部归约是 C→C'；外部调用暂停为 Wait(k,p,a)，回复 v 后继续 k(v)。声明端口 IO.call 表达 Wait，Instance.resume 表达提供 v。语言内部递归、循环与数据构造仍使用受控 TS，不要求新增游戏原子。

对有限的可计算交互程序，逐步把外部读取换成声明端口即可构造同轨迹程序；内部纯计算和受控局部状态保持原样。GameSDK 只是普通函数组合，加入它不改变此归约关系。游戏阶段、优先权、响应栈和触发队列可以是任意内部计算，不进入 Core。

前提：执行器对准入 TS 子集语义保持；实例堆完整；外部值通过声明 schema 检验；预算允许所讨论的有限轨迹。此命题不保证任意程序终止或有限资源可以计算无限轨迹。

## P2：外侧没有第二套状态机

对当前稳定 InstanceStop x 定义纯投影 π(x)：call 用相应 receive 得到 view/choices；done 用 finish 得到终局。所有 observe/describe/query/respond 都只依赖 π(x) 和本次参数。DecisionId=(Instance.id,callId)，无需额外可变映射。

因此外侧所需数据可以从 x 与静态 contract 重建。删除全部缓存后重新绑定，观察、合法选项和输入转换不变。若某实现还必须恢复一个宿主随机游标、已提交玩家列表或隐藏事件计数才能继续，它就是这一条的反例，不能声称符合协议。

submit 的唯一状态推进是 Instance.resume：先匹配凭证与 choice，调用纯 respond，拒绝时不 resume；成功时将唯一 reply 送入原实例。后续 event 的 receive/output 也是静态纯函数，持续驱动到下一游戏边界。因此一个游戏步是原程序轨迹的一个片段，并非第二个 transition 实现。

前提：contract 纯且输入/输出隔离；绑定独占驱动权。TS 的 readonly 与类型兼容性不证明纯性或所有权，后端和准入检查必须落实。

## P3：输入、读取和交互覆盖

任意需要外部输入的游戏边界可编码为 decision 端口的请求与回复；不需要外部选择的通知可编码为 event；结果编码为程序返回。decision 是输入边界，不强制对应人类玩家：signal 可承载游戏声明的外部事件，choices 可为空。可计算设备行为放在内侧库；不可计算的现实输入仍显式提供。

多个玩家的等待通过 choices 表达；每次被接受的部分输入进入 Instance，程序发布剩余 choices。封存及先后顺序属于内侧状态；外侧不得先把输入藏在宿主变量中。有限合法载荷使用 exact；无法有限列举的载荷使用 construct 描述，由游戏调用方解释。不宣称存在自动解任意约束的通用生成器。

校验和动作选择不同：exact 不承诺任何 delivery 都有效；validate/submit 检验完整输入。Choice.type、request、input.value 与 query.name/args 的关联由映射联合类型维持。内侧规则重新校验返回，不把外侧预检作为可信规则状态。

## P4：分支双模拟与恢复充分性

令 C₁≈C₂ 表示程序/受控数据与挂起位置相同，仅实例身份及能力重绑定不同。完整 fork 复制 C 并隔离可变对象；受控 IO 能力在子实例重绑定，不能指向父实例的可变执行器。于是父 C 与子 C' 满足 ≈。

基础步：内部计算在等价堆和环境上产生等价后继。外部步：相同声明调用参数与相同未来回复产生等价后继。按步数归纳得到相同领域轨迹；输入身份字段按新 InstanceId 重命名。父凭证因 instanceId 不匹配被拒绝。

结合 P2，π(C) 与 π(C') 的领域观察、合法动作和结果一致；外侧 fork 只需要给 C' 绑定相同 contract。故 child.submit 与 parent.submit 使用相同规则，分支不是另一种游戏对象。分支失败仅清理子资源。

保存序列化同一个 C，恢复重建满足 ≈ 的 C'，因此不需要 BaseGame 补存状态。保存包含原等待点，恢复不重放已执行的输入/效果。IO 能力、程序身份和快照引用由提供者验证，不把任意宿主指针当可恢复对象。

当前只有 InstanceSnapshot 引用协议和同类型 fork 声明。完整复制、闭包恢复、记录前缀、能力重绑定及失败隔离仍是 C02 的真实运行验收前提，本轮没有用 JSON 克隆伪造该证明。

## P5：搜索接口闭合

节点 N 是普通 BaseGame。读取 N 得到边界、观察和候选；N.fork 得到同类型 N'；N'.submit 后 N' 仍为同类型；close 释放分支。归纳得任意有限深度的树遍历无需新节点运行类型或不同的游戏转移函数。

DFS 改变访问顺序；alpha-beta 另外提供满足算法条件的对抗价值与界；MCTS 另外提供选择/评估/回传和随机策略。协议只证明这些算法可以控制相同执行操作，不保证所有游戏都满足 alpha-beta 的博弈假设，也不把克隆同一随机流误当独立采样。隐藏世界构造、chance 分布、独立试验种子属于显式游戏/搜索配置，不能穿透 Instance 修改私有状态。

walk 类型示例确实在 fork 后读取子凭证，再 validate/submit/递归/close。它是可编译调用方，不是生产搜索效果证据。directPlay 验证没有分支能力也可运行。

## P6：原生、受控、训练与实战路径一致

原生测试直接执行与受控编译相同的 Program.run。给定相同 setup 和端口回复，语义保持的受控执行按 P1 得到相同轨迹。内侧伪随机 seed 是 setup 一部分，闭包在每局 run 内创建，所以不会共享宿主随机游标。

输入提供者不出现在规则计算中。真人、脚本、模型、搜索只改变输入选择；相同有效回复得到同一规则轨迹。原生侧已经实际验证；受控侧尚未实现，不能宣称双端 diff test 已经通过。

## P7：事件和资源不成为隐藏规则状态

发布游标、待公开选择与规则日志属于内侧；外侧只是返回本次推进得到的 events。读取或重新绑定可以得到同一边界数据，但不会自动发送外部通知。会话交付游标与回执由消费者保存，并以实例/记录身份去重。它们不影响规则是否能够从快照继续。

fork/save 不重放事件；restore 从原挂起点继续。关闭父实例不影响子实例或保存引用；释放保存引用不影响已恢复实例。外侧绑定失败关闭已接管实例，子绑定失败不影响父。独占权、故障清理及资源生命周期须运行验收。

## 斗地主真实路径

启动参数为 ProgramSetup={game:Setup,seed:uint32}。program.ts 创建 SDK；sdk.ts 的 random 局部更新用于洗牌，返回的 deal/decision 闭包与 state、published 同属于 Instance。SDK.decision 封装输入端口，请求 Frame、回复 Input；SDK.event 封装事件端口，发送 AuditEvent[]、回复 null。published 在事件确认后推进，再发布 events 为空的决策或终局 Frame，避免重复发送。

implementation.ts 导出 {program,contract}。receive 投影 Frame；respond 从当前 Frame 与提交构造 Input，用同一 validateInput 预检；内侧 apply 再验证并更新局部 state。外侧观察按席位隐藏手牌、底牌和未公开加倍；程序 return Frame 的 state.result 是唯一终局来源。

完整规则文件 rules.ts、patterns.ts、独立 oracle.ts 与规则测试保持原哈希。完整对局、重新发牌、全部超时默认、规范动作编码、私有同时选择、计分与席位观察仍实际运行；新增用例明确验证明确的 decision/event 外部端口、显式 seed 和内侧随机流隔离。修改原生接线不等于实现 Core。

## 原 15 个压力场景

| 场景 | 表达及所属状态 |
| --- | --- |
| 同点双分支 | Instance.fork；父子 BaseGame 同类型 |
| 触发来源死亡 | 对象 ID、触发记录留在内侧堆 |
| 多恢复点接续 | 保存控制栈、闭包与待决调用 |
| 恢复后再分支 | restore→Instance→bind→fork |
| 私密选择分支 | 内侧封存，外侧纯可见投影 |
| 死亡目标 | respond/apply 同一规则拒绝 |
| 错人、错类型、非法数量 | 会话权限、关联输入类型与内侧规则 |
| 重复或过期请求 | 当前 InstanceId/callId 校验 |
| 错分支凭证 | fork 新 InstanceId；旧凭证不匹配 |
| 同名对象重新进场 | 内侧实例 ID 与卡名分离 |
| 相同场面不同控制流 | 保存完整现场，不由 view 猜 PC |
| 提交中故障 | Instance fault/close；不能保存半现场 |
| 触发内部恢复 | 精确等待点继续，不重跑前半段 |
| 反制跳过内部选择 | 程序条件控制流决定是否调用端口 |
| 条件尾部跳过 | 普通内侧分支，不加 Core 领域规则 |

## 验证范围和未完成项

类型消费、schema 准入、实际原生对局、独立规则 oracle、源码边界审计和导出索引是本轮证据。生产受控编译、准入完备检查、Instance fork/save/restore、绑定独占权、失败清理和实际双端 diff test 仍由 C02/C03 验收。协议表达力证明以上述具体前提为条件，没有声称证明任意实现无 bug。

## P8：回调控制与手动驱动等价

Instance.bind 只注册外部回调；run 在当前 call 查表，将参数复制给对应回调，接受 reply.value 时调用与 resume 相同的原子返回操作。因此去掉宿主等待时长后，给定相同被接受的回复序列，回调驱动与手动 resume 的程序轨迹相同。BaseGame 回调只额外进行纯请求投影、输入验证/编码和事件交付；同样的 GameInput 经 submit 与 onDecision 得到同一个底层 reply。

活动驱动持有租约，回调结果携带隐含的 (Instance.id,callId,驱动代次) 归属。返回接受、取消撤销和新驱动登记按一个串行顺序提交；只有仍拥有当前租约且匹配当前 call 的返回能够生效。因此即使旧 Promise 不响应取消、在新 run 或 fork 后才完成，也不能推进其他现场。绑定表与租约属于宿主控制，不是必须保存的游戏数据；fork/restore 丢弃它们并保留受控待决调用。

拒绝、pause、限额和回调异常都不接受回复，故不改变待决现场；acceptedReplies/acceptedInputs 只在接受线性化点增加。完成先于限额检查；取消先于发起下一回调。程序故障另进入 fault，不能用 paused 掩盖。实际租约实现、并发取消竞争和错误清理由后续 runtime 的反例验收落实，本轮不声称已经执行这些状态机。

## P9：控制边界与事件交付闭合

每次外部调用只有两类游戏角色：decision 或 event；程序结束为 ended。加入 event 边界后，回调抛错、主动 pause、取消发生于输出确认处也有合法可表达状态，不再强迫协议虚构一个玩家决策。事件没有 view 时，observe/query 明确拒绝 view_unavailable，而非读取一份外侧隐含旧状态。

回调在稳定等待时允许只读、fork/save，所以搜索可在 onDecision 内建立子实例，重新绑定搜索回调，使用 run 限额或手动 submit 控制深度。父回调的驱动租约继续保护父现场，子驱动互不影响。run(maxInputs:0) 可经过事件确认停在决策；单次输入或任意有限输入预算均不必调用底层端口。

事件 delivery id 从 Instance 身份、当前 call/done 和纯事件数组下标计算，不依赖外侧隐藏游标。部分交付后失败允许以同 id 重投，消费方去重；这明确是可重试协议，不假装实现网络恰好一次。前端动画或慢消费者不得成为游戏规则时钟。Core 捕捉实际调用与被接受的确认，原生斗地主测试验证全部事件通过 event 端口传出且与规则事件序列完全一致。

## P10：多玩家与策略接入

GameRequest 的 offers 从当前真实 choices 构造。每个 offer.observation=observe(view,observerFor(actor))，options 来自相应入口的 describe，类型上 input/request/options 保持关联。DecisionPolicy 只接收一个 actor 的 offer，输出该模板的动作载荷；可信路由器才拥有整批 offers、delivery/signal 的构造以及回调绑定权。不能把整批私密观察直接传给某个玩家模型。

多个入口的回答顺序由输入提供者和内侧规则决定，通用运行器不假定轮流、最小席位优先或零和。第一次被接受的输入进入 Instance，剩余选择由内侧程序重新发布；其他旧回调的迟到结果不能用旧凭证继续提交。封存记录、输入进度与规则期限留在程序内，策略记忆与网络回执留在调用方。

## 反例与验收定位

| 缺口反例 | 固定约束 / 当前证据 |
| --- | --- |
| bind 时立即触发用户回调 | bind 是无执行注册；协议法则，runtime 待验收 |
| 错端口返回混入程序 | 关联 PortBindings/CallbackReply 类型负例及端口输出 schema |
| undefined 被当成“等待” | 必须显式 reply/pause，类型负例 |
| 事件回调失败却只有 decision/ended 可表示 | GameBoundary.event 与 GameRunStop.paused |
| 旧异步返回回答子分支 | 租约归属与未绑定 fork/restore 法则 |
| onDecision 内搜索必须穿透 Core | callbackPlay + walk 类型消费，BaseGame.run 输入限额 |
| 真人/模型拿到其他玩家观察 | DecisionPolicy 单 offer 边界；可信路由器分发，原生观察隐私测试 |
| 主动 emit 从未实际经过协议 | 斗地主 SDK.event 与全部原生完整对局事件序列测试 |
| submit 和回调运行两份规则 | 两者均委托 Instance 返回接受路径；协议证明，生产驱动仍待实现 |

## P11：适配器所有权可由公开协议实现

BaseGameBinder 通过 Instance.transfer 获取同一实例的新句柄，旧句柄失去操作权。transfer 不复制现场、不启动执行，并清除宿主绑定；它只改变宿主控制权。随后 BaseGame 的端口适配仅通过新句柄 bind/run/resume/fork/save。故独占绑定不依赖未声明的私有引擎函数或在适配器中伪造全局锁。活动 run 时 transfer 被拒绝，不能劫持在途回调；fork 与 transfer 区别为独立新运行态和同运行态的控制权移动。实际失效旧句柄由 provider 验收，不由 TypeScript 静态类型冒充保证。

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
  observer: unknown;
  observation: unknown;
  event: unknown;
  result: unknown;
};
export type Submission<G extends GameTypes> = GameInput<G['interactions'], G['delivery'], G['signal']>;
export type DecisionData<G extends GameTypes> = {
  view: G['view'];
  choices: Choice<G['interactions'], G['actor']>[];
  events: G['event'][];
};
export type TerminalData<G extends GameTypes> = {
  view: G['view'];
  result: G['result'];
  events: G['event'][];
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
        respond: (view: ReadView<G['view']>, input: ReadView<Submission<G>>) => PreparedReturn<G['ports'][K]['output']>;
      };
};
export type GameSchemas<G extends GameTypes> = FixedTable<G['interactions']> & {
  [K in 'view' | 'actor' | 'delivery' | 'signal' | 'observer' | 'observation' | 'event' | 'result']: z.ZodType<G[K]>;
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
  observerFor: (actor: ReadView<G['actor']>) => G['observer'];
  observe: (view: ReadView<G['view']>, observer: ReadView<G['observer']>) => G['observation'];
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
    code: z.enum(['invalid_input', 'invalid_argument', 'call_mismatch', 'snapshot_not_found', 'snapshot_incompatible']),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal('conflict'),
    code: z.enum(['instance_busy', 'instance_closed', 'instance_finished', 'instance_owned']),
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
  resume: (input: { callId: CallId; reply: PortReturn<P> }) => Promise<Outcome<InstanceStop<P, R>>>;
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
export type InstanceCapture<S, P extends { [K in keyof P]: PortShape }, R> = {
  read: (instance: Instance<P, R>, input: RecordRead) => Promise<Outcome<{
    records: InstanceRecord<S, P, R>[];
    next: number | null;
  }>>;
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
  z.strictObject({ kind: z.literal('rejected'), code: z.enum(['invalid_input', 'invalid_argument', 'decision_mismatch', 'choice_not_found', 'snapshot_not_found', 'snapshot_incompatible']), message: z.string() }),
  z.strictObject({ kind: z.literal('conflict'), code: z.enum(['game_busy', 'game_closed', 'game_ended', 'view_unavailable']), message: z.string() }),
  z.strictObject({ kind: z.literal('unsupported'), code: z.literal('capability_unavailable'), message: z.string() }),
  z.strictObject({ kind: z.literal('fault'), code: z.enum(['invalid_output', 'program_failed', 'budget_exceeded']), message: z.string() }),
]);


export const GameRunLimitsSchema = z.strictObject({maxInputs:z.number().safe().nonnegative().optional()});
export const EventDeliveryIdSchema = z.strictObject({
  instanceId:InstanceIdSchema,
  origin:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('call'),callId:CallIdSchema}),
    z.strictObject({kind:z.literal('done')}),
  ]),
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
export type GameUpdate<T extends InteractionTable, A, E, R> = {
  boundary: GameBoundary<T, A, R>;
  events: E[];
};
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
/** Each offer is already projected for its actor; the whole batch belongs to a trusted router. */
export type DecisionOffer<T extends InteractionTable, A, V> = {
  [K in TableKeys<T>]: {
    choice:{id:ChoiceId;actor:A;type:K;request:T[K]['request']};
    observation:V;
    options:InputOptions<T[K]['input'],T[K]['description']>;
  };
}[TableKeys<T>];
/** A policy receives one actor's offer, never a batch of other actors' observations. */
export type DecisionPolicy<T extends InteractionTable, A, V> = <const C extends DecisionOffer<T,A,V>>(
  offer:C, control:CallbackControl
) => Promise<CallbackReply<T[C['choice']['type']]['input']>>;
export type GameRequest<T extends InteractionTable, A, V> = {decisionId:DecisionId;offers:DecisionOffer<T,A,V>[]};
export type EventDeliveryId = z.infer<typeof EventDeliveryIdSchema>;
export type EventDelivery<E> = {id:EventDeliveryId;event:E};
/** Host routing callbacks, not code or state injected into the controlled program. */
export type GameBindings<T extends InteractionTable, A, D, S, V, E> = {
  onDecision?: (request:GameRequest<T,A,V>, control:CallbackControl) => Promise<CallbackReply<GameInput<T,D,S>>>;
  onEvent?: (delivery:EventDelivery<E>, control:CallbackControl) => Promise<CallbackReply<null>>;
};
export type GameRunLimits = z.infer<typeof GameRunLimitsSchema>;
export type GameRunOptions = {limits?:GameRunLimits;signal?:AbortSignal};
export type GameRunStop<T extends InteractionTable, A, R> = {acceptedInputs:number} & (
  | {kind:'paused';reason:PauseReason;boundary:GameBoundary<T,A,R>;message?:string}
  | {kind:'ended';result:R}
  | {kind:'fault';error:Extract<GameError,{kind:'fault'}>});
/** Exclusive outer facade of one Instance; no separate mutable game/service state. */
export type BaseGame<T extends InteractionTable, A, D, S, O, V, E, R, Q extends { [K in keyof Q]: QueryShape }> = FixedTable<T> & FixedTable<Q> & {
  readonly id: InstanceId;
  bind: (bindings: GameBindings<T,A,D,S,V,E> | null) => Promise<GameOutcome<void>>;
  run: (options?: GameRunOptions) => Promise<GameOutcome<GameRunStop<T,A,R>>>;
  inspect: () => Promise<GameOutcome<GameBoundary<T, A, R>>>;
  submit: (input: { decisionId: DecisionId; input: GameInput<T, D, S> }) => Promise<GameOutcome<GameUpdate<T, A, E, R>>>;
  observe: (input: { observer: O }) => Promise<GameOutcome<V>>;
  describe: <const C extends DescribeChoice<T>>(input: C) => Promise<GameOutcome<InputOptions<T[C['type']]['input'], T[C['type']]['description']>>>;
  validate: (input: { decisionId: DecisionId; input: GameInput<T, D, S> }) => Promise<GameOutcome<InputValidation>>;
  query: <const C extends QueryCall<Q>>(call: C) => Promise<GameOutcome<Q[C['name']]['output']>>;
  fork?: () => Promise<GameOutcome<BaseGame<T, A, D, S, O, V, E, R, Q>>>;
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
import type { Core, ProgramModule, PortShape, FixedTable, InstancePersistence, InstanceCapture, Instance } from '../core/types.ts';
import type { BaseGame, QueryShape, GameOutcome, GameUpdate } from '../game/types.ts';
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
  load: <S, P extends { [K in keyof P]: PortShape }, R>(program: CompiledProgram<S, P, R>) => Promise<LoadedCore<S, P, R>>;
};
/** Differential execution uses the same author source, without claiming continuation snapshots. */
export type NativeCoreLoader = {
  load: <S, P extends { [K in keyof P]: PortShape }, R>(program: ProgramModule<S, P, R>) => Promise<LoadedCore<S, P, R>>;
};
export type GameHandle<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = BaseGame<
  G['interactions'], G['actor'], G['delivery'], G['signal'], G['observer'], G['observation'], G['event'], G['result'], Q
>;
/** Transfers exclusive driving authority; does not start another program or own services. */
export type BaseGameBinder = {
  bind: <G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }>(input: {
    instance: Instance<G['ports'], G['programResult']>;
    contract: GameContract<G, Q>;
    persistence?: InstancePersistence<G['ports'], G['programResult']>;
  }) => Promise<GameOutcome<{
    game: GameHandle<G, Q>;
    initial: GameUpdate<G['interactions'], G['actor'], G['event'], G['result']>;
  }>>;
};
```
