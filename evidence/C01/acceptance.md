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

## 内侧 SDK 配套补全（实施前门槛）

- C01-03：新增库与协议声明分包，内侧只依赖 IO；请求/事件类别、端口入参返回与外侧 GameContract 关联，类型反例必须拒绝错类别、错数据、未知端口；每个 BaseGame 功能明确内侧对应或仅外侧控制。
- C01-05：斗地主通过公开 SDK lib 运行；既有全局规则、正常/超时对局、事件投影与非法输入测试继续通过。补充递归/循环调用、不同 SDK 实例、输入返回/异常原样传播、原生直接 IO 与 SDK 轨迹一致的测试。
- 命令：`npm run check`（全部通过、无跳过）；`python3 evidence/C01/verify-migration.py`（源码附录与规则基线一致）；`python3 tools/check_project.py --self-test`（负向用例通过）；`git diff --check`（无错误）。日志、哈希记录在本关 report.json。
- 内侧不新增 bind/run/save/fork、宿主回调或独立状态存储；不将原生验证作为受控续延实现证据。
