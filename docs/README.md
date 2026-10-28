# 文档索引

本目录共 25 篇文档（23 篇正文 + 本索引 + 1 份计划归档），按受众分为「框架通用」与「STS 专属」两类。STS 是当前旗舰示例，但框架、协议和实施规格仍适用于其他游戏；历史归档不作为当前依据。

## 怎么读

- 想先玩 STS：本页 → [STS 玩家模拟器与 TUI](sts-simulator.md)（`npm run sts:tui`）→ [沃利贝尔实现契约](volibear/DEVELOPMENT.md)（需要查卡表时）。
- 想用框架或做其他游戏：本页 → [项目介绍](project-overview.md) → [需求](requirements.md) → [架构](architecture.md) → [协议](protocol.md) → 按任务读规格。
- 查进度：只以 [plan.md](plan.md) 为准；历史进度见 [plan-archive-2026-10.md](plan-archive-2026-10.md)。

## 框架通用

| 文档 | 内容 |
| --- | --- |
| [plan.md](plan.md) | 唯一进度清单；顶部「仓库结构收敛」说明当前目录、入口与参考 pin |
| [requirements.md](requirements.md) | 业务需求与边界；顶部为最新 STS 追加要求 |
| [project-overview.md](project-overview.md) | 项目定位、三层协议、执行路径、实验与审核入口 |
| [architecture.md](architecture.md) | Core／Instance／BaseGame 三层、Context 与数据流 |
| [protocol.md](protocol.md) | 公共协议字段与语义（冻结） |
| [implementation-spec.md](implementation-spec.md) | 从协议到首版完整系统的实施规格（含训练与 STS 复刻） |
| [card-core-spec.md](card-core-spec.md) | 并列卡牌后端、可扩展规则模型与整体优化设计 |
| [card-core-proof.md](card-core-proof.md) | 卡牌内核语义与正确性证明 |
| [controlled-program-spec.md](controlled-program-spec.md) | 受控程序与编译执行的规范 |
| [compiler-and-differential-spec.md](compiler-and-differential-spec.md) | 受控编译、准入与差分验收方法 |
| [scenario-resolution-requirements.md](scenario-resolution-requirements.md) | 双潮焚契结算、分支与恢复压力案例 |
| [doudizhu.md](doudizhu.md) | 斗地主示例：规则配置与接口验证 |
| [forge-duel.md](forge-duel.md) | Forge Duel 示例游戏规则 |
| [handoff.md](handoff.md) | 2026-10-15 新对话交接说明（历史上下文，进度不在此维护） |
| [card-resolution-spec.md](card-resolution-spec.md) | 历史 TS 组合库设计；已被专用卡牌后端替代 |
| [card-resolution-proof.md](card-resolution-proof.md) | 历史组合库的形式语义与证明 |

## STS 专属

| 文档 | 内容 |
| --- | --- |
| [sts-simulator.md](sts-simulator.md) | 玩家 TUI：启动、键位、界面、存档、事件与验收 |
| [sts-entry.md](sts-entry.md) | 旧 JSONL／数字终端逐步评审入口与协议 |
| [sts-agent-guide.md](sts-agent-guide.md) | 交给代理的独立玩家指导、操作原则与停机规则 |
| [sts-rule-gaps.md](sts-rule-gaps.md) | 与规则书的差异清单、修复依据与参考 pin 说明 |
| [player-search-spec.md](player-search-spec.md) | 2026-10-25 封存的启发式搜索设计；不代表当前方向 |
| [volibear/CARDS.md](volibear/CARDS.md) | 沃利贝尔 S2-3.0 完整卡表（文字） |
| [volibear/DEVELOPMENT.md](volibear/DEVELOPMENT.md) | 沃利贝尔实现契约与内容目录约定 |

`volibear/` 下另有数据文件 [cards_s2.json](volibear/cards_s2.json) 与 [implementation_spec.json](volibear/implementation_spec.json)，随契约使用。STS 最新的追加需求写在 [requirements.md](requirements.md) 顶部，该页同时保留框架层面的需求。

## 历史归档

| 位置 | 内容 |
| --- | --- |
| [plan-archive-2026-10.md](plan-archive-2026-10.md) | plan.md 中 2026-10-19 及以前的条目，原文按顺序归档 |
| [../archive/](../archive/) | 已失效的历史设计（含 2026-10-08 快照与旧编译器笔记），只有追溯时才读取 |
