# 历史 TS 组合库：斗地主与 Forge Duel

2026-10-17：专用执行后端以 card-core-spec.md 为准。本文保留原 async 组合库与通用执行入口的历史设计，不代表不经编译的卡牌 Core。

本文件定义 TS 卡牌领域结算层的设计与迁移验收，属于 implementation-spec.md 的细化。目标是同一个内核服务现有 competitive-2016-bear-1 与 forge-duel-v1，保持原实例功能与对外行为一致。它不是第三种 Core 协议，不启动 Rust 重构或恢复性能优化。进度仅记入 plan.md。本文是设计，不是新实现已通过等价性测试的证明。

形式语义、组合正确性、保存与分支隔离、新旧轨迹等价的充分条件见 [数学证明附录](card-resolution-proof.md)。功能等价按双方资源充足的执行比较；相同数值计算预算下的耗尽位置可能因组合器指令增加而不同，不能混同为已证明的等价性，详见附录第 7 节。

## 1. 交付边界

新增 packages/card-engine：静态效果定义、效果组合执行、实例内结算上下文、选择与端口适配。斗地主与 Forge Duel 分别提供规则包和 GameModule 接线，导出名称、setup/result/ports schemas、GameContract、公开动作和观察不变。现有 Loader → Core → Instance → BaseGameBinder → GameHandle 全部复用；训练继续使用 BaseGame 玩家接口。

同一个内核是指两游戏调用同一份生产调度器和组合执行器，分别配置静态规则定义。内核不得出现游戏名、牌名、座位数量、胜负或牌型判断，不得 import examples。也不能仅把两个旧 program.run 或完整 apply 挂到一个 opaque 回调就宣布迁移完成：阶段与行动流程进入公共组合器，具体动作拆成有明确输入/结果的规则操作；Forge 卡牌效果由注册定义组合调用。

领域内核负责“下一项效果是什么、子效果返回什么、等待哪个选择”；旧受控 runtime 仍负责 TS 函数续延、存储隔离与快速 fork。当前不新增解释任意 JS 的语言运行时，不要求作者手写 PC。原生路径可使用同一规则定义，但仍不宣称获得保存和 fork。

## 2. 现有接口接线

| 当前接口 | 保留职责 | 新领域层对应物 |
| --- | --- | --- |
| ProgramModule<S,P,R> | schemas 和 run(setup,io) | 规则包装配的结算入口，P/R 原样保留 |
| Core.start | 创建 Instance | 创建唯一规则状态和结算上下文 |
| Instance.bind/run/inspect/close | 端口回复与生命周期 | 不增加旁路 submit/step；回复进入原端口 |
| Instance.fork / InstancePersistence | 实例状态分支和持久化 | 保存规则状态、未完效果、随机状态及发布游标 |
| GameContract.ports | receive/respond 与 session | 继续复用两游戏原契约，保留请求校验 |
| GameContract.observe/projectEvent/inputs | 玩家投影与合法动作 | 游戏规则包提供纯查询，禁止共享隐藏数据 |
| BaseGame.run | 接受一个规则输入，交付事件，到下一请求或终局 | 不把每个内部效果变成一次玩家决策 |
| GameHandle.save/fork | 可选能力 | 沿用当前后端提供的能力，不另建 snapshot |

GameState 的 request/event/ended/fault、Instance 的 call/done/fault 与 accepted/pause 均不扩展。训练奖励、张量和 logProbability 不进入领域内核或公共 contracts。

## 3. 定义、状态与类型形状

定义采用静态 TS 组合表达式与类型化规则操作，允许参数化、嵌套调用和执行时分支。初步 API 形状如下（设计伪码，不是已发布类型）：

```ts
RuleDefinition<S, Setup, Ports, Result> = {
  initialize: (setup: Setup) => S,
  entry: EffectDefinition<S, Setup, Result>,
  effects: StaticEffectRegistry<S>,
  ports: ExistingPortAdapter<S, Ports>,
};

ResolutionContext<S> = {
  state: S,                   // 唯一权威领域状态，不是复制的 Frame
  frames: ResolutionFrame[], // 实例内参数、结果槽、来源与父子关系
  extensions: InstanceData,  // 游戏需要的随机状态、发布游标等
};
```

规则/效果函数与不可变定义属于 Program，不放进 Context 中的模块导出图；运行中生成的效果实例用定义标识、数据参数和来源引用表示。可变捕获状态必须属于实例，不得放在静态注册表或宿主闭包。执行时的 TS 调用栈由现有受控 runtime 续接，领域帧用于效果上下文和追踪，不再复制一份竞争的运行时 PC。

保留两游戏现有 State schema；不为统一而将斗地主的点数多重集改成 Forge 的 Card/Unit。框架通过规则操作访问状态。State.events/history/pending 已经拥有的权威数据不在内核再保存一份。Frame/observe 输出是原协议所需的投影，不作为另一套可写世界。

原生 primitive 操作只执行有界、同步的规则变更并返回数据；复杂逻辑可写 TS 并调用公共组合接口。可能等待外部输入的能力必须显式通过选择/端口操作执行，不能把宿主 Promise、计时器或任意外部函数塞进效果定义。

## 4. 公共执行语义

当前基础实现位于 packages/card-engine/src：createResolution 持有唯一 state、原 IO 适配引用和数据来源帧；invoke 执行静态定义并在返回/异常时释放帧，返回值通过原 TS 续延传递。sequence、branch、repeat、forEach、operation、request 复用这一机制。repeat 每轮重查条件，forEach 进入时复制成员列表但保留元素身份。publish 通过 request 使用原 event 端口，checkpoint 通过 invoke/operation 调用规则定义，不增加自动死亡检查或发布游标副本。游戏随机与发布游标继续留在原实例状态/词法环境中。基础实现通过测试不代表两游戏已经接入，迁移进度见 plan.md。

| 组合能力 | 语义与状态 |
| --- | --- |
| sequence | 按序执行；保存已完成子项结果，恢复不重复执行 |
| invoke | 调用静态效果定义，产生独立参数/局部结果环境，返回后续接父效果 |
| branch | 在执行到该位置时求条件，只进入选中的分支 |
| repeat/forEach | 明确迭代集合是进入时捕获还是每轮重新查询；局部变量不能跨兄弟执行混用 |
| operation | 调用规则包有界同步操作，结果可供后续效果读取 |
| request | 经既有 IO.call 请求输入，保留请求语义及内部续接 |
| publish | 使用原 event 端口发布原事件批次，游标推进时机按原程序保持 |
| checkpoint | 调用规则包指定的死亡/胜负/触发处理；不在任意写入后隐式执行 |
| responseWindow | 可选规则模块；与效果内部选择分离，两个现有游戏不强制启用 |

顶层推进先执行自动工作，遇原协议 IO 边界就等待，收到合法回复继续；终局返回原 R。内部唯一候选是否自动执行由规则包决定，不能全局开启而删掉原游戏的玩家请求、事件端口或轨迹。选择候选及授权条件按当前状态验证，不复用过期列表。

禁止将触发统一为事件发出后的同步递归回调。记录事实、捕获触发、排序、执行是不同阶段，由规则包指定检查点。批量同时变更与逐项变更必须显式区分；第一阶段严格保留现有游戏顺序，不借迁移“修正”为万智牌规则。

参数化卡牌定义示意：spark/blast = sequence(damage(target, amount), checkpoint('deaths'))；supply = sequence(draw(actor), draw(actor))，每次 draw 均保留终局短路；repair = heal(actor,3)。增加同机制卡牌由组合与参数完成，不能改内核 switch。召唤、攻击、支付费用及移动区域由规则操作实现；通用复用点达到证据后再提取，不先建立所有游戏共用的万能状态表。

## 5. 斗地主规则包映射

旧实现基准已冻结在 examples/doudizhu/tests/reference；对应生产文件为 src/program.ts、sdk.ts、rules.ts、patterns.ts、module.ts、schemas.ts。当前 src/effects.ts 将输入校验、slot 消费与 bid/double/redouble/pass/play 拆开，通过公共 invoke 执行；原同步 apply 复用相同规则原语，不再是生产循环的唯一行动执行入口。

| 现有行为 | 迁移安排与必须保留的细节 |
| --- | --- |
| 开局与洗牌 | initialize 创建原 State；deal 效果调用相同 LCG 和 Fisher–Yates 次序，每次随机调用数量与点数排序不变；全不叫重发延续同一实例随机流 |
| 主循环 | dealing → deal；生成原 frame；有新增事件则 event；推进 published 游标并清空输出事件；ended 返回原 Frame；否则 decision → 应用输入 → 循环 |
| 叫分 | 逐次增加 bidCount，叫 3 立即确定；全不叫时首叫顺移，原 deal/stage/boundary 序号保持 |
| 双农民加倍 | 同一阶段可有两个待决 slot；一次回复只消费一个；未提交农民的 slot 和 deadline 保留，不能强制拆成新的单人阶段 |
| 隐藏选择 | doubleChosen 仅本人可见；两人都提交才公开 doubles；底牌仍在现有时机公开，不能为了编码方便提前披露 |
| 再加倍与底牌 | 维持当前规则的触发条件、加倍影响及底牌加入地主手牌时机 |
| 出牌与过牌 | 复用 classify/beats/contained 及合法动作顺序；动作牌型解释不能重算成不同合法解释；两次过牌还原引牌权 |
| 控制输入 | clock 只推进 now，不消费 slot；timeoutFirst 边界、默认动作、boundaryKey/stageId 校验按现有 validateInput 保持 |
| 结算 | 炸弹/火箭/春天/反春和各农民不同倍数按 settle 保持；三方 scores、事件顺序及 result 完整一致 |

实现应把 apply 的 clock、消费待决输入、bid/double/redouble/pass/play 分支拆成可组合规则步骤；牌型纯算法、结算公式与合法性查询可直接复用。不能把完整旧 apply 唯一包成一个效果当作完成公共结算层。原 module.ts 的 observe、projectEvent、prepareAction/prepareControl 与 exact 动作接口继续使用，公开 schema 不包含内部结算帧。

## 6. Forge Duel 规则包映射

旧规则与契约基准已冻结在 examples/forge-duel/tests/reference；实验行为仍由原 experiment/* 测试验证。当前 src/effects.ts 经公共 repeat/invoke/request 执行主循环和行动，src/rules.ts 保留校验、支付、移区、伤害及收尾原语。cardEffects 将 spark/blast 映射到同一伤害/死亡步骤并传不同数值，supply 使用两次 draw，repair 使用 heal；原同步 apply 与效果路径共用这些原语和卡牌步骤定义。

| 现有行为 | 迁移安排与必须保留的细节 |
| --- | --- |
| 初始化 | 两座位 carry 事实、洗牌与抽牌顺序、seed 更新、首回合 begin 完全相同 |
| 主循环 | while 未终局：available → 发布 pending.splice(0) → decision → action；结束后冲刷剩余 pending；不能在 available 前增加新请求或重复产生机会事实 |
| 出牌 | 先完整校验，再 cause='action:'+step；移出手牌、扣费、play 事件后执行效果；原 cardId/entity 编号及入场未 ready 保持 |
| spark/blast | 数值 2/4 通过同一个伤害定义传参；伤害后执行 deaths 检查点 |
| supply/repair | 连抽两次中第一次致命疲劳后第二次不再工作；治疗上限 20，记录实际恢复量 |
| guard/攻击 | guard 限制攻击但不限制法术；攻击者先取消 ready；记录 attack，再目标受伤、再反击、最后 deaths，不能逐次伤害后立即删除对象 |
| deaths/witness | 现有顺序按座位 0→1；每座位先移除全部死者并记录 death，再由该座位仍存活 witness 对每个死者治疗；死去 witness 不触发；不能换成跨双方收集再统一结算 |
| 回合与胜负 | begin 的法力、ready、turn 事件和抽牌顺序不变；保留 30 回合限制、同时致命平局、fatigue 及最终 settle 时机 |
| 动作收尾 | step 增加及 cause 清空在原位置执行，即使本次动作进入终局也保持原行为 |
| 观察与事实 | audit 不进入玩家事件；owner 事件向对手保留遮蔽后的事实；available 去重、事件 key/decision/cause、history/pending 批次保持 |

将 apply 拆为校验、行动开始、play/attack/end 效果定义、检查点和行动结束。cards 注册表扩展为参数与效果引用；相同机制必须共用定义。legal/sameAction/observe/project 可以直接复用并继续验证独立合法动作 oracle。实验 tasks、四类策略、替换干预、事实统计、崩溃恢复和 viewer 消费协议不因迁移而改变。

## 7. 与复杂卡牌语义的连接

已有 examples/resolution 是独立的“双潮焚契”压力样例，不是 Forge Duel 正式规则或其 witness 卡。不能以 Forge witness 测试通过替代来源离场后保留触发的语义，二者当前规则不同。

公共结算机制需用该样例验证 invoke/repeat/branch/request 的组合：双波动态选目标、目标控制者防止、实际伤害累计、条件私密取牌、来源身份捕获、法术结束后触发、响应反制取消效果、K2–K6 保存及分支。检查点和响应时机由该规则包提供，不改两个正式游戏来迁就样例。

当前 examples/resolution/src/effects.ts 已将响应窗口、每波伤害、私密奖励和捕获触发拆成静态效果，用同一个 invoke/forEach/request 组合。旧实现独立保存在该示例 tests/reference，六种变体逐次端口与终局/故障差分。单候选自动执行只保留在该规则包的 choose 中；响应窗口仍逐玩家请求。受控测试另比较相同世界对象、不同剩余波数的恢复现场，验证对象返回后的新身份，以及故障现场不可保存、先前有效快照仍可恢复。

未来万智牌式替换、分层属性、对象代次、优先权和触发排序应通过同一效果/选择机制的规则模块扩展；本次不宣称完整万智牌兼容，也不把完整万智牌实现加入双游戏等价性目标。

## 8. 功能相同的比较定义

比较基准必须独立：迁移前冻结原 program/rules/sdk 等可变依赖闭包的源码参考，保留其确切版本；不能让新旧入口都调用重构后的 apply 后宣称差分通过。迁移后参考只能存在于相应游戏 tests/reference 的测试资源中，不另提供生产执行器，也不修改来迎合候选。已有独立牌型/合法动作 oracle 保留。

同一个 setup、随机种子、玩家动作与控制输入带，在原实现和新内核实现分别运行。基准先产生语义动作，候选必须先证明该动作属于其完整合法列表再交付；不得各自选择“第一个合法动作”掩盖顺序变化。

| 比较层 | 必须逐项相同 |
| --- | --- |
| Program | 端口名、输入、回复、调用顺序和事件批次；终局返回值；等待点的业务状态 |
| GameContract/BaseGame | 请求玩家/类型/data、合法候选及顺序、各玩家 observation、事件投影、accepted/pause 和终态 |
| 安全边界 | 非法/错玩家/过期/跨分支/重复动作拒绝，拒绝不推进或扣费，隐藏选择不泄漏 |
| 记录与实验 | action/event/facts/commit/policy 关系、事件数量和次序、机会分母、结算分、替换与分析输入 |
| 分支恢复 | 原地继续、fork 后同输入、save/关闭/restore 后同输入一致；异输入分支各自与参考续跑一致 |
| 资源生命周期 | 父实例关闭不损坏子分支；不重跑初始化或已发生外部副作用；有效快照及记录按原协议可用 |

只有随机生成的 InstanceId/CallId 等凭证可以做双射规范化，必须保留重复关系与引用一致性。游戏生成的 stageId/slotId/decisionKey/cardId/unitId/event key、数组顺序和私密可见性不得删除、排序或通配。规范化不用于放过非法凭证：跨实例/分支与旧请求拒绝要独立直接测试。恢复保留的 CallId/记录前缀与新的 InstanceId 按现有 persistence 契约校验。

外部非法动作由现有契约拒绝；执行中错误是 fault，不变成无效动作或正常终局。故障现场不能作为成功状态发布或继续回答旧请求；重试从先前有效快照开始。新内核不承诺每条规则操作自动回滚，也不以全图复制增加每步事务。

## 9. 验收范围和落地顺序

先冻结独立参考，再实现公共组合执行器及测试；然后让两游戏各自迁移阶段/动作效果，保持原契约；最后运行原生/受控差分、恢复分支、实验与分析回归。不能以纯原生游戏相同证明受控分支正确。

斗地主覆盖原 schemas/rules/game/controlled/session-host/experiment/architecture 测试；追加同种子三座位首叫、全不叫重发、叫 3、双农民两种提交顺序及中间恢复、加倍/再加倍、边界时刻超时、全部牌型和独立 oracle、春天/反春/多倍结算。正常随机对局之外使用定向合法现场覆盖稀有分支。

Forge Duel 覆盖原 rules/context/experiment/experiment-controlled/experiment-runner/experiment-crash/analysis；全部 8 种卡牌、guard、反击、双死、存活/死亡 witness、爆手、疲劳、双致命、回合上限、四类策略与替换构筑均有定向场景。同 seed 87/991 的原有差分配置保留，不能只比较最终 winner。

公共内核测试需证明同定义可同时服务两个独立实例，无共享可变注册数据；中途选择暂停、返回子效果结果、重复/条件、空/唯一候选策略、嵌套故障和预算终止行为正确。领域内核不能导入两游戏模块，且两游戏都从同一包入口使用生产执行器；新增同机制卡牌测试不得改内核源码。

现有 Context 结构检查继续有效：快照不得包含整个 moduleExports 或依赖初始化图。公共执行器引入必要续接帧后，原“恰好一个帧”类实现数量断言要以原测试目的审查，不能删掉静态/动态分离、无重复初始化及快照边界的验证。若原快照体积/性能约束出现退化须报告，不静默提高阈值。

新增包遵循 src/tests、独立 typecheck/test/check 和根 workspaces 汇总。发布前检查实际 diff，运行新增包与两游戏及受影响 runtime/binder/session 的正式检查，再运行根 check/build；编译器或受控执行语义变化时运行相应固定 Test262 门槛。测试通过仅证明其覆盖范围，语义映射、结构隔离和实测成本分别报告。优化目标继续冻结，记录吞吐变化但不以“达到 Rust 目标”作为本次设计完成声明。
