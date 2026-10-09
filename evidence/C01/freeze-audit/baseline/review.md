# 协议冻结审计：不能冻结

审计基线：2ed41da80b1570a094726583a6ef2490a25c9fdf。此次只审计，不修改公共协议或实现。现有类型/schema/原生测试通过，不构成“公共协议以后不需要修改”的证明。

## 判据

冻结至少要求：已声明需求的能力闭合；操作法则彼此一致；所有合法路径的数据/控制都可表达；跨模式组合不丢失约定。本次找到反例/未闭合义务，足以拒绝冻结，不声称已经穷尽所有缺口。

## F1：独占绑定后的捕捉访问未闭合

当前声明同时有：

1. InstanceCapture.read 的实参必须是 Instance。
2. BaseGameBinder.bind 先 transfer；旧句柄及别名的操作返回 instance_owned。
3. 新句柄只由 BaseGame 私有持有，不对外暴露。
4. BaseGame 没有 capture/readRecords 能力，也不暴露受限读取句柄；binder 只接收 persistence，没有 capture 接线。

考虑合法提供者 LoadedCore={core,capture}，不提供 persistence。start 返回 i；bind(i,contract) 后调用方持有失效的 i 和 BaseGame b。由公开返回类型归纳，b 的调用只产生领域数据/同类型 b/可选快照，不产生有权读取原局记录的 Instance 句柄。在 transfer 对旧句柄访问统一失效的解释下，无法调用 capture.read 读取这局持续运行的记录。

如果实现希望 capture.read 对失效句柄是例外，这个例外目前没有规定，且与“旧句柄及其别名的操作失效”的宽规则冲突。故至少缺少一条明确的只读捕捉访问契约。不能把“实现时直接按 id 读取”作为现有协议的完备性证明。

该项是公开能力可达性证明的失败，不要求先实现执行器。需要确定捕捉权是随 transfer 移动、独立保留，还是由 BaseGame 转接，再补类型/法则；本轮不替用户选补丁。

## F2：手动/回调模式的事件交付组合未证明

合法 GameContract 的 decision.receive 可返回非空 events。合法轨迹：

1. 在 D0 调用 submit(a)。
2. 程序推进到 D1，D1 的纯投影 events=[e]。
3. submit 返回 boundary=D1 和这次推进产生的 events=[e]。
4. 不回答 D1，切换到 run。
5. 当前协议规定 run 先交付当前决策投影的 events，再调用 onDecision，于是 onEvent 再次收到 e。

这与“手动控制与回调驱动……不重复交付”的表述冲突。不能借斗地主当前决策 events 恰好为空排除反例：公共 DecisionData 允许非空事件，必须覆盖所有合法作者程序。

GameUpdate.events 是 E[]，回调事件却是 EventDelivery<E>。协议虽然允许回调重试并按 id 去重，但没有统一规定手动交付与回调重投如何关联；中间多个端口的事件在手动返回中也失去逐项来源。消费者可以设计基于边界身份的去重约定，但这个额外约定没有被当前协议固定。

如果决定 submit 不返回 D1 投影事件，则必须说明连续手动 submit 如何获得每个边界事件，否则又有事件遗漏路径。这里不能用私有“已经发送”标志默认解决，因为协议同时要求外侧状态可丢弃并允许保存/恢复。

event-witness.mts 使用当前公共类型构造合法纯投影、GameUpdate 与回调 envelope；它通过严格类型检查。它不是生产运行器，也没有假装通过真实 submit/run 重放。重复交付结论来自以上规范逐步推导。

## 现有证明的范围

proof-index 的 101 个导出被列入四组有前提的论证，并非 101 项独立完备性定理。语义保持、正确 fork、生命周期等许多性质列在 assumptions/openObligations 中。它们可作为合法的条件证明前提，但不能用“提供者遵循协议”消除 F1 的访问缺口和 F2 的组合冲突。

57 项测试包含原生游戏与 schema 检查，类型消费者不运行生产 Instance/BaseGame。尤其斗地主把事件放在独立 event 端口，不能覆盖任意合法 decision.receive.events 非空的混合模式轨迹。

## 可复核命令与结论

- 严格类型见证：node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --allowImportingTsExtensions evidence/C01/freeze-audit/event-witness.mts
- 声明/规范前提检查：node evidence/C01/freeze-audit/check.mjs
- 两者成功只确认反例材料符合声明和引用法则，不代表构造了执行器。

结论：当前协议不能冻结。C01-03 重新打开；游戏原生正确性验收不因此撤销。修复上述具体义务后还需做有限需求集合上的完整状态转移/能力闭合审计，不把“没有继续找到问题”称为全局证明。公共 type/schema 未修改。
