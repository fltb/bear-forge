# TS + toolkit 执行规格 v0.1

历史演算机模型：九节点、指令级暂停和显式帧结构不是当前后端硬要求。当前需求见 [执行与实验契约](runtime-contract.md)：首版以支持的决策等待边界保存、恢复和分叉。

状态：本文件是内部执行模型与接口契约；不是已实现的运行时。作者接口已更新为 [受控 TS 编译](authoring.md)，下文构造器是内部 IR 工具，不要求规则作者手写。配套的构造性证明见 [证明](proofs.md)。它替代此前 Scheme、任意运行期 JS 回调及深/浅代数效果处理器方案。

## 1. 范围与明确假设

采用 TS 编写计算函数，用 TS 构造流程数据。只解释跨步骤的控制与状态操作，不解析新文本语言、不编译任意 TS、不实现 Scheme。

执行器在步骤之间拥有完整 context。单个宿主计算调用内部没有可恢复的暂停点。计算调用必须同步、确定、终止，不修改输入、不使用隐藏可变状态。纯净性和终止性不能由 TS 函数签名推出，属于原子准入与实现验证责任。

数学模型允许任意大的有限程序执行现场及精确自然数；实际资源限制由运行器报告，不能当作游戏输赢。所有证明以合格原子和正确持久化存储为前提，不宣称任意 JS 都自动满足。

## 2. 程序与值

冻结的程序包 P 包含：流程定义表 D、纯计算注册表 F、外部 capability 签名表 Q、类型/schema 定义、只读常量、源码映射以及全部版本。程序包有限。执行期间不动态替换代码、注册处理器或加载模块。更换任一计算实现或常量必须改变程序版本。

基础值及类型：

```text
T ::= Unit | Bool | Nat | Symbol | Pair(T,T) | List(T)
    | Ref(T) | Proc([captureTypes], [argumentTypes], resultType)

v ::= unit | true | false | n | symbol
    | Pair(v,v) | Nil | Cons(v,v)
    | Ref(address)
    | Closure(defId, [capturedValues])
```

Nat 为非负精确整数，不能默默使用 JS Number 的截断精度。Symbol 是有限字符串，以确定的序列相等规则比较。游戏记录、标签联合、枚举可通过符号、pair、list 编码；作者工具可提供有 schema 的记录包装。其他数值类型作为有独立规格的库扩展，不影响以下表达能力证明。

值为有限不可变数据；引用指向 context 的存储，闭包是代码 ID 加显式值，不是 JS 函数。通过 Ref 可以形成逻辑循环；禁止直接 JS 对象环、getter、Proxy、Promise、generator、函数和未编码对象进入值域。序列化需保留引用身份，Nat 使用精确编码，不能直接假定 JSON.stringify 可用。

操作数不是任意 TS 表达式：

```text
a ::= Literal(v) | Variable(x) | Close(defId, [a1,...,an])
```

Literal 只含可验证的静态数据，不能伪造 Ref。Close 从当前环境显式读取捕获值，得到 Closure；不执行函数体。操作数求值左到右、有限、只读；失败产生 Fault。它的结果记为 eval(a, rho)。

流程定义为 D[id] = (captureParameters, argumentParameters, body, signature)。body 中全部自由变量必须在两组参数里。递归通过同一 defId 的 Close/Call 表达，不靠构造期 TS 无限递归。相互递归允许，定义表必须先分配 ID 再填入有限的函数体。

## 3. 九种流程节点：封闭清单

```text
c ::= Return(a)
    | Bind(c1, x, c2)
    | If(a, cTrue, cFalse)
    | Call(aFunction, [a1,...,an])
    | Compute(primitiveId, [a1,...,an])
    | Alloc(type, a)
    | Read(aReference)
    | Write(aReference, aValue)
    | Await(capabilityId, aRequest)
```

| 节点 | 返回值 | 唯一职责 |
| --- | --- | --- |
| Return | 操作数值 | 完成本段流程 |
| Bind | c2 的结果 | 执行 c1，把结果绑定为 x，再执行 c2 |
| If | 被选分支的结果 | 只执行一个分支，条件必须为 Bool |
| Call | 被调流程的结果 | 进入显式闭包；支持递归和高阶流程 |
| Compute | 注册函数的结果 | 运行一个合格同步 TS 计算 |
| Alloc | Ref<T> | 在本 context 分配存储单元 |
| Read | T | 读取单元 |
| Write | Unit | 产生更新后的存储 |
| Await | 合格响应值 | 返回显式外部请求，等待恢复 |

没有隐式 truthiness、自动 await、隐式随机或后台任务。map、sequence、while、fold、领域调度均由这些节点组合。定义与 Close 是代码/值构造设施，不是额外的控制效果。

第一版没有 call/cc、捕获任意续延、动态深/浅 handler 或任意宿主 perform。领域操作默认是普通流程调用；需要动态处理器时，游戏显式传递 Closure，或在存储中维护处理器表。游戏中的嵌套响应用 Call/Bind/Await 实现。这里承诺可表达规则行为，不承诺兼容 Scheme 或任意代数效果语言。

## 4. 保底计算原子与扩展契约

以下固定原子足以支撑后面的完备性证明；不依赖用户提供一个“万能模拟器”回调。

| 原子 | 输入 → 输出 | 定义 |
| --- | --- | --- |
| nat.succ | Nat → Nat | n+1，精确 |
| nat.pred | Nat → Nat | max(n-1,0) |
| nat.eq | Nat×Nat → Bool | 精确相等 |
| symbol.eq | Symbol×Symbol → Bool | 符号相等 |
| pair.make | A×B → Pair(A,B) | 构造不可变 pair |
| pair.first / pair.second | Pair(A,B) → A / B | 投影 |
| list.cons | A×List(A) → List(A) | 构造不可变列表 |
| list.isNil | List(A) → Bool | 判空 |
| list.head / list.tail | List(A) → A / List(A) | 非空时投影；空表返回 DomainError |

unit、布尔、0、有限符号和 Nil 是 Literal。表中类型参数由构造器实例化，程序校验器核对对应 schema。每个原子必须有整数成本函数，成本覆盖所选表示的实际工作上界；不能把任意精度加法当恒定成本。错误也是确定结果。

允许注册更方便的 TS 纯计算，例如排序、牌型、公式，不因此扩充九种节点。每个注册项固定：ID、版本、参数/结果 schema、函数、成本/输入边界及错误行为。函数只能读取显式参数与版本化不可变定义，不能读取 world、时钟、环境变量、网络、可变缓存或捕获的对局状态。读取 world 必须先通过 Read，再把必要值传给 Compute。

“原子只能拿 context”的实现含义是：运行器拥有 context；计算适配器最多取得只读操作数视图，没有 world、控制帧或全局 I/O 权限。状态写权限仅由 Alloc/Read/Write 的固定处理器持有。普通计算函数采用 args → result 更容易审计，不必给它整个 context。

函数执行成功并校验结果后，才发布下一 context；若抛出异常或返回非法值，转换为 PrimitiveFault，无该步的业务状态修改。不得回调流程执行器、返回挂起函数或修改原始输入。Readonly 类型不构成安全沙箱；需通过实现隔离/静态准入/审查与测试落实约束。非合格代码不享有确定性、终止性与隔离证明。

## 5. context 的完整结构

```text
C = (programVersion, mode, H, nextAddress, authority, nextRequest)

mode ::= Eval(c, rho, K)
       | Value(v, K)
       | Waiting(request, K)
       | Done(v)
       | Fault(code, source)

K ::= Halt | Frame(x, c, rho, K)

H : address -> (schema, immutableValue)
rho : variableId -> immutableValue
request = (localId, capabilityId, immutablePayload, responseSchema)
```

authority 是初始化时授予的 capability 集合；首版不允许流程修改它。Ref 只在所属 context 家族内有效；Read/Write 通过合法的、不透明 Ref 访问，不接受普通整数地址。引用 schema 固定；首版不提供释放后地址复用。堆地址从 nextAddress 单调分配，各分支可使用相同数值地址但拥有不同存储。

运行器的会话/分支路由 ID 不可被规则读取。外部响应信封用 (sessionId, branchId, localId) 定位到某个活跃 context，避免分叉后把兄弟分支的响应串入。路由信息不参与游戏随机或规则计算。

PRNG 的算法固定于程序版本，seed/state 放在 H；库通过 Read → Compute → Write 更新。不另设隐藏全局随机服务。领域任务队列、玩家历史、持续效果、未结算事件均为 H 或显式捕获值中的数据。

## 6. 全部正常单步规则

下文未提及的 context 分量保持不变。所有操作数必须先成功求值并通过对应 schema 检查；失败转 Fault，当前步骤不发布任何部分写入。

```text
Eval(Return(a), rho, K)
  → Value(eval(a,rho), K)

Eval(Bind(c1,x,c2), rho, K)
  → Eval(c1, rho, Frame(x,c2,rho,K))

Value(v, Frame(x,c2,rho,K))
  → Eval(c2, rho[x := v], K)

Value(v, Halt)
  → Done(v)

Eval(If(a,ct,cf), rho, K)
  → Eval(ct,rho,K)  当 eval(a,rho)=true
  → Eval(cf,rho,K)  当 eval(a,rho)=false

Eval(Call(af,args), rho, K)
  → Eval(D[id].body, bind(captureNames,captures) ∪ bind(argNames,values), K)
     其中 eval(af,rho)=Closure(id,captures)，values=eval(args,rho)

Eval(Compute(id,args), rho, K)
  → Value(F[id](eval(args,rho)), K)  当返回 Ok(value)
  → Fault(PrimitiveFault, source)   当返回错误或违反结果契约

Eval(Alloc(T,a), rho, K), H, nextAddress=n
  → Value(Ref(n), K), H[n := (T,eval(a,rho))], nextAddress=n+1

Eval(Read(ar), rho, K), H
  → Value(H[r].value, K)  其中 eval(ar,rho)=Ref(r)

Eval(Write(ar,av), rho, K), H
  → Value(unit,K), H[r := (H[r].schema,eval(av,rho))]
     其中 eval(ar,rho)=Ref(r)

Eval(Await(q,a), rho, K), nextRequest=j
  → Waiting((j,q,eval(a,rho),Q[q].responseSchema), K), nextRequest=j+1
     要求 q∈authority，payload 满足 Q[q].requestSchema
```

Call 不额外压帧。返回位置已由外围 Bind 表示，所以尾调用沿用 K；非尾调用则自然保留 Bind 帧。调用和返回都由运行器循环驱动，不借用 JS 递归栈跨步骤保存位置。

Waiting、Done、Fault 没有自主内部转移；step 返回对应 Boundary，不循环空转。未绑定变量、未知代码或原子、参数不匹配、非 Bool 分支、坏引用、无权限请求、版本不匹配等一律为显式 Fault，不允许隐式宿主行为。检测顺序固定为版本/节点有效性、操作数从左到右、签名与权限、执行与结果校验。正常程序也可能遇到 DomainError，不能把它伪装成游戏负收益。

之前已完成的 Write 不因后来的 Fault 自动回滚。保证的是单步原子发布，不是整张卡或整个回合的事务。若游戏要求多步回滚，由运行器持有旧快照或游戏事务协议明确实现。

## 7. 恢复、预算、分叉和取消

resume(C,j,value) 仅接受 Waiting 且 localId 匹配、响应 schema 合格的 C，返回将 mode 替换为 Value(value,K) 的新 context。其余输入返回 Rejected 和原 C，不改变世界。客户端不能传 Ref 或 Closure 的原始内部编码：首版外部 schema 只接受数据值；游戏实体用校验过的领域 ID 表示。

同一个不可变 Waiting 快照可以有意恢复成两个不同未来，这正是反事实分叉。网络意义的“只处理一次”由运行器对活跃分支版本执行比较并交换保证；不能靠 pure resume 修改旧快照来实现。

内核只验证请求身份、结构和权限，不知道动作是否合法。游戏必须在业务写入前验证动作；若需恢复同一个决策供重试，可在候选快照中验证再提交。拒绝规则与玩家可见反馈属于游戏协议。

run(C,budget) 反复调用 step：先计算下步所需资源，足够才执行，否则返回 Yielded(C)，不执行半步。Waiting/Done/Fault 立即返回。每步费用至少 1；Compute 成本按注册契约计算，操作数读取/捕获构造等成本也不能遗漏。补足预算后从 C 继续，不重跑前缀。资源账本属于运行器，不可被规则读取，预算分段不改变业务结果。

单个 Compute 内部不支持恢复。实际超时或 OOM 导致工作进程终止时，只能报告基础设施失败并使用已有的已提交快照，不承诺保存中途 JS 栈。证明假定合格原子终止且资源足够；预算与宿主故障不能混淆。

fork(C) 得到两个逻辑上相同的不可变 context 根。后续更新分别产生新根，不修改父根或兄弟根；分叉无游戏内副作用。运行器为分支分配不同路由 ID。引用不跨分支自动导入；合并分支没有默认语义。

cancel 属于运行器生命周期：停止调度该分支并作废其活跃响应路由。首版不执行隐式 finally 或补偿动作。若取消有游戏意义，必须作为显式响应/规则输入处理。再次使用旧快照是显式创建新分支，不是重新激活旧网络请求。

## 8. 内部 TS 构造器的精确边界

接口示意，尚未实现：

```typescript
interface Expr<A> {}       // 符号操作数，非实际 A
interface Program<A> {}    // 流程图引用，非 Promise<A>

pure<A>(value: Expr<A>): Program<A>;
bind<A,B>(p: Program<A>, build: (x: Expr<A>) => Program<B>): Program<B>;
branch<A>(condition: Expr<boolean>, yes: Program<A>, no: Program<A>): Program<A>;
call<A,B>(procedure: Expr<Procedure<A,B>>, args: Expr<A>): Program<B>;
compute<A,B>(primitive: PureId<A,B>, args: Expr<A>): Program<B>;
alloc<A>(value: Expr<A>): Program<Ref<A>>;
read<A>(ref: Expr<Ref<A>>): Program<A>;
write<A>(ref: Expr<Ref<A>>, value: Expr<A>): Program<void>;
request<A,B>(cap: Capability<A,B>, args: Expr<A>): Program<B>;
```

bind 构造器分配唯一变量 x，执行一次 build(Variable(x)) 并保存产物 Bind；回调随构造结束消失。lambda/define 构造器分配流程 ID，将捕获变量显式列入定义参数，产生 Close；所有构造回调只运行于构造期。类型和作用域检查拒绝游离符号与错误签名。不能把 Expr<boolean> 放进普通 TS if，也不能在普通 TS 中对未来值求和；动态计算用 compute，动态控制用 branch/call。

map(p,f) 只能接收构造函数 Expr<A>→Expr<B> 或已注册 PureId，不能默默保存运行期 JS 回调。普通 TS 计算写在 compute 的注册函数中，不能混淆这两种函数。

源码类型是辅助，不是证明边界：最终图仍要校验定义引用、变量作用域、输入输出 schema、每个分支返回类型和闭包捕获类型。被强转 any 或手工构造的非法产物不能绕过校验。

## 9. 派生组合与明确不承诺的能力

sequence(p,q)=Bind(p,unused,q)；map(p,f)=Bind(p,x,Compute(f,[x]))；while 通过尾递归流程定义 If(test,Bind(body,...Call(self)),Return(unit))。fold 同理。带局部状态的过程通过显式参数、Bind 绑定和 Ref 表达。

短路、失败、事务、领域事件、触发排序和调度不是 Compute 的隐式行为。可恢复的业务失败用带标签的结果值表达；Fault 终止当前执行。领域事件进入游戏保存的日志/队列；机器调试追踪不回馈规则。

不承诺任意 TS 函数自动可暂停、不承诺任意 JS 的纯净性、标准语言兼容、全局规则正确性、实时硬期限、自动保密或模型最优策略。这里完整规定的是九种节点及其执行合同；实际引擎、构造器和原子实现仍需验收。

## 10. 类型与程序校验规则

使用判断 Γ ⊢ a:T 和 Γ ⊢ c:Program<T>；Γ 是词法变量类型表。堆类型表 Σ 为每个有效地址提供固定 T。参数列表要求长度、顺序和类型全部一致，不采用隐式转换。

- Literal 按值形状获得类型；Nil 必须携带元素类型；Variable 从 Γ 查找。Close(id,captures) 要求捕获值逐一符合 D[id] 的捕获参数类型，结果为该定义的 Proc 类型。
- Return(a):Program<T> 当 a:T。
- Bind(p,x,q):Program<B> 当 p:Program<A> 且 Γ,x:A ⊢ q:Program<B>；x 使用新符号身份。
- If(b,p,q):Program<A> 当 b:Bool 且 p、q 均为 Program<A>。
- Call(f,args):Program<B> 当 f 的 Proc 声明参数为 args 的类型、结果为 B。闭包捕获在 Close 时检查，调用不借用调用者的额外自由变量。
- Compute(id,args):Program<B> 当 F[id] 声明 args 的类型到 B；已声明的错误通道仍可能产生 Fault。
- Alloc(T,a):Program<Ref(T)> 当 a:T。
- Read(r):Program<T> 当 r:Ref(T)。
- Write(r,a):Program<Unit> 当 r:Ref(T) 且 a:T。
- Await(q,a):Program<B> 当 Q[q] 声明 A→B 且 a:A；authority 是运行时另行检查的权限，不由类型自动授予。

每个流程体在其捕获参数和实参组成的 Γ 下检查，结果必须等于声明返回类型。递归先检查完整签名表，再检查所有体，禁止未定义 ID。类型有限、显式；不要求推断所有 TS 类型，也不允许依赖 any 逃过产物检查。

环境 rho 满足 Γ，指每个变量值符合其声明类型；H 满足 Σ，指每个单元值符合固定 schema 且所有内部 Ref 都在 Σ 中。Closure 的捕获值必须符合定义签名。H 可以通过 Ref 有环，因此校验器需要记录已访问的地址/schema 组合。

帧类型 K:A⇒R 表示它能接收 A 并最终返回 R：Halt:A⇒A；若 Γ,x:A ⊢ c:Program<B>、rho 满足 Γ、K:B⇒R，则 Frame(x,c,rho,K):A⇒R。Eval 的表达式结果类型、Value 的值类型或 Waiting 的响应类型必须与 K 的输入类型相同。

非法快照/程序在装载时拒绝。运行期仍校验纯原子输出和外部响应，防止实际宿主实现违约；类型正确不意味着 list.head 不会遇到空表，也不意味着游戏动作合法。

## 11. 外部世界不随 fork 自动复制

Await 只产生数据请求，执行器不自行调用外部服务。运行器的 capability 适配器必须明确分支派发策略；默认模拟分支只允许决策、提供输入等已授权交互。真实外部写入不能因为 fork 自动重复派发。

请求响应路由的去重不等于外部系统恰好执行一次。若接入具有真实写副作用的服务，需要其幂等/提交协议；它不包含在 context 分叉定理里。定理保证的是引擎内部状态与给定输入下的行为，不声称复制外部世界。
