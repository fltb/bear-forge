# 协议冻结的需求闭合与构造证明

证明对象是 packages/contracts/src 的声明和 docs/protocol.md 的操作法则。结论为：在列明的语义保持、状态闭合及投影前提下，存在满足当前需求的一致操作模型，所需交互均可由公开能力组合。

## 1. 唯一状态归属

分成三个互不替代的状态集合：

- C：受控程序现场，包括程序身份、栈/闭包/对象图、SDK 局部、待决端口、记录前缀。只有程序内部归约和接受端口回复能改变它。
- H：宿主控制状态，包括有效句柄、关闭标记、回调表、活动驱动租约、取消信号与本次计数。保存 C 不保存 H；恢复创建空绑定的新 H。
- A：审计/持久化提供者的资源状态，包括实例记录引用、不可变快照引用、授权集合与引用生命周期。A 不决定规则下一步如何结算。

BaseGame 持有同一个 C 的有效句柄；边界、观察、选项、输入转换均是 C 已发布数据与纯 GameContract 的函数。它只管理自己的 H，不维护第二份 C。会话记忆和训练数据是调用方资源，不进入上述规则状态。

这一划分允许执行控制存在可变状态；禁止的是恢复 C 还需要找回宿主隐藏规则变量。删除缓存或更换驱动不会改变规则结果，未确认外部事件可按同一身份重试。

## 2. 抽象操作模型

取受控源程序的一种完整、语义保持的现场表示。这里表示可用数学上的语法树、环境和续延；不规定实际后端必须采用解释器。假定内部一步归约是确定的，外部不可确定数据只经端口回复输入。

稳定状态集合为 W(k,p,x)、D(r)、F(e)、Closed。W 保存续延 k、声明端口 p、已隔离参数 x；k 不外泄。内部运行态为 Computing。句柄携带独占所有权代次，回调租约携带独立驱动代次。

定义执行器内部的唯一接受操作：

Accept(C,H,lease,v) 仅在当前状态为 W、lease 仍有效、端口输出校验通过时成立；先追加 returned，再把 k(v) 归约到下一 W/D/F，追加对应记录。否则不修改 C。取消和 Accept 在线性化顺序中只能有一个先发生，过期 lease 永不重新生效。

公开操作由以下规则完全决定：

| 操作 | 条件与结果 |
| --- | --- |
| load | 准入和 schema 匹配成功返回 LoadedCore；失败返回错误，不发布部分能力 |
| start | 校验 setup，建立 C/H/started，内部归约至 W/D/F 后返回 Instance |
| bind | 有效、未关闭、无活动驱动且稳定时替换回调表；不改 C；故障时仅允许清空 |
| run | 原子取得独占驱动；在 W 检查取消、限额、回调，然后等待明确 reply/pause；reply 走 Accept；D/F 直接返回 |
| inspect | 稳定 W/D/F 返回隔离投影；内部计算拒绝 busy；不改 C |
| transfer | 稳定且无活动驱动时更换所有权代次，id/C 不变，清空回调；旧句柄失效 |
| fork | 仅 W/D，完整隔离复制 C，新 id、新 H、空绑定；失败保持父状态 |
| save | 仅 W/D，取得不可变完整 C 引用；不改原实例 |
| restore | 检查保存引用与程序兼容性，构造独立 C、新 id、新 H；不执行已完成效果 |
| close | 无活动驱动且稳定时释放执行现场；对有效已关闭句柄幂等；不删除已保留记录/快照 |
| snapshot.release | 释放保存引用，重复释放该引用幂等；未知引用拒绝；已恢复实例不受影响 |
| capture.read | 授权实例 id 的原子已提交记录前缀；与执行权无关，可在运行和关闭后读取 |
| capture.release | 仅关闭实例的记录引用可释放；活实例 busy；重复释放幂等，未知身份拒绝 |

所有句柄操作先检查所有权再检查生命周期；非法参数在任何状态修改前拒绝。fork/save 不支持时通过可选字段缺席表达，存在的字段必须履行能力承诺。独立提供者可以通过有限映射、互斥所有权、不可变日志和引用管理实现这些抽象操作，故此组法则至少存在一个满足者。

## 3. 归纳不变量

I1：一个实例最多有一个有效执行所有者和一个活动驱动。

初始只创建一个所有者。bind/inspect/read 不新增所有者；run 必须原子取得空闲驱动；transfer 原子撤销旧所有者；fork/restore 使用新 id。因此每一步保持 I1。

I2：每个端口调用最多接受一次返回。

Accept 检查当前 W 与驱动代次，成功后离开该 W；下一调用的 callId 不复用。取消撤销代次，旧 Promise 的返回不再满足条件。因此重复/迟到返回不能再次接受。

I3：无效输入不改变规则现场或 accepted 计数。

所有校验先于 Accept；只有成功 Accept 追加 returned 和增加计数。宿主 pause、异常和非法值均不进入 Accept。内侧规则仍可因程序错误进入 F，该故障不能被算成游戏输赢。

I4：分支独立且恢复充分。

设 C≈C' 表示完整控制现场与受控值相同、可变对象隔离，仅外侧身份/能力绑定不同。内部确定归约保持 ≈；相同端口回复下，续延归约保持 ≈。对任意有限接受序列归纳，父子/恢复实例的领域轨迹相同。分支之间的修改不共享可变对象，所以一方执行不改变另一方。宿主未来输入不同可以产生不同轨迹，并不违反该命题。

I5：capture 在转移控制权后仍可达。

capture.read 的参数只依赖授权能力和 id，transfer 保持 id，BaseGame 返回同一 id。因此从 LoadedCore.capture + BaseGame.id 可构造合法读取，不需要隐含持有新 Instance。close 不释放记录，分析可以晚于对局执行；显式 release 使资源可回收。

## 4. 游戏适配由公开操作构造

将稳定端口按 contract.ports 映射成 decision 或 event，将 D(r) 经 finish 映射成 ended。F(e) 映射为 GameError。所有端口都有唯一角色，决定分支的标签是封闭联合，不依赖引擎猜测游戏语义。

- decision：receive 得到 view/choices/signalPlayers；按 playerFor 将 choices 分组。对每个有入口或信号资格的绑定 player，以 observe(view,player) 构造一次 observation，对其每个 choice 调用 describe 得到 options。并发调用各自 onDecision；第一个合法回复经 respond(view,input,player) 编码为端口返回，其他租约撤销。
- event：receive 得到 events/output；按源事件顺序、player 字符串顺序调用 projectEvent。null 跳过，其余输出通过 playerEvent schema 后交给该玩家 onEvent。全部确认才返回 output。重试使用相同 (instanceId,callId,index)，去重键是 (player,id)。
- ended：finish 投影 view/result。

BaseGame.run 可以循环使用 Instance.run(maxReplies:1)。一次返回 acceptedReplies=1 时，从本次端口角色确定是否增加 acceptedInputs；即使后续程序 fault，这个已接受输入仍计数。达到 maxInputs 后继续确认 event，在下一个 decision 暂停。取消由底层 lease 防止迟到回复，游戏特有停止原因只在本次宿主驱动局部保存并翻译。

上述适配算法使用公共 Instance/InstancePersistence 操作。契约处理器失败时撤销驱动并 close，返回契约故障。只读时发现契约故障执行相同清理，先撤销活动租约再关闭。

## 5. 表达完备性：相对于可计算交互的构造

目标行为由有限描述的内部计算，以及输入请求、事件通知、终局构成。对每种节点构造：内部计算保持原受控 TS；输入节点替换成 await decision；通知节点替换成 await event；终局节点替换成 return。顺序、条件、循环、递归、闭包仍由源语言组合。游戏规则选择这些节点的顺序，Core 无需认识生命值、区域、牌型或回合。

语言计算能力也有直接编码：取递归类型 `type V = (x: V) => V`，把变量映射为局部变量，把 λx.t 映射为 `(x: V): V => T(t)`，把应用 t u 映射为 `T(t)(T(u))`。词法闭包保存自由变量，按值函数调用与按值 λ 演算的 β 归约对应；递归及对象构造无需新 Core 指令。该编码讨论理想无界资源下的可计算表达力；实际执行只承诺数据表示和预算容纳的前缀。

对目标的有限可观察轨迹长度归纳：空轨迹直接成立；内部步不增加外部轨迹；每个输入节点接受相同回复后续延相同；通知节点确认后续延相同；终局返回相同结果。因此存在协议程序产生同一输入/通知/终局轨迹。有限资源下只承诺预算内前缀；任何图灵完备语言都不能保证任意程序终止。

事件序列采用 await event(events);await decision 或 await event(events);return，通知顺序与规则结果由这一顺序组合保持。

多玩家、同时选择和限时由游戏数据表达：choices 可以包含多个入口；内侧保存部分输入后发布剩余入口；signal 携带游戏声明的超时信息。真实/虚拟时钟由会话回答同一个信号协议。严格同时刻或封存语义由游戏内的批次结构表达，不要求物理同时执行多个 JS 栈。

exact 表达有限动作列表；construct 表达作者声明的 JSON 构造约定。通用层保持模板/载荷类型关联，具体合法性及构造解释由作者提供。

## 6. 需求到公开能力的闭合

| 需求 | 构造路径 | 约束 |
| --- | --- | --- |
| R03 直接运行 | load→start→bind→run→inspect/close | 无需训练、存档或搜索能力 |
| R04 受控 I/O、可恢复现场 | IO.call→W；fork/save/restore | 完整现场与语义保持由提供者履约 |
| R05 多席位、脚本/模型 | bind(player)→该玩家 GameRequest→DecisionPolicy→回调回复 | playerFor、observe、projectEvent 由游戏提供，控制句柄由调度方持有 |
| R06 实际轨迹、行为来源 | 调用方记录 player/observation/offer/动作/模型信息；capture 校对接受记录；按 actor 组装 | 模型概率与奖励意义由训练适配提供 |
| R07 干预和关系实验 | 不同 setup/程序/构筑组合独立 start，外层保存实验条件与事实 | 因果识别由实验方法与证据支持 |
| R08 真人与虚拟时钟 | delivery/signal 经 decision 输入；事件发给前端 | 动画不回复规则时间，不作为事件确认条件 |
| 同规则深搜索 | fork→读取候选→bind→run(maxInputs:1)→递归→close | 遍历/剪枝/价值/隐世界构造由调用方决定 |
| 长期审计与资源回收 | capture.read(game.id)→close→读取尾部→release | 提供者授权，不向玩家暴露审计能力 |
| 差分验证 | 同一 ProgramModule 原生运行；受控产物提供同类型 Core | 比较真实调用/回复/结果；受控实现仍待开发 |

万智牌 like 的 15 个压力场景逐项映射保留在 boundary-migration-review.md。它们只使用上述程序节点、完整续延、分支和当前凭证，不需要引擎增加领域状态。

## 7. 玩家投影与绑定不变量

设稳定输入边界为 B=(v,C,S)，玩家 p 的请求定义为：

- Oₚ=observe(v,p)。
- Cₚ={c∈C | playerFor(c.actor)=p}。
- Qₚ={decisionId,observation:Oₚ,offers:map(describe,Cₚ),acceptsSignal:p∈S}。

绑定表 M 按字符串 player 索引。bind(p,h) 只更新 M[p]；移除只删除该键；清空删除所有键。函数引用不参与键比较，所以同一函数分别绑定 p、q 后，仍以不同的 Qₚ、Qq 和 control.player 调用。一个 player 的多个 actor 自然位于同一 Cₚ，不需要 actor 身份与 player 相等。

回复通过条件是：当前租约有效、当前凭证匹配、输入结构有效、choice 属于 Cₚ（或 p∈S）、respond(v,input,p).valid=true。所有检查先于接受。因此另一个玩家的 choice 无法通过成员检查；信号的具体目标由 respond 判定；非法回复不产生规则转移。第一个接受撤销其他租约，由 I2 得到至多一次接受。

事件 e 对玩家 p 的交付定义为 projectEvent(e,p)。返回 null 时无交付，返回 {event:x} 时只交付 x。由构造，player 回调的每一个数据来源都落在该玩家的请求或事件投影中。游戏作者负责这些投影的领域可见性；框架负责按绑定选择投影与数据隔离。接口上的隔离性质相对于作者指定的投影成立。

signalPlayers 使 C 为空时仍能构造 Qₚ；observation 携带该信号需要的游戏信息。斗地主的 timeout 由自己的 slot、deadline、onTimeout 构造，respond 从当前 Frame 补齐内部 boundaryKey，当前 decisionId 负责外部调用匹配。

fork/restore 的规则现场等价且绑定表为空，因此复制规则状态不会把父玩家回调带到子实例。重新绑定相同 player 之后，纯投影得到相同领域观察；实例与调用身份依其规则重命名。

## 8. 验收证据与实现义务

| 性质 | 证据 |
| --- | --- |
| 单一推进和事件来源 | 实际方法集合、声明审计及负向类型消费者 |
| 状态/请求/事件按玩家投影 | player.test.ts：同一回调、多 actor、不同事件载荷、过滤与值隔离 |
| 绑定相互独立 | player.test.ts：替换、移除单玩家、清空 |
| 信号和回复闭合 | 纯信号等待、跨玩家拒绝、首个合法回复、取消和迟到回复 |
| 完整作者程序可接线 | 斗地主正常/超时逐玩家完整对局，真实 IO 和 GameContract 路径 |
| 领域行为 | 未变规则/oracle 哈希、完整原生对局与合法牌型核对 |
| 分支、恢复、搜索 | I4、同类型消费者、15 个场景构造 |
| 捕捉和释放 | I5、提供者 capture(id) 类型消费者 |
| 声明一致性 | 全部声明原文、公共导出索引、源码哈希 |

C01 证明上述有限需求的表达与组合性质，并执行原生作者/消费者验收。C02/C03 的提供者验收落实语义保持、依赖准入、完整续延保存、所有权、取消竞争、隔离和记录生命周期。
