# 三层与横向能力

| 功能 | Core | Instance | BaseGame |
| --- | --- | --- | --- |
| 创建与执行 | 装载程序、创建实例 | 推进、读取停止状态、关闭 | 持有实例，解释游戏状态 |
| 输入输出 | 程序与端口声明 | 发出调用、接受一次返回 | 游戏请求、动作、事件 |
| 玩家交互 | — | — | 请求直接指定 player，状态和事件投影 |
| 合法动作 | — | 校验端口结构 | 游戏描述并校验动作 |
| 会话控制，可选 | — | 普通端口返回 | 独立 bindControl，游戏解释时间/超时 |
| 保存恢复，可选 | 提供恢复能力 | 完整现场保存 | 复用实例保存 |
| 分支，可选 | — | 同类型独立实例 | 同类型独立游戏 |
| 捕捉，可选 | 提供记录访问 | 记录调用与返回 | 上层解释训练和分析数据 |

Core 提供执行机制并加载共享 Program。Instance 持有独立 Context，其中是跨外部 call 所需的显式控制位置、局部值、调用帧、闭包捕获数据、对象引用图、SDK 状态及待决调用；不是原生 JS 栈或整份模块导出图。BaseGame 持有 Instance 的外部控制权。配套 lib `@bear-forge/game-sdk` 和游戏领域 SDK 属于被执行内容；玩家回调和外侧 GameContract 处理器在宿主侧。

编译受控程序内访问宿主状态或服务只有一条路径：声明端口并执行 `IO.call`，由 Instance 暂停后交给外侧处理，再把返回值作为数据送回。受控编译产物、依赖和内侧 SDK 都遵守同一条边界；不能通过全局对象、宿主函数、getter 或包名豁免直接调用宿主。V8 的纯语言计算和程序自有状态仍在边界内执行，不必包装成 IO。编译准入与运行时守卫负责拒绝无法满足这条规则的受控程序。直接装载的原生 `ProgramModule` 属于受信任代码，不受 IO-only 保证约束。

```mermaid
flowchart TB
  Caller[用户 / 脚本 / 模型] -->|纯动作| Game[BaseGame]
  Game -->|请求 / 玩家状态 / 玩家事件| Caller
  Session[可选会话：时钟与超时] -->|bindControl| Game
  Game -->|通用端口回调| Instance
  Core -->|start| Instance
  Instance -->|执行| Program[游戏程序与内侧 SDK]
  Program -->|IO.call| Instance
  Search[搜索] -->|普通游戏分支| Game
  Analysis[捕捉 / 分析] -->|可选记录读取| Core
```

## 代码与实例上下文

这是三层内部的代码/数据边界，不增加公共协议层或 Context 导出类型。

```text
产物 ──加载一次──> 共享 Program（代码、静态标识、不可变元数据）
                           │
                 runtime 调用（Context、端口返回）
                           │
                 运行到外部 call 或正常结束
                           │
                 Context A ──fork──> Context B
                 共享代码；实例可变数据完全隔离
```

编译器把跨 call 的续接信息放进 Context，边界内计算交给 V8。保存只编码 Context，恢复只装入 Context 并关联已加载代码；冷进程先加载一次匹配产物。实现由 compiler 分离静态注册和实例初始化，runtime-controlled 的 LoadedProgram 共用注册表，ProgramExecution 持有 Context。装载时用临时 Context 完成 schema 准入，随后释放；start 初始化新局，fork 共享 Context 的持久化存储根，并令父子后续写入按需分离；restore 读回独立 Context。fork 不遍历完整状态，首次推进不补做全量复制；fork/restore 都不调用模块初始化。编译器按闭包捕获需求生成共享变量单元的投影，闭包不持有整个父执行帧。没有作用域切换的函数按实际捕获集合分配局部槽：被子闭包捕获的变量使用独立单元，其余槽直接保存值；祖先捕获仍通过独立变量单元访问。普通严格同步调用的未捕获槽、局部作用域数组及控制帧使用临时记录；捕获变量仍是独立 COW 单元，闭包只保留其投影。异步/生成器及其包装函数保留 COW。有作用域切换时保留单元访问方式，按子闭包在各层的捕获槽索引并集保守划分：可能被捕获的槽使用独立单元；其余槽在同步函数中使用临时值记录，在可挂起函数中共享 COW 存储组，防止捕获变量连带保留无关局部数据。严格 arguments 是与参数槽分离的原生 Arguments 对象，其属性随 Context 分支，恢复保留品牌和描述符。同一实例内的捕获投影按来源词法作用域与路径复用共同祖先容器；变量单元仍属于 Context，fork/restore 保留内部别名并隔离不同实例的写入；可证明已死且未捕获的平坦局部值在 await 前释放；可达性包含普通续接、异常和 return 清理路径，作用域切换或可达的未知跳转仍保守保留。fork 不经过持久化编解码器；记录共享不可变分块前缀。schemas 的实例值及实际捕获环境随 Context 保存；只有程序实际引用导出命名空间或使用入口 this 时，才保留对应可变数据和别名。

受控路径在 LoadedProgram 装载时创建一个 V8 Realm，把作者代码、内建值、操作表和续延设备装入其中。宿主输入复制成该 Realm 的数据；对外的端口请求和合法 JSON 结果复制回宿主。Program Realm 不属于 Context，多个 Instance 共享它；fork/restore 不新建 Realm。原生路径仍在宿主 Realm 执行，不提供 fork/restore；直接传入的函数可以持有宿主闭包或跨实例共享的模块变量。

## 数据流

1. 装载程序，Core.start 运行至首次端口等待或结束。
2. binder 接管 Instance，调用方提供与程序匹配的 GameContract。
3. 输入端口经 receive 产生 view 和请求列表；每个请求直接含 key/player/type/data。
4. BaseGame 为请求附加实例/调用身份、该玩家观察与合法动作描述，交给对应 onRequest。
5. 回调只返回动作。纯 respond 校验并编码为端口返回；原程序验证后结算。
6. 会话控制使用独立回调和游戏定义的数据，经独立 respond 编码到同一个端口；游戏决定时钟、超时和默认行为。
7. 游戏发布事件；projectEvent 按玩家生成可见事件，onEvent 接收入队。
8. 一次游戏 run 最多接受一个动作或会话控制，再交付后续事件，到下一请求、结束或暂停时返回具体接受结果。

同时选择由游戏保存部分输入、封存结果和发布剩余请求。外侧一次交付一个返回；结算顺序和共同决策结束条件在程序里。

## 源码目录

```text
packages/
  contracts/
    src/
      core/          program、core、loading 的类型及 schema
      instance/      instance、persistence、capture、branching
      game/          game、authoring、binding、session
      internal/      包内类型辅助
      index.ts       日常入口
      loading.ts     保持既有 /loading 公共入口的 re-export
    tests/
      core/          Core 层测试
      instance/      Instance 层测试
      game/          Game 层测试
      support/       共用协议测试夹具
      *.test.ts      跨层协议、schema 和依赖边界测试
  game-sdk/
    src/
    tests/
examples/
  doudizhu/
    src/
    tests/
```

协议文件按职责命名为 `*.types.ts` 和 `*.schemas.ts`。各层的公共导出和保存/捕捉兼容入口仅做 re-export。源码归属与包的公共导入路径分别管理；目录迁移保持下列导入路径不变。

## 包路径

```text
@bear-forge/contracts              十个日常入口类型
  /core                           程序、端口、创建
  /instance                       通用回调、单步运行、状态、关闭
  /game                           请求、纯动作、玩家交互
  /authoring                      游戏程序、SDK、共享端口、纯适配声明
  /session                        可选会话控制
  /persistence                    可选保存恢复
  /branching                      可选同类型分支
  /capture                        可选执行记录
  /loading                        装载、接管和可选能力组合
src/internal                      类型检查辅助工具
@bear-forge/game-sdk               可执行内侧 lib：createGameSDK
```

基础入口不导出保存、记录、训练或搜索辅助类型。基本 Core/Instance/Game 声明不依赖可选功能声明；loading 在接线时组合实际提供的能力。各模块 tests/architecture.test.ts 检查自身源码的依赖边界，包含在该模块的 npm test 中；根目录通过 workspaces 汇总。

游戏目录：schemas.ts 定义领域数据；types.ts 特化公开契约；program.ts 是主循环；sdk.ts 组合公共 game-sdk lib 与实例内随机流；rules.ts/patterns.ts 实现规则；module.ts 声明 GameModule 与纯处理器。

C01 交付公共声明、完整斗地主及原生协议消费者。生产执行、保存续延及正式绑定器在 C02/C03 验收。

内侧 lib 与外侧功能的逐项对应、类型关联和语义法则见 protocol.md 的“内侧 lib 与外侧功能配套”。GamePortDeclarations 同时用于 Program 的端口 schema 与内侧函数生成；GameContract 受同一端口类别/输入/返回类型约束。Core/Instance 不依赖该游戏声明或 lib。lib 不持有 BaseGame、Instance 控制句柄或宿主回调。

测试归属对应模块：contracts/tests 验证公共契约；game-sdk/tests 验证内侧库及游戏接口接线；doudizhu/tests 验证具体游戏。contracts/tests/support 的协议夹具由依赖模块的测试复用，不作为生产包导出。

## 完整系统实现

生产模块、原生与受控两条路径、游戏领域记录、策略、实验存储和关系展示的实施方案见 [implementation-spec.md](implementation-spec.md)。这些模块通过现有公开接口组合，不修改本页三层边界。实现目录与审核入口见 project-overview.md；进度以 plan.md 为准。

执行实例均在主 runtime 内直接调用编译产物，代码按产物缓存，模块变量/闭包/执行帧按实例持有。受控路径仅在 Program 装载时创建 V8 Realm；创建 Instance、fork 和 restore 不创建 Realm。没有 Worker 或执行子进程。只有编译预算检查，不提供硬超时。测试中的新进程用于证明关闭程序后仍能从持久快照恢复，不是执行器的实例承载机制。
