# Bear Forge

Official name: **Bear Forge**. Directory and package slug: `bear-forge`.
目前只有设计文档和文档验收工具。没有游戏引擎、模型训练器或可用设计分析系统。当前目标是先交付一个游戏的脚本对局与有证据的关系分析闭环。

## 唯一有效入口

按以下顺序阅读，不自行扩大阅读范围：

1. [目标与边界](docs/requirements.md)：做什么、不做什么、验收义务。
2. [架构与接口](docs/architecture.md)：v0.1 模块图、拟建代码树、固定协议及业务覆盖表。
3. [执行规则](docs/workflow.md)：如何工作、留证、恢复和报告完成。
4. [实施计划与清单](docs/plan.md)：唯一实施顺序和逐项验收。
5. [进度账本](checkpoints.json)：当前步骤、状态、证据和下一动作。

代理必须先读 [AGENTS.md](AGENTS.md)。旧版 22 份文档已移到 archive/2026-10-08，全部失效，日常工作不读取。有效文档不依赖旧文档补充定义。

## 当前交付

本轮固定架构与协议，同步文档与执行机制，对应 C00。C01–C07 全部未开始。内部执行库、编译方式和存储实现暂缓决定。

业务核对以[双潮焚契的 15 个场景](docs/scenario-resolution-requirements.md)为输入；协议覆盖分析位于架构文档第 12 节。

检查文档、清单、状态与证据一致性：

```sh
python3 tools/check_project.py
python3 tools/check_project.py --self-test
```

从本目录运行。校验通过仅表示这些机械检查通过，不表示规则正确、游戏覆盖完整、训练有效或设计平衡。
