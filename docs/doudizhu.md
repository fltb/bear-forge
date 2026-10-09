# 斗地主：规则配置与接口验证

游戏包使用声明端口与 GameModule；原生测试通过逐玩家回调执行真实规则程序。生产执行、驱动与保存由 C02/C03 验收。

规则基准：[《竞技二打一扑克竞赛规则》2016 年 2 月，国家体育总局棋牌运动管理中心署名，全文镜像](https://www.pagat.com/docs/landlord412005.doc)。[总局发布说明](https://www.sport.gov.cn/n20001280/n20067662/n20067613/c22917445/content.html)。实现单副牌第五至十一条、术语与附录一记分；多人赛事 MP、瑞士移位和赛事组织不属于单副牌规则。配置 ID：competitive-2016-bear-1。

## 固定解释

1. 54 张牌，按座位 0→1→2 代表逆时针方向。每人17张，底牌3张。首叫由 setup 显式指定；全不叫重新洗牌且首叫顺移一位。这是首叫安排的明确比赛配置。
2. 叫分仅一轮，每人最多一次；叫3立即结束。确定地主后农民同时决定加倍，结果在两人都完成后公开；地主在有人加倍时决定再加倍。加倍阶段结束前底牌对所有人隐藏，之后公开且归地主。
3. 每个输入限时25000游戏毫秒；到达截止点采用 timeoutFirst。叫分超时不叫，加倍/再加倍超时不加倍；出牌超时引牌出最小单张，跟牌过牌。农民加倍默认不加倍及恰好截止点的顺序是明确的宿主规则补充。
4. 翅膀可有重复单牌（书中有一对作两翼的示例），不可包含机身点数、双王同时、四张同点数、在3至A序列中与机身相邻的完整三张；对子翼必须来自不同点数。四带两单允许一对，禁止双王同时；四带两对不能拿炸弹当两个对子。这些歧义按附例和限制统一解释，不作为对所有斗地主变体的断言。
5. 同一牌张组合可能有多个合法机身解释；动作显式声明牌型、机身高点与长度，校验其合法解释，避免比较时猜测。
6. 再加倍仅作用于选择加倍的农民，按附录一算例：叫3，一炸一火箭且反春，仅农民1加倍且地主再加倍，得分为农民1 +96、农民2 +24、地主 -120。正文个别措辞与示例有歧义，本配置以该算例为准。
7. 花色无比较意义，动作使用点数多重集；不因不同花色制造策略上重复的动作。牌库用54个物理牌ID发牌，手牌逻辑使用点数，保持各点数总数守恒。
8. 余牌张数、已出牌、叫分及揭示后的加倍结果公开；手牌仅本人可见，底牌仅在公开后可见。书中少于两张的提醒额外生成公开事件。终局不额外揭示未出的私有手牌。

## 公共契约消费

program.ts 是唯一完整循环，类型 Program<ProgramSetup,DouDizhuPorts,Frame>。ProgramSetup={game:Setup,seed:uint32}。程序内部创建 SDK，随机状态在 SDK 闭包内驱动洗牌；decision 端口发布 Frame 并等待 Input；event 端口发布尚未交付的 AuditEvent[] 并等待 null 确认。published 在事件确认后推进，决策/终局 Frame.events 清空以避免重复发布。局部 state 与 published 位于程序现场，完整恢复由 Instance 的实现承担。

implementation.ts 导出 GameModule={program,contract} 声明 game。decision.receive 从 Frame 投影 view/choices/signalPlayers；respond(view,input,player) 检查该玩家对应的 slot，使用同一 validateInput 规则检查并编码 Input。finish 从 state.result 提取唯一终局结果。

## 字段与数据流

- setup：profile/firstBidder/initialGameTime。
- ports.event：AuditEvent[] → null，角色 event；确认接收不等待动画。
- seed：显式程序启动参数；伪随机流由受控 SDK 局部持有。
- ports.decision：Frame{state,events} → Input，角色 decision。
- view：Frame，只供可信游戏适配处理器读取。
- interaction action：request 为 Slot，input 为 Action，description 为 never，options 只能 exact。
- choice.id=slot.slotId，actor=slot.actor，type='action'，request=slot。
- delivery：{receivedAtGameTime}，由会话提供可信接收时间。
- signal：{kind:'host',inputType:'timeout',gameTime,payload:{slotId}}。respond 从当前 stage 补出内部 boundaryKey；外部请求由 decisionId 定位。
- player：Seat；playerFor(actor)=actor；observation：{observation,events}。
- event：AuditEvent{audience,event}；playerEvent：Event；projectEvent 按 audience 返回 {event} 或 null；result：Result。

模型/玩家只选择 Action。BaseGame 提交为 choice{choiceId,input:{type:'action',value:Action},delivery}。respond 根据当前真实 slot 补出 actor/stageId/slotId，与接收时间组合为程序 Input。超时经 signal 转成程序的 host Input。两者共用 validateInput 和 apply。

农民同时加倍表现为同一 decision 下两个 choices。接受其中一个后，剩余 choiceId 保持；游戏边界身份更新，已有玩家绑定接收新的请求。其他农民的私有加倍事件不进入其观察。

## 数据与隐私

Frame 含完整领域状态。observe 返回本人手牌、公开信息及该席位可见事件；终局延续相同可见性规则。GameContract.projectEvent 统一用于观察中的历史和主动事件交付，玩家回调收到 Event。三个席位可绑定同一函数，通过 control.player 区分所属玩家。

describe 当前 choice 得到完整 Action 列表。时间和会话信号使用各自输入字段。动作顺序为叫分升序、布尔 false/true、出牌先过牌再按牌型/高点/长度/排序点数串。该顺序仅规定枚举顺序。Play.cards 为非降序点数，多重集对应唯一编码；pattern 保留每种合法牌型解释。客户端需提交规范编码，不由 schema 静默重排。

## 验收追踪

| 条款 | 实现 | 验收 |
| --- | --- | --- |
| 第5条 | sdk、program | 54张守恒、17/17/17+3、底牌公开时点 |
| 第6条 | rules、program | 单轮叫分、叫3、全不叫重发、独立农民加倍、再加倍 |
| 第7条 | rules | 顺序、过牌、重新引牌、报单、各阶段超时 |
| 第8/9条 | patterns | 全部牌型、比较、动作生成与独立子集核对 |
| 第10/11条、附录一 | settle | 胜负、春天反春、逐玩家得分、零和与附录算例 |
| 协议 | GameModule、IO、纯处理器 | 三席位完整对局、隐私、非法/到期输入、完整动作列表、输入转换、隔离的原生对局 |

运行 `npm run check`。原生消费者以公共 IO、GameContract 和 GameBindings 驱动完整程序，覆盖逐玩家正常出牌、超时、私有事件、跨玩家拒绝。独立规则 oracle 核对合法动作；保存、执行生命周期与生产绑定器由 C02/C03 验收。
