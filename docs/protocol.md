# Core / Instance / BaseGame 协议冻结稿

公共声明位于 packages/contracts/src。Instance 是唯一完整运行态；游戏约定通过它两侧的 SDK 和 BaseGame 实现。当前交付声明、内侧斗地主源码及原生验证；生产执行、编译、装载、绑定、保存与分支实现由后续关卡验收。

## Core 与 Instance

- PortShape：input/output。PortCall 是关联的 port/input；PortReturn 是关联的 port/output。端口表是有限必填字符串键表，不接受开放索引、联合表、可选键、数字或符号键。
- IO.call(call)：外部调用。Program.run(setup,io) 使用普通受控 TS 计算、循环、递归和闭包。ProgramModule 包含 schemas{setup,result,ports} 与 run。
- Core.start(setup)：运行至稳定边界并返回 Outcome<Instance>。
- Instance：id、bind(bindings|null)、run(options?)、inspect()、可选 fork()、transfer()、close()。
- InstanceStop：call{callId,call}、done{result} 或 fault{error}。
- Outcome：ok/value 或 ok/error。操作拒绝与程序故障分开。
- InstancePersistence：save(instance)、restore(snapshot)、release(snapshot)。唯一快照类型 InstanceSnapshot 只公开 snapshotId。
- InstanceCapture.read(instanceId,{after,limit})：返回 records/next。记录为 started{setup}、called{callId,call}、returned{callId,reply}、completed{result}、faulted{error}，每条有 sequence。
- PortBindings：声明端口的可选回调表。每个回调接收 {instanceId,callId,input} 与 {signal}，返回 {kind:reply,value} 或 {kind:pause}；返回类型关联该端口。它不成为程序内部能力，也不进入保存现场。

Instance 保存程序身份、控制栈、局部变量、闭包环境、对象图、内侧 SDK/受控设备状态、待决调用和记录前缀。影响后续运行的内部状态不得藏在外侧 BaseGame 或不受控宿主闭包中。纯计算生成的伪随机流在内侧持有 seed/状态；真实外部不确定性通过端口回复显式输入。Core 不解释随机、时钟、玩家或卡牌。

执行内部计算时 inspect/fork/save/close 拒绝 instance_busy，不返回过期现场。程序稳定等待宿主回调时 inspect/fork/save 可以线性化读取；run/bind/close 仍被活动驱动租约排斥。错误端口、过期 callId、无效 schema 的回复被拒绝，不改变现场或输入记录。正常结束可以读取、保存和分支，不能继续程序；故障不能继续、保存或分支；close 关闭活实例。程序预算耗尽为 fault，不冒充游戏输赢。

## 分支与保存

fork 从稳定的 call/done 创建同类型 Instance。父实例、子实例和其他兄弟的可变状态相互隔离，子实例获得新 InstanceId；父实例不推进。子实例保留提供者的 fork 能力，但不继承宿主回调绑定或活动驱动，处于未绑定状态。创建失败清理临时资源且保持父实例不变。

save 返回同一现场的不可变保存引用。restore 返回独立、未绑定的同类型 Instance，不重放完整程序前缀，不重新执行已经完成的外部效果。fork 与 save→restore 在运行语义上等价，但接口不限定内部算法、复杂度或持久化介质。所有句柄仅由其兼容提供者解释；未知、已释放和不兼容引用分别按既有错误类别拒绝。

release 释放保存引用，不影响已恢复实例或独立分支；重复释放同一已释放引用幂等成功，未知引用仍拒绝。close 不隐式释放已保留快照。直接运行无需提供 fork 或 persistence。真正的外部输入生产者不属于快照：重现后续轨迹要求显式提供相同后续回复，不能把现实网络/用户的未来行为纳入确定性承诺。

记录 sequence 从 0 连续递增，started 唯一；只记录被接受的回复，completed/faulted 后不追加。after=null 从头读取，否则指最后消费的有效序号；越界游标拒绝。next=null 表示没有更多，调用方保留实际已消费序号。fork/restore 继承记录前缀，不重复 started/called；记录所属实例与 callId 一起确定调用身份。

## 捕捉权限与记录生命周期

LoadedCore.capture 是装载提供者授予可信审计调用方的能力，授权读取这个 LoadedCore 所产生的实例；InstanceId 只是定位值，不自行授予权限。未知、其他提供者以及已释放记录返回 rejected/records_not_found。普通策略不能持有 capture。

read(instanceId,...) 与实例执行句柄无关。transfer 只移动执行控制权；id 不变，捕捉权不移动。BaseGame.id、fork 子实例 id 及 restore 结果 id 均可被同一个兼容 capture 定位。一次 read 原子地读取某个已提交的日志前缀；可以与 run 并行，不暴露半条记录。记录值隔离，读取不影响执行。

close 释放执行现场但保留捕捉记录。capture.release(instanceId) 仅在实例已关闭时释放该实例的记录引用；活实例返回 conflict/instance_busy。重复释放同一已释放引用幂等成功，未知身份仍拒绝。父、子及快照的共享底层存储必须引用计数或等价隔离；释放父记录不影响子记录或快照包含的前缀。没有 capture 能力时不承诺外部日志留存，执行和保存能力仍独立成立。

## 同一游戏协议的内外两侧

GameModule={program,contract}。program 是实际进入 Instance 的程序；contract 是两侧共享的 GameContract。装载及绑定必须使用同一作者包的匹配程序与约定；相同 TS 类型不证明两个任意实现具有相同语义。

内侧 GameSDK<P> 把每个声明端口 K 包装为 (input:P[K].input)→Promise<P[K].output>。它是库函数形状，不是另一个执行器。SDK 在 program.run 内创建，包装 IO.call；具体游戏可组合 deal/bid/play 等更高层库函数，内部计算不必都变成端口。SDK 闭包和可变局部均由 Instance 持有。SDK 发事件也是受控调用：只等待接收确认，不等待动画结束。端口角色和数据语义由 GameContract 确定，Core 不认识 GameSDK。

外侧 BaseGame 持有并独占驱动一个真实 Instance，使用 GameContract 解读已发布的端口数据。它不能有恢复所必需的额外游戏/服务状态。边界、观察、选择、查询可由当前 InstanceStop 和纯 contract 重新计算；缓存可全部丢弃。事件发送回执、策略记忆、会话权限及网络重试状态属于各自调用方，不属于游戏规则状态。

GameContract 字段：

- schemas：view/actor/delivery/signal/observer/observation/event/result，以及关联的 interactions 模板。
- ports：每个外部端口恰为 event 或 decision。event.receive(input) 返回 events/output；decision.receive(input) 返回 view/choices；decision.respond(view,submission) 返回 valid:false/reason 或 valid:true/output。
- finish(programResult)：返回 view/result，终局只有一个来源。
- observerFor(actor)：该参与方对应的观察身份；observe(view,observer)：可见投影。运行器用二者生成该参与方的 DecisionOffer，不擅自映射玩家身份。
- inputs[type]：options schema 和 describe(view,choice)。
- queries[name]：input/output schema 与 run(view,args)。

这些处理器必须纯、确定且值隔离，不捕获可变宿主状态。外侧 respond 做提交预检和编码；内侧规则仍验证端口返回，再执行结算。多方输入的封存、计数、触发队列、随机流与事件发布游标都在内侧。外側不能把尚未送入 Instance 的玩家输入偷偷缓存在游戏私有状态中；要么立即编码为一个受控输入，要么留在明确的会话协议中。

## 游戏数据与外侧接口

InteractionShape={request,input,description}。Choice={id,actor,type,request}，type 关联载荷。choices 是真实待决入口，id 唯一，没有 context 过滤字段。

DecisionId={instanceId,callId}，由当前 Instance 身份及挂起调用直接构成，无需外侧维护额外签发状态。GameBoundary 为 decision{decisionId,choices}、event{callId} 或 ended{result}。event 表示当前在输出端口等待确认，并非玩家行动。边界通过 inspect 读取；事件统一通过 run 驱动 onEvent 交付。

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
- fork?()：底层 Instance.fork 后用同一 contract 绑定新 Instance，返回同类型 BaseGame。
- save?()：委托兼容 InstancePersistence.save(所持 Instance)，直接返回 InstanceSnapshot。
- close()：关闭所持 Instance。

不存在 GameSnapshot、GameReadTarget、branching.step 或第二个模拟执行入口。搜索使用 child=game.fork()，然后调用 child.inspect/bind/run/observe；回调请求携带子实例的 DecisionId。父实例凭证不能提交给子实例，即使其 Choice 内容相同。

终局可观察、查询、分支、保存，不能提交/描述输入；内部执行时拒绝 game_busy，关闭后拒绝 game_closed。event 边界可 inspect/fork/save/run；observe/query 拒绝 view_unavailable，因为事件端口没有声明可读 view；describe/validate 同样不能把它当作决策。回调等待时只读与 fork/save 可用，推进受驱动租约保护。validate 不替代 run 对回调输入的再次检查。非法输入不向程序返回值。处理器异常或输出不合约为契约 fault；BaseGame 释放自己的活动驱动、关闭所持 Instance，再返回 fault。后续访问为 game_closed。适配器不能把错误写成 Core 程序故障或添加可恢复的外侧故障状态。程序自身 fault 则保持底层 fault，读取转换为 GameError，close 仍可用。

## 装载、绑定及恢复

NativeCoreLoader.load(ProgramModule) 与 ControlledCoreLoader.load(CompiledProgram) 返回 Outcome<LoadedCore{core,persistence?,capture?}>。CompiledProgram 为受控产物及 invariant 类型见证；loader 仍须检验程序准入、schema 与兼容身份；失败通过 Outcome.error 返回，未准入/不匹配产物为 rejected/invalid_input，缺失必要提供者能力为 unsupported/capability_unavailable，不发布部分 LoadedCore。

Core.start(setup) → Instance → BaseGameBinder.bind({instance,contract,persistence?}) → BaseGame。bind 不启动第二份规则程序，先通过 Instance.transfer 接管独占驱动权，仅投影当前 call/done；初始边界可以是 event。绑定失败关闭被接管的实例。transfer 在未被活动驱动占用的稳定状态原子地返回同一 InstanceId 的新句柄，使旧句柄及其别名的操作返回 instance_owned；新句柄保留原现场与底层可选能力，清空宿主绑定。它不是 fork，不复制运行态。BaseGameBinder 只持有新句柄，不向外暴露它；重复使用旧句柄绑定被拒绝。TS 无线性类型，运行器必须落实这项通用所有权操作。

外侧 fork 当且仅当底层实际支持 fork 才暴露，save 当且仅当绑定了兼容 persistence 才暴露。普通直接运行不要求两者。子 BaseGame 保留同一 contract 与可用能力，但外部回调未绑定；子绑定失败清理子实例，父实例不受影响。

恢复路径：persistence.restore(snapshot) → Instance → binder.bind({instance,contract,persistence})。不需要游戏级 restore 或额外补存状态。恢复/分支后的决策凭证使用新 InstanceId。binder 直接返回游戏句柄，初始边界通过 inspect 读取。绑定、恢复和 inspect 不发送事件；事件只在 run 中通过 onEvent 交付，并使用 EventDeliveryId 去重。

## Instance 外部控制与回调生命周期

bind 的表仅允许声明过的端口，缺少某端口不是默认返回 undefined，而是 run 到该调用时返回 paused/unbound。表替换是原子的；活动 run 存在时 bind/transfer/close 或第二个 run 均拒绝 instance_busy。BaseGame 接管后的原 Instance 别名操作拒绝 instance_owned；内部适配持有独占权限。绑定注册表不是程序状态，fork/restore 不复制。

Instance.run 的 options={limits?:{maxReplies?},signal?}。maxReplies 是本次驱动最多接受的回复数，非执行指令数；0 在当前调用边界停止，不执行回调。省略则不以回复数限制。无效限额在执行前 rejected/invalid_argument。run 返回 InstanceRunStop：

- paused：reason、当前 call、可选 message、acceptedReplies；
- done：result、acceptedReplies；
- fault：error、acceptedReplies。

acceptedReplies 只统计本次已提交给程序的端口返回，拒绝、暂停与取消均不增加。Instance 和 BaseGame 的唯一推进入口均为 run。单次端口返回使用 bind 配置回复回调，再 run({limits:{maxReplies:1}})；端口返回的原子接受是执行器内部操作，不另暴露公共入口。

CallbackReply<T> 的 reply.value 必须通过该端口输出 schema，pause 不带值。回调 pause → requested；缺失回调 → unbound；回复数限额 → limit；signal 取消 → cancelled；回调抛错/拒绝 Promise → handler_failed；输出结构不合法 → invalid_reply。以上均保留待决调用，不将宿主错误当成程序 fault。再次 run 会重新调用当前端口的回调。

回调参数中的 AbortSignal 是宿主控制对象，不能进程序或快照。运行器为每次回调产生独立信号，外部取消或结束该次租约时撤销；回调可以忽略取消，但它的迟到返回必须丢弃。回复提交与取消有确定的线性化顺序：提交先发生则该回复计数并继续到下一个稳定点；取消先发生则不接受回复。相同调用不能接受两次回复。停止后可重新 bind/run；旧 Promise 永远不能回答新驱动、其他实例或恢复后的调用。

程序正在内部计算时，取消在下一个端口/终局稳定点生效；不要求任意指令可恢复。无限内部循环由执行提供者的预算终止为 fault。回调在等待期间可立即撤销其驱动租约而保留待决调用，无需等待宿主 Promise 实际结束。

当到达 done/fault 时，实际终止优先于回复数限额；若仍在 call，则依次检查取消、限额和绑定，之后才调用回调。终局 run 直接返回终局，不再继续程序。

## BaseGame 游戏回调与控制

GameBindings 包含可选 onDecision 和 onEvent。bind 只注册，不调用它们；null 清空。run 负责实际调度。外侧游戏适配将这些回调包装成 Instance 的端口回调，负责驱动编排，不解释程序或直接调用规则 apply。

onDecision 接收 GameRequest={decisionId,offers}，每个 DecisionOffer 包含关联的 choice{id,actor,type,request}、该 actor 的 observation、该入口的 options。构造方式固定为 receive 当前调用、observerFor(actor)、observe、inputs[type].describe。字段关联不能在联合输入类型中丢失。返回 CallbackReply<GameInput>；reply 经当前凭证、模板和纯 respond 检验后才编码为底层端口返回。非法回答以 paused/invalid_reply 返回，不推进。signal 同样是一种 GameInput；无 choices 的信号等待仍可由回调回答。缺少 onDecision 时在当前 decision 暂停为 unbound，不默认选取任何动作。

该回调面向可信会话/策略路由器，可以看见多个待决参与方的 offer。DecisionPolicy 是公共函数类型，只接收一个 offer 和取消信号，返回对应模板的动作载荷或 pause；交付元数据和 GameInput 包装由路由器补齐。路由器向单个用户/脚本/模型只传对应的 offer，不能把整批私有观察交给一个玩家。onEvent 同样是可信路由入口，按事件的游戏可见性约定分发；核心层不猜受众。直接读取 observe(observer) 是可信控制能力，不是无权限的玩家 API。

多个 choice 表示当前允许的入口，不表示运行器自动选择第一个。路由器可以等待任一回答或返回明确 signal；每个底层调用只接受一次回答。内侧程序保存这个部分输入并发布剩余入口。旧回调控制信号随本次完成而撤销，晚到回答不得自动挪到新 decisionId；剩余玩家是否重试及策略记忆由会话/策略绑定管理。

onEvent 接收 EventDelivery={id,event}。id={instanceId,callId,index}，index 是当前 event.receive 事件数组的位置。返回 reply/null 表示确认收到，pause 表示在当前边界停下。动画完成不是确认条件。缺少 onEvent 时仍确认事件端口，事件保留在实际端口记录中，不阻塞无界面策略。

事件交付为可重试语义，不承诺网络恰好一次。回调先发送后失败、取消或暂停，下次 run 可以重投同一 id；消费者按 id 去重。fork 的新实例拥有新 id，绝不自动调用父实例的事件回调。恢复也不会重放已完成的端口前缀，但当前待确认调用可再次交付。decision.receive 和 finish 不产生事件。所有通知，包括终局前通知，必须由程序在 return 之前调用 event 端口发布。ended 没有尚待确认的通知，也不属于 paused 边界。

BaseGame.run options={limits?:{maxInputs?},signal?}。maxInputs 只数本次接受的 GameInput，包括 signal，不数事件确认；0 处理当前事件后停在下一个 decision。它是适配回调的调用方预算，不是游戏现场。run 返回带 acceptedInputs 的 paused{reason,boundary,message?}、ended{result} 或 fault{error}。宿主失败/非法回答走 paused，程序/契约故障走 fault。

只有 event 端口交付 events；数组全部确认后才返回该端口 output。重试从数组开头开始，使用相同 id，协议不保存外侧交付游标。取消先于启动任何新回调；达到输入限额时可以处理产生的事件，但不再调用下一个输入回调。回调等待期间允许 inspect/observe（有 view 时）/fork/save，禁止 bind/第二个 run/close；取消活动 run 后可重新绑定并继续 run。

BaseGame 的唯一推进入口是 run。bind 只配置回调；输入由当前 onDecision 调用返回，事件由 onEvent 接收。单步调用使用 maxInputs:1，搜索在每个同类型子实例上使用相同入口。

## 适配控制与故障归属

BaseGame 的绑定表、活动驱动标记、计数、取消信号和本次停止原因是宿主控制状态，不能影响游戏规则。它们不进入快照；fork/restore 清空绑定与驱动，规则现场不丢失。一次 run 可暂存已经交付的数组位置；取消后该位置丢弃，下次按相同身份重试。

BaseGame 实现只使用所持 Instance 的公开 bind/run/inspect/fork/close 和提供者的 save。其端口回调在需要游戏级暂停时返回 pause，并在当前 run 局部保留 requested/unbound/limit/invalid_reply 等原因用于翻译底层停止值；这个局部数据在 run 返回后丢弃。acceptedInputs 只在底层确实接受对应 decision 回复时计数，不能在策略返回时提前计数；可用 Instance.run(maxReplies:1) 的结果逐步累计。适配器可以循环调用这些驱动操作，但不执行规则、不另行接受端口返回。

用户 onDecision/onEvent 抛错是 handler_failed 暂停，用户返回值不合法是 invalid_reply 暂停；纯 contract 抛错或发布了无效 view/choice/output 是 invalid_output 契约故障。BaseGame 关闭故障实例前须撤销内部活动驱动；关闭本身的提供者失败按 fault 返回，不能宣称关闭成功。操作入参错误在取得驱动权前拒绝；进入驱动后的暂停/结束/故障通过 GameRunStop 返回。只读操作遭遇底层故障或契约故障通过 GameOutcome.error 返回。

## 操作状态表

| 稳定状态 | 读取/分支/保存 | bind | run | close |
| --- | --- | --- | --- | --- |
| 未驱动的 call | 允许；游戏 event 无 view | 允许 | 允许 | 允许 |
| 回调等待中的 call | 允许；读取线性化到该等待点 | busy | busy | busy，先取消驱动 |
| 内部计算中 | busy | busy | busy | busy |
| done | 允许 | 允许 | 直接返回结果，不执行回调 | 允许 |
| fault | 仅读取故障；不得 fork/save | 可清空绑定，不能恢复程序 | 返回故障 | 允许 |
| closed | closed | closed | closed | 幂等成功 |

transfer 仅在无活动驱动的 call/done/fault 上允许，内部计算和回调等待中返回 busy，closed 返回 closed。独占绑定后的底层句柄先检查所有权；闭合错误枚举见 schemas。失败处理不得发布部分成功结果、部分分支或让外部回调改变父分支。

## 搜索、训练和分析

同类型 fork/read/bind/run 已闭合搜索节点操作。DFS、alpha-beta、MCTS 由调用方决定遍历、候选、评价和回传；协议不预设多人、零和或随机节点算法。保存是暂停节点的资源策略，不是另一种规则步。隐藏信息假设世界由授权的游戏构造逻辑提供，普通策略不得直接拿真实 Instance/快照。

StateTransition、StateResources、StateConstruction、Evaluation、Encoding、FactExtraction 是上层可选结构类型，不是 BaseGame 的第二个必经执行层。GameHistory 保留 setup/configuration/initial/transitions{input,output}；configuration 是实验元数据，凡影响规则的配置必须进入实际程序 setup 或受控输入，不能仅存在历史字段里。

训练记录观察、动作概率、奖励、行为版本与截断；分析定义事实及关系；动画消费可见事件。三者均不改变规则运行路径。

## 错误类别的使用范围

| 类别 | 来源 |
| --- | --- |
| invalid_argument | 无效操作参数、限额、游标、未知查询名/端口绑定键 |
| invalid_input | setup/产物或只读校验输入不符合声明；run 内用户非法回复转 paused/invalid_reply |
| snapshot_not_found | 仅 InstancePersistence 的未知/释放快照；BaseGame 没有按快照读取的入口 |
| snapshot_incompatible | 保存/恢复提供者或传入 binder 的 persistence 与程序不兼容 |
| records_not_found | 仅 capture 的未授权、未知或已释放记录 |
| instance_busy / game_busy | 活动驱动、内部计算或不允许的并发操作 |
| instance_closed / game_closed | 已关闭执行句柄；capture 记录留存独立于该状态 |
| instance_owned | 旧所有权句柄；BaseGame 不暴露已转移句柄 |
| game_ended / view_unavailable | 终局无输入入口 / event 没有 view |
| decision_mismatch / choice_not_found | 只读 describe/validate 的凭证或真实入口不匹配 |
| capability_unavailable | 提供者不能提供请求的装载/能力；可选操作通常通过字段缺席表达 |
| invalid_output / program_failed / budget_exceeded | 契约或程序输出故障 / 受控程序异常 / 执行预算；不能当游戏输赢 |

## 完备性与证明边界

完整需求闭合与操作构造证明见 [冻结证明](../evidence/C01/protocol-freeze-proof.md)；逐项场景与源码字段原文见 evidence/C01/boundary-migration-review.md。证明前提是受控语言语义保持、内侧状态闭合、纯 contract 和正确 Instance 保存/分支；公共 type/schema 不能单独证明任意实现符合这些前提。原生测试证明实际游戏和内侧 SDK 路径，生产保存和分支行为由 C02/C03 验收。
