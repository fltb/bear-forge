# 当前公共协议

协议按 Core、Instance、BaseGame 三层组织。会话控制、保存恢复、分支、捕捉分别可选。默认包入口公开 Core、Program、ProgramModule、IO、Instance、BaseGame、Request、InputOptions、GameModule、GameSDK；细节从对应功能路径导入。

## Core：程序与通用端口

ProgramModule={schemas,run}。schemas 声明 setup、result 和每个端口的 input/output。run(setup,io) 是受控 TS 程序，普通函数、循环、递归和闭包完成内部计算。IO.call({port,input}) 等待声明类型的返回。

端口表是有限必填字符串键表。调用的 port 与 input、返回类型保持关联。开放索引、联合表、可选键、数字/符号键不作为固定端口声明。

Core.start(setup) 创建 Instance 并计算至首次调用或结束。影响后续规则执行的局部、闭包、对象图、伪随机流及 SDK 状态由 Instance 持有；真实外部输入通过端口返回进入。

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

accepted 表示这次实际提交到 Instance 的输入。即使后续事件暂停、取消或发生故障，该字段仍保留。类型不包含动作次数或运行次数限制。连续对局由上层循环 run；单步搜索直接调用一次 run。

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

GameSDK 把声明端口包装成类型化函数，程序内创建并通过 IO.call 调用。上层领域 SDK 组合这些函数。语言语法与传递依赖准入在 C02 验收。

## 可选会话控制

使用 @bear-forge/contracts/session。启用时，GameContract 的 request 端口可声明 session：

```text
requestSchema / inputSchema
request(view) → 会话控制请求数据
respond(view,input) → 合法端口返回或拒绝原因
```

接线后提供 bindControl(handler或null)。回调接收 {instanceId,callId,data} 与取消信号，返回控制输入或 pause。它与玩家动作回调相互独立；无玩家请求时也可等待控制输入。控制数据由游戏定义，通用层不认识时钟、超时或席位。

会话负责真实时钟与输入到达顺序；训练会话可以使用虚拟时钟。需要时间进入规则时先提交控制输入。控制接受也使一次 Game.run 停在下一输入边界，accepted.kind='control'。游戏选择是否创建超时、执行默认动作或判负。玩家动作及 exact 动作列表保持纯动作。

## 事件交付

event.receive 产生原始数组。按源顺序，对已绑定玩家调用 projectEvent。null 跳过，{event:x} 经 playerEvent schema 检查后交给 onEvent({id,event},{signal,player})。投影使用事件发生时的数据。

id={instanceId,callId,index} 标识源事件。同一事件对不同玩家可以有不同数据；接收方需要去重时使用 (player,id)。同一事件的玩家交付按字符串键排序。

回调 reply/null 表示已接收或入队。全部可见接收完成后，才向 Instance 返回事件端口的 output。没有回调直接跳过；动画、网络重试与客户端回执由前端/会话处理。

回调 pause、失败或取消保留 event 边界；再次运行重新交付当前数组，标识保持一致。绑定、读取、分支和恢复本身不发送事件。程序 return 前完成终局事件，ended 时没有尚待交付的端口事件。

## 可选保存、分支和捕捉

保存：InstancePersistence.save/restore/release，InstanceSnapshot={snapshotId}。保存完整稳定调用或正常终局现场；restore 创建新实例身份并清空宿主绑定。未来输入源由调用方重新绑定。释放快照保持已恢复实例有效，重复释放已释放引用幂等，未知引用拒绝。

分支：fork 从稳定调用或正常终局产生同类型实例，隔离所有可变受控状态。BaseGame 的分支使用相同 contract 返回同类型游戏。父实例保持原状，子实例所有玩家和会话绑定为空。创建失败清理子资源。只有底层实际提供时才暴露 fork。

捕捉：InstanceCapture.read(instanceId,{after,limit}) 和 release(instanceId)。记录包含 started/called/returned/completed/faulted，sequence 连续。只有接受的返回写入 returned。read 原子读取已提交前缀，值隔离；after=null 从头，否则为已消费序号；next=null 表示当前前缀读完。

transfer 保持实例 id，capture 仍按同一 id 读取。close 释放现场但保留记录。capture.release 只释放已关闭实例的记录引用；活实例返回 busy。父、子及保存引用的共享数据按引用独立保留。普通运行可以不提供上述三项能力。

## 装载和接线

NativeCoreLoader 装载 ProgramModule；ControlledCoreLoader 装载 CompiledProgram。二者返回 Outcome<LoadedCore{core,persistence?,capture?}>。编译产物包含类型关联和受控内容；实际准入、兼容性及程序保存由提供者验证。

binder.bind({instance,contract,persistence?}) 接管既有实例。调用方负责提供匹配的程序与 contract；类型只验证端口与数据形状。fork/save 与会话能力按实际提供情况组合成 GameHandle。恢复路径为 persistence.restore → binder.bind。

## 审核与证明

[字段报告](../evidence/C01/boundary-migration-review.md) 包含全部公开声明原文、三层职责与业务映射。[协议证明](../evidence/C01/protocol-freeze-proof.md) 列出操作构造、动作/会话分离、接受反馈及恢复前提。源码检查覆盖各功能子路径，默认入口独立核对。
