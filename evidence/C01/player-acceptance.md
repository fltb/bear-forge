# Player 协议验收

1. `npm run typecheck`：按 player 绑定/替换/移除；observe、validate 使用 player；请求只有本玩家入口和观察；可见事件独立类型；纯信号接收玩家有声明。拒绝缺失 player、错误 player、错误可见事件类型。
2. `npm test`：实际斗地主规则程序通过 player 接线完整对局；同一回调绑定不同玩家，各自收到状态和请求；私密事件按玩家过滤；同一事件可投影不同载荷；错误玩家动作及信号不改变状态；多 actor 对一 player 和纯信号等待均有覆盖。保留独立牌型与规则 oracle。
3. `npm run check:protocol`：当前类型、作者契约和有效文档一致，活动源码及规范使用 player 命名；原始事件只进入投影函数，回调事件类型使用 playerEvent。
4. `npm run check:schemas`、`npm run check:proof-coverage`、`python3 evidence/C01/verify-migration.py`：schema、所有导出、逐字段附录和业务源码证据一致。
5. `python3 tools/check_project.py` 及 `--self-test`：有效文档、checklist、报告哈希和负向机制通过。

交付：公共声明、游戏作者代码、原生执行消费者、协议法则和证明。生产提供者按 C02/C03 实施。
