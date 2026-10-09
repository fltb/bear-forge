# F1–F4 严格修复与证明

2026-10-09。已按用户批准方案完成公共协议、消费代码、独立准入工具和证明回归。版本仍为 0.3.0；未实现生产 Core/loader，也未把斗地主行为参考宣称为受控 GameModule 迁移。

## 修复及机械证据

| 义务 | 修复 | 实际证据 |
| --- | --- | --- |
| F1 搜索查询闭环 | 固定 GameReadTarget schema；query、describe、validate 以及独立观察/输入能力支持实例/快照；具体处理器复用 | search-closure.test.ts：无 persistence 的服务遍历三层 15 节点；节点描述、校验、查询、转移、释放；父状态/随机位置/真实局不变；拒绝外来、释放、过期边界、非法输入 |
| F2 参数关联 | RequestArgs 二元组联合；QueryCall/DescribeCall 判别对象联合；回复整体传入 validate；返回类型由实际参数键索引 | strict-types.ts：显式扩大泛型、独立联合键、错误字面量配对均拒绝；关联联合变量和精确结果类型通过 |
| F3 键域一致 | FiniteTableGuard 检查有限、必需的字符串键；作用于 schema、模块、产物及 LoadedGame；运行时表检查自有可枚举数据属性和键集合相等 | 数字/符号/宽泛索引/可选条目负例，空表正例；继承、getter、符号、隐藏属性、处理器键偏差运行反例 |
| F4 验证保持值 | pinned Zod 结构白名单+内部排除；可信源绑定的纯回调；复制前数据检查；成功时值相等；返回保留别名的隔离副本 | schema-admission.test.ts：改写构造及嵌套改写、未知构造、回调、副作用 getter、字段丢失、共享缓冲拒绝；重复验证、别名和调用者隔离；50 个现有公共/斗地主 schema 结构审核 |

命令 npm run check 实际通过：71 项运行测试，0 失败/跳过；类型正反例、源码依赖边界、50 个 schema 结构准入检查通过。完整日志 strict-repair.log。原来的 proof-audit 目录是修复前反例快照，不再作为当前成功验收命令；当前拒绝回归位于 tests/contracts/strict-types.ts 和 schema-admission.test.ts。

## F1：闭包性质的构造证明

定义 Valid(s) 为本 LoadedGame 产生且未释放的快照，T(s)={kind:'snapshot',snapshot:s}。

基础：capture 返回 s0 且 Valid(s0)。固定 inputs/queries 的目标类型包含 T(s0)，规范要求提供者调用该边界的同一游戏处理器，而不是要求 restore。

归纳：假定 Valid(sn)，游戏提供输入描述/查询所需的游戏专用参数后，可通过 T(sn) 读取。对合法 a，transition(sn,a) 返回 sn+1，且规范要求 Valid(sn+1)。所以相同入口适用于下一层。对任意有限搜索深度闭合，不新增玩家/树策略语义到 Core 或 StateTransition。

前提：引用所有权和生命周期由提供者验证；查询/转移遵守父状态隔离。这里证明协议有完整路径；有限状态 witness 验证一份真实实现满足这些条件，不代替 C02 对完整程序现场的证明。

## F2：参数集合证明

设 Rk 为键 k 对应的请求类型。RequestArgs(T)=并集 k∈Keys(T) [k,Rk]。入口的泛型 A 必须满足 A⊆RequestArgs(T)。因此扩大 A 到整个合法联合仍不能得到 [left,Rright] 这种交叉项；独立的键联合与载荷联合形成的乘积也不能整体赋给合法联合。

QueryCall 与 DescribeCall 对同一结论使用对象判别项。返回值通过 A 的键索引：单一键得到精确结果，关联联合得到对应结果联合。TS 的 any、断言和任意伪造仍不构成运行时准入，延续已有受控规范。

## F3：映射不丢键证明

准入模块的表 T 满足：keyof T 是有限字符串字面量集合，没有可选条目。于是 FiniteStringKeys(T)=keyof T；请求、回复和调用参数映射枚举的键集合与模板表一致。原数值键 0 的模块在 GameSchemas/产物入口就不可构造，不再允许进入后静默映射为 never。空集合合法，对应无交互/无查询模块。

运行时 JS 已将数值属性写法转换为字符串，不能恢复其源码类别；静态构建负责拒绝数值声明。运行时负责实际自有键、数据属性及处理器一致性。两项义务不互相冒充。

## F4：成功验证的保持性证明

实现先验证宿主数据属于支持的普通数据子集，再保存隔离副本 b，并在另一副本 c 上解析。仅当 c 与 b 值相等、解析结果 r 与 b 值相等时才成功，返回 b。因此每次成功验证直接保证 value(out)=value(in)；返回的 b 由 structuredClone 保留允许的重复引用且隔离调用者，不采用可能拆开别名的 parser 输出。

对固定、纯且确定的 schema，重复验证输入值不变，谓词接受性不变，故重复成功结果值相等。结构审核拒绝改值操作、未知路径；值比较同时防止库边缘行为静默丢字段。拒绝是一种合法结果，不把“所有 JSON 都必须被任意具体 schema 接受”作为目标。

准入的前提：真实未篡改的 Zod 构造、固定版本和已验证来源；任意 schema/批准信息变更必须重新准入。三个当前纯自定义检查的来源由 tools/check_schema_admission.ts 的哈希固定；custom/lazy 内建例外仅限已登记实例。游戏不得自行填写批准集合。扫描不调用未知 lazy 或对象 shape getter；未经批准的诊断回调也拒绝。Proxy、原型篡改及构造器替换仍由上游受控源码准入排除，不能声称这个工具隔离任意恶意 JS。

生产与原生 loader 都必须兑现此 profile 和成功值相等法则；本轮没有实现 loader，因此未将 C02 标为完成。该证明也不涉及领域规则正确性、exact 集合穷尽性或模型效果。

## 状态

四个已确认缺口已完成本轮规定的修复和验收。C01 整体仍 in_progress；C01-03/05 的完整受控准入/迁移义务没有降低或借用这些夹具关闭。后续以 docs/plan.md 和 checkpoints.json 的未完成项接续。

## Subsequent audit
The whole-protocol continuation found a missing F3 premise: an admitted registry must be one fixed table, not a union of registries. F1 closure also requires waiting-boundary preconditions for input operations. Current correction and counterexample evidence: proof-continuation-review.md. The original F1-F4 report does not certify all protocol definitions.
