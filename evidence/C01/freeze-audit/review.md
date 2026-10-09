# 协议审计

- Core/Instance 保持通用执行与端口；BaseGame/GameContract 负责玩家归属和投影。
- Instance 与 BaseGame 各有 bind/run 这一控制路径；程序通知统一通过 event 端口。
- 玩家绑定按字符串键独立替换/移除。同一函数绑定不同玩家时，control.player 与对应投影共同确定调用。
- 输入请求包含自己的 observation/offers 和 acceptsSignal；纯信号等待有显式 signalPlayers。respond 接收 player 以验证领域目标。
- event/playerEvent 分别声明，projectEvent 可以返回不同载荷或跳过。重试使用稳定事件身份，消费者按玩家去重。
- 两个 loader 返回 Outcome。capture(id) 在 transfer 和 close 后保留读取路径，release 明确回收。

命令：npm run check、python3 evidence/C01/verify-migration.py。原生消费者覆盖多人、信号、事件、竞争、取消和完整斗地主；生产提供者履约由 C02/C03 验收。完整证明见 [协议证明](../protocol-freeze-proof.md)。
