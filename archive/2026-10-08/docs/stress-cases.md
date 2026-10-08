# 复杂规则用例：受控 TS 编译方案的可行性审查

日期：2026-10-08。这里是规则资料核对与架构推演，没有编写实验代码，也没有声称已通过真实游戏兼容测试。所有 SDK 示例是建议接口。

## 结论

TS 规则函数 + 受控 await + 显式 context 可以承载下面的执行流程。但“把 async 编译成可保存状态机”不等于完整游戏框架；必须补足领域调度、延迟任务、对象身份和观察投影。signal/derived 只负责状态读取和纯派生，不能替游戏决定规则时机。

白名单是调用准入，不是游戏裁判，也不是隐藏信息证明。以下案例均不要求新增伤害/卡牌专属 opcode；新增的是用现有节点实现的游戏库协议。不存在原生 Promise、动态 eval 或宿主闭包例外。

## A. Maro：重算发生了，不代表现在能执行状态检查

规则依据：[Magic 综合规则 2026-09-25，704.4 示例](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.pdf)。Maro 在弃光手牌再抽七张的结算中会暂时为 0 防御，但该例最终存活。

设计推论：如果写成“防御 signal 为 0 就触发死亡 effect”，结算会错误。不能在每个 read/write、编译块或 await 后自动运行游戏状态检查。

```typescript
const resolveWheel = defineRule(async (g, player) => {
  await discardHand(g, player);
  await drawCards(g, player, 7);
});
```

外层万智牌调度器在正确规则边界调用状态检查与优先权流程。内部 await 可能只是子流程返回，甚至是结算途中必须回答的选择，并不开放自由出牌窗口。

应保存：当前结算对象、局部变量、未结算触发及游戏调度阶段；属于 game state/控制帧，不是宿主任务队列。

验收：纯属性可以显示中途值变化，但不能提前移走对象；在任一预算暂停处恢复，不增加额外规则检查。此案是防止 signal 被错误当成规则引擎的首要用例。

## B. 替换效果：事件尚未发生时反复选择与重算

规则依据：同一 [综合规则](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.pdf) 614.5、616.1：按规则选择适用替换，并在应用后重新判断候选。

建议作者写法（省略具体优先类别与多人次序，由游戏函数实现）：

```typescript
const resolveEvent = defineRule(async (g, initial) => {
  let pending = initial;
  let applied = emptyEffectSet();

  while (true) {
    const eligible = eligibleReplacements(g.read(world), pending, applied);
    if (eligible.length === 0) break;
    const selected = await chooseReplacement(g, pending, eligible);
    pending = await applyReplacement(g, selected, pending);
    applied = includeEffect(applied, selected);
  }

  return await commitEvent(g, pending);
});
```

设计推论：pending 与已应用记录必须跨 await 保存；候选不能在最初算一次后永久缓存。真正的多对象/派生事件还要保留事件沿革，示例集合不能代替完整规则实现。

验收：在两个不同选择分叉中，原始事件不能已经发生；每个分支重新计算候选，不能因为共享集合污染另一分支。不允许先发生伤害再用普通 catch 撤销。

## C. 同时牺牲：顺序收集选择，统一生效

规则依据：同一 [综合规则](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.pdf) 101.4 给出各玩家选择生物再同时牺牲的例子。

设计推论：普通 for 循环可以收集选择，但不能每选完一人就直接结算离场，更不能用 Promise.all 的完成顺序代替游戏顺序。

```typescript
const choices = await collectSacrifices(g, orderedPlayers);
await commitSimultaneousSacrifices(g, choices);
```

游戏库先计算共同事件，再发布新的世界根和事件批次；触发记录依据规则所需的前后世界事实。引擎预算暂停不是玩家观察边界。顺序内部实现不能暴露出一个游戏规则不存在的中间世界供玩家行动。

验收：玩家选择期间对象仍在原状态；实际离场属于同一领域事件；交换内部实现遍历顺序不应改变本应同时发生的结果。物理多线程不是必需能力。

## D. 延迟任务与重复执行：Dominion Throne Room + Merchant Ship

规则依据：[Rio Grande Games，Seaside 第二版规则](https://www.riograndegames.com/wp-content/uploads/2022/01/Seaside2nd.pdf)，官方搜索索引提供了该组合的说明：重复执行持续牌会影响本回合、后续收益及相关卡牌留场。PDF 直接读取失败，故此处仅采用可核实的官方索引内容，不声称已完整读取规则书。

更复杂的官方延伸：[Captain 的说明](https://www.riograndegames.com/games/dominion-captain-promo/)明确存在 Captain → Throne Room → Caravan 的间接留场关系。

设计推论：play(card) 不等于将一张新牌搬入场上；应区分实体、一次执行实例、未来任务和保留依赖。只把未来行为写成 await nextTurn 会阻塞当前调用者，无法自然地让原回合继续。

推荐将延迟行为注册为明确数据：

```typescript
await scheduleFuture(g, {
  rule: merchantShipNextTurn,
  args: { player, sourceInstance, playInstance },
  when: nextTurnStart(player),
});
```

scheduleFuture 是已编译的游戏调度流程，调用只等待登记完成，将已登记 RuleRef 和参数追加到 context 中的任务表；不新增通用 VM 时间概念，不保存 JS 回调。当前流程立即完成，未来调度器再调用该任务。留场依赖由 Dominion 游戏库维护。

验收：同一牌产生多个合法执行记录，未来收益次数正确；卡牌清理依据其待完成任务和依赖；在两回合之间分叉后各自任务只执行规定次数。白名单限制 RuleRef 的代码来源，不限制同一获准规则的运行期实例数量。

## E. 对象身份和读取时点：Banishing Light / Chainweb Aracnir

规则依据：[Theros Beyond Death 官方说明](https://magic.wizards.com/en/news/feature/theros-beyond-death-release-notes-2020-01-10)。Banishing Light 的提前离场与放逐返回有专门裁定；Chainweb Aracnir 离场后结算伤害会使用最后战场信息。

设计推论：不能只存 cardId 并在恢复时查当前卡牌；也不能让编译器把所有属性都冻结成开始执行时的值。游戏需要明确区分：

- 当前仍是该对象时，读取当前信息。
- 指定历史读取时点，读取保存的快照/最后已知信息。
- 对象换区后，使用新 generation 的领域身份。

实体引用至少需游戏层定义 instance/generation 关系；底层 Ref 只是内存引用，不自动等于游戏对象身份。规则库提供 readCurrent、readLastKnown 等明确操作，而非让编译器猜测。

验收：使来源在触发后改变属性、离场、重新进场，再分别恢复；不能引用到新对象或错误使用过早的属性快照。该案例不要求通用内核认识“离场”。

## F. 持续效果：依赖图不等于规则中的依赖关系

依据：[综合规则](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.pdf) 613，属性修改按规则层次、时间戳和规定的依赖处理。

设计推论：Solid 风格的“哪个 getter 读了哪个状态”只能用于缓存失效，不能直接替代游戏效果的先后关系。两种依赖含义不同。

正确框架：derived(() => evaluateCharacteristics(base, effects, ruleOrder))。evaluateCharacteristics 是白名单中的游戏纯计算，接受效果记录与规则版本；每次按游戏规则计算结果。缓存允许省略重算，不允许改变适用效果、排序或触发次数。

验收：相同世界在缓存全空、缓存命中、分叉后单边变化三种情况下结果一致。事件驱动写回最终属性不是默认方案，否则容易出现重算次数改变结果。

## G. 德州扑克：同一桌面最高下注，不同玩家的加注权不同

依据：[Poker TDA 官方论坛的累计短全押解释](https://www.pokertda.com/forum/index.php?topic=1287.60)。使用该公开历史规则解释作为固定用例，不将其标为已核对的 2026 全部赛事规则。

自构造数值例子：本轮最小完整下注/加注量为 100，A 下注 100，B 全押至 125，C 跟至 125，D 全押至 200，E 跟至 200。在该累计规则下，轮回 A 时面对累计增加 100，可以重新加注；若 A 仅跟至 200，C 面对增加 75，不能据此重新加注。

设计推论：仅保存 currentBet=200 不够，需要每个玩家上次行动金额及本轮完整加注尺度。派生合法动作是历史充分状态上的纯计算，不是最高下注数值的简单 getter。

边池与收益是另一个纯计算问题，可使用整数筹码与显式投入/资格记录，不依赖新的语言控制机制。

验收：在 A 与 C 的决策点，合法动作不同；保存恢复后不丢失玩家行动历史；合法动作编码不能由全局统一 raiseAllowed 标志决定。白名单纯函数需显式接收完整必要状态，不能靠模块变量补历史。

## H. Hanabi：可分叉 context 不能直接交给策略

依据：[Cocktail Games 官方 Hanabi 页面](https://www.cocktailgames.com/jeu/hanabi/)：玩家看不到自己的牌，通过队友提示协作。

设计推论：规则合法读取真实手牌不表示策略合法读取。白名单只说明函数获准执行，不能阻止一个获准函数把隐藏牌编码进 observation、候选排序或稳定卡牌 ID。

选择请求必须经玩家视角投影，候选可以用手牌位置等合法标识。策略历史保留其过去合法获得的信息，但不追加其他玩家私有日志。实体 opaque ID 不应泄漏牌面或生成顺序中的隐藏语义。

验收：对某玩家不可区分的两份世界，在相同可见历史下产生相同 observation 和动作协议；只改变当前不可见内容且保持该玩家历史知识一致时，不得导致策略输入变化。真正玩家搜索不能直接利用完整世界 fork 作为额外信息。

## 白名单在这些案例中的统一作用

- 编译模块、框架调用、游戏规则与计算入口均进入固定构建清单；未知运行时依赖拒绝。
- 延迟效果和复制效果保存获准 RuleRef+数据，而不是动态生成/导入代码。
- 牌型、持续效果、候选计算用获准纯函数，不新增内核业务指令。
- 白名单不证明时序、同时性或保密性；它保证这些规则不会绕开指定执行边界。

## 对方案的必要修订

1. 区分机器暂停、模型被要求选择、游戏规则检查和自由响应窗口；await 本身不决定后三者。
2. 游戏 toolkit 提供延迟任务和执行实例数据，不把整个未来行为悬挂在当前调用栈上。
3. 游戏 toolkit 定义待发生事件、同时事件批次、已发生事实、对象身份及历史读取。
4. derived 仅作为确定性纯计算/缓存；触发器必须由显式游戏调度负责。
5. 观察与动作协议作为独立导出边界验证。

这些不是新核心 opcode。九种节点仍足以组合，但游戏 SDK 必须把这些常见模式做成可复用、可测试接口，不能要求每张卡各自维护。首先以 A/B/D/E 的源码可读性及保存恢复语义评审；随后加入 C/F/G/H 的规则与信息验收。未完成这些验收前，不宣称已验证通用游戏支持。
