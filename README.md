# Bear Forge

正式名称 **Bear Forge**，目录与包写法 `bear-forge`。用于固定策略下的游戏对局、构筑替换实验和带证据的关系分析。实现包含提前编译、原生/受控执行、保存恢复与分支、游戏绑定、策略、文件实验、分析及本地查看界面；完整验收进度见 docs/plan.md。神经训练和玩家搜索后置。

完整介绍与审核入口：[项目介绍](docs/project-overview.md)。

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
| examples/doudizhu | 真实斗地主规则、循环、领域 SDK 与外侧适配 |
| packages/contracts/tests | 协议类型、schema、依赖边界测试；support 存放可复用的协议测试夹具 |
| packages/game-sdk/tests | SDK 调用、类型及与外侧游戏接口的接线测试 |
| examples/doudizhu/tests | 规则、合法动作独立核对、领域 schema 与完整原生对局测试 |
| docs | 当前设计、需求和计划 |
| archive | 已失效的历史设计，不作为当前依据 |

Core 提供执行机制，Instance 持有完整现场，BaseGame 在外侧解释游戏交互。两种生产执行器遵循同一协议；受控路径保存完整执行现场，原生路径保留 V8 async/await。

游戏入口：[模块导出](examples/doudizhu/src/index.ts)、[领域 SDK](examples/doudizhu/src/sdk.ts)、[主循环](examples/doudizhu/src/program.ts)。代理工作规则见 [AGENTS.md](AGENTS.md)。

## 正式检查

```sh
npm ci --ignore-scripts
npm run check
```

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
