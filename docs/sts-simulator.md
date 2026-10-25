# STS 玩家模拟器与 TUI

本轮验收对象：玩家能启动、完整游玩、保存退出并继续的 TUI。唯一原规则、共享 Program、独立 Context；不恢复已封存搜索，不替玩家决定。现有角色 ironclad / volibear，现有难度 A20。首批不实现 Web 或 Transformer 训练。

## 启动与操作

仓库根目录安装依赖后，用 Node >=22.18（保存与恢复使用同一 Node 主版本）在交互终端运行：

```sh
npm install
npm run sts:tui
# 指定新局目录与角色；目录必须不存在或为空
npm run sts:tui -- --save data/sts-saves/my-run --character ironclad
# 保存退出后继续，直接装载原 Context
npm run sts:tui -- --resume data/sts-saves/my-run
```

不指定目录时自动生成独立路径并打印；默认种子来自系统随机源，可用 `--seed` 指定十进制 uint64。继续时不能混用新局角色或种子参数，不自动开新局。不同规则源码或 Node 主版本的存档拒绝加载；请保留创建该局的版本。本地存档只用于可信目录，不从网上加载不可信存档。

- ↑/↓：在完整合法动作中选择；标签明确动词、目标、费用及多选组合。Enter 执行。
- 结束回合、丢弃药水、离开与跳过奖励再次 Enter 确认；Esc 取消确认。
- m：多选窗口切到勾选模式，↑/↓ 移动、Space 勾选、Enter 提交；只匹配原宿主已给出的合法组合，不构造新动作。Esc 返回动作列表。
- /：按名称、目标或组合筛选动作；Enter 完成输入，Esc 清空。输入期间字母不会执行动作。
- ←/→：场面、卡组与牌堆、地图、结算记录、规则说明、当前动作详情；Tab 在动作选择和内容滚动间切换。
- PgUp/PgDn：滚动内容；Home/End：当前焦点的首尾。? 查看帮助。
- s：保存；q 或 Ctrl-C：成功保存后退出。保存失败留在当前现场，可重试，不宣称成功。确需放弃当前进程时，连续两次大写 X 明确中止；未提交进展不可恢复。

至少需要 60 列 × 16 行；更小窗口显示调整提示并禁用动作。支持缩放、中文换行；内容可滚动。场面、卡组和规则页读取原展示文案。抽牌堆只显示数量，持 Frozen Eye 时沿原公开契约显示顺序。未知地图节点不是保证事件。

## 会话与策略边界

`examples/sts/src/simulator.ts` 提供 `createSimulator({store, setup})` 和 `resume:true`。每进程共享加载后的 Program，每局独立 Context。`observe / act / save / close` 串行；`decide(policy, signal)` 在串行队列外等待建议，再按原 revision 提交。HumanPolicy 只等待 UI 选择，返回现有 Policy Proposal，不调用执行器。未来模型可以直接替换策略。

动作命令包含 `id / sessionId / revision / action`。外部入口验证当前请求和合法候选；原游戏宿主仍负责接受和执行。一次执行到下一请求或真实终局，包括效果中的选牌。已接受 Policy 的 nextMemory/nextRandom 随 Context 提交并在恢复后续接；未接受建议不改变它们。最后一次命令及结果记录随存档提交：相同命令重试返回已有结果，旧 revision 拒绝，相同 id 不同内容拒绝。界面不把非法输入转换成其他动作。终局分 death / act3-clear / heart-victory；用户保存退出不算死亡或通关，执行故障和未提交中断也不算终局。

## 存档与中断

每个保存目录：`current.sts` 是一个原子提交的完整 Context 和会话包，`pending.json` 是执行前持久化的目标 revision，`owner.lock` 保证本机单会话使用；崩溃锁回收留下 `.retired-*` 代次标记，避免并发恢复误删新锁。临时文件先写入并同步，原子替换后同步目录。不要将同一目录放在多主机共享文件系统并发使用。

每次真实动作前先同步 pending，再执行原规则，抵达下一稳定边界后同步当前 Context、请求、最近命令结果、事件批次和游标。仅提交成功后显示已保存；失败时停止新动作，但保留内存当前现场供重试保存。成功重试不再执行动作。自动存档覆盖的是本会话自己的当前状态，新会话拒绝非空目录。

进程在动作执行中或提交前消失，pending 高于已提交 revision：恢复报告 interrupted，拒绝旧存档补跑。成功提交后即使 pending 文件仍在，其 revision 不高于存档，允许直接恢复。进程死在稳定且已提交边界可继续；无历史动作重放。锁的旧 PID 不存在时才尝试回收；无法识别的锁如实报错，不擅自覆盖。

存档可能包含私有游戏未来，因此只能由可信宿主持有，不作为前端或模型输入。公开视图、原规则事件只通过会话接口输出。

## 公开事件与未来 Web

每个批次含 `fromRevision / revision / actionId / cursor / events / identities / state`。事件携带单调 sequence 和动作归属；实体在首次公开时分配不含原分配位置的稳定展示 id，卡牌公开 uniqueId 和敌人公开槽位用于定位；映射随 Context 存档续接。规则事件补充关联信息不改变结算。

Web 可从上个展示状态顺序播放当前批次，再采用最终 `state`。伤害事件用于表现，资源变化和最终状态用于状态同步，不可重复扣血。跳过动画直接采用最终状态。断线后调用 observe 获取最新状态与最新批次，用 sessionId/revision/cursor 去重；更早批次不在内存无限积累，过期客户端直接同步最终状态。展示记录只读，绝不驱动内核重执行。

## 验收与成本

正式检查入口：

```sh
npm run typecheck --workspace @bear-forge/sts
npm run typecheck --workspace @bear-forge/cli
npm run check --workspace @bear-forge/policies
npm run test:simulator --workspace @bear-forge/sts
npm run test:tui --workspace @bear-forge/cli
```

跨进程测试必须普通请求与原 SECRET_TECHNIQUE 中途选牌分别保存/关闭/重启；恢复时禁止 Program.initial，随后只执行一个新选择。测试还覆盖过期/重复/非法输入、存档失败、隔离、公开边界和事件顺序。真实 TUI 操作与生产完整终局另行验收，状态仅记录在 plan.md，不以测试或首屏替代。

退出时打印动作推进、存档和绘制的样本数量、中位数及最大耗时。启动/恢复计时包含加载与持久化相关工作；动作计时不含玩家思考和存档，绘制计时含构造文本和写入终端流，不等同终端像素呈现延迟。执行不等待动画，不设自动对局一分钟上限。
