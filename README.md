# Bear Forge

正式名称 **Bear Forge**，目录与包写法 `bear-forge`。用于固定策略下的游戏对局、构筑替换实验和带证据的关系分析。实现包含提前编译、原生/受控执行、保存恢复与分支、游戏绑定、策略、文件实验、分析及本地查看界面；受控执行采用共享 Program 与独立 Context，分支及恢复不重新初始化程序；完整验收进度见 docs/plan.md。训练入口包含现成 DouZero 学习器及两游戏共用的自研 Transformer/PPO，模型通过同一 Policy 和 Card Core 执行。玩家搜索、Rust 迁移和运行时性能优化继续后置。

完整介绍与审核入口：[项目介绍](docs/project-overview.md)。

本机斗地主脚本实验复用已有策略与共享实验 runner：

```sh
npm run doudizhu:experiment -- data/ddz-scripts examples/doudizhu/experiments/scripts.json
# 省略配置，读取原目录注册信息续跑；已提交的任务不重复执行
npm run doudizhu:experiment -- data/ddz-scripts
```

配置中 `seats` 按 0/1/2 席位选择 `first`、`last`、`random`；`games` 和 `seed` 控制局数与起始种子，`engine` 可选 `native`/`controlled`，两者都运行现有 Card Core。输出目录保存现有实验格式的观察、已接受决策和结果。全员 `first` 会持续不叫并按 `maxSteps` 截断，这是策略行为，不计为输局。目录绑定配置与实现版本，改变配置或源码时使用新目录。三个脚本及现成训练器闭环已验证；当前自研训练与模型实验进度见 [计划](docs/plan.md)。

现成训练器接入使用固定提交的 [DouZero](https://github.com/kwai/DouZero/tree/718a5c920bf3361e34178a38f3b80458e176b351)（Apache-2.0），直接调用其模型、优化器及 DMC `learn`；Python 游戏环境不参与推进。先创建隔离环境，再在仓库根目录运行：

```sh
uv sync --frozen --project examples/doudizhu --python 3.14
npm run doudizhu:training -- train examples/doudizhu/experiments/train.json
npm run doudizhu:training -- resume examples/doudizhu/experiments/resume.json
npm run doudizhu:training -- eval examples/doudizhu/experiments/eval.json
```

`train` 默认目标 20,000 条出牌样本或 10 分钟，`resume` 新增最多 100,000 条或 60 分钟；达到任一预算后在完整对局边界保存。模型通过既有 Policy 和实验 runner 执行完整斗地主，叫分与加倍使用固定脚本，当前只学习出牌。`data/ddz-training/model.pt` 保存模型、优化器、随机状态、下一局种子和计数，另保留两份旧 checkpoint；Ctrl-C 请求在当前局结束后保存退出。新训练拒绝覆盖已有模型目录，恢复必须保持采样配置。评测使用独立种子和三个席位，统一叫分/加倍脚本，First/Last/Random 只作为出牌对手（阶段 1 的原始脚本不变）；可在评测配置中加入 `previousCheckpoint` 对战旧模型。指标写标准输出，模型产物不提交 Git。

WP 预训练接入使用同一个运行器：

```sh
npm run doudizhu:weights -- data/douzero-wp
npm run doudizhu:training -- init examples/doudizhu/experiments/wp-baseline.json
npm run doudizhu:training -- init examples/doudizhu/experiments/wp-initialize.json
npm run doudizhu:training -- train examples/doudizhu/experiments/wp-train.json
npm run doudizhu:training -- resume examples/doudizhu/experiments/wp-resume.json
npm run doudizhu:training -- eval examples/doudizhu/experiments/wp-eval.json
```

官方 README 的 Google Drive 下载入口目前返回 404；下载命令采用 [DouZero_API 固定提交中的 WP 镜像](https://github.com/pineoncellar/DouZero_API/tree/ca8c841552e08d602ad326d2c7450b683bf41226/baselines/douzero_WP)，来源和 Apache-2.0 代码许可证链接写入模型元数据，不声称已与失效入口的原文件核验一致。三角色权重以 `weights_only=True` 严格检查后导入。`wp-baseline` 保存原始维度的冻结教师；`wp-initialize` 保存扩展维度、尚未更新的学生。迁移按输入列位置复制参数，新增 91 列权重为零；其余层保持原值。原教师对我们的全部合法候选评分，同牌不同解释采用现有候选顺序破同分，绝不裁掉动作或让 Python Env 结算游戏。

当前默认每角色跨完整对局累计 `batchSamples:3200` 条样本调用上游 `learn`。`samples` 计已采集的学生出牌样本，`learnedSamples` 计实际参与更新的样本，`pendingSamples` 是未满批尾部；三者可核对。旧 checkpoint 没有角色样本计数，其已学习总量另保留为 `legacyLearnedSamples`。尾部随模型/优化器一起保存，预算结束不强制用很小的尾批更新。恢复保持批次、探索及教师配置；旧 checkpoint 可读取并转入跨局训练。WP 训练默认每两局插入一局冻结教师对手，学生地主和两名学生农民轮换，其余局自博弈，教师从不更新；`teacherCheckpoint` 与 `teacherEvery` 控制此配置。预训练初始化与冻结对手提供训练指导，未另写蒸馏算法。

默认 `evaluationMode:team`：同 seed 同副牌，学生地主对两名对手农民，再用两名学生农民对对手地主；报告两阵营与等权综合结果、规则团队得分和按 seed 聚类区间。每阵营 300 局来自 300 个独立 seed。`single` 保留旧单座位替换诊断，`both` 同时输出，两种口径分别标记。单阵营另报 Wilson 区间，避免 0/1 胜率时区间退化。评测和训练种子必须分开，已有模型目录可直接用于 `eval`，新训练及初始化拒绝覆盖。导入模型后的训练计数仅表示本框架新增样本和更新，不包含上游预训练量；初始化即具备的棋力不能归因于本机这轮训练。

## 自研训练与模型实验

`packages/training` 提供独立的 PyTorch/NumPy 环境、小型 Transformer 候选动作策略/价值网络及 PPO，不调用 DouZero 的学习算法。斗地主的叫分、加倍、反加倍和出牌都由模型决策；Forge Duel 复用同一网络与更新代码。游戏规则和推进仍只由 TS/Card Core 执行，Python 接收玩家可见特征和完整合法候选。

```sh
npm run training:setup
# 斗地主示例使用上方已初始化的 WP 教师；无教师训练可设置 teacher:false 并移除 teacherCheckpoint
npm run training -- train examples/doudizhu/experiments/ppo-train.json
npm run training -- resume examples/doudizhu/experiments/ppo-resume.json
# 可在评测配置中加 previousCheckpoint，与另行保留的旧模型比较
npm run training -- eval examples/doudizhu/experiments/ppo-eval.json

npm run training -- train examples/forge-duel/experiments/ppo-train.json
npm run training -- resume examples/forge-duel/experiments/ppo-resume.json
npm run training -- eval examples/forge-duel/experiments/ppo-eval.json
```

模型仅收集完整终局中实际接受的动作，保存行为版本和真实采样概率。默认跨局累计 1,024 条后执行四轮 PPO；未满批尾部随模型、Adam、随机状态和下一局种子原子保存，Ctrl-C 在完整对局边界退出。恢复须使用相同游戏、编码、学习/采样配置、教师版本及 Python 实现。教师标签来自学生实际到达的可见状态，只用于可选交叉熵监督；标签不会替换已经执行的动作。

斗地主评测的 `evaluationScope:both` 分开报告两种结果：`all` 由模型决定所有阶段，逐座位替换后地主身份可能变化；`playing` 统一叫分/加倍，交换完整地主/农民阵营比较出牌。两者不能混成同一个棋力指标。评测不更新模型，使用与训练不重叠的种子；短预算训练不保证超过 WP。

冻结 Forge 模型后，用 `model-` 前缀命名并在 `models` 映射 checkpoint，即可进入已有构筑替换、交互分析和证据页面：

```sh
npm run experiment -- --config examples/forge-duel/experiments/ppo-relations.json --output data/ppo-relations
npm run analyze -- --output data/ppo-relations
npm run serve -- --output data/ppo-relations
```

该配置执行 1,024 局，包含发现/确认、交换座次和四种干预条件。模型版本、文件内容和学习器实现共同冻结；继续实验时改动权重会被拒绝。查看页面沿用原有策略筛选、关系图、任务和逐玩家证据入口。模型、依赖环境及实验数据保存在本地忽略目录，不提交 Git。

## 阅读入口

- [目标与边界](docs/requirements.md)
- [分层与数据流](docs/architecture.md)
- [协议字段和语义](docs/protocol.md)
- [斗地主规则和接线](docs/doudizhu.md)
- [受控程序规范](docs/controlled-program-spec.md)
- [业务压力场景](docs/scenario-resolution-requirements.md)
- [完整实施规格](docs/implementation-spec.md)
- [当前进度与计划](docs/plan.md)

## 目录

| 目录 | 内容 |
| --- | --- |
| packages/contracts | 公共 TS 类型与 Zod schema |
| packages/game-sdk | 程序内使用的类型化端口薄封装 |
| packages/card-engine | 卡牌声明与专用同步执行器；另保留通用程序使用的旧 async 组合库 |
| packages/runtime-card | 并列专用卡牌后端：同步结算、COW 分支、保存恢复和记录重放；不经过通用编译器 |
| packages/training | 自研 Transformer/PPO、接受轨迹、概率采样及学习器进程连接 |
| examples/doudizhu | 真实斗地主规则、卡牌定义与外侧适配 |
| packages/contracts/tests | 协议类型、schema、依赖边界测试；support 存放可复用的协议测试夹具 |
| packages/game-sdk/tests | SDK 调用、类型及与外侧游戏接口的接线测试 |
| examples/doudizhu/tests | 规则、合法动作独立核对、领域 schema 与完整原生对局测试 |
| docs | 当前设计、需求和计划 |
| archive | 已失效的历史设计，不作为当前依据 |

Core 提供执行机制，Instance 持有完整现场，BaseGame 在外侧解释游戏交互。通用程序和专用卡牌后端遵循同一对外协议。通用原生入口运行受信任 JS，通用编译入口提供其准入保障；专用卡牌原生/受控都执行同一 Card Core，受控模式增加图状态隔离、保存、恢复、分支及步骤记录。

游戏入口：[模块导出](examples/doudizhu/src/index.ts)、[卡牌流程](examples/doudizhu/src/card.ts)、[生产契约](examples/doudizhu/src/contract.ts)。代理工作规则见 [AGENTS.md](AGENTS.md)。

## 正式检查

```sh
npm ci --ignore-scripts
uv sync --frozen --project examples/doudizhu --python 3.14
npm run training:setup
npm run check
```

作者程序及传递依赖使用严格 ES Module。`.js`/`.ts` 按 ESM 解析，`.mjs`/`.mts` 明确为 ESM；CommonJS 和 Script 输入在准入阶段拒绝。

根目录的 `npm run check` 汇总各 workspace 的类型检查和测试。`npm run typecheck`、`npm test` 分别汇总对应检查；每个模块都有自己的 package.json 脚本和 tsconfig.json。

只检查一个模块：

```sh
npm run check --workspace @bear-forge/contracts
npm run check --workspace @bear-forge/game-sdk
npm run check --workspace @bear-forge/doudizhu
```

也可以进入模块目录直接运行 `npm run check`。测试输出直接显示，不提交运行日志或验收报告。协议测试夹具可以被依赖方的测试复用，不进入生产导出。

受控执行改用提前编译、运行时装载产物；库选择、通用 benchmark/游戏差分与恢复测试见 [编译与差分规格](docs/compiler-and-differential-spec.md)。

## 首版演示

```sh
npm run build:viewer
npm run demo -- --output ./data/demo
npm run serve -- --output ./data/demo
```

打开 http://127.0.0.1:4173。demo 从空目录运行真实对局、文件提交和关系分析；小样本显示未知。完整实验、恢复和限制见项目介绍。

## 专用卡牌路径

同一 cardDefinition 的原生/受控模式都经过卡牌 Core，没有无 Core 的正式卡牌模式。两游戏模块、card:run/card:replay、build:games 和 demo/experiment 已接此路径。旧 async 游戏入口移入 tests/generic，作为通用后端的兼容性夹具；旧参考仅生成差分期望，正式 BaseGame 基准使用生产契约。

当前基准为同一 Card Core 上的完整可交互 GameHost：原生游戏自身的多余路径单独核算，受控再核算新增能力的成本。默认原生不承担未启用的训练、记录、COW 或存档管理；游戏历史、观察、合法动作及实际事件交付保留。[完整游戏优化方案](docs/card-core-spec.md#gamehost-optimization) 与尚未完成项保留，当前按用户要求冻结性能优化，实际完成状态见 plan.md。原生审计使用已有 recordCore:true；默认原生不发布 capture，--records 等显式消费者保留完整记录与重放。

通用 Program/编译执行入口保留。专用卡牌规则导出为各游戏的 `cardDefinition`，通过 `createCardLoader({ controlled: true | false })` 装载；加载结果仍为既有 Core/Instance/capture/persistence，GameContract 与 BaseGameBinder 不变。专用 Card Core 解释静态效果步骤，内部同步推进，遇端口才返回；受控模式提供步骤预算、分支隔离、存档与记录，不宣称任意 JS 的编译沙箱保障。

GameContract 作者适配函数按用户确定的纯只读契约借用稳定发布数据，两模式一致。活动世界、schema 可写输入、玩家回调及公开返回仍彼此隔离；不为每次纯适配调用复制整份 view。

```sh
npm run card -- --game forge-duel --seed 87
npm run card -- --game doudizhu --seed 31 --native
npm run card -- --game forge-duel --records /tmp/forge-card-records.json
npm run benchmark:card -w @bear-forge/forge-duel -- card-controlled
npm run benchmark:card -w @bear-forge/doudizhu -- instance-controlled
```

完整游戏基准使用 game-native/game-controlled（benchmark:card 默认 game-controlled），两模式都按收到的合法选项选动作并实际接收事件，计时前与独立旧游戏逐项比较完整交互。card-native、card-controlled、card-controlled-recorded、instance-native、instance-controlled、basegame-native、basegame-controlled 保留为局部诊断；裸 Core/Instance 不包含完整交互，不能据此计算合理包装预算或完整原生下界。游戏规则与装载、声明语义、正确性证明及边界见 [专用后端方案](docs/card-core-spec.md)、[证明](docs/card-core-proof.md)。实际进度与尚未完成的验证只见 docs/plan.md。
