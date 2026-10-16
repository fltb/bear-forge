# Bear Forge 新对话交接

交接日期：2026-10-15。本文由用户明确要求创建，用于全新对话接手，不复制旧对话历史。它是当前时点的上下文说明；后续进度只更新 `docs/plan.md`，不要另建验收报告、证据账本或零散审计脚本。

## 1. 任务与工作区

用户持续目标：**“那就按照边界做！清理掉越界内容，确保没有任何特判和开洞，全部做完。”**

本文用于交接固定目标、架构与工作约束；当前请求以用户最新消息为准，实施状态以 plan.md 为准。

- 工作目录：`/Users/bytedance/Documents/MRepo/research/bear-forge`。
- 保存项目是父目录 research；真正仓库在其 bear-forge 子目录。
- Git 分支 main；当前 HEAD 为 `031146f`，标题 `Run compiled programs in the main runtime without VM contexts`。此标题是旧提交，不能用来否定后来获准的 Program 级 Realm。
- 当前约 260 条修改/未跟踪路径，含大量有效生产实现，必须保留。不能从干净 HEAD 新建工作树而丢掉这些代码，也不能 reset/clean。
- 本轮没有 commit/push 授权。以后提交身份固定为 `fltb <fltbk@outlook.com>`，禁止使用真实姓名和内部邮箱。
- 误建的历史分叉对话已归档；正确接手方式是普通新对话直接使用当前本地目录。

## 2. 产品目标与首版范围

Bear Forge 用同一份游戏程序让脚本、未来的搜索/模型运行对局，探索卡牌、构筑和打法之间的替代、协同、克制与未知区域。结果是带上下文、覆盖与不确定性的关系图，不是一个总分；规则正确性检查不能替代设计质量分析。

已存在的首版链路：完整斗地主用于验证通用协议；Forge Duel 用于可构筑替换实验；resolution 是万智牌式复杂结算压力案例。固定脚本通过同一玩家接口对局，实验调度组合种子/座次/构筑/策略，文件存储结果，游戏自己的分析适配解释关系，界面展示。

明确后置：神经网络训练/推理合批、自动脚本演化、构筑与打法联合适应、玩家受限搜索、更多商业游戏复刻、正式多人运营产品。不把这些加进当前收尾，也不宣称它们已经实现。预算背景是本地 RTX 4070、额外计算与 Agent API 总上限 500 美元；没有要求为收尾启动模型训练。

## 3. 固定架构与禁止偏移的边界

### 三层与内外 SDK

| 层 | 责任 |
| --- | --- |
| Core | 装载程序、创建实例、提供通用执行及可选恢复/记录能力。没有生命值、出牌、离场、回合等游戏语义。 |
| Instance | 完整程序运行态，通用声明端口、调用/返回、结束/故障、bind/run；保存和分支属于这个运行态。 |
| BaseGame | 持有 Instance，在外层解释游戏请求、玩家观察、合法动作描述、事件和结果；不维护第二套游戏世界。 |

内侧 `game-sdk` 是被执行程序使用的库；具体游戏组合领域 SDK、类型、schema、规则和主循环。外侧 GameContract 处理器与玩家回调通过 Instance 端口绑定。游戏自己的循环/特殊规则全部由游戏程序实现，不进入 Core。

真人、脚本和模型共用逐 player 的交互约定。动作只包含动作；游戏限时是独立可选会话控制，动画由前端处理。合法输入描述采用既有 exact/construct 协议：斗地主可以返回完整 exact 集合，通用层不解释游戏自定义构造规则。不要重开已经冻结的协议命名讨论或加 planning/observer 等新层。

### Program 与 Context

1. 共享 Program 是内部实现概念，承载提前编译的代码、静态标识与不可变元数据。
2. 每个 Instance 拥有独立 Context；运行时用同一 Program 和不同 Context 推进。
3. 保存点只在完整对外 IO.call 等待边界及正常终局。内部 await 不是新增公共保存点；不要求任意 JS 指令处恢复。
4. 跨 IO 存活的控制位置、局部值、调用/异常清理状态、闭包捕获、模块可变数据、别名与循环、SDK 状态和受控任务队列进入 Context。作者照常写循环、递归、闭包，不手写 PC。
5. fork 复制 Context；save 编码 Context；restore 恢复 Context 并关联已加载 Program。禁止恢复时重放历史、重跑程序入口或依赖初始化。
6. 代码、宿主回调绑定和整份 moduleExports/依赖注册图不能被无条件当作快照根。源码真实使用的命名空间、函数自有属性与可变 schema 捕获仍可能是实例状态，不能随意删掉。
7. 闭包代码用共享标识，捕获数据隔离；不能仅把旧整图改名 Context 就算完成。
8. 不承诺 O(1) fork/COW，不复制进程。直接运行无需依赖训练、存档或搜索。

### Program 级 Realm

用户已明确批准每个已加载 Program 一个独立 V8 Realm。作者代码、内建值、操作表和续延设备在其中执行；同 Program 的多个 Instance 共享 Realm，实例可变数据仍在各自 Context。fork/restore 不新建 Realm。它用于隔离宿主内建状态，不能演变成每实例 VM、Worker 或进程快照方案。

### 作者语言、IO 与准入

- 作者写 TS + toolkit；TS 去类型后是严格 ESM。采用提前转译生成普通 JS，运行时由 V8 执行，不解释作者 AST。
- 编译、检查职责分开：静态合法性先检查，转换假设其准入前提；运行时只检查依赖实际值的义务和内部不变量，不能反复重做静态校验。
- 白名单内再用黑名单排除；未知项默认拒绝。入口、SDK 和全部传递依赖一视同仁。
- 允许范围内与目标原始 V8 行为对照，包括结果、求值顺序、副作用和异常。不能静默编译成错误程序。
- 宿主通信只能经声明 `IO.call`。内建纯计算属于程序所用 V8 语言能力；真实时间、外部随机熵、网络等必须走 IO。不能任意注入宿主函数、按包名跳过检查或为 navigator/Zod/某个游戏开口。
- 不做恶意代码安全沙箱，不提供进程级内存隔离或硬抢占。预算/动态检查的目的必须能对应执行受控和可恢复义务。
- Script、非严格模式、CommonJS 作者输入、运行时生成代码、动态 import/import defer 均不属于范围。目标 V8 未实现的能力不用自行模拟。细分内建支持/排除以 controlled-program-spec.md 和实际白名单为准；禁止未经用户决定缩小既定支持范围来消除失败。
- 用户批准保留可信原生直传入口。该入口不承诺 IO-only、独立闭包状态或 fork/restore；原生构建路径也保留原生 Promise 行为，不能拿它冒充受控证明。
- 公共协议 `packages/contracts` 与 `docs/protocol.md` 冻结。不要添加字段、方法、导出路径、版本号或旁路。具体反例确实迫使协议变化时报告用户。

“无特判”指不能依据游戏名、依赖包、测试名、源文件/源码形状豁免执行义务；不同 ECMAScript 内建算法按语义类别适配是必要实现，但仍须核对是否偷偷改变已准入行为。

## 4. 当前实现与阅读位置

先读 AGENTS.md、README.md、requirements.md、architecture.md、plan.md 顶部当前交接校正；archive 是失效历史，除非用户要求追溯，不作为设计依据。

| 路径 | 内容 |
| --- | --- |
| packages/contracts | 冻结 Core / Instance / Game types 和 schema |
| packages/compiler/src | 统一准入、依赖/ESM 链接、语义降级、捕获与存活分析、代码生成 |
| packages/runtime/src/operations.ts、native-policy.ts | 受控属性/调用/强制转换/迭代操作、原生入口与排除条件 |
| packages/runtime-controlled/src | Program Realm、共享装载、Context 推进、复制/编码与恢复、受控内建状态 |
| runtime-controlled/src/copy-plan.cjs | 稳定 Context 的复用复制布局；并非历史重放 |
| packages/runtime-native | 可信原生/差分对照执行路径 |
| packages/boundary、game-sdk、game-host | 端口值边界、内侧 SDK、外侧游戏交互 |
| packages/policies、session、experiments、analysis | 脚本路由/记忆、会话、实验调度/文件提交、通用统计 |
| examples/doudizhu、forge-duel、resolution | 真实游戏和压力案例，业务测试也在各自 tests |
| examples/forge-duel-viewer | 游戏自己的分析展示；不是强行塞进通用层的游戏规则 |
| vendor/effectful、babel-*、rollup | 带来源/许可的依赖分支与补丁，不能假设上游天然正确 |

当前底座是 Babel/Rollup + 修改后的 EffectfulJS core v2，不能描述成“未决定任何底座”。此前找到上游表达式求值、迭代委托等真实缺陷，也发现 Babel/SWC/TS 的候选降级路线并非换库即可无误。后续评估应看当前生产实现及证据，不能重新凭库名选型。

## 5. 检查结果与剩余工作

当前检查结果、性能数据与剩余验收统一见 [实施计划](plan.md)。本交接文档不再复制随实施变化的计数、运行状态和待办，以免旧结果被误当作当前结果，或已完成工作被重新打开。

## 6. 验证入口

```sh
cd /Users/bytedance/Documents/MRepo/research/bear-forge
npm run check
npm run build
npm run check -w @bear-forge/runtime
npm run check -w @bear-forge/runtime-controlled
```

Test262 需要完整、干净、非 sparse 的固定 revision checkout，设置 `TEST262_ROOT` 后：

```sh
npm run test:test262:parse -w @bear-forge/compiler
npm run test:test262:compile -w @bear-forge/compiler
npm run test:test262:resolution -w @bear-forge/compiler
npm run build -w @bear-forge/runtime-controlled
node --experimental-strip-types --test packages/runtime-controlled/tests/test262/module-execution.test.ts
node --experimental-strip-types --test packages/runtime-controlled/tests/test262/module-runtime-negative.test.ts
node --experimental-strip-types --test packages/runtime-controlled/tests/test262/module-async-execution.test.ts
```

运行前核对目标 Node/V8（此前固定为 Node 26.5.0 / V8 14.6.202.34-node.24）；不要换引擎后静默解释为语义回归或扩大支持。若临时 checkout 不在，重新准备并核对固定 revision，不凭旧日志声称当前执行过。

测试归属各模块 tests；临时探针/日志仅放 /tmp，不提交。仅在相关实现变化或存在具体未验收义务时运行对应检查；文档调整无需重复全套测试。

## 7. 接手要求

先验证仓库与本文一致，向用户给出简洁的现状及剩余清单，然后围绕原目标继续。不要复制整段历史对话，不重复已经确认的技术路线，不重新索要已有授权。继续实施前说明选中的具体缺口和验收依据。

所有改动必须服务于普通程序编写体验、受控 IO、独立 Context 和高效无重放分支恢复。不要扩展成通用安全沙箱，不因预算计费/错误文本细节长期偏离这些核心义务。对正确性、结构与性能分别报告，避免再次用旧段落或局部绿色检查声称整体完成。
