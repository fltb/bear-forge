# 边界清理审计

- F1 已闭合：capture.read(instanceId,...) 使用提供者授予的独立审计权限。transfer 保持 id，BaseGame 暴露同一 id；close 后留存记录，capture.release 显式回收。类型消费者覆盖绑定游戏后的读取。
- F2 已消除：BaseGame 与 Instance 都仅通过 bind/run 驱动；不存在 submit、resume 或 GameUpdate 公共入口。
- 事件来源统一：仅 event 端口交付通知。DecisionData/TerminalData 不携带事件，ended 不再是 paused 边界；EventDeliveryId 只引用 callId。
- 装载失败统一：两个 loader 都返回 Outcome，不将已知准入失败藏在未声明的成功返回中。
- 契约故障不能伪装成程序 fault：适配器使用公开控制接口撤销驱动并关闭实例，不依赖私有 markFault。

完整需求闭合、状态归属、操作存在性与归纳证明见 ../protocol-freeze-proof.md。原始反例及输出保留在 baseline/，只对应旧提交，不是当前消费代码。

当前审计命令：`node evidence/C01/freeze-audit/check.mjs`；完整类型/原生/schema 验证：`npm run check`。这些命令不测试尚未实现的生产运行器；其履约义务单独留在 C02/C03。
