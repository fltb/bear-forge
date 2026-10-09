# Core / Instance / BaseGame 协议

公共声明位于 packages/contracts/src。Instance 持有完整运行态；GameContract 定义游戏在 Instance 两侧的约定；BaseGame 按 player 提供交互。C01 交付声明、游戏作者包、原生消费者与证明，C02/C03 验收生产执行及绑定实现。

## Core 与 Instance

PortShape={input,output}。PortCall/PortReturn 通过端口键关联参数与返回。端口表为有限必填字符串键表；固定表检查拒绝开放索引、联合表、可选键、数字和符号键。

ProgramModule={schemas:{setup,result,ports},run}。Program.run(setup,io) 使用受控 TS 的函数、循环、递归和闭包，IO.call(call) 表达外部调用。Core.start(setup) 运行至稳定边界，返回 Outcome<Instance>。

Instance 的成员是 id、bind、run、inspect、可选 fork、transfer、close。InstanceStop 为 call{callId,call}、done{result} 或 fault{error}。Outcome 为 ok/value 或 ok/error，操作拒绝与程序故障分别表达。

完整现场包含程序身份、控制栈、局部变量、闭包环境、对象图、内侧 SDK/设备状态、待决调用和记录前缀。受控伪随机流的 seed 与状态在程序内部；真实外部不确定性通过端口返回输入。游戏规则、玩家、时钟含义由游戏解释。

内部计算期间 inspect/fork/save/close 返回 instance_busy。稳定等待回调时 inspect/fork/save 可以线性化读取；活动 run 排斥 bind/transfer/close 和其他 run。回复匹配当前 callId、端口及 schema 后原子接受，追加返回记录并继续运行。无效回复保持现场和记录不变。正常结束支持读取、保存和分支；故障支持 inspect/close，拒绝继续、保存和分支。执行预算耗尽归为 fault。

## 通用绑定和驱动

PortBindings 是声明端口的可选回调表。每个回调接收 {instanceId,callId,input} 与 {signal}，返回 CallbackReply：reply{value} 或 pause。value 与对应端口输出类型关联。

Instance.bind(table) 原子替换整个端口回调表；bind(null) 清空。绑定只配置宿主控制状态。Instance.run(options?) 是唯一推进入口，options={limits?:{maxReplies?},signal?}。maxReplies=0 停在当前调用边界；省略表示回复次数不限。计数只包含本次已接受的端口返回。

InstanceRunStop 是带 acceptedReplies 的 paused{reason,call,message?}、done{result} 或 fault{error}。pause→requested，缺少回调→unbound，限额→limit，取消→cancelled，回调异常→handler_failed，非法回复→invalid_reply。暂停保留当前调用，下次 run 重新调用相应回调。

每次回调拥有可撤销租约及 AbortSignal。取消或租约结束撤销信号，迟到回复被丢弃；提交先于取消则提交计数并继续到稳定点，取消先于提交则回复不被接受。稳定等待时取消立即释放驱动，宿主 Promise 可以随后结束。内部计算时取消在下一个稳定点生效，无限循环由执行预算终止。

到达 done/fault 时实际终止优先；仍在 call 时依次检查取消、限额和绑定。结束实例的 run 返回终局。

## 分支、保存和所有权

fork 从稳定 call/done 产生新 id、独立可变现场、相同类型和底层能力的 Instance；父实例保持原状。子实例无宿主绑定、无活动驱动。失败清理临时资源。

InstancePersistence 提供 save(instance)、restore(snapshot)、release(snapshot)。InstanceSnapshot 只公开 snapshotId。save 保存稳定现场；restore 创建独立且未绑定的 Instance，从保存的续延继续。fork 与 save→restore 对相同未来输入具有相同运行语义。提供者解释并检查程序/规则/保存格式兼容性；未知、释放和不兼容引用分别拒绝。

release 释放保存引用；重复释放已释放引用幂等成功，未知引用拒绝。已恢复实例和独立分支保留其资源。close 释放实例现场，快照引用保持有效。直接运行可省略 fork/persistence 能力。

transfer 只移动执行控制权：在无活动驱动的 call/done/fault 上，原子地返回同一 id 的新句柄，旧句柄及别名后续操作返回 instance_owned，新句柄清空宿主绑定。内部计算或回调等待返回 busy，关闭返回 closed。所有操作先检查所有权，再检查生命周期。

## 捕捉和资源生命周期

LoadedCore.capture 按提供者授予的范围访问实例记录。InstanceCapture.read(instanceId,{after,limit}) 返回 records/next；release(instanceId) 释放已关闭实例的记录。未知、其他提供者及已释放记录返回 records_not_found。

记录为 started{setup}、called{callId,call}、returned{callId,reply}、completed{result}、faulted{error}，sequence 从 0 连续递增。started 唯一，只有接受的回复写入 returned，completed/faulted 后停止追加。after=null 从头读，否则为最后消费序号；无效游标拒绝。next=null 表示当前前缀已读完，调用方保留已消费序号。

read 原子读取已提交前缀，可与 run 并行；返回值隔离。transfer 保持 id，捕捉能力仍可通过 BaseGame.id 定位同一记录。close 释放执行现场但保留捕捉记录。capture.release 对活实例返回 instance_busy，对已释放引用幂等成功，对未知身份拒绝。

fork/restore 继承记录前缀，调用身份由实例 id 与 callId 共同确定。父记录、子记录及快照的底层存储按引用隔离，释放一方保留其他引用。

## GameContract 与内侧 SDK

GameModule={program,contract}。装载器和绑定器核对同一作者包的程序与约定。GameSDK<P> 将每个声明端口 K 包装为 (input:P[K].input)→Promise<P[K].output>。SDK 在 program.run 内创建，通过 IO.call 访问外部；领域 SDK 继续组合发牌、响应、伤害等游戏行为。

GameTypes 声明 setup、ports、programResult、view、interactions、actor、delivery、signal、player、observation、event、playerEvent、result。

- player 是游戏定义的字符串键，由游戏 schema 限定取值，按字符串值比较。
- actor 是具体行动主体，可为任意游戏数据；多个 actor 可以映射到同一 player。
- view 为纯适配处理器读取的边界数据；observation 为指定 player 的可见投影。
- event 是端口发布的原始游戏事件；playerEvent 是交付给指定 player 的事件数据。

GameContract 的字段：

| 字段 | 输入 → 输出 |
| --- | --- |
| schemas | view/actor/delivery/signal/player/observation/event/playerEvent/result，以及 interactions 的 request/input/description schema |
| ports[K].receive，decision | 端口 input → {view,choices,signalPlayers} |
| ports[K].respond，decision | (view,submission,player) → {valid:false,reason} 或 {valid:true,output} |
| ports[K].receive，event | 端口 input → {events,output} |
| finish | programResult → {view,result} |
| playerFor | actor → player |
| observe | (view,player) → observation |
| projectEvent | (event,player) → {event:playerEvent} 或 null |
| inputs[type] | options schema；describe(view,choice) → InputOptions |
| queries[name] | input/output schema；run(view,args) → output |

每个端口恰有一种角色。decision.receive 和 finish 不产生事件。projectEvent 的 null 表示跳过交付，{event:null} 可以表达值为 null 的可见事件。投影只依赖该条原始事件和 player；事件包含完成投影所需的发生时数据。

以上处理器纯、确定、值隔离，输出通过对应 schema 检验。playerFor 输出和 signalPlayers 元素通过 player schema 检验。choices 的 id 唯一。signalPlayers 按 player 去重；允许 choices=[] 的纯信号等待。observe 与 describe 的输出是该玩家可接收的数据；输入选项的可见性由游戏约定保证。

规则状态、部分输入封存、触发队列、随机流和事件发布位置全部在 Instance 内。respond 进行只读预检和编码，内侧程序验证端口返回后结算。会话的交付时间、策略记忆与网络回执由各自调用方持有。

## 输入结构和只读接口

InteractionShape={request,input,description}。Choice={id,actor,type,request}，type 关联载荷类型。DecisionId={instanceId,callId}，直接使用当前 Instance 与调用身份。

GameInput 是 choice{choiceId,input:{type,value},delivery} 或 signal{signal}。无信号的游戏使用 never。InputOptions 为 exact{values} 或 construct{description}：exact 完整列出指定入口的合法动作载荷；construct 使用游戏声明的 JSON 构造约定，由上层调用方解释。交付数据和信号各有自己的 schema。

GameBoundary 为 decision{decisionId,choices}、event{callId} 或 ended{result}。BaseGame 持有并独占驱动一个 Instance，公开：

| 方法 | 语义 |
| --- | --- |
| id | 所持 Instance.id |
| bind({player,onDecision?,onEvent?}) | 原子替换该 player 的回调；仅有 player 时移除该项 |
| bind(null) | 清空全部玩家绑定 |
| run(options?) | 委托 Instance.run 驱动，返回带 acceptedInputs 的 paused/ended/fault |
| inspect() | 当前完整游戏边界 |
| observe({player}) | 当前边界对该 player 的可见投影 |
| describe({decisionId,choiceId,type}) | 当前指定入口的 InputOptions |
| validate({player,decisionId,input}) | 当前玩家完整输入的只读预检 |
| query({name,args}) | 游戏声明的边界查询 |
| fork?() | 底层 fork 后，绑定相同 contract，返回同类型 BaseGame |
| save?() | 委托兼容 persistence，返回 InstanceSnapshot |
| close() | 关闭所持 Instance |

inspect/describe/query、指定 player 的 observe 以及 capture 是控制调用方持有的读取能力。用户、脚本和模型接收其 player 回调数据。会话负责把连接关联到游戏 player。

validate 检验 decisionId、player、当前 choice/type、载荷与交付 schema，再调用 respond。choice 必须映射至该 player；signal 必须声明该 player 为接收者，具体信号目标和约束由 respond 检查。语义不合法返回 valid:false；每次实际回复重新执行相同检查。

内部计算时返回 game_busy。event 可 inspect/fork/save/run；observe/query/describe/validate 返回 view_unavailable。终局可 observe/query/fork/save；describe/validate 返回 game_ended。关闭后返回 game_closed。回调等待允许只读及 fork/save，活动驱动排斥 bind/run/close。

## 玩家绑定和决策回调

GameBindings={player,onDecision?,onEvent?}。按 player 保存绑定，绑定操作保持其他玩家原项；同一个函数可绑定到多个 player。bind 只注册，run 执行回调。fork/restore 的绑定表为空。

onDecision(request,control) 接收：

```ts
request = {
  decisionId,
  observation,           // observe(view, 当前绑定 player)
  offers: [{choice, options}], // playerFor(choice.actor) 等于当前 player
  acceptsSignal          // signalPlayers 包含当前 player
}
control = { signal, player }
```

每个 offer 保持 choice.type/request/options 的类型关联。一个 player 可收到多个 actor 的入口；只在有自己的 offer 或 acceptsSignal=true 时调用其 onDecision。纯信号等待仍携带 observation，信号构造所需游戏数据由 observation 或 request 提供。

DecisionPolicy(offer,observation,control) 只选择关联动作载荷或 pause；绑定函数补充交付数据、choiceId 和 GameInput 包装。玩家回复是 CallbackReply<GameInput>。

一次 decision 按 player 字符串顺序启动所有符合条件的已绑定回调，异步等待任一合法回复。第一个通过检查及 respond 的回复原子提交；其余租约取消，迟到返回丢弃。内侧保存已接受输入并发布下一边界。下一请求使用新的 decisionId，重新生成各玩家自己的入口。

单个回调返回 pause、失败或非法回复时，停止等待该回调，其他回调继续。全部结束仍无合法回复时暂停：invalid_reply 优先于 handler_failed，随后为 requested。没有符合条件的已绑定 onDecision 时为 unbound。外部取消立即暂停为 cancelled。投影或 respond 的异常属于契约 fault。

## 玩家事件回调

event.receive 产生原始事件数组。BaseGame 对每条事件、每个已绑定 onEvent 的 player 调用 projectEvent；null 跳过，其余按 playerEvent schema 检验后交付。

onEvent(delivery,control) 接收 {id,event:playerEvent} 和 {signal,player}。id={instanceId,callId,index}，index 是原始数组位置。相同源事件对多个玩家保留相同 id，消费者按 (player,id) 去重。不同玩家可收到不同数据或完全不接收。

交付顺序为原始事件数组顺序，同一事件内按 player 字符串顺序。回调 reply/null 确认接收；全部可见回调确认后返回 event 端口 output。缺少 onEvent 的玩家和过滤掉的投影直接跳过；动画由接收方异步播放。

pause、回调失败、非法确认和取消保持当前 event 调用，按通用暂停原因返回。下次 run 从原数组开头重投，id 保持一致。消费者持有接收回执；外侧交付位置只存在于活动驱动中。绑定、inspect、fork 和 restore 只产生对应操作结果；run 承担事件交付。程序在 return 前完成终局事件端口，ended 的通知已确认。

## 游戏驱动、装载和故障

BaseGame.run options={limits?:{maxInputs?},signal?}。maxInputs 只统计本次接受的 GameInput，包括 signal；事件确认不计数。0 处理当前事件后停在下一个 decision。终局优先；仍待输入时检查取消、限额和绑定。停止返回 acceptedInputs 与 paused{reason,boundary,message?}、ended{result} 或 fault{error}。

适配器可循环调用 Instance.run(maxReplies:1)，根据端口角色累计 acceptedInputs；达到输入限额后继续交付产生的事件。自身停止原因保留在本次驱动局部，底层接受数为最终计数依据。无效回答保持原规则现场。

NativeCoreLoader.load(ProgramModule) 与 ControlledCoreLoader.load(CompiledProgram) 返回 Outcome<LoadedCore{core,persistence?,capture?}>。装载核验准入、schema 与兼容身份。产物拒绝为 invalid_input，必要能力缺失为 capability_unavailable。

路径：load → Core.start → Instance → BaseGameBinder.bind({instance,contract,persistence?}) → BaseGame。binder 通过 transfer 接管独占控制权，投影当前 call/done；失败关闭接管实例。fork 仅在底层提供 fork 时暴露，save 仅在持有兼容 persistence 时暴露。

恢复路径：persistence.restore(snapshot) → Instance → binder.bind。子游戏使用相同接口、相同 contract、新 InstanceId 和空玩家绑定表。

程序 fault 保留底层故障。纯处理器异常或输出不合约是契约 fault：适配器撤销活动驱动，按公开 close 关闭 Instance，返回 GameError；其后为 game_closed。只读操作发现契约故障时执行相同清理，先撤销已有租约再 close。规则继续所需状态全部由 Instance 保存，宿主绑定和租约只负责外部驱动。

## 搜索、训练和分析

搜索在同类型子游戏上使用 fork/inspect/observe/describe/validate/bind/run/close；单步使用 maxInputs:1。调用方决定 DFS、alpha-beta 或 MCTS 的遍历、候选、评价和回传。隐藏信息搜索由游戏构造合法假设世界，分析实验可按授权访问完整现场。

StateTransition、StateResources、StateConstruction、Evaluation、Encoding、FactExtraction 是上层可选结构类型。GameHistory={setup,configuration,initial,transitions:[{input,output}]}；影响规则的配置进入实际 setup 或受控输入，configuration 保存实验元数据。

训练记录 player、actor、实际观察、动作概率、奖励、行为版本和截断；分析解释领域事实及关系；前端播放 playerEvent。三者共享同一规则运行路径。

## 错误类别

| 类别 | 来源 |
| --- | --- |
| invalid_argument | 操作参数、限额、游标、未知查询/绑定键 |
| invalid_input | setup/产物或校验输入结构；运行回调非法回复映射 invalid_reply |
| snapshot_not_found / snapshot_incompatible | 保存引用不存在或不兼容 |
| records_not_found | 记录访问范围外、未知或已释放记录 |
| instance_busy / game_busy | 活动驱动或内部计算冲突 |
| instance_closed / game_closed | 已关闭执行句柄 |
| instance_owned | 旧所有权句柄 |
| game_ended / view_unavailable | 终局输入操作 / event 边界缺少 view |
| decision_mismatch / choice_not_found | 当前凭证或输入入口不匹配 |
| capability_unavailable | 提供者必要能力缺失 |
| invalid_output / program_failed / budget_exceeded | 契约输出故障 / 程序异常 / 执行预算 |

需求闭合与归纳证明见[协议证明](../evidence/C01/protocol-freeze-proof.md)，逐字段原文和场景映射见[字段报告](../evidence/C01/boundary-migration-review.md)。
