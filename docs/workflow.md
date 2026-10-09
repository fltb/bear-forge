# 执行规则与完成判据

## 唯一事实来源

需求在 requirements.md，职责在 architecture.md，验收项在 plan.md，状态在 checkpoints.json。不得另建平行 TODO/计划来绕开它们。需要更改时同步修改，并在账本 changes 留下原因和用户指令来源。用户最新指令优先；归档内容没有效力。

## 状态机

pending → in_progress → done；in_progress 可变为 blocked，条件解决后回 in_progress。变更导致旧验收失效时重开相关关卡，并使依赖它的已完成关卡重新验收。最多一个 in_progress。

每项 checklist 只有 pending/passed。全部 passed 不自动代表 done：还需证据有效、依赖已完成及最终核验。blocked 必须有实际原因与 next_action，不能以“工作量大”冒充阻碍。

## checkpoint 的执行顺序

1. 读有效文档与账本，运行检查；确认当前用户授权范围。
2. 将当前关卡标为 in_progress；写明目标、剩余项和 next_action。
3. 在 evidence/<ID>/acceptance.md 为每个 checklist ID 绑定产物、实际验收命令、期望结果；冻结门槛后再实现。计划中的“待绑定命令”不算已通过。
4. 按项实现、运行实际检查并保留输出。失败先解决，不能只修改测试期望掩盖失败。
5. 用检查输出、产物哈希生成 evidence/<ID>/report.json；再同步 checklist 与状态。
6. 运行 python3 tools/check_project.py。检查失败就不是完成。
7. 完成报告列出 checkpoint、产物、验收、未完成/后置内容。只有当前用户请求全部满足才能结束；已授权后续关卡不因“本关完成”而自动停止。

每次长任务开始和关键边界保存进度；中断/上下文恢复依账本续做。工具被硬中断可能来不及写入，因此 next_action 必须经常更新，恢复后还要核对真实文件与进程，不盲信旧状态。

## 证据协议

每个完成关卡的 report.json 至少包括：checkpoint、kind、summary、artifacts（相对路径与 SHA-256）、checks（覆盖所有 checklist ID）。每个 check 包括 id、status=passed、command、exit_code=0、log（存在的输出文件路径）。检查日志不可用“预计通过”或手写成功结果替代。

实现关卡另要求 acceptance.md 和 replay_command：reviewer 应能运行该命令重做本关验收。测试/构建代码变化后需重新运行并更新证据，不能沿用旧通过结论。检查工具对产物验证哈希，但并不自动执行全部验收命令；验收者须实际重跑报告中的命令。

C00 是文档关卡，kind=documentation。其检查包括归档完整性、有效文件/链接/清单一致性和检查工具的负向用例；不声明系统运行能力。C01 是设计选型关卡，kind=design。C02–C07 为 implementation，不能用纯文字说明替代可运行证据。

## 防止常见失效

| 失效 | 强制约束 |
| --- | --- |
| 按旧方案干活 | AGENTS 限定读取路径，archive 不生效；有效文档不能链接到归档 |
| 临时换方向 | 记录 changes，修改有效规格与受影响清单，禁止静默减范围 |
| 跳过困难项 | 每项有 ID；依赖未完成不得开下一关；不接受 skipped 作为 passed |
| 写完代码就宣布完成 | 必须有实际命令、日志、产物哈希与全部通过项 |
| 用文档冒充实现 | 不同 kind；实现阶段须有 acceptance 和可重放命令，报告明确未实现部分 |
| 半途退出后失忆 | 当前关卡、剩余项、阻碍、next_action 持久化 |
| 测试过期 | 校验产物哈希；受影响关卡重新验收 |
| 测试只验证自己的假设 | 用需求 ID 追踪、反例/隔离测试和真实端到端产物验收 |

本地校验负责清单、证据和源码一致性。独立 CI 与只读验收者可进一步负责合并审核；该部署属于后续工作。

## 报告模板

完成：本轮目标；完成的 checkpoint/清单 ID；产物路径；执行命令与结果；未完成与后置范围。

中断：当前 checkpoint；已完成项；未完成项；实际阻碍；精确 next_action。不得使用“基本完成”“应该通过”“后续自行运行”冒充验收。
