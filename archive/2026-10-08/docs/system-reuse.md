# 全系统复用、接口与实现量评估

日期：2026-10-08。基于官方文档与项目说明的设计评估，未安装或跑通集成，未锁定依赖版本。服从 [当前执行契约](../spec/runtime-contract.md)。工程量是范围估计，不是实测、报价或训练效果承诺。

## 1. 结论与交付范围

自有系统应是游戏契约、策略/实验编排和证据分析的集成层，不应自研语言、RL 框架、数据引擎、程序演化平台或图布局算法。

但已有项目不能自动提供游戏的观察权限、组合动作协议、合法构筑、卡牌机会分母、假设世界生成、干预语义和独立评测设计。这些仍由游戏作者与本系统共同实现。现成算法不自动赋予卡牌关系因果含义。

分开三个交付级别：

1. 最小闭环：一个游戏、固定脚本种群、批量对局、条件胜负矩阵、一类明确的卡牌替换实验、证据链接。先无需神经网络或玩家搜索。
2. 可复用本地平台：受控 TS 游戏入口、决策快照、策略版本与记忆隔离、可恢复任务、游戏分析契约和可筛选关系图。
3. 增量能力：自动脚本演化、模型训练/合批推理、受限模拟搜索；分别验收，不同时变成首版前置。

## 2. 全链路替代矩阵

表中的“不能替代”是本次查阅材料未提供我们的端到端契约，不声称项目永远无法扩展到该能力。

| 模块 | 可复用项目/设施 | 能替代的工作 | 仍需自有实现 | 建议 |
| --- | --- | --- | --- | --- |
| TS 构建与依赖检查 | TypeScript、esbuild、ESLint | 类型检查、打包、依赖图、静态规则基础设施 | 白名单传递闭包、禁止动态绕过、规则产物版本、能力检查 | 首版复用；不自研控制流编译器 |
| 规则执行与快照 | quickjs-wasi / JS-Interpreter | JS 语义、堆/控制状态、已有快照设施 | 决策等待桥接、随机/时间入口、宿主重绑定、隔离与故障处理 | 二选一后端，尚未选定 |
| 现有游戏规则 | RLCard / OpenSpiel | 已有游戏实现、部分基线与编码 | 规则版本核对、环境适配、领域事件、可用快照能力声明 | 可直接作为独立 GameAdapter，不强制重写 TS |
| 会话与真人入口 | boardgame.io 候选；或薄会话服务 | 回合制游戏的状态、多人同步、日志等基础设施 | 与自身规则状态机的所有权划分、ticket、权限投影、时间输入 | 暂不叠加第二套游戏调度；真人 UI 后置 |
| 多策略环境协议 | PettingZoo AEC；单人可用 Gymnasium | 标准环境接口及生态兼容 | TS/Python 桥、变长动作、逐 actor 奖励归集、隐藏信息 | 训练阶段加适配，不让 Python API 进入 core |
| 多策略学习与采样 | Tianshou 或 RLlib | RL 算法、采样/缓存、策略管理等 | 自定义编码/分布、脚本桥、版本固定、特殊轨迹边界 | 本地先评估 Tianshou；需要 RLlib 管理能力时替换，不双用 |
| 神经网络 | PyTorch 标准 Transformer 组件 | 自动微分、优化器、网络基础层 | 游戏编码、自回归动作分布、价值头、batch 与缓存管理 | 不设计新网络基底 |
| 局外脚本演化 | ShinkaEvolve | 程序候选生成、演化循环、评价调度与存档 | Policy 打包、权限运行、对手/规则冻结、评价反馈与总预算 | 可选增量，不把其优化指标当设计结论 |
| 构筑/参数候选 | Optuna；多样性搜索可用 pyribs | 参数搜索、质量多样性档案及 ask/tell 流程 | 合法构筑生成/修复、行为描述符、生态评价 | 有需求时选一个主导候选流程 |
| 对局任务执行 | 本机进程池；以后可用 Ray | 并行、进程生命周期等通用执行机制 | 规则×构筑×策略×座次×种子的任务设计、去重、失败重试 | 首版单机，无集群控制面 |
| 策略生态分析 | OpenSpiel Alpha-Rank 等 | 从收益表估计策略生态结构/排名 | 收益估计、置信度、未知项、分布条件、卡牌归因 | 可复用数值算法，不自研同类算法 |
| 事实与统计存储 | Parquet + DuckDB | 列式存储、查询、聚合 | event schema、机会分母、实验血缘、配对关系、分支去重 | 首版使用 |
| 运行与模型追踪 | MLflow | 参数、指标、权重/文件及运行比较 | 规则/策略/数据身份关联、事件索引 | 可选；不作为逐决策日志数据库 |
| 图与证据 UI | Cytoscape.js | 图展示、布局、交互 | 关系含义、条件筛选、置信与冷区显示、证据详情 | 直接复用；先无需图数据库 |
| 玩家模拟/搜索 | OpenSpiel 搜索算法可作候选 | 满足接口前提时的搜索算法 | 合法信息到假设世界、受限句柄、对手视角、预算 | 游戏适配最重，不承诺“接 MCTS 即通用” |

### 证据与限制

- [esbuild API](https://esbuild.github.io/api/#metafile) 提供构建元信息。工程判断：用依赖图辅助白名单检查，但静态检查不构成安全沙箱；运行时仍只暴露声明能力。动态加载和构建插件也要纳入构建信任范围。
- [quickjs-wasi](https://github.com/vercel-labs/quickjs-wasi) 明确提供 VM 快照/恢复及待决 Promise 保存，宿主回调按名称重新绑定。这符合候选方向，不等于已经证明我们的 SDK/宿主状态完整恢复。不能把 Vercel Labs 项目与已验证生产适配混为一谈。JS-Interpreter 证据见 [原选型记录](engine-reuse.md)。
- [RLCard 游戏说明](https://rlcard.org/games.html) 已有扑克、斗地主等实现，但文档所述斗地主用启发式指定地主，且有动作抽象。应核对所选提交的实际规则，不能称为完整目标版本的直接替代。
- [boardgame.io](https://boardgame.io/) 提供回合制、多人、状态同步等能力。它可用于整个游戏包，不能仅因为提供多人功能就与另一个规则调度器并行控制同一局。
- [PettingZoo AEC](https://github.com/Farama-Foundation/PettingZoo/blob/main/docs/api/aec.md) 提供按行动者推进的接口和 action mask 约定。它不等于序列化整个 TS 续延，也不会自动解决我们的结构化动作和事件语义。
- [Tianshou 多智能体文档](https://tianshou.org/en/latest/02_deep_dives/L6_MARL.html) 给出学习策略与固定随机策略共存示例。[RLlib](https://docs.ray.io/en/latest/rllib/multi-agent-envs.html) 有 agent→policy 映射与 policies_to_train；其当前文档仍提示多智能体环境向量化限制。因此不能仅凭“支持多智能体”推断单卡合批吞吐已满足。
- [ShinkaEvolve](https://github.com/SakanaAI/ShinkaEvolve) 已实现 LLM 程序演化与候选评价基础设施。我们的游戏评价器、权限隔离、独立对手和现金预算仍需提供。
- [pyribs](https://docs.pyribs.org/en/stable/) 提供 archive/emitter/scheduler，适合编码后的构筑/参数空间。任意 TS 程序不是其数值向量空间的直接替代品；不要与 ShinkaEvolve 重复掌管同一份候选生命周期。[Optuna](https://optuna.readthedocs.io/en/stable/faq.html) 可处理参数优化，但不负责博弈生态；其多进程存储也需按官方建议选择。
- [OpenSpiel Alpha-Rank](https://openspiel.readthedocs.io/en/stable/alpha_rank.html) 可直接接收益矩阵/张量，支持多种群。策略收益表可用，卡牌共现矩阵不可直接当作同一输入；空白对局不是 0 胜率。单人游戏采用场景表现比较，不强套对抗排名。
- [DuckDB Parquet](https://duckdb.org/docs/extensions/parquet)、[MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)、[Cytoscape.js](https://js.cytoscape.org/) 分别承担查询、运行追踪、展示。推断统计与卡牌关系定义仍属于我们。

## 3. 建议的组合与数据流

首版只使用：TS 构建工具 + 一个现成执行后端 + 本地 worker + 固定脚本 + DuckDB/Parquet + Cytoscape.js。现成游戏也可先独立接环境适配层，但不因此声称已实现 TS 作者运行时。

```text
                  实验清单 / 预算 / 冻结策略库
                              │
                       本地 ExperimentRunner
                              │
             ┌────────────────┴────────────────┐
         GameInstance A                    GameInstance B
             │ 决策                            │ 决策
             └────────────────┬────────────────┘
                         PolicyRouter
                    脚本 / 搜索 / 模型适配器
                              │
                    完整动作按 ticket 回到各局

各局 → 可见轨迹 ──→ 训练适配 → Tianshou 或 RLlib → 新策略版本
     → 审计与事实 → Parquet/DuckDB → 条件关系估计 → Cytoscape.js
     → 运行摘要 ──→ 可选 MLflow

候选提议器（手工 / ShinkaEvolve / 参数搜索）
     → 策略或构筑版本 → 实验队列 → 评价反馈
```

以上是逻辑模块，不是要求部署同等数量的服务。首版 TS 进程管理游戏；Python 用于离线分析与后续训练。一个子系统只能有一个任务生命周期所有者：若训练框架拥有采样 workers，我们提供 worker 内环境桥；不再同时让另一调度器重试同一局。外层实验调度可以提交一个训练任务，但不干预其每条采样任务。

## 4. 我们应拥有的接口

以下是边界草案，不是可编译类型声明。与旧 ports 的 submit/advance 两阶段可做薄映射，最终只固定一套规范，避免平行 API。

### 4.1 运行后端与游戏分开

```typescript
interface RuntimeBackend {
  create(artifact: ArtifactRef, input: Value): RuntimeHandle;
  resume(h: RuntimeHandle, reply?: CapabilityReply): RuntimeStop;
  snapshot(h: RuntimeHandle): SnapshotRef;
  restore(s: SnapshotRef): RuntimeHandle;
  dispose(h: RuntimeHandle): void;
}
// RuntimeStop = generic capability request | program done | fault
// 核心不知道 request 是玩家决策，done 也不自动代表游戏获胜。

interface GameAdapter {
  create(setup: Value, random: RandomSpec): GameHandle;
  advance(g: GameHandle, reply?: DecisionResponse): GameStop;
  snapshot(g: GameHandle): GameSnapshot;
  restore(s: GameSnapshot): GameHandle;
  capabilities(): GameCapabilities;
}
// GameStop = decision(packet) | terminal(outcome) | fault(issue)
```

fork 可以统一为 restore(snapshot)，不要求每个后端实现独立 COW。能力声明区分快照、规划、领域事件、规则参数修改、构筑、观察投影等。没有规划能力仍可对局；现成游戏缺少快照只能用于明确不要求分叉的实验，不能假称满足完整运行契约。

### 4.2 决策协议与策略接口

```typescript
type DecisionPacket = {
  ticket: Ticket; actor: ActorId; phase: string;
  observation: Value; history: VisibleHistoryRef;
  actionSpec: ActionSpec; contract: Version;
};

interface PolicyAdapter {
  decide(packet: DecisionPacket, memory: Value,
         budget: PolicyBudget): Promise<PolicyReply>;
}
// Reply = 完整动作 + 新记忆 + 适用时的采样概率/分布版本
// 路由层可将同版本模型的多局请求合批，内核接口不随之改变。
```

动作先完成再提交；token 解码不产生环境步。ticket 默认不进入模型特征。记忆在合法提交动作后更新。策略不能读取真实 GameHandle 或审计日志。

### 4.3 实验任务与候选提议

```typescript
type MatchSpec = {
  game: ArtifactRef; setup: Value; policiesBySeat: PolicyBinding[];
  random: RandomSpec; budget: RunBudget; experiment: ExperimentRef;
};
runMatch(spec: MatchSpec): Promise<RunResult>;
propose(context: PublicSearchContext, budget: Budget): Candidate[];
evaluate(candidate: Candidate, plan: EvaluationPlan): EvaluationReport;
```

RunResult 引用 outcome/轨迹/事实/版本与失败类别，而不是只有 winrate。EvaluationPlan 明确对手、构筑、座次、随机样本、适应范围和停止规则。候选生成器不能静默替换独立验收集。任务 ID 与 attempt ID 分离，失败重试不当作新独立样本。

### 4.4 学习与分析

```typescript
encode(packet: DecisionPacket): ModelInput;
decode(output: ModelOutput, actionSpec: ActionSpec): Action;
assembleTrajectories(records: VisibleRecordStream): TrainingBatch;
train(data: TrainingBatch, config: TrainConfig): PolicyVersion;

extract(records: AuditRecordStream, contract: AnalysisContract): FactStream;
estimate(plan: ExperimentRef, facts: FactQuery): RelationEstimate[];
```

编码、变长动作分布、跨对手回合的收益连接是实质工作，不是改一个 Gym wrapper。自回归动作整段 logprob、mask、截断与记忆都要符合选定算法；不能默认训练框架支持我们的自定义分布。train 是职责接口，不要求离线批式算法，也不强制自建训练 loop。

RelationEstimate 至少有实体、关系类型、条件、估计与不确定性、机会覆盖、证据引用、未知状态。以 episode/配对种子等正确抽样单位估计不确定性，不把同局决策或分叉当作独立对局。大规模卡牌关系筛查与确认实验分开，避免从大量比较中挑出偶然显著边。

### 4.5 受限规划（后置）

继续沿用 [PlanningContract](../spec/planning.md)：游戏提供合法信息到假设世界的构造器，服务提供 sample/fork/advance/close。搜索算法可以替换，真实隐藏世界不能成为默认起点。通用 snapshot 不自动解决这项工作。

## 5. 实现量估计

计量：自有生产源码，不计依赖、生成文件、文档、美术和游戏卡牌内容。人周包含常规测试/集成与文档，按熟悉 TS/Python/RL 的工程人员估计；不是根据行数机械换算，不预设 AI 带来固定倍数加速。

### 5.1 可复用本地平台，先固定脚本

| 工作包 | 自有生产代码估计 |
| --- | ---: |
| 构建约束、版本产物、schema 基础 | 0.8–1.6k 行 |
| 现成 runtime 适配、toolkit、完整快照桥 | 1.2–2.8k 行 |
| 会话、观察投影路由、ticket/记忆提交、脚本入口 | 1.0–2.2k 行 |
| 多局任务、冻结策略库、重试/恢复与预算 | 1.5–3.0k 行 |
| 事实与轨迹落盘、查询、血缘 | 0.8–1.8k 行 |
| 首批干预协议、机会分母与关系估计 | 1.5–3.6k 行 |
| 图展示、条件筛选、证据详情与简单回放 | 0.8–1.8k 行 |
| 合计 | 7.6–16.8k 行 |

再预留约 4–9k 行测试/夹具（不包含商业游戏规则测试），总体约 10–20 人周。这里交付的是本地可复用工程系统，不是公开多人运营服务或任意不可信依赖的安全认证产品。也不包括重写依赖引擎；如果复用适配实际变成引擎 fork，应重新估算和选型。

### 5.2 后置能力的增量

| 能力 | 生产代码增量 | 人周增量 | 最主要风险 |
| --- | ---: | ---: | --- |
| 一个小 Transformer 的训练、编码、合批与版本对局 | 2–5k | 3–6 | 动作分布/轨迹适配；不保证学会 |
| 一个游戏的受限规划服务及算法适配 | 2–5k | 3–7 | 假设世界构造与信息权限；复杂游戏可能超出 |
| 接入程序演化框架 | 1–3k | 2–4 | 评价协议、候选隔离、生态保留与预算 |
| 接入质量多样性构筑搜索 | 0.5–1.5k | 1–3 | 合法构筑编码、描述符、评价噪声 |

以上按复用前面的策略库/调度器估计，不能另起一套完整平台后再声称是这个增量。新增游戏的训练编码、领域事实与规划构造器单独计费。

### 5.3 游戏内容必须另计

- 对一个接口合适的现有小型游戏做环境/结果适配：初步估计 0.3–1.5k 行、约 0.5–2 人周；不含补齐缺失规则、完整快照或细粒度卡牌事件。
- 从零实现 500 张牌的完整商业级游戏：当前不能可靠估算。牌数不是机制复杂度；需要清点独立机制、交互例外、战斗/构筑/地图/事件等系统，以及目标规则版本。
- 复用完整游戏引擎可能省下最多的工作，但要查规则覆盖、可修改性、无头接口、合法观察、快照和再分发许可。只有画面或 AI 对战演示不够。

### 5.4 最小闭环可以更小

如果限定一个现成游戏或已就绪游戏包、固定脚本、单机、单一干预类型和简易关系界面，可以将第一阶段控制为约 3–6k 行生产代码、3–6 人周，另加适当测试。它是上述平台的子集，不是另加一份成本；缺少完整作者工具链、自动演化、泛化训练/规划和生产运维。

$500 是增量计算/API 预算，不能覆盖这些人工成本；复用框架减少工程量，不自动降低达到同等策略覆盖所需的对局和学习量。本次未测吞吐或跑训练，不增加新的 4070 性能保证。

## 6. 优先级与不能省的工作

先交付可直接看见设计证据的链路：GameAdapter → 脚本 PolicyAdapter → 批量实验 → 事实/结果 → 条件关系图。原生 TS 游戏运行时按契约适配现成后端；已有游戏可以并行接在 GameAdapter 下，但不把它当作 TS 完备性证明。

其次加入局外脚本候选生成和有行为依据的种群保留；随后接一个训练后端。需要搜索时才实现具体游戏的假设世界接口。

不能省的四项：

1. 游戏给出的合法观察、完整动作和领域事实。
2. 实验定义：固定/适应什么、与谁比较、花多少预算。
3. 策略与游戏版本隔离、可追溯样本和可恢复任务。
4. 未知/缺失覆盖的诚实表达，以及独立样本上的关系确认。

不建议首版自建：语言与编译器、RL 算法框架、LLM 程序演化框架、分布式集群调度、图数据库、图布局算法、模型服务平台。需要的是上述模块的清晰连接和游戏语义，不是让每一层都成为新项目。
