CURRENT STATUS: REOPENED. Controlled-state ownership and resumption are not established by the implementation. The completion assessment below is superseded; native execution test results remain valid only within their stated test scope.

# Core/Game 协议替换与斗地主迁移报告

本轮交付 Core/Game 公共能力、固定公共 schema、斗地主具体模板、公共 Execution 到 Game 的适配器及完整规则程序。包版本保持原值，没有协议工厂或新增旁路宿主接口。

## 结构变化

- contracts/core：执行、输入请求、显式随机、可选保存恢复和自动捕捉。
- contracts/game：运行、观察、动作查询、状态转移/构造、资源释放、评价、编码与事实提取的独立泛型能力。
- 斗地主：schemas.ts 模板、types.ts 特化、implementation.ts 适配、program.ts 唯一循环；保留 SDK、规则、牌型及独立动作 oracle。
- 删除旧 Payload、GameDefinition、ProgramToolkit、协议工厂与上层占位 wire API。上层职责仍在需求和后续验收中。

## 已执行验收

npm run check：类型检查、45 项测试全部通过、源码依赖边界检查通过。原始日志 migration.log，源码哈希 report.json。

真实 program 经公开 Execution 测试提供者完成三种地主席位的对局；覆盖全不叫重发、同时加倍、超时默认直到终局、卡牌守恒、计分和事件增量。非法及过期输入不调用 resume；观察隔离、跨实例游标拒绝、并行独立对局和可复现行为通过。牌型全部类别及九组小手牌与独立子集 oracle 核对保留。

补充错误分类：Core 明确拒绝且未推进时保留游戏边界，可再次提交；Core 已推进但给出无效 Frame 或调用抛出不确定异常时将适配实例标记故障并允许清理。三种情况均有回归测试。终局结果仅存在 state.result，Frame 与 Core 完成状态相互校验。

旧协议工厂和旧上层 API 测试随被替换的协议移除，不能直接用旧测试总数比较覆盖；本轮验证对应当前有效公共接口。类型消费另验证基础运行不强制保存/奖励，以及无玩家语义的 StateTransition。

## 工程判断与剩余范围

完整斗地主可沿这些接口实现，无须给 Core 添加地主、玩家或阶段语义。接入路径只有“具体模板 → 公共类型特化 → 游戏能力实现 → 注入 Execution”。枚举、采样与前缀查询复用同一合法动作来源；当前斗地主实现会生成完整动作数组，未来更大空间可替换内部算法而不改公共能力。

测试提供者为原生 V8 异步执行，提供 Execution/Capture，不提供可序列化继续执行现场。它证明实际游戏与公开接口能接通，不证明生产 Core 的保存恢复。斗地主 StateTransition/StateConstruction、会话幂等回执、训练/分析服务仍未实现。

C01-03、C01-05 本轮通过；C01-02/04 保持 pending，C01 整关不标完成。C02–C07 未启动。
