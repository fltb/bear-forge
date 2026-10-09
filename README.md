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

Core 提供执行机制，Instance 持有完整现场，BaseGame 在外侧解释游戏交互。程序通过 IO.call 使用声明端口，内侧 SDK 和游戏循环在 Instance 内执行。

请求直接指定 player。onRequest 只返回动作，describe/validate 对应相同动作类型；时钟和超时通过可选 bindControl 输入。一次 run 接受至多一个游戏输入，返回具体接受结果并交付后续事件。

保存恢复、同类型分支和捕捉记录按功能路径独立导出。默认包入口有十个日常类型，细节与 schema 位于各自模块。训练、搜索、分析由上层组合公开能力。

游戏入口：[game / program](games/doudizhu/src/index.ts)；[SDK](games/doudizhu/src/sdk.ts)；[主循环](games/doudizhu/src/program.ts)。协议矩阵见 [架构](docs/architecture.md)，全部字段见 [报告](evidence/C01/boundary-migration-review.md)，构造证明见 [协议证明](evidence/C01/protocol-freeze-proof.md)。[15 个压力场景](docs/scenario-resolution-requirements.md) 保留业务需求。

## 检查

```sh
npm ci --ignore-scripts
npm run check
python3 tools/check_project.py
python3 tools/check_project.py --self-test
```

类型与 schema 检查、实际原生游戏测试、独立牌型 oracle 和公共导出证明索引共同验证本轮交付。生产执行与绑定的履约验收在 C02/C03，训练与实验交付按后续清单执行。
