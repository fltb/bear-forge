# TS 规则编写与受控编译实现方案

历史方案：本文件自研编译与 async 约束不再是默认实现要求。以 [当前契约](runtime-contract.md) 为准，作者 API 随现成后端适配，允许后端保存客体续延，禁止遗漏宿主隐藏状态。

状态：实施设计，尚无编译器代码。本方案以正常 TS 源码为作者入口，将 [执行规格](execution.md) 的流程表示降为内部语义与参考模型。它更新此前“不编译规则源码”的限制：只转换显式标记的规则函数，不编译任意 TS/JS 运行时。

## 1. 对作者的契约

使用正常 .ts 模块、类型声明、泛型辅助、IDE、格式化器和调试源码。流程写成 defineRule(async (...) => ...)，以 await 标记可暂停操作；同步计算保留普通 TS。作者不接触 Expr、Bind、Close、程序计数器或环境打包。

“完整 TS 编写体验”指沿用语法和工具链，不是接受所有 TS 能编译的运行时行为。规则区域是一个明确的受控 profile，必须公开支持矩阵。编译器不能支持的语义直接报错，不能回退为原生 Promise/generator。

```typescript
// 接口示意，不是已实现 SDK。health 属于游戏包，不属于通用内核。
const health = defineField<EntityId, number>("health", numberSchema);

export const damage = defineRule(async (g: RuleContext, target: EntityId, amount: number) => {
  const before = g.read(health, target);
  g.write(health, target, Math.max(0, before - amount));
});

export const strike = defineRule(async (g: RuleContext, source: EntityId) => {
  const targets = findTargets(g.read(board));
  const target = await g.choose({ actor: source, options: targets });
  await damage(g, target, 3);
  await draw(g, source, 1);
});
```

defineRule 产生有类型的 Rule 句柄。源码中的调用结果可通过框架声明的 awaitable 类型被 TS 正常检查；实际调用由编译器识别并降低为 Call，不创建保存规则现场的原生 Promise。未编译执行入口必须显式报错。仅凭结构兼容 PromiseLike 不足以获得规则调用权限，编译器必须核对符号/来源和构建清单。

defineField 仅声明状态 schema 和稳定键，不在模块级创建某局的状态。g 是不可逃逸的运行时能力参数，不存入帧、不传给任意回调；生成块执行时由运行器重新提供对应分支的能力。暂停后重新读取会取得当前世界状态；暂停前保存在局部变量的 before 则保留原值，编译器不得擅自重算。

## 2. signal 类能力与确定性

第一版提供显式 read/write 的状态单元/字段，读取不可变值，写入通过事务视图提交新存储根。可以提供接近 signal 的 getter/setter 语法糖，但不能产生跨暂停点的宿主闭包；编译器将它还原为稳定引用和 read/write。

derived 是只读派生计算：可以依赖状态读取，不能 await、写状态或做外部 I/O。初版直接按需计算；第二阶段再加依赖追踪和缓存，避免为开发语法先实现一个完整响应式调度器。

缓存只影响性能：删除缓存不改变规则结果，按存储根/依赖版本隔离分支。依赖追踪信息若影响派发或执行次数就不再是纯缓存，必须纳入规范。游戏事件/触发技能走显式队列，不能用自动重跑的 derived/effect 驱动抽牌、伤害等一次性行为。

## 3. 编译管线

选择 TypeScript Compiler API，复用 parser、binder、TypeChecker 和节点生成/输出设施。不要使用 transpileModule 代替跨模块分析；不要依赖未公开的 TypeScript 内部 flowNode。受控语法的 CFG 由本项目建立。

```text
TS Program + 类型检查
  → 识别规则入口和模块依赖
  → 校验执行能力与支持语法
  → 建立控制流图、调用图
  → 分析暂停点和局部变量活跃性
  → 生成显式帧/调用/返回
  → 降低为受控 IR
  → 输出 JS 块函数、程序清单、帧 schema 和源码映射
```

### 3.1 按符号识别能力

defineRule、read/write、choose 等通过 import 符号和受信 SDK manifest 识别，不按函数名称字符串识别；重命名导入不影响识别。同名普通函数不能冒充。规则调用解析到固定规则 ID 或经验证的 RuleRef；未知动态调用拒绝。

按用户确定的白名单制准入，不以“扫描未发现危险调用”推断安全。规则只可调用已登记的 SDK 能力、规则入口、纯计算和受支持的标准库成员。运行时依赖闭包中的每个模块都必须获准，未知依赖直接拒绝；自行标记 pure 不构成准入。

白名单分三类：框架原子/capability（带权限与版本）；纳入本次构建的规则源码及其已校验 RuleRef；已批准的同步计算与工具库入口。构建清单固定模块内容哈希、入口导出、全部运行时依赖与能力。游戏可在已纳入构建的规则源码中增加卡牌，通过检查后生成对应条目；不允许借此自动扩大宿主能力名单。

模块初始化代码同样受检查；即使只导入一个纯导出，也不能忽略模块顶层的副作用。重新导出、别名、标准库成员和传递依赖需解析到获准符号；不能因顶层 npm 包在名单内就放行整个依赖树。纯类型导入不产生运行时代码，可按类型依赖单独记录。动态 import/require、运行期 eval 和无法解析的调用不在第一版白名单内。

纯辅助函数在白名单内部继续校验调用及捕获关系。代码或依赖版本变化后原构建清单失效，必须重新构建和检查；任何模块的未知运行时依赖都导致构建失败。

### 3.2 控制流与活跃变量

将 if、循环、break/continue、return 建为 CFG。每个受控 await 划分调用/等待边界；循环回边提供预算检查点。先保持源码的表达式求值顺序和调用顺序，再优化。

跨边界仍被使用的局部变量进入显式槽位。不能简单只保存当前函数参数；也不能把暂停前的变量在恢复后重新求值。初版允许保守地保存全部合法局部值，之后用活跃性分析缩小帧。

局部原始值的 let 重赋值允许，生成对局部帧槽的更新。跨边界的数据对象采用不可变数据 profile：禁止原地字段修改、可变别名共享和对象身份比较；需要可变实体身份时使用 Ref/EntityId。不是用 JSON 深拷贝任意 JS 对象来假装保存语言语义。

若后续开放一般可变局部对象，必须扩展为显式对象堆并保持别名/身份语义；不能作为“优化”无声加入。

### 3.3 递归、调用与闭包

直接或相互递归规则先分配 ID，再输出函数体；不在编译期展开递归。调用产生参数帧与返回位置，返回由运行器继续调度。规则参数也可携带经登记的 RuleRef，实现高阶调用而不传原生函数。

立即执行且不逃逸的纯 map/filter 回调可以原样留在同步计算中。跨 await 捕获的普通 JS 闭包在第一版拒绝；后续需要 closure conversion，显式生成 codeId+captures，并做变量装箱/别名验证。不能因为底层具有 Closure 就声称编译器已支持任意 TS 闭包。

### 3.4 代码生成

冻结代码表保存普通同步 JS 块函数。对局只保存 (codeId, locals, continuation, heap, pendingRequest)，不保存函数对象。每块返回 Continue/Call/Wait/Return/Fault 等控制描述，运行器处理；这些标签是节点执行的宿主协议，不新增游戏语义。

首版保持与参考流程转移的对应关系，不融合跨 Await/Call/状态写入的步骤。同步纯表达式可形成 Compute 原子；循环/规则递归必须保留显式调度点。某段同步纯计算内部仍不能恢复性中断。

Number 算术若开放，必须用明确的 JS binary64 原子语义，不改写成规格中的 Nat；边界 schema 需要约定 NaN、Infinity、-0 的支持/拒绝与编码。BigInt 可提供精确整数路径。编译器不能用“数学上相等”替代 JS 实际求值语义。

输出包括：程序与编译器版本、依赖/原子版本、代码表、帧与值编码 schema、能力清单、诊断映射和 source map。快照绑定整个构建版本；初版不支持跨版本热恢复。

## 4. linter 与编译器各自负责什么

使用 typescript-eslint 的 typed rules 提供编辑器即时诊断。共享检查库提供诊断码、符号分类和依赖准入规则；构建阶段必须再次执行强制检查，eslint-disable 或关闭 IDE 插件不得绕过。

| 检查 | 拒绝/处理方式 |
| --- | --- |
| Date.now、Math.random、fetch、定时器、文件/进程环境 | 规则及未经批准的传递依赖中拒绝；需要的输入走 capability |
| 可变模块变量、隐藏对局闭包 | 拒绝；迁入状态字段或显式捕获数据 |
| Promise/new Promise/Promise.all、未识别 await | 拒绝；第一版只允许受控顺序等待 |
| 丢弃规则调用返回值、规则放入普通异步回调 | 拒绝；必须受控 await/明确调度 |
| eval、动态 import、动态原型访问、反射绕过 | 受控区域拒绝 |
| any/类型断言伪造 RuleRef/Ref/能力 | 类型检查不是唯一关卡，产物及运行时入口继续验证 |
| g/句柄逃逸、输入对象原地修改 | 拒绝或仅允许明确的局部受限形式 |
| 未支持的语法 | 明确诊断，定位源码，不回退原生执行 |

这些检查提供合规开发约束，不声称构成恶意任意 JS 的安全沙箱。原子的纯净与终止性仍有可信实现面；工作进程提供超时和故障隔离，不用于分叉游戏状态。

## 5. 第一版支持矩阵

| 作者能力 | 第一版 |
| --- | --- |
| TS 类型、模块、普通同步纯函数 | 支持；导入闭包受准入检查 |
| const/let、算术、只读对象/数组、解构 | 按列明节点支持，不隐式接受 getter/Proxy |
| if/else、有限源码的循环、break/continue、return | 支持；循环可无限执行但按预算分段 |
| await 已知规则或 capability | 支持；不保留原生 Promise |
| 规则递归、相互递归、明确 RuleRef 参数 | 支持 |
| 普通纯函数内部的立即回调 | 支持已识别且不逃逸形式 |
| 跨暂停点的任意 JS 闭包 | 第一版拒绝，后续显式 closure conversion |
| try/catch/finally、异步迭代 | 第一版拒绝；没有异常/清理帧语义前不开放 |
| Promise 并发、任意类实例、Proxy/反射 | 第一版拒绝 |

框架业务错误使用 Result 联合值；Fault 按执行规格终止。拒绝语言功能不等于删除计算完备性：顺序、分支、递归及可扩展数据足够。但它限制可直接移植的 TS 写法，必须向作者如实说明。

## 6. 包结构与实现顺序

| 包 | 责任 |
| --- | --- |
| packages/core-ir | 九种节点、程序/schema 与诊断数据、产物验证 |
| packages/runtime | 显式帧、持久化状态、调度、请求、预算、分叉 |
| packages/sdk | defineRule、状态字段、能力与 RuleRef 类型 |
| packages/compiler | TS 分析、CFG、帧生成、IR 降低与 JS 输出 |
| packages/checks | 编译与 lint 共用的准入规则和诊断 |
| packages/eslint-plugin | typed lint、编辑器解释与有限安全修复 |

先实现最小 SDK 类型与源码检查，使作者样例可以被 TS 检查。随后实现参考 IR 执行器和快照，再完成顺序/分支/一次等待的编译路径。之后扩展循环、跨规则调用、递归和复杂局部数据。源码映射与稳定诊断同步做，不能最后才补。

最终交付不是只运行一个玩具例子：首轮验收需贯通多次选择、嵌套规则、循环中等待、递归返回、分叉不同响应及保存后恢复。一般闭包转换和派生缓存在这些通过之后再加，不挡住核心规则编写。

## 7. 新增的证明与测试义务

执行规格中的引擎证明不自动证明编译器正确。需要建立源码规则配置与 (codeId,locals,K,H) 的对应关系：跨 await 活跃值相同、读写和调用顺序相同、请求/响应/结果相同。纯计算内部多步可以对应生成代码一块，采用允许有限内部步差异的模拟；不能据此声称优化前后的预算费用完全相同。

测试分三种独立预期：

1. 对受控顺序源码，用普通 JS async 加测试适配器建立参考执行，比较请求序列、世界变化及返回值。参考端不承担分叉，不进入正式运行路径。
2. 将编译产物同时交给参考 IR 执行器和生成 JS 后端，对照状态与边界；不能只有两个共享同一 bug 的后端，还要使用手写裁定案例。
3. 在每个等待/预算边界保存恢复和分叉，比较不同响应的独立结果，检查父/兄弟快照未污染；单独测试拒绝规则与绕过尝试。

## 8. 依据

- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)：复用程序、类型检查、语法树遍历及生成设施。
- [typescript-eslint 自定义规则](https://typescript-eslint.io/developers/custom-rules/)：带类型信息的项目规则与 IDE 诊断。
- [Solid JSX 编译预设](https://github.com/solidjs/solid/blob/main/packages/babel-preset-solid/README.md)：借鉴将声明式源码降低为运行时调用的分工，不宣称其已有可分叉规则编译器。

## 9. 复杂用例审查后的边界补充

参见 [八组规则用例](../docs/stress-cases.md)。await 只表达控制依赖，不自动执行状态检查、派发触发或开放优先权。游戏调度器明确设置规则时机。

持续效果与未来任务由游戏库登记 RuleRef、参数、时机和来源实例；调用只等待登记完成，不等待未来回合发生。同时事件用游戏库收集选择、准备事件和提交世界变化，不能让原生 Promise 完成顺序决定规则。领域对象版本与最后已知信息不等于底层 Ref。白名单也不能替代玩家观察投影的正确性。
