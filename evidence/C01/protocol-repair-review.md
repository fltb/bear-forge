# 公共协议修复复核

后续证明复核已推翻“这些修复足以使协议定稿”的推论，并发现查询泛型仍有联合键漏洞。当时发现的 F1–F4 见 [证明审核](proof-audit/review.md)，后续修复见 [严格修复报告](strict-repair-review.md)；本文件保留此前修复与测试的历史范围。

2026-10-09。范围：修复公共协议审核的全部七项问题，并检查关联消费者；包版本不变。生产 Core、编译器、会话和斗地主受控迁移未在此报告中算作完成。

| 问题 | 修复 | 证据 |
| --- | --- | --- |
| request/input 两个独立联合 | 有限 interactions 模板表、关联 request/reply 联合、按键 request 返回值；运行时必须核对当前键和边界 | 两种互不兼容请求在同一作者循环中运行；错误键/载荷/返回值类型反例 |
| 实际输入未限制 JSON | InteractionShape 与 GameRuntime/InputValidation/History 的输入约束；运行时 JSON 校验义务 | 回调、Date、undefined、bigint、非有限数反例 |
| options 未绑定作者入口 | GameModule.inputs 与 schemas.interactions 同键；每项 options schema、describe、validate；LoadedGame.inputs 固定入口 | exact-only、construct 具体描述、错误描述及非法值测试 |
| 可选能力未闭合 | LoadedGame 可选 persistence/simulation；获取、恢复/推进、消费、释放；GameSnapshotRef 独立品牌；具体游戏工具显式绑定公共端口 | 保存/恢复/搜索/构造/评价类型消费；构造与评价适配器只调用公开实例、查询、快照接口；无生产恢复声明 |
| CoreError 非法组合 | kind 判别联合；CoreFault 限制执行 fault 与 faulted 记录 | 全部 40 个 kind/code 组合核对；类型反例 |
| load 绑定随机种子 | 删除 load 配置；每次 create 必须提供 GameRunOptions；Core Execution 配置泛型及 GameCoreExecution 映射；History 与 Core started 捕捉保留配置，ProgramSchemas 对配置提供模板 | 缺配置静态反例、配置 schema、显式两局 Core start 类型消费 |
| 公共缓存布局 | 删除公共 GameOwnedState；GameCoreProgram 的额外能力由绑定器特化；缓冲只留在测试夹具内部 | 被删除导出的负向导入；原生映射和事件增量测试 |

补充修复：GameQueryCapability 参数使用 NoInfer 防止通过参数扩大查询键；查询与错误类型的负例纳入类型检查。inputs.validate 不携带无消费者的 context，完整输入自己包含领域所需身份/选择；context 仅用于 describe。

验收：npm run check，58 项运行测试通过，0 失败/跳过；TypeScript 的负向期望全部生效；源码层依赖边界检查通过。斗地主现有完整对局、全部牌型、exact 选项、非法输入与隐私回归通过。原始日志：protocol-repair.log。

文档和证据一致性检查另外执行。当前 C01 仍 in_progress，C01-03/05 仍待更大范围验收：本报告证明上述协议修复及消费样例，不证明受控程序准入、真实恢复隔离或完整游戏迁移。docs/controlled-program-spec.md 的实现义务不被删除或降低。
