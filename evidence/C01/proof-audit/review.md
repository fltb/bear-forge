> 历史反例：F1–F4 已按批准方案修复。当前证明与验收见 [严格修复报告](../strict-repair-review.md)。本目录保留修复前源码/日志；旧 run.py 的通过预期不适用于修复后的公共类型。

# 公共协议的证明义务与反例

2026-10-09，C01-03 审核。当前公共源码保持原样；本次新增反例证据，未实施接口修复。先前“七项修复”不能推出“协议已经完整”。

## 判定标准

令 P 为当前公共类型、Schema 和有效文档的合取，R 为目标性质。协议验收要逐项建立 P ⇒ R。找缺口有三种证据：

- 能力缺口：给出 P 允许的能力组合，目标操作的前提无法由公开操作产生。
- 类型缺口：给出 TypeCheck(call)=true 且关联约束为 false 的具体调用。
- 语义欠定义：找出组合所需的等式，但当前 P 既未规定它，也未规定避免依赖它的责任分配。

类型缺口不自动证明运行时非法接受：runtime 可以拒绝。实现尚未完成、游戏规则正确性、训练强度也不作为本轮协议缺口。

## F1 搜索状态的查询不封闭：能力缺口

目标：不修改真实对局，每个搜索子状态可以复用 Game 已声明的输入描述、校验与查询处理器。

现有签名：capture(GameRef)→Snapshot；transition(Snapshot,input)→Snapshot；inspect(Snapshot)→GameUpdate；inputs.describe / validate / queries.query 全部需要 GameRef；唯一把 Snapshot 变回 GameRef 的 restore 是独立可选能力。

构造允许的服务组合：simulation 存在、persistence 不存在。capture 真实局 g 得到 s0，transition(s0,a) 得到 s1。游戏请求只含“请出牌”，合法动作从私有领域 state 计算；GameUpdate 不保证携带完整合法输入或任意游戏查询结果。这种游戏符合当前作者协议。

在保持真实局 g 不变的操作集合中，对 s1 可用的操作只有 inspect、transition、release，其输出不含对应 s1 的 GameRef。对调用序列长度归纳，无法得到 inputs.describe 所需的对应引用。新 create 产生新初始局，不保证是 s1；推进真实局违反前提；伪造 UUID 不产生有效实例。于是已有游戏 describe 处理器不能用于 s1。

结论：P 不推出“simulation 独立构成可复用游戏查询的搜索服务”。这是对子节点输入描述、校验、观察/评价查询的同一个可达性缺口。不是说任何 DFS 都不可能：外部算法自带完整动作生成器、或同时得到 persistence 时可以工作，但这不是当前独立 simulation 的保证。

最小修复义务：每个可转移搜索状态都必须能使用其对应的只读游戏查询；或者能力组合必须保证一条公开的转换路径。不得强迫每个搜索算法重写游戏合法性。

## F2 联合键破坏参数关联：类型缺口

预期法则：调用实际使用键 k 时，参数应属于 T[k]，不能只属于某个键对应的参数联合。

设 T.left.request={left:number}，T.right.request={right:string}。当前 request<K>(type:K,request:NoInfer<T[K].request>) 允许 K='left'|'right'。代入后参数类型为两个 request 的联合，故 ('left',{right:'wrong'}) 被接受，实际键与参数不匹配。

counterexamples.ts 的 widenedRequest、dynamicRequest 均被 TypeScript 接受，没有 any、断言或诊断忽略。同样的代入作用于 GameQueryCapability.query 和 InteractionOptions.describe；widenedQuery、widenedOptions 也通过。

NoInfer 只阻止参数反向参与 K 的推导，不禁止 K 本身为联合。反例由显式泛型以及普通联合键变量两条路径构成。

结论：当前独立参数的泛型调用签名不保证键/载荷关联。InteractionRequest/Reply 的判别对象联合本身仍保持关联；不能把该性质转移到另一种调用签名上。

最小修复义务：调用的整个参数积应限制到合法配对集合的并集 Σk ({k}×T[k])，不能放宽成键集合与载荷集合的乘积。修复后这些反例应静态拒绝，合法字面量调用仍保留精确返回类型。

## F3 非空契约被消成 never：类型缺口

预期法则：对准入的有限契约表，每个已声明且载荷非空的契约，都存在对应的请求表示。

Numeric.interactions={0:T.left} 满足 GameTypes 的 InteractionTable 约束，acceptedNumeric 可以直接返回 GameTypes。TypeScript 中该表的 keyof 为数值字面量 0。InteractionRequest 的索引集合是 keyof T & string，因此 0 & string = never。非空表的请求类型为 never；erasedNumeric 的实现被 TypeScript 接受。

这不是空 input schema 引起的不可达：left.request 是非空的对象类型。运行时 JS 对象键又会成为字符串 '0'，进一步显示当前声明层没有统一键表示。

结论：表的准入键域与请求/回复映射的键域不同。公共层既未静态拒绝数字键，也未统一规范化为字符串。

最小修复义务：统一表准入、schema、作者调用与公开信封的键域。选择拒绝数字/符号键或定义字符串规范化即可，不需要增加游戏语义。

## F4 多层校验缺少归一化法则：语义欠定义

目标：领域 validator 检查的输入值，应与继续执行收到的输入值一致。

当前 GameSchemas 使用 z.ZodType<T>，不排除纯 transform。normalization.ts 定义 N(x)=x+1 的整数 schema，实际通过 GameSchemas 与 GameInputDefinitions 类型检查。

令原始输入 x=0，validator 只接受 1。N(0)=1，领域校验成功；再次解析同一“已校验输入”得到 N(1)=2，领域校验失败。因此 N(N(x))≠N(x)。实际执行记录在 normalization.log。

当前 Game.advance 规定先校验 input 再 resume；Core 又有独立 ProgramSchemas.reply 校验。已有协议没有完整规定归一化由谁负责、第二层使用原始还是已归一化值、Core reply 模板是否必须是身份校验。把同一模板重复使用不是安全的默认组合。

结论是“缺少组合语义”，不是声称尚未实现的 runtime 已经执行了两遍。可以通过禁止改变值的边界 schema，或定义唯一归一化拥有者和后续纯验证来满足目标。只写“schema 通过”不足以证明校验值等于执行值。

## 未列作缺口的事项

| 证明义务 | 当前结论 |
| --- | --- |
| Core 不依赖游戏领域 | 源码依赖方向符合分层；O 是抽象实例配置，不引入领域规则 |
| 只运行不保存 | Execution 可独立构造；没有必需 persistence 字段 |
| 关联回复对象 | 映射判别联合保持 type/data 关联；不等同于 F2 的函数调用签名 |
| 故障不是终局 | fault/done/ended 区分，CoreFault 只允许 fault 错误；运行时遵循它仍需实现验收 |
| 非法/过期回复不推进 | 有效文档明确原子校验与请求消费义务；尚未实现不能单独算接口缺口 |
| 保存/恢复与释放 | 同时提供 persistence 时存在获取→恢复→实例操作→关闭→释放路径；不覆盖 F1 的独立 simulation 组合 |
| 恢复后的局部变量、随机流、别名 | 文档明确完整现场义务；具体编码和正确性属于 C02 |
| exact 是否确实完整、游戏胜负规则是否正确 | 已规定语义，具体游戏须验证；类型匹配不能证明这类领域性质 |
| construct 的解释与候选构造 | 明确属于游戏上层调用方，不要求 Core 实现统一构造算法 |
| 同时多玩家、超时、动画 | 请求 payload 可表达游戏自定义席位和时间；不要求 Core 新增领域控制流。作者准入的并发子集仍由后续规范落实 |

以上是对本次列出的证明义务的覆盖，不宣称枚举了所有可能缺陷。F1–F3 已有具体反例，F4 已证实所需幂等性不能从当前 schema 类型推出，必须补充组合责任。

## 重放

从仓库根目录：python3 evidence/C01/proof-audit/run.py。

预期：当前类型检查 exit=0，表示坏调用被接受，绝不是协议通过；归一化反例断言通过并打印 0→1→2。后续修复 F2/F3 后，应将对应例子转成必须拒绝的回归检查，并补充合法输入正例。
