# 当前协议审核

三层依赖与功能路径已明确。默认入口十个类型；保存、分支、捕捉和会话控制按需导入。动作不含时间，请求直接指定 player，describe/validate 对应同一个 Action。

Instance 与 Game 都单步推进。Game 返回具体接受结果，后续事件暂停、取消、程序或契约故障均保留该结果。事件按玩家投影，游戏程序负责多方输入封存和结算。

装载配对责任由调用方承担；绑定器只通过公开 Instance 接管控制。原生消费者按公开 IO/GameContract 实际运行。完整规则、异常路径、子路径依赖与导出清理分别由对应测试和审计覆盖。

当前验收见 [convergence-acceptance.md](../convergence-acceptance.md)，证明见 [protocol-freeze-proof.md](../protocol-freeze-proof.md)。

内侧配套 lib 已独立落在 @bear-forge/game-sdk。GamePortDeclarations 统一程序 schema、内侧方法集合和外侧端口类别；类型负例与原生轨迹、exact/construct、多玩家/会话/事件/终局验证见 sdk-types.ts、sdk.test.ts、player.test.ts 和完整斗地主测试。Core/Instance 无新增游戏功能。
