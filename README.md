# Bear Forge

Bear Forge 是通用的卡牌执行与实验框架：同一份游戏规则可以运行不同策略和构筑，保留真实对局证据，并分析卡牌替换、条件克制与协同关系。仓库同时带完整游戏示例，其中 `examples/sts`（杀戮尖塔式 A20 玩法复刻，含铁甲与沃利贝尔两名角色及玩家 TUI）是当前旗舰示例，`examples/doudizhu` 与 `examples/forge-duel` 用于验证框架、训练和实验闭环。

## 30 秒入口

### 玩 STS

Node 24（`.node-version` 已固定，fnm/nvm 进入仓库会切换；`engines` 最低 22.18），在仓库根目录：

```sh
npm install
npm run sts:tui
# 指定新局目录与角色；目录必须不存在或为空
npm run sts:tui -- --save data/sts-saves/my-run --character ironclad
# 保存退出后直接装载原 Context 继续
npm run sts:tui -- --resume data/sts-saves/my-run
```

现有角色 `ironclad` / `volibear`，现有难度 A20。默认自动存档，`q` 或 Ctrl-C 保存退出；不指定目录时会自动生成路径并打印。不同规则源码或 Node 主版本的存档拒绝加载。

- 操作键位、界面分区、存档与事件接口：[STS 玩家模拟器与 TUI](docs/sts-simulator.md)
- 旧 JSONL／数字终端逐步入口（评审用，非 TUI）：[STS 玩家入口](docs/sts-entry.md)
- 交给代理的独立玩家指导与停机规则：[STS agent 指导](docs/sts-agent-guide.md)
- 已知规则差异与修复依据：[STS 规则差异清单](docs/sts-rule-gaps.md)
- 沃利贝尔定稿卡表与实现契约：[卡表](docs/volibear/CARDS.md)、[实现契约](docs/volibear/DEVELOPMENT.md)

### 框架 / 其他游戏

```sh
npm run check
npm run card -- --game forge-duel --seed 87
npm run experiment -- --config examples/forge-duel/experiments/baseline.json --output ./data/baseline
npm run analyze -- --output ./data/baseline
npm run serve -- --output ./data/baseline
```

框架目标、三层边界、实验与证据的完整说明见 [项目介绍](docs/project-overview.md)；执行模型与分层见 [架构](docs/architecture.md)；公共字段语义见 [协议](docs/protocol.md)；从协议到首版完整系统的实施方案见 [完整实施规格](docs/implementation-spec.md)。

其他示例：

| 示例 | 用途 | 文档 |
| --- | --- | --- |
| `examples/doudizhu` | 完整实际游戏与协议接线，DouZero 与自研 PPO 训练 | [斗地主规则和接线](docs/doudizhu.md) |
| `examples/forge-duel` | 可构筑研究游戏与关系实验闭环 | [Forge Duel v1](docs/forge-duel.md) |
| `examples/resolution` | 双潮焚契复杂结算、分支与恢复压力案例 | [结算与恢复案例](docs/scenario-resolution-requirements.md) |
| `examples/sts` | 完整 STS 复刻、玩家 TUI、差分参考 | [STS 玩家模拟器](docs/sts-simulator.md) |

实验、策略、训练与查看器的命令细节统一写在 [完整实施规格](docs/implementation-spec.md) 和 [项目介绍](docs/project-overview.md)，不在本页重复。

## 当前状态与边界

- STS 玩家 TUI 已可启动、完整游玩、保存退出并跨进程恢复；旧启发式搜索路线已封存（[搜索规格](docs/player-search-spec.md)），不继续调参或自动开局。未完成真实第四幕碎心，普通死亡／第三幕胜利不等同碎心。
- 严禁历史重放：真实动作执行后只能从实际后继继续，恢复必须接续最新已保存现场；动作带、日志和记录只作只读证据。
- 框架侧已完成编译器、原生／受控执行、保存恢复与分支、游戏绑定、策略、文件实验、统计分析与本地查看界面；训练侧有现成 DouZero 接线和两游戏共用的 Transformer/PPO，模型通过同一 Policy 与 Card Core 执行。完成状态以 [进度清单](docs/plan.md) 为准。
- 完整状态与未完成项只维护在 [docs/plan.md](docs/plan.md)；`archive/` 是已失效的历史设计，不作为当前依据。

## 目录

| 目录 | 内容 |
| --- | --- |
| packages/contracts | 公共 TS 类型与 Zod schema（冻结协议） |
| packages/game-sdk | 程序内使用的类型化端口薄封装 |
| packages/boundary、packages/compiler、packages/runtime、packages/runtime-native、packages/runtime-controlled | 值复制与 schema 准入、通用程序编译、执行、原生／受控后端与快照 |
| packages/card-engine、packages/runtime-card | 专用卡牌内核：声明、同步结算、COW 分支与持久化 |
| packages/game-host、packages/policies、packages/session | 请求／观察／动作投影、策略隔离、会话时间 |
| packages/experiments、packages/analysis、packages/training | 实验登记与调度、关系统计、自研 Transformer/PPO |
| examples/sts | 旗舰示例：完整 STS 内容、CLI/TUI、参考差分与搜索 |
| examples/doudizhu | 完整斗地主规则、训练与实验接线 |
| examples/forge-duel | 可构筑研究游戏与实验闭环 |
| examples/forge-duel-viewer | 只读关系图与证据界面 |
| examples/resolution | 双潮焚契结算压力案例 |
| tools/cli | 仓库开发命令聚合器（`@bear-forge/dev-cli`），可依赖 examples |
| docs | 设计、规格、进度；分类索引见 [docs/README.md](docs/README.md) |
| archive | 已失效的历史设计，不作为当前依据 |

公共协议由 Core／Instance／BaseGame 三层组成：Core 提供执行机制，Instance 持有完整现场，BaseGame 在游戏侧解释请求、动作与事件。通用程序与专用卡牌后端遵循同一对外协议。代理工作规则见 [AGENTS.md](AGENTS.md)。

## 常用命令

```sh
# 安装与检查
npm ci --ignore-scripts
npm run check                 # 全仓汇总类型检查与测试
npm run typecheck             # 仅类型检查
npm test                      # 仅测试

# STS
npm run sts:tui
npm run sts -- play --character ironclad --ascension 20 --seed 130 --output data/sts-review/ironclad-001 --interface terminal
npm test -w @bear-forge/sts

# 框架游戏 / 实验 / 查看器
npm run card -- --game forge-duel --seed 87
npm run build:games
npm run build:viewer
npm run demo -- --output ./data/demo
npm run serve -- --output ./data/demo
npm run evaluate -- --config examples/forge-duel/experiments/deck-evaluation.json --output data/forge-deck-evaluation
```

训练与评估（DouZero、WP 预训练、自研 PPO、斗地主脚本实验）需要 Python 环境与额外安装步骤，命令和验收边界见 [完整实施规格](docs/implementation-spec.md) 第 17–20 节；本机已完成的零训练卡组评估结果与限制见 [计划归档](docs/plan-archive-2026-10.md)。

## 正式检查

```sh
npm ci --ignore-scripts
uv sync --frozen --project examples/doudizhu --python 3.14
npm run training:setup
npm run check
```

根 `npm run check` 汇总各 workspace 的类型检查和测试，每个模块有自己的 `typecheck`／`test`／`check` 脚本。也可只查一个模块：

```sh
npm run check --workspace @bear-forge/contracts
npm run check --workspace @bear-forge/sts
```

作者程序及传递依赖使用严格 ES Module；`.js`/`.ts` 按 ESM 解析，CommonJS 和 Script 输入在准入阶段拒绝。测试输出直接显示，不提交运行日志或验收报告。构建产物在 `build/`，演示与实验输出由 `--output` 指定，均为业务产物，不提交 Git。

## 卡牌内核性能复现

以下入口只运行专用 Card Core 和原 STS 规则。每个样本创建新的 Context，动作取自当次合法选项；不读取动作带，不恢复封存搜索。使用同一 Node 24 版本，交错运行两个提交的独立工作树，避免并发测试干扰计时。

```sh
# 几何规模：数组、替换链、事件环境、FX/Query、FIFO 任务
npm run performance:kernel -w @bear-forge/runtime-card -- --case all

# 原战斗路径的压力夹具；每个角色用独立进程对照
npm run performance:kernel -w @bear-forge/sts -- --workload combat --character ironclad --warmup 5 --samples 7
npm run performance:kernel -w @bear-forge/sts -- --workload combat --character volibear --warmup 5 --samples 7

# 正常开局经过完整生产 BaseGame，启用玩家展示事件，运行到真实死亡或胜利
npm run performance:kernel -w @bear-forge/sts -- --workload run --lane basegame --detailed-events

# 单独核对全部公开请求、事件与最终输出；此模式不作为性能分数
npm run performance:kernel -w @bear-forge/sts -- --workload combat --verify --samples 1 --warmup 0

# 预热后采样新 Context 样本（含初始化、执行和关闭）；不作为性能分数
npm run performance:kernel -w @bear-forge/sts -- --workload combat --character ironclad --profile /tmp/sts-kernel.cpuprofile
```

内核微基准的 `--size` 支持逗号分隔规模；`--samples`、`--warmup` 调整独立样本数。`fx-query` 测标量调用，`fx-record` 测有 schema 的对象参数和结果；事件捕获可用 `--listeners`、`--events` 分别改变监听器和事件数。STS `combat` 复用已有高生命战斗夹具（9990/10000 HP），默认 Chosen＋Cultist；`--encounter TIME_EATER` 可测另一种原规则。该压力夹具不代表正常初始生命的胜率。`run` 使用工程合法动作策略，死亡同样是真实终局，不是通关质量评估。初始化、后续执行和关闭分别计时；公开边界哈希与指令数用于确认可比工作量，微基准倍率不能当作整局倍率。

STS 输出保留每个样本的墙钟与进程 CPU 用时；后者包含 GC 工作线程，不能当作主线程墙钟。峰值 RSS 覆盖装配、预热及全部样本，`heapUsed` 未强制 GC，均不能解释为单场战斗的净分配量。`--profile` 只接受一个角色，预热后才开始采样，窗口包含新 Context 初始化、执行、最终哈希、关闭及汇总输出，排除 Program 装配和预热；它不是严格的 execute-only profile，输出的 `profileScope` 说明此边界，并明确标记计时无效。排查停顿可另加 Node 的 `--trace-gc-nvp`、`--trace-deopt`，不要把这些诊断运行当作速度分数。BaseGame 基准也不包含完整 TUI 的调度、自动存档与终端渲染。

## 文档

全部文档的分类索引（框架通用／STS 专属／历史归档）见 [docs/README.md](docs/README.md)。最短阅读路径：本页 → [项目介绍](docs/project-overview.md) → [需求](docs/requirements.md)／[架构](docs/architecture.md)／[协议](docs/protocol.md) → 按任务读规格文档 → [当前进度](docs/plan.md)。
