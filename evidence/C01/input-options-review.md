# 输入选项清理报告

公共输入选项统一为 InputOptions<I,D>：exact 携带完整 values，construct 携带具体游戏定义的 JSON description。公共层只验证外形，不解释描述或执行函数；Game 上层调用方使用游戏约定。斗地主仅实现 exact，校验仍保留。

删除旧的三个独立辅助查询接口、能力枚举项、状态 schema、斗地主分页参数/游标/熵/前缀模板、实现分支和对应旧消费者。无兼容别名。不存在落盘的通用 ConstructionRule 或 filtered/constructive 机制需要保留。有效文档同步改为新边界。

保留 Core 随机能力、搜索 StateTransition/StateConstruction 等无关能力，避免把“输入构造描述”和“构造模拟状态”混淆。保留独立牌型 oracle 与全部游戏规则测试。历史证据与 archive 不作为有效协议，未删除历史记录。

npm run check：53 项测试全部通过，类型和源码边界检查通过。新增验证覆盖 exact/construct JSON 和具体模板、描述不允许函数、上层独立解释描述、斗地主仅接受 exact、完整叫分选项、出牌选项合法性、引牌单张覆盖及返回值隔离。已有独立子集 oracle 持续检查牌型生成。

本轮没有实施编译器、runtime 或受控恢复，也未把旧 Game 适配器宣称成完成的作者 SDK 迁移。C01-03/05 保持 pending。
