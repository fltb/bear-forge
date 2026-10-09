# C01 协议与游戏作者包验收

范围：Core / Instance / BaseGame 公共协议、玩家绑定、完整斗地主作者包、原生与类型消费者、字段报告和条件证明。C02/C03 验收生产执行、绑定、保存与分支。

| 清单 | 交付 | 验收命令与结果要求 |
| --- | --- | --- |
| C01-01 | 斗地主规则配置、歧义解释和单副牌覆盖 | docs/doudizhu.md 审阅；npm run check 的规则与完整对局验收 |
| C01-02 | 候选底座与后端选择 | 保留原计划的选型关卡 |
| C01-03 | 公共 type/schema、作者接口、逐玩家交互、表达与组合证明 | npm run check；python3 evidence/C01/verify-migration.py；逐字段与需求映射审阅 |
| C01-04 | 生产底座验证输入 | 保留原计划对应验收 |
| C01-05 | 真实斗地主 SDK、循环、规则、协议接线 | npm run check；规则基线哈希；逐玩家完整对局、超时与拒绝测试 |

## 约定与行为

- Core 使用声明端口；Instance 持有完整续延及 SDK 状态。内侧规则推进由 program.run 执行。
- GameContract 定义纯 receive/respond/finish/playerFor/observe/projectEvent/describe/query，BaseGame 持有真实 Instance 并按 player 绑定。
- 请求只包含当前 player 的 observation 和 offers，信号接收者显式声明；事件通过游戏投影后交付。同一函数的不同玩家绑定相互独立。
- validate 和回复检查 player、当前调用与输入关联；非法回复保持规则状态不变。并发回复接受一次，取消后迟到回复失效。
- 分支返回同类型对象；保存复用 InstanceSnapshot；捕捉通过提供者能力按 id 读取并显式释放。
- 斗地主保留真实规则、主循环、SDK、牌型和独立 oracle；正常出牌与超时均通过玩家回调完成对局。
- exact/construct 保持类型关联；delivery/signal 各自声明。游戏与消费者共同核对完整输入可构造。

具体 player 场景与命令见 [player-acceptance.md](player-acceptance.md)。规则与 oracle 文件对照迁移基线哈希。字段报告逐字包含当前公共声明；证明索引覆盖所有公共导出与对应法则。

## 交付

文档、账本、日志与哈希通过 python3 tools/check_project.py、--self-test 和 git diff --check 验收。

实际执行检查后记录退出码、输出及产物 SHA-256；同步计划/账本与报告。最终提交并推送 fltb/bear-forge，核对本地 HEAD、远端 main 与工作树。
