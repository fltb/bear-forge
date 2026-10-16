# 历史编译与 Script 兼容记录

这部分是严格 ESM 边界确定前的实施记录，不是现行准入或验收要求。

## 语言符合性与底座重审

已在原版 EffectfulJS 2.0.12 的 v2/debugger 路径确认表达式转换、委托控制流和生成器运行时缺陷。此前通过的游戏与差分检查只证明其覆盖的行为，不能证明整个准入范围正确。现阶段保留当前实现供比较，不把 Babel/SWC 的生成器转换等同于已完成替代，也不新增或修改公共协议。

初版交付完整的受控程序支持：普通 TS 函数、循环、递归、闭包、异常与模块组合，在规定的 IO 等待和正常终局保存完整 Context。不得以作者手写 PC、历史重放、包名豁免、宿主状态旁路或缩减既定基本能力来迁就候选实现。

语言语义以固定目标 Node/V8 原生执行为准，Test262 为外部用例来源。落实时固定其具体提交，再按预先确定的支持范围分类，不能按是否通过筛选测试。结果至少区分适用且通过、适用但失败、范围外、运行器尚未支持；未分类和运行器缺项不得计为通过。范围外的准入拒绝单独验证，不能冒充 Test262 语义通过。Test262 的 feature 元数据不能单独表示全部条件准入规则。

适用测试必须经过生产编译和受控运行时，并保留原断言、严格模式/模块语义、独立测试环境、异步结束协议及预期错误的阶段和类型。不得将全局测试统一包装成函数。测试专用宿主设施与业务端口隔离，不扩大作者程序的能力白名单。原生执行仅作定位参照，不以两端共同改写后的结果作为唯一 oracle。

Test262 不覆盖我们的 IO、fork/save/restore、共享 Program、实例隔离、无重放和性能要求。上述要求仍以正式模块检查及完整业务验收验证；插入 IO 的派生测试明确标识为项目测试，不能计入未修改 Test262 的通过数。有限测试通过不构成全程序正确性证明。

候选实现必须逐项核对：语法及语义转换、局部变量与闭包环境显式化、运行时控制状态显式化、内建状态表示、统一依赖准入、现有端口接线。Babel/SWC/TypeScript/Closure Compiler 原有生成器降级仍有原生闭包状态，复制它们名为 context 的对象不等于复制完整现场。尚未证明这些适配的成本与正确性前，不宣称替代已完成。

Test262 接入核对采用上游提交 `2e0a56762801e275a9fdf96dc49d90ba0cddcf63`。该提交的 INTERPRETING.md 要求每个用例独立 realm，普通源码按 global code 执行，assert.js/sta.js 先在同一全局环境求值；negative 必须同时匹配阶段与错误构造器。当前 programFactory 是严格模式模块工厂，admitSource 拒绝顶层 this，loadProgramFactory 在当前宿主加载产物。这些机制不能直接充当该运行器。不能为跑测试而暗中放宽业务准入；也不能把原文件包成函数、把 this 改成 globalThis 或只执行断言片段后报告官方用例通过。

例如该提交的 `test/built-ins/{Infinity,NaN,undefined}/prop-desc.js` 使用顶层 this 与 propertyHelper.js；现有项目差分测试可独立验证同一属性规则，但必须标为项目测试。后续运行器的环境支持与业务语言子集须分别分类：运行器缺失 global-code/realm 支持不能被归为业务不支持、不能计为成功。尚未完成此接入，也没有 Test262 通过率。


## 模块链接的语义边界

游戏程序打包不再使用 esbuild：其顶层 let/const/class 转 var 会丢失 TDZ，无法由后续续延转译恢复。编译器采用 Rollup 4.64.5 与官方 node-resolve/commonjs 插件，Babel modules-commonjs 8.0.1 负责最终导出转换；这些依赖均为 MIT，准确版本由 lockfile 锁定。项目构建工具中其他 esbuild 用途不受此调整影响。

每个物理源码模块在 load 阶段先接受相同的原始源码准入，再擦除类型；依赖包名称不影响该流程。入口源码字符串采用同一处理。编译器插件生成的内部模块由其所属插件加载；作者模块标识禁止 NUL，不能请求内部虚拟模块。未知源文件格式和未解析依赖失败。JSON 在编译时验证，生成统一的 JSON.parse 初始化和命名导出引用，保留所有数据键、普通对象原型与默认/命名导出别名；不转换成对象字面量。

链接阶段关闭 tree-shaking，源码注释不参与纯函数等优化判断。输出先保持 ESM 局部词法绑定，再转换最终 exports；不直接使用 Rollup CJS 输出，因为它可把导出的可变绑定改为 exports 属性，导致循环导入提前读取返回 undefined。CommonJS 入口根据官方插件提供的模块类别元数据保留原始 module.exports 对象；不依据文件名、包名或源代码片段推测。循环依赖本身合法，必须保留对应初始化时序。

正式测试覆盖模块初始化 TDZ、循环依赖、live binding、CommonJS 导出别名、传递依赖准入，以及这些可变绑定经过等待点后的 fork/restore 隔离。它们不代替完整模块语义证明或 Test262 验收；模块命名空间反射、函数名称、类和参数绑定等剩余范围继续按计划审核。

具名函数表达式的内部名称是独立的只读绑定，参数及函数体声明可遮蔽它。续延作用域分配将名称环境与参数/函数体变量表分离；解析引用时先找局部声明，再查名称环境。编译器按 Babel 绑定身份转换对此只读绑定的赋值和更新，不按标识符拼写判断。严格模式写入在右侧或数值转换完成后抛出 TypeError；非严格模式忽略写入但保留表达式结果。类的隐式严格模式在共享语法降级阶段保留，链接后的 ESM 由导出适配保留显式 use-strict；不能从后端内部用于作用域分配的 parser 模式推断作者严格性。

无需调用作者代码的私有绑定操作使用显式闭合名单标注为同步操作，同时保留 CFG 的顺序及异常边；数值更新可能调用作者转换方法，仍走正常可恢复调用。新增运行时操作不包含额外可变状态；函数引用与捕获单元仍属于既有 Context 表示。JSON 模块的默认/命名导出别名和数据属性已纳入等待点、fork、持久恢复回归。


类内部名称在字段和计算属性拆分之前，按语法绑定身份转为独立的只读词法记录；其初始化发生在构造器和方法定义完成之后、静态字段初始化之前。计算属性名中逃逸的闭包必须先经历 TDZ，再读取完成初始化的同一记录。每次类求值拥有自己的记录，包括循环头、参数默认值和实例字段中的嵌套类。记录属于 Context，访问器代码属于共享 Program/runtime；不靠类名、源码路径或依赖包名选择规则。转译后用构造器及 helper 的内部 AST 身份核对初始化数量，标记丢失时拒绝生成产物。


模块链接后的函数名称通过源码映射回到原始 AST 节点恢复，不依据生成标识符后缀。函数声明的 name 恢复放在所属作用域开始处，保证循环依赖提前读取时也可见；表达式保留原有词法绑定，仅恢复 name 属性。模块命名空间的完整 exotic-object 语义尚未完成：当前链接器生成的冻结普通对象在属性描述符、标签及 defineProperty 行为上存在已复现差异，正式回归保持失败，不能宣称该部分符合 ECMAScript。


ESM 命名空间现由原始 import-namespace / export-namespace 语法产生编译器专用标记，链接后按绑定身份消费标记，把已确认的命名空间导出表转换为私有 moduleNamespace 操作。标记在准入后生成，作者使用保留标识符会被拒绝；普通 Object.freeze 对象不参与转换。运行时以内部 Proxy 实现 ECMA-262 10.4.6 的属性语义，读函数及捕获数据归 Context。直接复制、复制计划和持久化专用描述器只处理显式导出名/读函数记录，不枚举 live 描述符；空壳分配后再安装引用，保持循环关系且不会读取 TDZ。此处内部 Proxy 不是允许作者使用任意 Proxy，也不捕捉原生调用栈。

模块命名空间先按词典序建立导出占位属性，再由 V8 的 Reflect.ownKeys 返回键序列，保留目标引擎对整数索引键的排序；绑定读取仍使用原有导出记录映射。正式测试通过原生模块覆盖整数边界、非规范数字字符串、空名和普通字符串。

Test262 测试输入准备已接入 `packages/compiler/tests/test262-cases.ts`，使用上游运行器依赖的 `test262-stream` 读取元数据。辅助脚本作为独立的全局脚本返回，不拼进测试模块；原测试源码只允许官方要求的严格模式指令前缀。module 只保留一次隐式严格执行，raw 不注入辅助脚本，异步完成辅助脚本及 negative 的阶段/错误类型单独保留。重复选择、缺少辅助脚本和越界路径直接报错，不计为跳过或通过。

运行前的 checkout 检查要求固定提交、相关文件没有本地改动且没有稀疏检出遗漏。该输入准备层不执行用例，也不产出符合性通过记录。原生参照已有独立执行环境，生产转译接线仍未完成；现有严格模块工厂不能代替全局脚本语义。

原生参照执行器位于 compiler/tests，使用独立 worker 和独立 V8 context 执行原始全局脚本，辅助脚本先单独安装。worker/context 仅属于测试基础设施，不进入生产 Program、Instance 或 fork 路径。外侧超时可以终止同步死循环和无限 Promise 微任务。模块参照支持原始模块、相对 JavaScript 夹具、循环链接和独立全局辅助脚本。尚未实现的动态导入、导入属性等宿主能力立即返回 runner-missing；即使测试捕获异常后永久等待，也不能变成通过或误记为超时。结果始终区分 native-reference 与 production-controlled；辅助脚本/运行器故障不能满足 negative 的预期错误。

原生参照可能与 Test262 断言不同：固定提交的 prefix-increment/S11.4.4_A6_T3.js 在目标 Node 26.5.0 的两个模式下失败，原始执行显示属性键转换两次。项目差分直接对照原始 V8，并覆盖前后置增减、复合赋值及跨 IO 恢复。原始 Test262 断言仍须保留，其结果单独报告；不能把原生与外部用例的差异抹成 Test262 通过。

原始源码准入错误分为 ECMAScript 解析错误与 `AuthorAdmissionError` 策略拒绝；后者不能满足 Test262 的预期 SyntaxError。原始源码解析错误由准入阶段记录来源，后续转译器解析生成代码失败不能冒充原始源码早期错误。JS 源文件使用 JS 解析模式，只有 .ts/.tsx/.mts/.cts 使用 TS 插件；TS 的类型语法和导出检查差异不能流入 JS 准入。

生产解析阶段的正式检查入口为 `TEST262_ROOT=<完整检出路径> npm run test:test262:parse -w @bear-forge/compiler`。该检查验证固定提交与完整干净检出，然后选择所有 module + negative.phase=parse 的原始用例，直接调用生产 compileJavaScript。它不执行测试或 harness，不检查运行时行为；独立标识为 production-module-parse，不能与 production-controlled 的执行结果混算。脚本目标、正例、resolution/runtime 负例仍需后续完整执行适配。准入拒绝、编译器故障及运行器缺项不能计为成功。

挂起帧由 Future 的回调、保留的 resolver 和游戏仍可达的数据维持，不另设强引用的全体挂起帧登记表。否则已不可达的异步任务会被调试索引提升为永久 Context 根。fork/save/restore 仍复制所有真正可继续执行的回调与闭包；废弃任务的不可达负载不应随历史持续积累。原 IO 路径与经 resolver 间接继续的任务均有独立恢复回归。


弱集合的 Context 可达性：WeakMap/WeakSet 的弱键索引只用于发现候选条目，不构成保存根。复制和持久化从 Context 的强引用及共享静态注册值开始，仅当键已可达时保留条目；条目的值可以扩展可达集合，直到不再有新增条目。对象属性名中的 Symbol 和装箱 Symbol 同样属于强可达值。只有弱边支撑的环不能自行存活；测试宿主仍持有某个键，不代表分支应持有它。可恢复的闭包、游标和显式控制状态仍按其真实强引用保留。此规则适用于直接复制、复用布局的 fork 和快照恢复，不改变公共协议。


fork 的复用布局缓存属性键序列，避免每个兄弟分支重复生成键数组。普通对象直接按普通原型创建；空对象无需清理构造时自带的属性，函数、错误等仍按既有逻辑恢复属性顺序和描述符。内部变量 Cell 的类型描述按其固定原型注册一次，变量值和 Cell 实例仍逐分支复制；快照编码及共享变量别名不变。这些优化不共享实例可变数据，也不调用作者初始化逻辑。


弱条目的不动点由按键索引的工作队列推进：发现强可达键时，仅唤醒等待该键的条目；每个条目入队并处理一次，处理其值可以继续唤醒条目。对于有索引的弱集合，调度工作量随已访问的键和候选条目线性增长（采用 Map/Set 的通常摊销模型），不再随反向依赖链反复全表扫描。直接复制、复制布局发现和持久化共用这一调度器；旧的无索引原生弱集合辅助路径不据此宣称同样复杂度。返回的布局复制函数由独立词法作用域构造，只捕获布局和根引用，不捕获发现阶段的源对象索引或待决弱条目。

解析器报告缺少语法插件（missingPlugin）属于当前实现不能判断该语法，统一视为准入拒绝；即使 Babel 使用 SyntaxError/BABEL_PARSE_ERROR 包装，也不能满足 Test262 的预期早期错误。历史205项全通过的结果曾包含4项缺插件误分类，已撤回。当前准入解析器显式识别 deferredImportEvaluation/sourcePhaseImports 语法，随后拒绝合法但不支持执行的导入阶段；非法语法由解析器本身报告。修复后的固定提交模块解析负例重新执行205/205通过；这只证明该解析负例集合，不代表支持这些阶段的执行或完整 Test262 通过。


Test262 模块执行入口：`TEST262_ROOT=<完整检出路径> npm run test:test262:modules -w @bear-forge/runtime-controlled`。它使用固定检出的原始模块与相对依赖，每个用例在新 Worker 中编译、执行。harness 原始 Script 源码作为闭合源码集合进入生产编译链，声明名称来自真实语法绑定，所有脚本和模块依赖均经过准入；不再在宿主 realm 运行 harness。编译后的脚本按顺序在模块求值前初始化实例全局，模块读取同一实例环境中的绑定。没有提供对应源码声明时，assert 等未知名称仍被拒绝。

测试入口仅 side-effect import 原模块，通过生产 compileEntry 与 ProgramExecution 初始化并执行。原模块不会被包进函数、替换断言或增添局部绑定。脚本编译将全局 var/function 显式化，再生成执行单元；源严格模式和函数源码由编译器来源信息保留，Script 顶层 this 与函数/类接收者区分。入口是语言执行夹具，其简化 schema 不用于证明完整 Loader/Zod 准入。共享 Script 顶层 let/const/class 声明在各自 Script 开始时安装独立词法单元，执行到声明处时初始化；单元属于 Context，不成为全局对象属性。后续 Script 不提前安装声明；共享 Script 的 module/exports 名字按其全局或词法绑定处理，CommonJS 转换先建立实际加载器参数作用域，之后仅将仍未绑定的同名引用接到 Script 环境。动态 Function 仍未获得宿主执行权限。完整 harness 接入尚未完成，也不能把这些缺项算成符合性通过。

当前该入口只尝试 flags 为 module、没有 async 标志、没有 negative 元数据的正例；这不是整个支持范围的替代定义，也不等于源码没有顶层 await。其他模式和完成阶段返回 runner-missing。外部关卡将失败及未执行均计为未通过，不能用局部通过关闭总体验收。固定提交首轮495例：12通过、171执行抛错、296准入拒绝、16运行器错误；命令失败。已定位一个生产缺口：合法顶层 await 在编译阶段获准，但初始化在继续执行完成前读取程序导出，`await 1` 即可触发缺失 ProgramModule 错误。完整异步模块初始化、依赖次序及异常传播尚未修复；不能通过排除顶层 await 来撤销此失败。


模块语法上下文必须跨打印/重解析保留。原始准入 AST 记录顶层 AwaitExpression 或顶层 for-await；该信息从每个真实依赖汇总到编译阶段，用于恢复 allowAwaitOutsideFunction 解析上下文。它不按包名/文件内容猜测，不放宽 TaggedTemplateExpression 等未准入语法，也不跳过后续依赖检查。修复前 ESM 标记被擦除后，unambiguous 解析会把顶层 await 后的模板字面量解释成标签调用，进而生成非法 JS；修复后不再发生这类误解析。这只是编译阶段修复，不代表支持完整的异步模块初始化。

多模块异步求值另有独立缺口：a 模块记录 a:start 后 await 0 再记录 a:end，兄弟 b 模块记录 b；原生静态模块导入顺序为 a:start,b,a:end，当前合并结果为 a:start,a:end,b。不能仅通过初始化时 drain 队列来修复。需要保留模块求值边界、依赖调度、完成及异常传播。顶层执行帧的异步完成状态与导出读取时机已按下段修复，模块图顺序仍待修复。


单编译单元的异步完成已接入：编译器依据原始 AST 的顶层 await 信息，为内部 File 标注异步求值；续延转换复用现有异步帧与 Future 完成/拒绝协议。initialize 返回该完成对象，运行时推进该 Context 的任务队列，在完成后才读取程序导出；拒绝值原样抛出。仍未完成且没有外部输入边界的初始化不会启动 run，也不能保存为合法现场。无新公共字段、保存点或宿主回调。普通同步模块保留原有路径。

这不修复打包合并导致的异步模块依赖顺序。正式 initialization.test.ts 已加入原生 ESM 对照：兄弟模块必须在另一模块 await 暂停时开始执行；该项目前失败，不能跳过、改期望值或用199个 Test262 通过替代。Native 编译产物的顶层异步求值路径也仍需对齐。


模块图调度组件已实现于 compiler/src/module-evaluation.ts，尚未接入 bundleProgram。它只接受已链接、已实例化的内部模块定义，按请求顺序访问依赖，保留循环根、待完成依赖及异步推进顺序；错误状态与错误值分离。其代码可与作者代码一起转译并在 Context 内执行，不通过宿主回调执行模块体，也不新增公共加载接口。512种三节点无自环依赖图/异步分配组合与原生 ESM 对照，另经实际受控转换验证同样512组及后续IO/fork/restore。组件测试不等于生产模块链接验收：导入导出绑定、模块实例化、源码元数据及 native 产物接线仍待完成，原有兄弟模块次序失败项仍有效。


Module-graph integration update (supersedes the pending-linkage status above): bundleProgram now invokes module-instantiation.ts for graphs containing admitted top-level await. Module lexical activations register live export readers and import connectors before evaluation; the scheduler advances their bodies inside the existing controlled execution. CommonJS namespace snapshots initialize at module completion. Namespace provenance uses resolved module IDs and output files to reconstruct linker-elided declarations, followed by binding validation. Maps use absolute source identities and are passed separately from generated code. The original sibling-order failure now passes, along with512 production-linker/native-ESM graph comparisons and controlled binding/fork/restore checks. Large async Zod entry compilation exhausts the default heap; native artifact async initialization and full acceptance remain incomplete.


import.meta uses a per-source-module, lazily allocated null-prototype extensible object. File-backed compilation initializes its writable/enumerable/configurable url property from the resolved source file URL; direct single-source compilation uses bear-forge:program. This runtime does not add Node-specific metadata functions or dynamic loading. Metadata mutations and aliases are Context state, while initial URL literals and getter code are shared compiled definitions. Original callable source is captured before this lowering. Cyclic imports can obtain the same object through hoisted exported functions before module body evaluation. This is an internal compiler contract, not a change to the frozen Core/Instance protocol.


Final generated-code processing separates scope-dependent rewrites from explicit-slot analysis. Ambient binding resolution and budget insertion retain Babel scopes. Capture projection and liveness operate on the continuation representation with scope-free traversal; they must not resolve author variables. Static factory insertion also needs no source scopes. Owned AST traversal caches are released at these phase boundaries and before printing, without clearing another compiler consumer's caches. The current large real-schema artifact is byte-identical across this memory optimization, and the default-heap full regression/build now pass; exact evidence is recorded in docs/plan.md.


原生初始化接入：含顶层 await 的产物工厂现在使用原生 async 函数。实现辅助函数 nativeProgram 返回 Promise<ProgramModule>，等待初始化后再交给既有 NativeCoreLoader.load；每次 Core.start 等待自己的新模块实例初始化，随后读取 schema 和启动 run。实验调度及所有调用点同步等待。公共 Core/Instance/Loader 协议、产物字段和 ABI 未改；受控执行的共享 Program/独立 Context、fork/restore 路径未改。异步初始化的预算/宿主违规标记仍优先判错，不能被作者捕获后转换为成功。验收结果见 plan.md。


非严格函数接收者：编译器在链接前记录函数的原始严格模式，模块图确认 ESM/CommonJS 身份后保留该信息。只对原始非严格普通函数的 this 引用建立一次调用内的局部接收者；使用 Babel 环境遍历区分箭头捕获与独立函数/类边界。接收者引用先进入参数转换，初始化声明在参数转换完成后插到默认参数执行前，保证生成器参数和延迟函数体共享同一次装箱。运行时空接收者指向当前实例的 globals，原始值使用原生 Object 装箱；不引用宿主全局。局部绑定进入既有 Context 捕获机制，原生/受控后端共用转换。不改变公共协议，也不代表完整 Script 全局声明与 Test262 harness 已完成。

Script 顶层 this（包括严格 Script）及其箭头/计算键引用指向实例全局；函数只接管自身参数和函数体中的接收者引用，方法自己的计算键属于外层。原生对照与独立分支检查覆盖这些区别；完整 Script 声明环境仍待实现。


属性操作的严格模式：赋值（含复合赋值）、更新及 delete 在编译时携带原始源代码的严格模式，而非运行时外壳的模式。严格路径保持 V8 的原生失败行为；非严格路径对失败的普通属性写入忽略 false、保留表达式返回值与已发生的部分修改，delete 返回布尔值。两条路径都先执行共享内建对象保护及访问器准入检查，非严格模式不扩大宿主能力。类语法整体属于严格区域，转换前保留该信息，计算键、解构目标及静态块即使被提取到外层也不能改变模式。类静态块进入统一语法白名单，使用已有 Babel 转换、受控调用和 Context 保存流程。


Direct Script global declarations now use compiler/script-bindings.ts. Original Babel binding identities distinguish top-level var/functions from lexical declarations and linked module locals. Reads use instance global references; assignments, update expressions, iteration targets and destructuring targets use guarded property operations. Function declarations keep original source identity and mutable global recursion, without creating an immutable named-expression self binding or changing receiverless calls.

Runtime global-bindings.ts stores only plain references to the active instance object, name and strictness. Declaration ordering, partial failures, descriptor changes and RHS name changes are compared with a native DONT_CONTEXTIFY realm to avoid vm sandbox-proxy reflection differences. The compiler does not inject host globals or exempt harness function names. Cross-Script lexical declarations now use per-Instance declarative cells; Annex B remains unfinished; ordinary declaration tests do not prove full Script/harness support.


Author ambient globals are now lowered before helper generation/module wrapping by ambient-bindings.ts. Reads use globalRead(name); typeof permits an absent property. Writes use a plain global reference plus a runtime-owned accessor target, so destructuring, iteration and suspended compound assignments share ordinary guarded operations. Accessor code is registered shared runtime code; reference data belongs to the instance. Local declarations are resolved by Babel binding identity and stay local. Direct Script declarations of builtin names use the same mutable instance properties.

Builtin global bindings are writable/configurable except undefined/NaN/Infinity. Their original intrinsic objects remain protected, and unknown ambient names remain outside admission. Generated helpers continue to use trusted intrinsic operations rather than mutable author globals. CommonJS versus ESM write strictness comes from Rollup's actual module classification via compiler-owned markers; missing provenance fails compilation. Markers are consumed before graph framing/continuation compilation, including side-effect-only ESM. This is not a filename/package exception or permission to execute a host function.

Direct Script loading provides module/exports as writable, enumerable, configurable instance-global properties before source declarations execute. Compiler-owned aliases access the original loading values, so lexical declarations with those names do not interfere with initialization. Free reads and admitted writes resolve the instance properties; linked modules retain their own module bindings. Namespace retention accounts for escaped root aliases and access to the Script global object, while loading-only export writes do not retain unused export contents. Declared var reassignment, alias identity, lexical shadowing and descriptors are compared with a fresh native realm through independent fork and persistent restore. Bare unbound module reassignment remains rejected by admission; this change does not claim complete CommonJS or global-environment support.

Import writes are lowered before linking through ordinary compiled accessor references. Their getters read the original live import; setters perform the existing strict immutable-write operation. This preserves RHS evaluation before a simple assignment error, read/TDZ/coercion before compound/update errors, logical short circuiting, destructuring/iteration closure and IO continuation state. Namespace property targets use a compiled getter to prevent the linker rejecting the write before runtime. No host callback or new runtime capability is introduced. Original inferred callable names are retained in compile-time source provenance, including anonymous class names observed by static initialization before a failed import write.

Default export expressions become explicit lexical snapshot bindings before linking; function/class declarations retain their own instantiation behavior. This prevents Rollup's generated var from exposing undefined before a default expression initializes. Indirect named exports are normalized into imported local bindings and local exports before printing, preserving live aliases and attributes. This avoids Babel's string-to-string export alias printer error without matching any export spelling or source file. Numeric literal keys in the linked namespace table use the ordinary static number-to-property-key conversion. Cyclic star/named reexport resolution uses the vendored resolver and original-graph V8 link validation described above; these repairs do not establish complete module conformance.


Shared Script lexical compilation uses original Babel binding identities in script-bindings.ts. Top-level class declarations become lexical initializations with their named class expression scope preserved. Only the Script's own top-level lexical references are rewritten; nested bindings remain local. Initialization targets retain their cell before evaluating the initializer; reads, writes, patterns, updates and pending compound assignments use existing guarded operations. Anonymous callable names and original source provenance survive the rewrite. Runtime globalDeclare installs that Script's lexical cells before its var/function instantiation, preserving observed target-V8 partial failures. Declaration conflicts use existing lexical cells and restricted own global properties, not a historical set of every var spelling: V8 permits a later lexical declaration when var reused a preexisting configurable property. Source-derived admission remains unchanged for external capabilities. Loader-binding collisions are handled after CommonJS wrapper conversion; Annex B and static Function construction remain pending.


The first source pass defers shared Script names that coincide with module loader bindings. A second narrow binding pass runs after the CommonJS plugin has introduced actual lexical wrapper bindings; bound references remain local, while still-free declared Script names resolve through the Instance environment. It does not rewrite generated intrinsic helpers or exempt any source from admission. Native references for loader-global reflection execute real .mjs files, because Node's -e environment itself can provide a module global.

Namespace projection applies only to the loader-created initial exports container. Assigning a replacement module.exports does not give that author object the loader container's property layout. Such an object may also be reachable through an ordinary CommonJS closure, and stripping its keys would break that alias after fork/save. Replacement objects survive only through actual continuation references or required namespace roots; this does not restore whole module-export graphs as unconditional roots.
