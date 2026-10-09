# Core / Instance / BaseGame 协议

公共声明位于 packages/contracts/src。Instance 是唯一完整运行态；游戏约定通过它两侧的 SDK 和 BaseGame 实现。当前交付声明、内侧斗地主源码及原生验证；生产执行、编译、装载、绑定、保存与分支实现由后续关卡验收。

## Core 与 Instance

- PortShape：input/output。PortCall 是关联的 port/input；PortReturn 是关联的 port/output。端口表是有限必填字符串键表，不接受开放索引、联合表、可选键、数字或符号键。
- IO.call(call)：外部调用。Program.run(setup,io) 使用普通受控 TS 计算、循环、递归和闭包。ProgramModule 包含 schemas{setup,result,ports} 与 run。
- Core.start(setup)：运行至稳定边界并返回 Outcome<Instance>。
- Instance：id、bind(bindings|null)、run(options?)、inspect()、resume({callId,reply})、可选 fork()、transfer()、close()。
- InstanceStop：call{callId,call}、done{result} 或 fault{error}。
- Outcome：ok/value 或 ok/error。操作拒绝与程序故障分开。
- InstancePersistence：save(instance)、restore(snapshot)、release(snapshot)。唯一快照类型 InstanceSnapshot 只公开 snapshotId。
- InstanceCapture.read(instance,{after,limit})：返回 records/next。记录为 started{setup}、called{callId,call}、returned{callId,reply}、completed{result}、faulted{error}，每条有 sequence。
- PortBindings：声明端口的可选回调表。每个回调接收 {instanceId,callId,input} 与 {signal}，返回 {kind:reply,value} 或 {kind:pause}；返回类型关联该端口。它不成为程序内部能力，也不进入保存现场。

Instance 保存程序身份、控制栈、局部变量、闭包环境、对象图、内侧 SDK/受控设备状态、待决调用和记录前缀。影响后续运行的内部状态不得藏在外侧 BaseGame 或不受控宿主闭包中。纯计算生成的伪随机流在内侧持有 seed/状态；真实外部不确定性通过端口回复显式输入。Core 不解释随机、时钟、玩家或卡牌。

执行内部计算时 inspect/resume/fork/save/close 拒绝 instance_busy，不返回过期现场。程序稳定等待宿主回调时 inspect/fork/save 可以线性化读取；resume/bind/close 仍被活动驱动租约排斥。错误端口、过期 callId、无效 schema 的回复被拒绝，不改变现场或输入记录。正常结束可以读取、保存和分支，不能 resume；故障不能继续、保存或分支；close 关闭活实例。程序预算耗尽为 fault，不冒充游戏输赢。

## 分支与保存

fork 从稳定的 call/done 创建同类型 Instance。父实例、子实例和其他兄弟的可变状态相互隔离，子实例获得新 InstanceId；父实例不推进。子实例保留提供者的 fork 能力，但不继承宿主回调绑定或活动驱动，处于未绑定状态。创建失败清理临时资源且保持父实例不变。

save 返回同一现场的不可变保存引用。restore 返回独立、未绑定的同类型 Instance，不重放完整程序前缀，不重新执行已经完成的外部效果。fork 与 save→restore 在运行语义上等价，但接口不限定内部算法、复杂度或持久化介质。所有句柄仅由其兼容提供者解释；未知、已释放和不兼容引用分别按既有错误类别拒绝。

release 释放保存引用，不影响已恢复实例或独立分支。close 不隐式释放已保留快照。直接运行无需提供 fork 或 persistence。真正的外部输入生产者不属于快照：重现后续轨迹要求显式提供相同后续回复，不能把现实网络/用户的未来行为纳入确定性承诺。

记录 sequence 从 0 连续递增，started 唯一；只记录被接受的回复，completed/faulted 后不追加。after=null 从头读取，否则指最后消费的有效序号；越界游标拒绝。next=null 表示没有更多，调用方保留实际已消费序号。fork/restore 继承记录前缀，不重复 started/called；记录所属实例与 callId 一起确定调用身份。

## 同一游戏协议的内外两侧

GameModule={program,contract}。program 是实际进入 Instance 的程序；contract 是两侧共享的 GameContract。装载及绑定必须使用同一作者包的匹配程序与约定；相同 TS 类型不证明两个任意实现具有相同语义。

内侧 GameSDK<P> 把每个声明端口 K 包装为 (input:P[K].input)→Promise<P[K].output>。它是库函数形状，不是另一个执行器。SDK 在 program.run 内创建，包装 IO.call；具体游戏可组合 deal/bid/play 等更高层库函数，内部计算不必都变成端口。SDK 闭包和可变局部均由 Instance 持有。SDK 发事件也是受控调用：只等待接收确认，不等待动画结束。端口角色和数据语义由 GameContract 确定，Core 不认识 GameSDK。

外侧 BaseGame 持有并独占驱动一个真实 Instance，使用 GameContract 解读已发布的端口数据。它不能有恢复所必需的额外游戏/服务状态。边界、观察、选择、查询可由当前 InstanceStop 和纯 contract 重新计算；缓存可全部丢弃。事件发送回执、策略记忆、会话权限及网络重试状态属于各自调用方，不属于游戏规则状态。

GameContract 字段：

- schemas：view/actor/delivery/signal/observer/observation/event/result，以及关联的 interactions 模板。
- ports：每个外部端口恰为 event 或 decision。event.receive(input) 返回 events/output；decision.receive(input) 返回 view/choices/events；decision.respond(view,submission) 返回 valid:false/reason 或 valid:true/output。
- finish(programResult)：返回 view/result/events，终局只有一个来源。
- observerFor(actor)：该参与方对应的观察身份；observe(view,observer)：可见投影。运行器用二者生成该参与方的 DecisionOffer，不擅自映射玩家身份。
- inputs[type]：options schema 和 describe(view,choice)。
- queries[name]：input/output schema 与 run(view,args)。

这些处理器必须纯、确定且值隔离，不捕获可变宿主状态。外侧 respond 做提交预检和编码；内侧规则仍验证端口返回，再执行结算。多方输入的封存、计数、触发队列、随机流与事件发布游标都在内侧。外側不能把尚未送入 Instance 的玩家输入偷偷缓存在游戏私有状态中；要么立即编码为一个受控输入，要么留在明确的会话协议中。

## 游戏数据与外侧接口

InteractionShape={request,input,description}。Choice={id,actor,type,request}，type 关联载荷。choices 是真实待决入口，id 唯一，没有 context 过滤字段。

DecisionId={instanceId,callId}，由当前 Instance 身份及挂起调用直接构成，无需外侧维护额外签发状态。GameBoundary 为 decision{decisionId,choices}、event{callId} 或 ended{result}。event 表示当前在输出端口等待确认，并非玩家行动。GameUpdate={boundary,events}。

GameInput 为 choice{choiceId,input:{type,value},delivery} 或 signal{signal}。游戏无信号时使用 never。动作、交付元数据与会话信号分开，可信时间由会话提供。InputOptions 为 exact{values} 或 construct{description}；exact 完整描述指定入口的合法动作载荷，不枚举交付时间或信号；construct 由游戏上层解释，不内置通用枚举、采样或前缀引擎。

BaseGame：

- id：所持 Instance.id，不再另造游戏运行身份。
- bind(bindings|null)：替换游戏回调表，null 清空。绑定不执行回调、不推进实例。
- run(options?)：通过 Instance.run 和游戏端口适配回调驱动，返回带 acceptedInputs 的 paused/ended/fault。
- inspect()：解读当前绑定 Instance 的游戏边界。
- observe({observer})：当前边界的可见观察。
- describe({decisionId,choiceId,type})：当前真实入口的选项；身份/type 不匹配必须拒绝。
- validate({decisionId,input})：只读预检。
- query({name,args})：当前边界的类型化查询。
- submit({decisionId,input})：重新验证当前凭证和输入，使用对应 respond 转换后 resume 同一 Instance，处理 event 端口直到下一 decision/done。
- fork?()：底层 Instance.fork 后用同一 contract 绑定新 Instance，返回同类型 BaseGame。
- save?()：委托兼容 InstancePersistence.save(所持 Instance)，直接返回 InstanceSnapshot。
- close()：关闭所持 Instance。

不存在 GameSnapshot、GameReadTarget、branching.step 或第二个模拟执行入口。搜索使用 child=game.fork()，然后调用 child.inspect/submit/observe；提交必须使用子实例的 DecisionId。父实例凭证不能提交给子实例，即使其 Choice 内容相同。

终局可观察、查询、分支、保存，不能提交/描述输入；内部执行时拒绝 game_busy，关闭后拒绝 game_closed。event 边界可 inspect/fork/save/run；observe/query 拒绝 view_unavailable，因为事件端口没有声明可读 view；describe/validate/submit 同样不能把它当作决策。回调等待时只读与 fork/save 可用，手动推进仍受驱动租约保护。validate 不替代 submit 的再次检查。非法输入不调用 resume。处理器输出不合约或程序执行失败为 fault，不伪装成普通非法输入；失败驱动的实例须关闭或由 Instance 标记故障，不保留一个隐藏的外侧可恢复故障状态。

## 装载、绑定及恢复

NativeCoreLoader.load(ProgramModule) 与 ControlledCoreLoader.load(CompiledProgram) 返回 LoadedCore{core,persistence?,capture?}。CompiledProgram 为受控产物及 invariant 类型见证；loader 仍须检验程序准入、schema 与兼容身份。

Core.start(setup) → Instance → BaseGameBinder.bind({instance,contract,persistence?}) → {game,initial}。bind 不启动第二份规则程序，先通过 Instance.transfer 接管独占驱动权，仅投影当前 call/done；初始边界可以是 event。绑定失败关闭被接管的实例。transfer 在未被活动驱动占用的稳定状态原子地返回同一 InstanceId 的新句柄，使旧句柄及其别名的操作返回 instance_owned；新句柄保留原现场与底层可选能力，清空宿主绑定。它不是 fork，不复制运行态。BaseGameBinder 只持有新句柄，不向外暴露它；重复使用旧句柄绑定被拒绝。TS 无线性类型，运行器必须落实这项通用所有权操作。

外侧 fork 当且仅当底层实际支持 fork 才暴露，save 当且仅当绑定了兼容 persistence 才暴露。普通直接运行不要求两者。子 BaseGame 保留同一 contract 与可用能力，但外部回调未绑定；子绑定失败清理子实例，父实例不受影响。

恢复路径：persistence.restore(snapshot) → Instance → binder.bind({instance,contract,persistence})。不需要游戏级 restore 或额外补存状态。恢复/分支后的决策凭证使用新 InstanceId。initial.events 是当前现场的纯投影数据；既有等待边界的数据可以再次读取，但绑定、恢复和 inspect 本身不向外发送通知。消费者若需要恰好一次交付，使用记录身份和自己的游标去重。submit.events 只含该次真实推进的事件，历史前缀不作为新事件重发。

## Instance 外部控制与回调生命周期

bind 的表仅允许声明过的端口，缺少某端口不是默认返回 undefined，而是 run 到该调用时返回 paused/unbound。表替换是原子的；活动 run 存在时 bind/resume/transfer/close 或第二个 run 均拒绝 instance_busy。BaseGame 接管后的原 Instance 别名操作拒绝 instance_owned；内部适配持有独占权限。绑定注册表不是程序状态，fork/restore 不复制。

Instance.run 的 options={limits?:{maxReplies?},signal?}。maxReplies 是本次驱动最多接受的回复数，非执行指令数；0 在当前调用边界停止，不执行回调。省略则不以回复数限制。无效限额在执行前 rejected/invalid_argument。run 返回 InstanceRunStop：

- paused：reason、当前 call、可选 message、acceptedReplies；
- done：result、acceptedReplies；
- fault：error、acceptedReplies。

acceptedReplies 只统计本次已提交给程序的端口返回，拒绝、暂停与取消均不增加。手动 resume 接受一个明确回复并推进到下一 call/done/fault，不自动调用绑定回调。run 可以从这个相同边界继续；两者共用返回校验和单次提交原子动作。

CallbackReply<T> 的 reply.value 必须通过该端口输出 schema，pause 不带值。回调 pause → requested；缺失回调 → unbound；回复数限额 → limit；signal 取消 → cancelled；回调抛错/拒绝 Promise → handler_failed；输出结构不合法 → invalid_reply。以上均保留待决调用，不将宿主错误当成程序 fault。再次 run 会重新调用当前端口的回调；手动 resume 也可以处理它。

回调参数中的 AbortSignal 是宿主控制对象，不能进程序或快照。运行器为每次回调产生独立信号，外部取消或结束该次租约时撤销；回调可以忽略取消，但它的迟到返回必须丢弃。回复提交与取消有确定的线性化顺序：提交先发生则该回复计数并继续到下一个稳定点；取消先发生则不接受回复。相同调用不能接受两次回复。停止后可重新 bind/run；旧 Promise 永远不能回答新驱动、其他实例或恢复后的调用。

程序正在内部计算时，取消在下一个端口/终局稳定点生效；不要求任意指令可恢复。无限内部循环由执行提供者的预算终止为 fault。回调在等待期间可立即撤销其驱动租约而保留待决调用，无需等待宿主 Promise 实际结束。

当到达 done/fault 时，实际终止优先于回复数限额；若仍在 call，则依次检查取消、限额和绑定，之后才调用回调。终局 run 直接返回终局，不再继续程序。

## BaseGame 游戏回调与控制

GameBindings 包含可选 onDecision 和 onEvent。bind 只注册，不调用它们；null 清空。run 负责实际调度。外侧游戏适配将这些回调包装成 Instance 的端口回调，不实现另一个执行循环或直接调用规则 apply。

onDecision 接收 GameRequest={decisionId,offers}，每个 DecisionOffer 包含关联的 choice{id,actor,type,request}、该 actor 的 observation、该入口的 options。构造方式固定为 receive 当前调用、observerFor(actor)、observe、inputs[type].describe。字段关联不能在联合输入类型中丢失。返回 CallbackReply<GameInput>；reply 经当前凭证、模板和纯 respond 检验后才编码为底层端口返回。非法回答以 paused/invalid_reply 返回，不推进。signal 同样是一种 GameInput；无 choices 的信号等待仍可由回调回答。

该回调面向可信会话/策略路由器，可以看见多个待决参与方的 offer。DecisionPolicy 是公共函数类型，只接收一个 offer 和取消信号，返回对应模板的动作载荷或 pause；交付元数据和 GameInput 包装由路由器补齐。路由器向单个用户/脚本/模型只传对应的 offer，不能把整批私有观察交给一个玩家。onEvent 同样是可信路由入口，按事件的游戏可见性约定分发；核心层不猜受众。直接读取 observe(observer) 是可信控制能力，不是无权限的玩家 API。

多个 choice 表示当前允许的入口，不表示运行器自动选择第一个。路由器可以等待任一回答或返回明确 signal；每个底层调用只接受一次回答。内侧程序保存这个部分输入并发布剩余入口。旧回调控制信号随本次完成而撤销，晚到回答不得自动挪到新 decisionId；剩余玩家是否重试及策略记忆由会话/策略绑定管理。

onEvent 接收 EventDelivery={id,event}。id={instanceId,origin,index}；origin 为 call{callId} 或 done，index 是相应纯投影事件数组的位置。返回 reply/null 表示确认收到，pause 表示在当前边界停下。动画完成不是确认条件。缺少 onEvent 时仍确认事件端口，事件保留在实际端口记录中，不阻塞无界面策略。

事件交付为可重试语义，不承诺网络恰好一次。回调先发送后失败、取消或暂停，下次 run 可以重投同一 id；消费者按 id 去重。fork 的新实例拥有新 id，绝不自动调用父实例的事件回调。恢复也不会重放已完成的端口前缀，但当前待确认调用可再次交付。done 结果附带的事件同样通过稳定 id 交付；中途暂停时 GameRunStop.boundary 可以是 ended，再次 run 重试交付后返回 ended。

BaseGame.run options={limits?:{maxInputs?},signal?}。maxInputs 只数本次接受的 GameInput，包括 signal，不数事件确认；0 处理当前事件后停在下一个 decision。它是适配回调的调用方预算，不是游戏现场。run 返回带 acceptedInputs 的 paused{reason,boundary,message?}、ended{result} 或 fault{error}。宿主失败/非法回答走 paused，程序/契约故障走 fault。

决策/终局投影自带的 events 先按顺序交付，再调用 onDecision 或返回 ended。事件端口的 events 交付确认后才返回该端口 output。取消先于启动任何新回调；达到输入限额时可以处理产生的事件，但不再调用下一个输入回调。回调等待期间允许 inspect/observe（有 view 时）/fork/save，禁止 bind/submit/第二个 run/close；取消活动 run 后可手动控制。

submit 是明确的手动输入模式：只在未被驱动占用的 decision 接受输入，委托同一 Instance 的返回接受与驱动机制，运行到下一个 decision/done；中间事件经相同纯投影收集进 GameUpdate.events。submit 不调用用户绑定的 onDecision/onEvent，事件由这次返回交给调用方。这样手动控制与回调驱动共享执行轨迹，不重复交付。两者可以在稳定边界交替使用。

## 操作状态表

| 稳定状态 | 读取/分支/保存 | bind | 手动回复 | run | close |
| --- | --- | --- | --- | --- | --- |
| 未驱动的 call | 允许；游戏 event 无 view | 允许 | Instance.resume；BaseGame 仅 decision 可 submit | 允许 | 允许 |
| 回调等待中的 call | 允许；读取线性化到该等待点 | busy | busy | busy | busy，先取消驱动 |
| 内部计算中 | busy | busy | busy | busy | busy |
| done | 允许 | 允许 | finished/ended | 返回结果；游戏可完成终局事件交付 | 允许 |
| fault | 仅读取故障；不得 fork/save | 可清空绑定，不能恢复程序 | 拒绝 | 返回故障 | 允许 |
| closed | closed | closed | closed | closed | 幂等成功 |

transfer 仅在无活动驱动的 call/done/fault 上允许，内部计算和回调等待中返回 busy，closed 返回 closed。独占绑定后的底层句柄先检查所有权；闭合错误枚举见 schemas。失败处理不得发布部分成功结果、部分分支或让外部回调改变父分支。

## 搜索、训练和分析

同类型 fork/read/submit 已闭合搜索节点操作。DFS、alpha-beta、MCTS 由调用方决定遍历、候选、评价和回传；协议不预设多人、零和或随机节点算法。保存是暂停节点的资源策略，不是另一种规则步。隐藏信息假设世界由授权的游戏构造逻辑提供，普通策略不得直接拿真实 Instance/快照。

StateTransition、StateResources、StateConstruction、Evaluation、Encoding、FactExtraction 是上层可选结构类型，不是 BaseGame 的第二个必经执行层。GameHistory 保留 setup/configuration/initial/transitions{input,output}；configuration 是实验元数据，凡影响规则的配置必须进入实际程序 setup 或受控输入，不能仅存在历史字段里。

训练记录观察、动作概率、奖励、行为版本与截断；分析定义事实及关系；动画消费可见事件。三者均不改变规则运行路径。

## 完备性与证明边界

逐项构造证明、反例和源码字段原文见 evidence/C01/boundary-migration-review.md。证明前提是受控语言语义保持、内侧状态闭合、纯 contract 和正确 Instance 保存/分支；公共 type/schema 不能单独证明任意实现符合这些前提。原生测试证明实际游戏和内侧 SDK 路径，生产保存和分支行为由 C02/C03 验收。
