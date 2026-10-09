# Bear Forge

正式名称 **Bear Forge**，目录与包写法 `bear-forge`。当前交付 Core / Instance / BaseGame 协议声明及迁移后的完整斗地主游戏作者包；生产执行、编译、绑定与训练实现留在后续关卡。

## 有效入口

1. [目标与边界](docs/requirements.md)
2. [分层与数据流](docs/architecture.md)
3. [执行规则](docs/workflow.md)
4. [计划与清单](docs/plan.md)
5. [协议字段和法则](docs/protocol.md)
6. [斗地主规则和接线](docs/doudizhu.md)
7. [受控程序规范](docs/controlled-program-spec.md)

代理读取 [AGENTS.md](AGENTS.md)；状态以 checkpoints.json 为准。归档与旧 evidence 是历史记录，不补充当前规范。

## 当前结构

Core 提供通用执行机制，Instance 承载完整现场。游戏只通过声明端口进行外部调用。Instance.bind/run 负责通用端口回调与驱动；BaseGame.bind({player,...}) 独立注册玩家，run 交付各自的请求和事件，并提供只读查询；具体游戏以 GameModule={program,contract} 提供真实规则程序和共享游戏约定。搜索、训练、会话与分析在上层。

游戏入口：[game / program](games/doudizhu/src/index.ts)。[SDK](games/doudizhu/src/sdk.ts) 在 Instance 内持有显式 seed 驱动的随机流并发牌，[主循环](games/doudizhu/src/program.ts) 通过 decision 端口请求输入、event 端口主动发布事件。规则状态和续延统一由 Instance 持有。

输入选择是指定真实入口上的 exact 值列表或 construct JSON 约定。动作、交付时间与会话信号分别声明。Core 捕捉/保存是可选能力，游戏保存复用 InstanceSnapshot，搜索使用同类型 fork 后的普通游戏接口；普通运行不要求存档或训练。

协议的需求闭合与构造证明见 [协议证明](evidence/C01/protocol-freeze-proof.md)，字段原文和场景映射见 [报告](evidence/C01/boundary-migration-review.md)。万智牌 like 需求保留在 [15 个压力场景](docs/scenario-resolution-requirements.md)。

## 检查

```sh
npm ci --ignore-scripts
npm run check
python3 tools/check_project.py
python3 tools/check_project.py --self-test
```

类型与 schema 检查、实际原生游戏测试、独立牌型 oracle 和公共导出证明索引共同验证本轮交付。生产执行与绑定的履约验收在 C02/C03，训练与实验交付按后续清单执行。
