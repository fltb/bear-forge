# 三层协议的构造证明

证明对象为当前公开声明及 docs/protocol.md 操作法则。前提是受控程序语义保持、完整现场保存、纯适配处理器和值隔离。原生消费者与斗地主验证实际接线；C02/C03 验收生产提供者对前提的实现。

## 状态归属

C 是程序现场：程序身份、栈、局部、闭包、堆、SDK、待决调用及记录前缀。H 是外部控制：有效句柄、绑定、活动运行与取消信号。A 是保存与捕捉提供者的资源引用。

只有程序内部归约与接受端口返回改变 C。保存和分支复制 C；新实例拥有独立 H。BaseGame 的请求、观察、合法动作与编码均由 C 已发布的数据和纯 contract 重建。关闭或更换外部绑定不改变规则状态。

## 表达能力

内部计算使用受控 TS。函数、词法闭包和调用直接编码按值 lambda 演算；循环与递归组合领域流程。外部输入替换为 await IO.call，事件通知通过声明输出端口等待确认，结束使用 return。

对有限可观察轨迹长度归纳：内部步保持内部语义；端口在相同显式回复后继续相同后继；事件确认和终局保持次序。于是协议可表达相同的计算、输入、通知和结果轨迹。有限运行预算决定实际可执行前缀。

## 请求与纯动作

设当前端口解释为 (view,requests)。每个请求 r=(key,player,type,data)，对外身份为 (Instance.id,callId,key)。key 在本次调用内唯一。

外侧构造 observation=observe(view,r.player)、options=inputs[r.type].describe(view,r)。回调只返回 r.type 对应 action。外侧保存原始身份和玩家，检查该动作的 schema，再调用 respond(view,r,action)。回调修改收到的副本不改变原身份。

合法动作集合由当前 view 与 r 确定，exact 是该集合的完整列表，construct 是游戏提供的构造描述。时间不作为 action 参数。时间影响合法性时先通过独立控制输入改变 view，随后 describe/validate 读取相同的新状态。

错误实例、旧 callId、错误 key 或 player 不能定位原请求，因此在程序接受之前拒绝。类型与 schema 保证结构关联，游戏规则检查保证该动作在当前请求下合法。

## 会话独立性

无会话控制的游戏取 control=never，基础 BaseGame 只有玩家交互方法。启用会话时，独立回调接收游戏提供的控制数据，经 session.respond 编码为同一端口返回。玩家不构造时间或超时。

斗地主用 clock 更新 now，用 timeout 执行默认行为。动作验证只读取 state.now，截止时 exact=[]。真实时钟和训练虚拟时钟都产生相同控制输入；同一输入序列产生相同规则轨迹。

## 单步与接受反馈

定义 Accept 为当前调用检查通过、回复原子提交的一刻。Instance.run 至多执行一次 Accept，随后归约至下一个稳定调用、完成或故障。返回 accepted:boolean 记录 Accept 是否发生。

BaseGame.run 组合若干 Instance.run：初始 event 自动交付；遇到请求时最多提交一个动作或会话控制；提交之后只交付事件，到下一请求停止。一个局部 accepted 槽在底层确认提交后写入具体输入，之后不再覆盖。

因此一次 run 至多有一个 accepted 输入，结束、事件暂停、取消与后续故障均保留该槽。推进后的错误进入 state.fault；运行前操作拒绝使用 Outcome.error。训练记录能把已执行动作连到原请求和 player，而不是推测哪个回调获胜。

取消与 Accept 有线性化次序。取消先于 Accept，accepted=null；Accept 先于取消，accepted 保留。旧回调租约被撤销，迟到返回不再满足当前接受条件。

多个外部回答可并发准备，单次端口接受仍串行。程序可封存先收到的数据、重新发布剩余请求，在收齐后统一结算；通用层不规定共同决策结果。

## 事件与私密性

原始事件 e 对玩家 p 的数据为 projectEvent(e,p)。null 表示跳过，{event:x} 只交付 x。请求观察按 r.player 投影。玩家回调的输入来源由这两个投影和属于该玩家的请求限定；领域可见性由作者定义，框架执行对应选择并隔离值。

事件的 source id=(instanceId,callId,index) 保持重试一致。接收方按 (player,id) 去重。数组全部接收后才确认底层端口；游戏结束前完成终局事件。动画和网络重试由外部接收方维护。

## 分支、保存与捕捉

令 C≈C' 表示控制位置、受控数据与能力形状相同，可变对象相互隔离，外部实例身份允许不同。完整 fork 构造这样的 C'。内部归约保持 ≈，相同未来端口输入保持 ≈；按接受步数归纳得到同领域轨迹。save→restore 使用相同构造。

BaseGame 是纯投影与输入转换，所以给子 Instance 绑定同一 contract 得到同类型游戏。父子玩家/会话绑定独立且初始为空。搜索递归组合 fork/read/bind/run/close，保存仍只针对 Instance。

capture 通过提供者能力和实例 id 读取记录，transfer 保持 id，close 保留记录直到 release。共享底层前缀按引用保留，父记录释放不影响子实例或保存引用。

## 公开能力与需求闭合

| 需求 | 构造 |
| --- | --- |
| 直接运行 | load → start → bind → run → close |
| 多玩家 | 请求直接指定 player，同一回调按绑定分别接收 |
| 同时选择 | 程序保存部分回复，发布剩余请求 |
| 限时 | 可选 clock/timeout 控制；动作保持纯动作 |
| 深搜索 | 同类型分支和单步 run；算法在调用方 |
| 训练 | accepted 的具体请求/玩家/动作、可见事件与结果 |
| 前端 | 玩家请求、观察和事件；播放独立 |
| 保存恢复 | 稳定点完整 C；重新绑定 H |
| 分析 | 可选捕捉记录和游戏定义的事实解释 |

接线时程序与 GameContract 的配对由调用方负责。类型验证数据形状；生产装载验证受控产物。该责任在公开协议中一致声明。

## 证据

player.test.ts 验证实际原生单步、接受反馈、事件重试、取消、故障、请求身份、多玩家投影与无可选能力运行。斗地主测试通过相同公开接口跑完纯动作和会话超时对局；原有牌型 oracle 保留。字段附录与子路径导出索引逐字对应源码。

## 内侧 SDK 与外侧功能对应

构造：对有限声明表每个自有键 K，创建 fK(x)=io.call({port:K,input:x})。无其他 I/O，返回原 Promise，故任何相同输入返回序列下，替换直接端口调用前后调用顺序、数据、异常与程序终值一致。tests/contracts/sdk.test.ts 覆盖嵌套递归/循环、等待和异常、不同实例及特殊字符串键；tests/contracts/player.test.ts 通过同一 lib 验证多人、会话、exact/construct、事件和结束。

GamePortDeclarations<P> 和 GameContract<G> 同受 P[K].kind/input/output 约束；请求不能声明成事件，错误输入/返回、缺键与非固定键表由 tests/contracts/sdk-types.ts 拒绝。程序和 SDK 共享声明。此证明不将 TS 类型等同运行时安全；动态数据继续由 Instance 的 schema 校验与生产准入约束。

外侧 observe/describe/validate 读取已发布 view，内侧没有对称的状态复制接口；事件由对应端口发布，结束由 return 表达；会话输入共用请求返回。bind/run/close/save/fork/capture 是外侧控制或提供者能力，不需进入 SDK。完整逐项映射及游戏适配语义法则列在 docs/protocol.md。

未证明事项：保存含 SDK 闭包的真实续延、生产依赖白名单与隔离在 C02/C03 验收。原生测试不能证明这些能力已实现。
