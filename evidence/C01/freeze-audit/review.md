# 删除重复推进后的审计状态

BaseGame 只通过 bind 配置回调、run 推进。批量返回事件的 GameUpdate 以及 binder 的 initial 包装均已删除；初始边界通过 inspect 获取。搜索消费者已改用子实例 bind/run(maxInputs:1)。F2 所依赖的两种游戏推进模式已不存在；事件只经 onEvent 交付，保留带身份的至少一次重试语义。

F1 仍开放：InstanceCapture.read 需要 Instance，但 transfer 使旧句柄失效，BaseGame 私有持有新句柄且没有捕捉读取接线。此次删除不解决这项独立能力闭合问题，C01-03 不能标为通过。

原始审计及命令输出保存在 baseline/，针对提交 2ed41da80b1570a094726583a6ef2490a25c9fdf，不是当前协议的消费者或重放指令。当前检查执行 `node evidence/C01/freeze-audit/check.mjs`，完整验证执行 `npm run check`。100 个公共定义的覆盖不等于完整正确性证明；生产运行器仍未实现。
