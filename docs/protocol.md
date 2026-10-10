# 当前公共协议

协议按 Core、Instance、BaseGame 三层组织。会话控制、保存恢复、分支、捕捉分别可选。默认包入口公开 Core、Program、ProgramModule、IO、Instance、BaseGame、Request、InputOptions、GameModule、GameSDK；细节从对应功能路径导入。

公共字段、枚举、方法、导出路径和本文行为语义作为后续实现的固定契约。游戏领域数据仍由游戏声明；内部实现自由选择。若发现具体需求反例，必须报告并由用户重新决策，不允许实现自行修改协议或增加旁路。

## Core：程序与通用端口

ProgramModule={schemas,run}。schemas 声明 setup、result 和每个端口的 input/output。run(setup,io) 是受控 TS 程序，普通函数、循环、递归和闭包完成内部计算。IO.call({port,input}) 等待声明类型的返回。

端口表是有限必填字符串键表。调用的 port 与 input、返回类型保持关联。开放索引、联合表、可选键、数字/符号键不作为固定端口声明。

空端口表和空动作表合法，表示没有对应能力；其值必须是无自有键的普通对象，不能以标量、数组或带额外键的对象代替。类型对空映射单独封闭；非空映射仍受 TS 结构类型规则约束，装载和绑定时必须检查实际自有键，类型检查不能代替运行期准入。

Core.start(setup) 创建 Instance 并计算至首次调用、结束或程序故障。setup 不满足声明时返回 rejected/invalid_input，不创建可运行实例；创建后即使在首次调用前故障，也返回 ok(instance)，通过 inspect/run 读取 fault。影响后续规则执行的局部、闭包、对象图、伪随机流及 SDK 状态由 Instance 持有；真实外部输入通过端口返回进入。

## Instance：单步运行

| 入口 | 约定 |
| --- | --- |
| id | 实例身份 |
| bind(table或null) | 原子替换通用端口回调表，null 清空 |
| run({signal?}?) | 接受至多一次当前端口返回，计算到下一个稳定点 |
| inspect() | 当前 call / done / fault |
| close() | 关闭实例 |
| fork?() | 可选：返回同类型独立实例 |
| transfer() | 装载接线时移交独占控制权，保持实例 id |

通用回调接收 {instanceId,callId,input} 和 {signal}，返回 {kind:'reply',value} 或 {kind:'pause'}。回调、宿主闭包和取消信号属于外部控制；保存现场只包含受控程序的状态。

Instance.run 返回 {accepted,state,pause}：accepted 是本次是否接受一个端口返回；state 为 call{callId,call}、done{result} 或 fault{error}；pause 为暂停原因或 null。接受后内部计算故障仍保持 accepted=true。已结束/故障状态直接返回，accepted=false。

暂停原因只有 requested、unbound、cancelled、handler_failed、invalid_reply。缺少回调为 unbound；回调主动暂停为 requested；异常为 handler_failed；格式不合法为 invalid_reply。它们均保留待决调用。

回复提交与取消按先后原子确定：取消先发生则丢弃回复，提交先发生则保留接受事实并到达下一稳定点。停止后旧回调返回不再生效。每个调用最多接受一次返回。内部计算期间取消在下一个稳定点生效；执行预算负责终止无限内部计算。

内部计算时 inspect/fork/save/close 返回 busy。稳定等待宿主回调时可 inspect/fork/save；活动驱动排斥 bind/transfer/close 和第二个 run。数据跨界隔离。非法参数在修改状态前拒绝。

transfer 在无活动驱动的稳定点原子返回同一实例的新控制句柄，原句柄及别名返回 instance_owned，绑定清空。BaseGameBinder 使用新句柄，接线失败清理接管的实例。

start、fork、restore 每次成功均分配未使用过的 InstanceId；不同活实例及尚保留记录的实例不能共享身份，释放后也不得复用。transfer 只更换控制句柄，不创建运行态。CallId 标识一次实际端口调用，同一实例内不得复用；fork/restore 保留已保存待决调用的 CallId，新 InstanceId 使旧 RequestId 不能跨实例生效。新调用的标识不得编码隐藏的调用次数或游戏状态。

程序调用未声明端口、调用参数不满足 input schema、正常返回值不满足 result schema，产生终态 fault/invalid_output；程序不能捕获这类协议违规后继续为正常结果。普通程序异常为 fault/program_failed。宿主回调给出不满足 output schema 的返回则是 pause/invalid_reply，accepted=false，待决调用不变；两种方向不可混淆。

Instance 的正常结束和程序 fault 均无后续程序推进：inspect 返回当前终态，run 返回相同 state、accepted=false、pause=null。无活动驱动时仍可 bind、transfer、close；bind 不触发回调，transfer 保留终态。save/fork 的终态处理见保存章节。公开对象数据保持值并与宿主隔离，正常返回的故障对象也不能成为修改内部故障状态的别名。

## 游戏请求与动作

ActionTable 的每个键声明 {request,action,description}。action 为 JSON 数据；纯动作不包含通用交付时间或网络信息。

Request 是唯一外部请求结构：

```ts
{
  id: { instanceId, callId, key },
  player,
  type,
  data,          // 游戏定义的请求数据
  observation,   // 该 player 的可见状态
  options        // exact 或 construct
}
```

key 由游戏指定，在同一次挂起调用内唯一。请求身份把实例、调用和具体入口联系起来；其他实例、旧调用和不存在的 key 均拒绝。一个 player 可以同时拥有多个请求；具体角色或行动主体放在 data 中。

InputOptions 为 exact{values} 或 construct{description}。两者描述同一个 action 类型。exact 完整列出当前请求下的合法动作；construct 是游戏声明的构造约定，上层按该约定构造动作。describe 与 validate 使用相同 action 类型。结构校验与具体规则校验均先于端口接受。

玩家回调 onRequest(request,{signal}) 只返回 CallbackReply<Action>。游戏层根据当前回调保存的请求身份和 player 包装 ActionReply={requestId,type,action}。回调修改自己收到的数据不能改变原请求归属。

## BaseGame：外侧接口

| 方法 | 输入与行为 |
| --- | --- |
| bind | {player,onRequest?,onEvent?} 替换该玩家项；只传 player 移除该项；null 清空 |
| run | {signal?}；一次最多接受一个游戏输入，随后交付事件，停在下一请求或结束 |
| inspect | 返回当前游戏状态 |
| observe | {player} → 该玩家观察 |
| describe | {requestId,type} → 合法动作描述 |
| validate | {player,reply:{requestId,type,action}} → 合法或原因 |
| close | 关闭持有的 Instance |

GameState 为 request{requests}、event{callId}、ended{result} 或 fault{error}。inspect 是调度方持有的完整读取能力；玩家只接收各自的回调数据。event 边界的 observe/describe/validate 返回 view_unavailable；终局保留 observe，动作操作返回 game_ended。关闭后返回 game_closed。

参数与状态按下述顺序判定：已关闭或已移交的句柄先拒绝；该操作被活动驱动/内部计算排斥时返回 busy；随后检查参数外壳、身份格式和已声明类别；再检查下表的稳定状态；最后检查当前请求的身份及规则。格式错误使用 rejected/invalid_input，bind/run 的控制参数错误使用 rejected/invalid_argument，均不推进状态。回调给出的错误格式或非法动作返回 pause/invalid_reply，不作为作者契约故障。

| BaseGame 稳定状态 | inspect / run | observe | describe / validate | bind / bindControl | close |
| --- | --- | --- | --- | --- | --- |
| request | 当前请求；run 可接受一个输入 | 玩家观察 | 检查当前请求 | 替换绑定 | 关闭 |
| event | 当前事件边界；run 尝试交付 | view_unavailable | view_unavailable | 替换绑定 | 关闭 |
| ended | ended；run 的 accepted=null、pause=null | 最终观察 | game_ended | 替换绑定，无后续回调 | 关闭 |
| 程序 fault | 原 fault；run 的 accepted=null、pause=null | Outcome.error 为原 fault | Outcome.error 为原 fault | 替换绑定，无后续回调 | 关闭 |
| 契约故障后 / 已关闭 | game_closed | game_closed | game_closed | game_closed | game_closed |

活动 run 排斥 bind、bindControl、close 和第二个 run。等待外部回调的稳定点可以读取；内部计算时读取返回 game_busy。契约故障首次被发现的操作返回该 fault，随后进入关闭状态；如果在 run 内发现，fault 放入 state 并保留本次 accepted。

validate 的格式合法但实例/调用/key/player/type 不匹配时，返回 ok({valid:false,reason:'request_mismatch'})；已声明动作的 payload 不满足 action schema 时为 ok({valid:false,reason:'invalid_action'})；领域规则不合法时返回 respond 的 reason。describe 找不到对应请求时返回 Outcome.error rejected/request_mismatch。未知动作类别属于参数格式错误。校验成功的 respond.output 还必须满足端口 output schema，否则属于作者契约故障，不能提交为 accepted。

请求带自己的 player。相同函数可注册给多个 player，状态与请求按对应玩家投影；player 是游戏 schema 定义的字符串键。绑定只注册，run 执行回调。

Game.run 成功返回：

```ts
{
  state,
  accepted: null
    | { kind: 'action', player, reply: {requestId, type, action} }
    | { kind: 'control', callId, input }, // 仅启用会话控制时可出现
  pause
}
```

accepted 表示这次实际提交到 Instance 的玩家动作或会话控制输入；事件端口的确认返回不计入该字段。即使后续事件暂停、取消或发生故障，该字段仍保留。类型不包含动作次数或运行次数限制。连续对局由上层循环 run；单步搜索直接调用一次 run。

运行前的操作拒绝通过 Outcome.error 返回。推进后的程序故障放入 state.fault，保留 accepted。纯投影或转换出错属于契约故障：撤销活动驱动、关闭所持实例，在本次返回中保留 accepted 与 fault。后续调用返回 game_closed。

多个待决回调可以同时等待。第一个完成检查的可交付输入送入当前端口；其余等待撤销。这里仅规定一次端口接受。游戏程序决定该输入是否已完成某项共同决策、是否封存、何时公开及后续顺序。一个请求拒绝或暂停不取消其他仍在等待的请求；全部结束且无合法输入时，暂停原因按 invalid_reply、handler_failed、requested 顺序选择。无处理函数为 unbound。请求开始的次序按游戏发布列表，业务先后由游戏控制。

## 游戏作者与内侧 SDK

GameModule={program,contract}。program 在 Instance 内执行，contract 的纯适配函数在外侧使用。两侧遵守相同端口契约。

GameTypes 提供 setup、ports、programResult、view、actions、player、observation、event、playerEvent、result 和 control 类型；无会话控制时 control=never。

GameContract 提供：

- schemas：view/player/observation/event/playerEvent/result 与 actions 的 request/action/description。
- ports：每个端口为 request 或 event。
- request.receive(portInput)：得到 {view,requests:[{key,player,type,data}]}。
- request.respond(view,request,action)：合法则得到端口 output，否则返回原因。
- event.receive(portInput)：得到 {events,output}。
- finish(programResult)：得到 {view,result}。
- observe(view,player)：得到 observation。
- projectEvent(event,player)：得到 {event:playerEvent} 或 null。
- inputs[type]：options schema 和 describe(view,request)。

这些函数纯、确定、值隔离；所有 schema 保持值，禁止隐式变换。view 是程序发布的完整边界数据；纯函数只能读取发布数据。每个端口的返回仍由程序内规则验证。局部循环、触发、部分输入、随机流和事件发布位置都由程序维护。

### 内侧 lib 与外侧功能配套

`@bear-forge/game-sdk` 提供 `createGameSDK(io, declarations)`，在 Program.run 内创建 GameSDK。每个声明端口得到一个同名函数：`sdk[K]: (input: P[K].input) => Promise<P[K].output>`。构造无 I/O；每次方法调用恰好转发一次 `IO.call({port:K,input})`，保持原 Promise 和异常，不复制参数、不增加自动运行或事件。库只依赖公开类型，没有宿主状态或外侧回调。游戏自己的领域 SDK 可以组合这些函数。

`GamePortShape` 为 `{kind:'request'|'event',input,output}` 类型；`GamePortDeclarations<P>` 用有限必填字符串键表声明每个端口的单一 kind、input schema、output schema；同一端口的 kind 不能是两种类别的联合。GameModule.program.schemas.ports 使用这份声明，内侧 lib 使用它的键集合，GameContract.ports 的类别和入参返回受同一 P 约束。声明为普通自有可枚举数据属性；准入检查禁止访问器和隐藏字段。Core 只读取 input/output，不解释 kind。schema 文件仅包含声明，不生成协议或注入宿主函数。

| 外侧功能 | 内侧对应 | 共用约定 |
| --- | --- | --- |
| onRequest、请求状态 | await 请求类 SDK 方法 | request.receive 将端口输入转成 view 和 key/player/type/data；玩家由程序数据指定 |
| observe、请求中的 observation | 请求端口发布的 view；终局 return 的数据 | observe/finish 纯投影；不额外保留可变规则状态 |
| describe、exact/construct | view 和请求数据充分表达当前合法性 | inputs.describe；构造约定由上层解释，SDK 不枚举 |
| validate、动作返回 | await 的返回值进入游戏规则 | respond 校验并编码端口 output；程序内复用规则验证后应用 |
| onEvent | await 事件类 SDK 方法，可一次发送数组 | event.receive → projectEvent → onEvent；事件发生时的数据由程序发布 |
| bindControl（可选） | await 同一个请求端口，返回可区分的游戏控制输入 | session.request/respond；不往玩家 action 添加时间 |
| ended、终局 observe | Program 正常 return | finish 得到最终 view 和 result；终局事件先发送 |
| bind/run/close/取消 | 端口等待与继续执行 | 仅外侧驱动；取消等待不作为游戏动作或内侧异常注入 |
| save/restore/fork（可选） | 内侧局部、闭包、对象和 SDK 状态 | Instance 保存现场；内侧无同名控制方法、无第二份状态 |
| capture（可选） | 同一端口调用、返回与程序结束 | 提供者捕捉；SDK 不另建日志旁路 |

对应法则：对每个请求输入 x，receive(x) 得到的 view 必须足以计算当前观察、请求和合法动作；respond(view,request,action) 的成功 output 必须是原程序对此请求认可的输入。会话返回遵守相同规则。动作/会话来源需要游戏区分时，游戏 output 必须携带自己的判别字段和请求键；SDK 不丢弃、补造或重编码它们。exact 与规则合法集合相等，construct 与 validate 保持同一动作类型及规则。事件投影使用发布时的值；finish 的 view/result 与实际结束状态一致。类型保证形状关联，语义由游戏规则与接线测试验证。

多个待决玩家请求可以放在同一次请求输入；一次只返回一个输入，程序内保存部分结果并再次请求。无需 Promise.all 并发调用端口。只有等待会话控制时允许玩家请求数组为空；输入收齐、公开顺序和循环仍是游戏代码。

无 session 声明却返回空请求列表、重复请求 key、未声明的请求类别或不满足声明 schema 的投影，均为作者契约 fault/invalid_output；不能伪装成 unbound。存在 session 声明而没有绑定会话回调时，空请求可暂停为 unbound。无端口程序直接 return，由 finish 产生正常终局。

在事件边界，外侧 observe 仍按既有协议返回 view_unavailable；内侧 lib 不虚构缓存观察。程序内部没有独立“更新外侧状态”调用：每次请求或终局发布当前数据即可。

语言语法、schema 对象及全部传递依赖的生产准入在 C02 验收；lib 的原生轨迹对照不代替续延实现。

```ts
// 当前斗地主的实际接线方式；gamePorts 是同一份端口声明。
const sdk = createGameSDK<DouDizhuPorts>(io, gamePorts);
await sdk.event(events);
const input = await sdk.decision(frame);
// 游戏验证、结算；终局由 Program return，外侧 finish 转换。
```


## 可选会话控制

使用 @bear-forge/contracts/session。启用时，GameContract 的 request 端口可声明 session：

```text
requestSchema / inputSchema
request(view) → 会话控制请求数据
respond(view,input) → 合法端口返回或拒绝原因
```

接线后提供 bindControl(handler或null)。回调接收 {instanceId,callId,data} 与取消信号，返回控制输入或 pause。它与玩家动作回调相互独立；无玩家请求时也可等待控制输入。控制数据由游戏定义，通用层不认识时钟、超时或席位。

会话负责真实时钟与输入到达顺序；训练会话可以使用虚拟时钟。需要时间进入规则时先提交控制输入。控制接受也使一次 Game.run 停在下一输入边界，accepted.kind='control'。游戏选择是否创建超时、执行默认动作或判负。玩家动作及 exact 动作列表保持纯动作。

同一调用中没有通用的“控制优先”或“玩家优先”；实际接受顺序就是显式输入序列的一部分。要求 timeoutFirst 或确定重放的会话必须在外层排好序：玩家包装回调先返回 pause 或保持未就绪，仅控制回调交付时钟/超时；run 返回后再重新读取请求并允许下一玩家动作。也可在两次 run 之间切换对应绑定。不得同时交付相互竞争的时钟与动作后再假定某一方必胜。会话对自己的控制数据做领域校验；通用 pause/invalid_reply 仅表示本轮未接受合法回复，不承担逐候选诊断。

## 事件交付

event.receive 产生原始数组。按源顺序，对已绑定玩家调用 projectEvent。null 跳过，{event:x} 经 playerEvent schema 检查后交给 onEvent({id,event},{signal,player})。投影使用事件发生时的数据。

id={instanceId,callId,index} 标识该玩家在本次调用中的可见事件。index 从 0 开始，只对该玩家 projectEvent 非 null 的子序列递增；绝不暴露原始数组下标，隐藏事件不能制造序号空洞。同一源事件对不同玩家可以有不同 index 和数据；接收方去重使用 (player,id)，不得用它跨玩家关联原始事件。同一源事件的玩家交付按字符串键排序。

回调 reply/null 表示已接收或入队。全部可见接收完成后，才向 Instance 返回事件端口的 output。没有回调直接跳过；动画、网络重试与客户端回执由前端/会话处理。

回调 pause、失败或取消保留 event 边界；再次运行重新交付当前数组，标识保持一致。绑定、读取、分支和恢复本身不发送事件。程序 return 前完成终局事件，ended 时没有尚待交付的端口事件。

每次重交付均从冻结批次和纯投影重算各玩家序号，序号不依赖其他玩家是否绑定，不保存不可重建的交付进度。此去重保证限于同一 InstanceId。部分接收后保存/恢复时，尚未被程序接受确认的整个批次可以在新身份下重新交付；跨恢复的业务恰好一次处理由外层持久接收账本或游戏定义的稳定事件键负责。已完成端口确认且位于保存点之前的事件不重新调用端口。分支是独立世界，新身份下的交付不能当父实例的重试丢弃。

## 可选保存、分支和捕捉

保存：InstancePersistence.save/restore/release，InstanceSnapshot={snapshotId}。保存完整稳定调用或正常终局现场；restore 创建新实例身份并清空宿主绑定。未来输入源由调用方重新绑定。释放快照保持已恢复实例有效，重复释放已释放引用幂等，未知引用拒绝。

save/restore 必须由提供者校验程序、规则与保存格式兼容性，不依赖 TS 泛型代替检查；已知但不兼容为 snapshot_incompatible，未知或已释放快照的 restore 为 snapshot_not_found。快照只恢复程序现场及其记录前缀，不恢复外侧策略记忆、网络连接或回调。

分支：fork 从稳定调用或正常终局产生同类型实例，隔离所有可变受控状态。BaseGame 的分支使用相同 contract 返回同类型游戏。父实例保持原状，子实例所有玩家和会话绑定为空。创建失败清理子资源。只有底层实际提供时才暴露 fork。

子实例具有新 InstanceId，并保留父实例在该提供者上已提供的可选能力；父子任一方关闭不影响另一方。恢复同样创建新身份，并按实际装载提供者提供能力。BaseGame.id 等于所持 Instance.id。

save/fork 在程序 fault 上返回原 fault，在已关闭或已移交句柄上分别返回 instance_closed/instance_owned，在内部计算时返回 instance_busy。稳定宿主回调等待点可保存/分支；其线性化点是复制该待决调用及记录前缀的瞬间，之后到达的回复只属于原实例。正常终局允许保存和分支。BaseGame 对应冲突码为 game_closed/game_busy，原程序 fault 保留；它不再持有已移交句柄。重复 close 返回 closed，不能恢复已关闭现场。

捕捉：InstanceCapture.read(instanceId,{after,limit}) 和 release(instanceId)。记录包含 started/called/returned/completed/faulted，sequence 连续。只有接受的返回写入 returned。read 原子读取已提交前缀，值隔离；after=null 从头，否则为已消费序号；next=null 表示当前前缀读完。

每个新 start 的逻辑记录流从 sequence=0 的 started 开始。fork/restore 的子流继承分叉/保存时完整且不可变的逻辑前缀（包括当前 called 或 completed），保留其中的 sequence 和 CallId；不补造 started/called，也不重放该前缀。新活动从前缀末尾的 sequence+1 追加。父流后来追加的记录不会进入子流，恢复取保存时前缀而非父流的最新前缀。继承的记录是历史引用，不是子世界再次发生的活动。

分叉/保存/恢复操作的调用方维护父子关系及前缀截止位置，跨流统计按该关系排除共同前缀；单个 read 结果不宣称是独立新样本。血缘属于实验调度，不进入 Core 游戏语义。记录能力必须保留快照所引用的前缀，父记录 release 不得使子流或尚有效快照失去历史。

read 返回至多 limit 条 after 之后的记录；after 超出该流现有末尾时返回 rejected/invalid_argument。若仍有已提交记录未返回，next 等于本页最后一条 sequence，否则 next=null。null 只表示本次读到当前末尾，不表示实例结束；轮询方保存最后实际读到的 sequence 再读。未知/已释放流为 records_not_found；活实例可 read，但不能 release。已知流重复 release 幂等，未知引用拒绝。

transfer 保持实例 id，capture 仍按同一 id 读取。close 释放现场但保留记录。capture.release 只释放已关闭实例的记录引用；活实例返回 busy。父、子及保存引用的共享数据按引用独立保留。普通运行可以不提供上述三项能力。

## 装载和接线

NativeCoreLoader 装载 ProgramModule；ControlledCoreLoader 装载 CompiledProgram。二者返回 Outcome<LoadedCore{core,persistence?,capture?}>。编译产物包含类型关联和受控内容；实际准入、兼容性及程序保存由提供者验证。

binder.bind({instance,contract,persistence?}) 接管既有实例。调用方负责提供匹配的程序与 contract；类型只验证端口与数据形状。fork/save 与会话能力按实际提供情况组合成 GameHandle。恢复路径为 persistence.restore → binder.bind。

## 验证范围

字段以 packages/contracts 的公共声明为准。`npm run check` 执行类型反例、schema 结构、模块依赖、SDK 原生轨迹、多人交互和完整斗地主测试。内侧 SDK 的逐调用等价关系及适配前提见本页“内侧 lib 与外侧功能配套”。这些检查验证当前协议与示例，不证明生产执行器已经正确实现保存、恢复和隔离；该部分仍在 C02/C03。
