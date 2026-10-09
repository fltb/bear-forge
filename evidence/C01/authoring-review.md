# 独立游戏作者 / runtime 协议相容验证

交付：authoring/types.ts、runtime/types.ts 与 schemas.ts；Core 新增 ManagedStateCapability/ReadView，Game 新增类型化 query 能力。Execution、GameRuntime 和原有可选能力签名保持。公开包提供 authoring/runtime 类型入口，无协议工厂、无实现函数、无版本增加。

协议说明与条件性构造证明见 docs/protocol.md 最后五节。已有 Execution 的 Q/R 分别实例化为 GameRequestPacket/GameResultPacket；初始化、请求、恢复、结束、拒绝、查询与事件映射均有明确语义。完整现场仍包括控制流和局部值，不把 Packet 当作快照。

npm run check 已执行：49 项测试通过，类型与源码边界检查通过。新增4项行为测试；编译消费覆盖全部作者模板、正式/原生 loader 类型隔离、状态只读视图、具体输入/事件/查询模板和现有五类 Game 查询能力映射。错误类型使用 @ts-expect-error 保持反例约束。

两条执行路径共享同一作者函数：原生上下文与 Core 协议映射夹具。夹具仅验证映射关系，无受控编译或恢复实现，不作为 C02 合规证据。C01-03/05 保持待完整验收。

本轮未修改斗地主规则或实现；未选择底层、未创建生产 runtime、未宣称 arbitrary TS 自动合法。正式产物装载校验、随机算法与完整差分工具需要后续实现；公开 loader 的类型品牌不能替代装载验证。
