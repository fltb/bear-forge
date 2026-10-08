# 游戏、训练与分析接口 v0.1

颗粒度更新：以 [当前契约](runtime-contract.md) 为准。checkpoint/fork 首版限于支持的决策等待边界；yielded 是后端可选能力而非硬要求。真实动作到下一真实选择为一步，计算中止不构成游戏输赢。

状态：设计契约，尚未实现。执行边界见 [分层契约](layers.md)；训练目标与实验协议见 [训练与实验](../docs/training.md)。

## 1. 固定边界

内核是执行器与记录 toolkit：运行受控程序，管理状态/控制帧，处理通用外部请求，保存/分叉现场，记录执行来源和游戏提交的数据。内核没有玩家、回合、卡牌、胜负、奖励、构筑或统计指标语义。

每个游戏提供自己的主循环、结算循环、规则操作，以及三套版本化契约：GameContract、TrainingContract 和 AnalysisContract。公共会话、时间和前端展示另见 [会话规格](session.md)。训练/分析适配器在内核之外解释数据。游戏 SDK 可以提供更高层封装；这些仍是游戏程序，不新增业务 opcode。

游戏决定循环条件与顺序，编译器转换循环回边与活跃变量，内核在步骤间检查执行预算。白名单同步原子的内部循环按其终止与成本契约运行；需中途暂停的循环必须编译为受控流程。预算耗尽不自动结束回合或判定游戏结果。

## 2. 总体数据路径

```text
游戏规则程序 ←→ 内核执行器/context
                    │
           通用请求、状态与记录
                    │
          ┌─────────┴─────────┐
     游戏训练适配器        游戏分析适配器
          │                    │
     决策与收益协议        领域事实、机会、结果
          │                    │
   采样器/编码器/模型       实验估计器/关系图
```

训练协议统一的是交互结构，不强制所有游戏采用同一个固定观察向量或动作列表。分析协议统一的是证据与关系结构，不强制所有游戏采用生命、伤害或战斗回合。

## 3. 公共游戏契约与训练适配

以下为职责接口，具体序列化类型在实现时实例化。契约内运行期规则引用为已编译 RuleRef 或已批准 PureId，不允许隐含对局状态的宿主回调。

```typescript
type GameContract = {
  version: ContractVersion;
  setupSchema: SchemaRef;
  observationSchema: SchemaRef;
  actionSchema: SchemaRef;
  boot: RuleRef;               // setup + seed -> 游戏会话
  decisionCapability: CapabilityRef;
  project: PureId;             // 只读局面与合法信息历史 -> 玩家数据
  actionProtocol: ProtocolRef; // 编解码、候选/前缀约束及规则验证
  rewardProtocol: ProtocolRef; // 游戏收益账本与终局定义；学习塑形另列
};
```

TrainingContract 在 GameContract 上增加观察/动作编码、学习奖励协议、轨迹和折扣/截断设置；它不拥有通用玩家决策语义。游戏使用 game.requestDecision，真人和模型共享相同请求与动作验证。

boot 接受 setup、显式 seed/随机输入，初始化游戏并启动游戏自己定义的主循环。谁行动由游戏发出的决策请求决定，不使用内核 currentPlayer 或固定轮流行动假设。

同一 actor 可以连续决策，也可在别人的回合回应。构筑、选角色、选卡、出牌均可作为决策类型；phase 是游戏命名标签，通用内核不解释。若游戏没有构筑阶段，不要求实现构筑接口。

游戏规则可能读取完整世界。project 位于可信适配层，只导出允许该 actor 看见的内容。历史由每个玩家合法可见的记录构建，包括曾经看见、现在不再公开的信息；不能只拿当前世界的公开字段替代记忆。

外部策略不能获得 context、随机种子、剩余牌序、对手私有日志或完整合法性验证器的任意世界查询能力。实体 ID、候选顺序、掩码及错误反馈也属于观察协议，需要排除隐含泄密。

## 4. 对训练运行器暴露的接口

```typescript
start(game: GameRef, setup: Value, seed: Seed): Session;
advance(session: Session, budget: Budget): AdvanceResult;
submit(session: Session, ticket: Ticket, action: Value): SubmitResult;
checkpoint(session: Session): SnapshotRef;
fork(snapshot: SnapshotRef): Session;

type AdvanceResult =
  | { kind: "decision"; packet: DecisionPacket; records: RecordRange }
  | { kind: "terminal"; outcome: Outcome; records: RecordRange }
  | { kind: "yielded"; records: RecordRange }
  | { kind: "fault"; issue: ExecutionIssue; records: RecordRange };

type DecisionPacket = {
  ticket: Ticket;
  actor: ActorId;
  phase: string;
  observation: Value;
  visibleHistory: HistoryRef;
  actionSpec: ActionSpec;
  observationVersion: Version;
  actionVersion: Version;
};
```

Ticket 绑定 session、branch、request 和决策版本，仅供路由；它默认不进入模型特征。visibleHistory 必须是该 actor 的历史引用，而非全局审计日志引用。第一次生成 packet 时固化它，训练记录保存实际送入策略的内容，不能训练时再从已变化的世界重新投影。

此处 actor 定义为实际选择者。支持控制另一位玩家等规则时，游戏决策 payload 必须另存 subject（行动主体）与 authority（选择授权依据）；费用主体、观察权限与收益主体由游戏协议分别确定，不能默认等于 actor。轨迹按实际行为策略记录，奖励按 TrainingContract 的目标归集；不把替对手决策自动解释为帮助对手获胜。具体字段编码仍待实现。

advance 推进游戏自己的流程。内部纯计算、规则调用和显式随机流不转成模型决策。遇到其他外部 capability，由已授权适配器处理；无法处理时报告 issue，不自行编造输入。内核 Done 也不自动等于游戏 terminal：只有游戏协议声明的结果才构成 Outcome；缺失结果是契约错误。

submit 在活跃决策上检查 ticket 与编码，然后由游戏验证语义合法性。拒绝保持已提交世界不变，不自动给予负奖励。若规则将非法尝试本身视为合法的游戏行为，须在动作协议中显式建模，而非复用协议失败。

checkpoint/fork 是训练运行器的管理接口，不是策略默认权限。会话快照还需绑定适配器版本与其记录游标；任何影响游戏推进的等待状态必须在 context/可快照会话中，不能藏在网络 Promise 或模块变量里。模型记忆单独管理，按 actor 与分支隔离。

玩家策略需要前瞻时使用独立的 [受限模拟接口](planning.md)，从合法信息状态构造假设世界；不得直接使用上述真实世界 checkpoint/fork。

首版每个决策请求对应一个 actor。同时秘密决策由游戏显式收集、封存并规定公开时机，不因顺序收集就允许后续玩家看见前面的私有选择。并行收集是后续运行器优化，不能改变决策观察或承诺顺序。

## 5. 动作空间与模型编码

```typescript
type ActionSpec =
  | { kind: "enumerated"; choices: Value[] }
  | { kind: "structured"; schema: SchemaRef; constraintRef: ConstraintRef };

legalNext(ticket: Ticket, prefix: Value[]): PrefixOptions;
validate(ticket: Ticket, action: Value): ValidationResult;
```

小动作空间可以枚举；组合出牌、目标、数量等使用结构化 schema 与前缀约束，不要求列出全部合法动作。legalNext 在训练适配层调用游戏的获准实现，不把任意 JS 函数发送到模型进程。约束响应须遵守该玩家的信息权限，不能通过试探前缀读取隐藏世界。

自回归生成参数是模型内部过程，不自动推进游戏。完整动作提交后才恢复请求；若游戏规则在参数之间公开新信息，必须拆成新的真实游戏决策。

编码器将 packet 转成 Transformer 输入，并将 token 解码回动作。编码器、mask/前缀实现和模型版本分别记录，不进入内核。换游戏时可共用训练管线，但观察与动作编码仍需遵循游戏 schema，不承诺无需适配的单一模型。

## 6. 收益与轨迹

游戏 rewardProtocol 输出带 actor 的收益记录及终局结果。内部模型优化用的奖励塑形另行版本化，不能默默改写用于设计分析的游戏结果。

```typescript
type RewardRecord = {
  seq: EventSeq;
  actor: ActorId;
  value: number;
  reason: string;
};

type Outcome = {
  utilities: Array<{ actor: ActorId; value: number }>;
  details: Value;
};
```

不预设双人零和或总和为零。合作、多人阵营和单人闯关均可输出自己的收益定义。内核只保存数据，不从生命下降、牌耗尽等现象推断奖励。

采样器把同一 actor 的相邻决策连接；中间可以经过多个其他玩家决策。按明确的半开序号区间归集该 actor 的奖励，每笔只归集一次；尚未作出过决策的 actor 的开局收益也要独立记录。终局时补齐尾部区间。

每条样本至少保存 packet 原件引用、动作、实际行为来源、checkpoint/编码器版本、行为 logprob（适用时）、奖励区间、下一 actor 决策及结束原因。自回归动作的概率是条件概率乘积/对数和；搜索或人类行为不能伪装成原策略采样。

yielded 表示需要继续推进，不是 episode 截断。训练运行器主动停止、时间上限或故障需分别记录；不能冒充 terminal 或平局。折扣按玩家决策、游戏阶段还是别的单位由训练协议选择，不按内核指令数默认折扣。

## 7. 游戏包的分析契约

内核天然能记录写入、调用、外部输入等执行事实，却不知道一次 hp 改变是伤害、支付成本还是直接设置。领域事实只能由游戏上报或游戏分析适配器从有版本依据的数据中解释。

```typescript
type AnalysisContract = {
  version: ContractVersion;
  entitySchema: SchemaRef;
  factSchema: SchemaRef;
  outcomeSchema: SchemaRef;
  extract: AnalyzerRef;
  opportunityDefinitions: DefinitionRef[];
  relationDefinitions: DefinitionRef[];
};

type Fact = {
  episode: EpisodeId;
  branch: BranchId;
  seq: EventSeq;
  type: string;
  payload: Value;
  provenance: EvidenceRef[];
  contract: ContractVersion;
};
```

type/payload 由游戏声明，例如 cardIncluded、cardDrawn、actionResolved；内核不硬编码这些名称。游戏实体定义区分卡牌定义、卡牌实例、构筑、策略和角色，防止把对象 ID 当成跨对局统计单位。

extract 只读执行记录/快照，不能反过来推进或修改游戏。分析通常可访问审计全量数据，但这些数据不能自动回流成玩家训练观察。规则模块执行依赖遵循白名单；离线分析依赖使用独立版本化构建清单，不能借分析器给规则开放 I/O。

## 8. 记录 toolkit 的接口与一致性

```typescript
game.record("damageResolved", {
  source, target, requested: 5, actual: 3
});
```

这是游戏 SDK 示例。实现可降低为在受管日志/outbox 中追加不可变记录的 Write，不要求新增“伤害”指令。记录内容、顺序号及提交位置要与 context 绑定，跨分叉形成共享前缀和各自后缀；外部日志消费者按 branch+seq 去重。回滚/未提交分支的记录不能冒充实际对局事件。

记录可关联当前规则实例、源码位置、父事件与状态版本；这些帮助定位来源，但调用父子关系本身不是统计因果证明。游戏声明的伤害事实需要与实际状态变化做游戏不变量校验，内核不会自动确认领域事实真假。

执行所需 context 必须完整；详细指令追踪可采样/关闭。训练协议要求的请求、实际观察、动作、收益，以及分析契约声明的必要事实不能被调试采样悄悄省略。缺失时标记证据不完整，不把未记录当作零次发生。

## 9. 从事实到关系图

```typescript
readFacts(query: FactQuery): AsyncIterable<Fact>;
aggregate(query: MetricQuery): MetricResult;
estimate(experiment: ExperimentRef, relation: RelationRef): RelationEstimate;

type RelationEstimate = {
  nodes: EntityRef[];
  relation: string;
  context: Value;
  estimate: Value;
  uncertainty: Value;
  coverage: Value;
  status: "supported" | "unknown" | "insufficient" | "conflicting";
  evidence: EvidenceRef[];
};
```

这些是离线分析服务接口，可以有普通异步 I/O；不属于受控游戏规则程序。异步读取数据库与在规则 context 中保存 Promise 是不同边界。

先区分三层：游戏事实 → 带分母的统计量 → 指定实验下的关系估计。卡牌携带率、抽到率、机会内使用率分母不同；机会可能是可计算谓词或采样估计，不要求逐帧枚举所有组合。未覆盖和不适用要分开。

卡牌 A 比 B 的替代关系需要规定牌组、角色、对手、替换约束和适应预算；同场出现率不直接证明协同。胜率、事件关联和因果干预分别标注证据种类。图可以保留多方关系与循环，不强制转为单一总排名。

实验血缘必须关联游戏/编译器/SDK/原子版本、观察/动作/收益契约、模型、对手与构筑分布、随机种子、分叉来源、预算及分析版本。反事实分支不能与真实采样轨迹混为独立样本。

## 10. 最小交付与验收

一个可玩的游戏通过 GameContract 至少交付：boot、决策请求及观察投影、动作协议、收益/结果契约；接入训练时再提供 TrainingContract；记录工具由内核 SDK 提供。只有结果契约也可先统计对局关系，但卡牌机会/体系图需要更丰富的 AnalysisContract，不能由日志字段自动猜出。

第一版端到端：游戏运行到决策 → 保存 packet → 策略返回动作 → 合法提交 → 运行至下一边界 → 累积 actor 轨迹 → 输出游戏结果 → 生成可追溯事实与对局统计。

必须验收：

1. 不同隐藏世界在同一合法信息状态下不泄漏到 packet/前缀接口。
2. 错误/重复/过期动作不修改已提交世界；反事实分支不串响应。
3. 同一玩家跨对手动作的历史与收益区间连续、无重复或漏记。
4. yield、训练截断、fault、terminal 不混淆。
5. 日志关闭部分调试字段不改变游戏；契约必要记录缺失时分析拒绝作确定结论。
6. 任一关系能追到契约、实验、样本和回放，不从内核状态变化直接宣称游戏设计好坏。
