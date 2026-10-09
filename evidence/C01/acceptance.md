# 当前 C01 验收

当前授权边界与具体门槛见 [convergence-acceptance.md](convergence-acceptance.md)。

| 清单 | 交付与命令 |
| --- | --- |
| C01-01 | 斗地主规则配置及完整单副牌覆盖；docs/doudizhu.md 与规则测试 |
| C01-02 | 后续模块复用与能力选型，按计划单独验收 |
| C01-03 | 三层、纯动作、单步结果、可选能力；npm run check 与逐字段证明 |
| C01-04 | 后续生产实现的验收样例与工作拆分，按计划单独验收 |
| C01-05 | 真实斗地主、SDK、原生消费者、玩家/会话接线、事件与异常路径；npm run check |

一致性验收：python3 evidence/C01/verify-migration.py、python3 tools/check_project.py、python3 tools/check_project.py --self-test、git diff --check。命令退出码、输出及产物哈希写入 report.json。

C01 交付协议、游戏作者包和原生验证消费者。生产受控执行、保存续延及正式绑定器由 C02/C03 验收。完成当前任务后提交推送，并核对远端 HEAD。
