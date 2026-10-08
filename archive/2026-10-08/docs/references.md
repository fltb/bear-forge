# 研究参考与适用边界

以下是讨论中已查阅的论文、作者项目与规则参考。它们支撑选型，不代表已在本项目复现。实施时需固定代码提交、依赖、许可证和规则版本。

| 工作 | 链接 | 借鉴内容 | 边界 |
| --- | --- | --- | --- |
| Decision Transformer 2021 | [论文](https://arxiv.org/abs/2106.01345) · [代码](https://github.com/kzl/decision-transformer) | 因果 Transformer 的轨迹建模 | 离线轨迹学习不自动提供在线探索或生态覆盖 |
| Multi-Game Decision Transformers 2022 | [作者介绍](https://research.google/pubs/multi-game-decision-transformers/) · [公开 notebook](https://github.com/google-research/google-research/blob/master/multi_game_dt/Multi_game_decision_transformers_public_colab.ipynb) | 同组权重跨多款游戏的实证与编码参考 | Atari 结果不证明任意卡牌与隐藏信息博弈通用性 |
| DouZero 2021 | [论文](https://arxiv.org/abs/2106.06135) · [代码](https://github.com/kwai/DouZero) | 斗地主组合动作、角色训练、采样和基准 | 非 Transformer，且是特定游戏系统 |
| PSRO 2017 | [论文](https://arxiv.org/abs/1711.00832) | 对手混合、近似响应、种群扩展 | 响应学习器能力限制仍然存在 |
| AlphaRank 2019 | [论文](https://arxiv.org/abs/1903.01373) · [实现文档](https://openspiel.readthedocs.io/en/latest/alpha_rank.html) | 从收益关系分析循环策略生态 | 评价对象是策略/策略组合，不能直接给卡牌做因果归因 |
| ReBeL 2020 | [论文](https://arxiv.org/abs/2007.13544) · [代码](https://github.com/facebookresearch/rebel) | 隐藏信息下的信念状态、搜索与学习 | 理论与实现范围需遵守，不能无条件推广到多人身份局 |
| AlphaStar 2019 | [作者介绍](https://deepmind.google/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/) · [代码](https://github.com/google-deepmind/alphastar) | 联盟训练、历史策略、针对性挑战 | 不照搬专用网络，不假设仓库等于完整论文训练环境 |
| OpenSpiel | [论文](https://arxiv.org/abs/1908.09453) · [文档](https://openspiel.readthedocs.io/en/latest/index.html) | 小游戏校准、游戏接口、算法和评测 | 接在自有演算机旁作为对照，而非替换 DSL 执行底座 |
| Magic 综合规则与 Forge | [官方入口](https://magic.wizards.com/en/rules) · [Forge](https://github.com/Card-Forge/forge) | 规则裁定与独立实现对照 | 固定赛制、卡池和规则版本；引擎也可能有缺陷 |
| Slay the Spire CommunicationMod | [代码与协议](https://github.com/ForgottenArbiter/CommunicationMod) | 真实游戏的状态与决策接入参考 | 客户端适配器，不是独立可分叉模拟器 |

## 当前采用的分工

标准 Transformer 是模型基底；DT/MGDT 是序列表示参考，不强制使用其训练目标。PSRO 和 AlphaStar 提供探索组织方法；AlphaRank 提供策略生态分析参考；ReBeL 提醒隐藏信息搜索的正确边界。没有任何一项工作替代本项目的规则验证、完整 context 语义或设计实验契约。

## 策略生成与设计评估系统对照（2026-10-08）

以下基于官方仓库、作者页面与论文摘要核查，未在本地安装、性能复现或完成源码级审计。不声称任何项目开箱覆盖完整需求。

| 系统 | 一手资料 | 可借鉴部分 | 适用边界 |
| --- | --- | --- | --- |
| RLCard | [仓库](https://github.com/datamllab/rlcard) · [接入文档](https://rlcard.org/development.html) | 环境与 Agent 分离，随机、规则和学习策略接入 | 不是通用机制设计分析器；结构化动作仍需本项目适配 |
| OpenSpiel | [仓库](https://github.com/google-deepmind/open_spiel) | 多种博弈环境、搜索/学习与评估框架 | 算法各有适用前提，不自动接入自有 TS 运行时 |
| EvoStone | [仓库](https://github.com/tehqin/EvoStone) | SabberStone 对局评估与策略搜索分离；MAP-Elites、CMA-ME；行为维度归档 | 特定炉石规则与 .NET 实验实现，原配置面向 HPC，不能照搬成本 |
| 炉石行为空间映射 | [论文](https://arxiv.org/abs/1904.10656) | 沿行为维度寻找不同的强策略，而非只选单一最高分 | 归档维度决定能看见的多样性，不证明探索完备 |
| Evolving the Hearthstone Meta | [论文](https://arxiv.org/abs/1907.01623) | 以模拟与进化搜索研究卡牌属性修改 | 论文的向 50% 胜率优化目标，不等于本项目保留关系图与多样性的设计目标 |
| Digital Red Queen | [作者介绍与代码入口](https://sakana.ai/drq/) | LLM 生成程序并挑战增长的历史对手，外部对手评估 | Core War 而非卡牌；作者观察到行为趋同，不保证多个 Agent 自动提供多样性 |
| ShinkaEvolve | [仓库](https://github.com/SakanaAI/ShinkaEvolve) | 程序种群、LLM 修改、候选评估与迭代基础设施 | 通用程序进化，游戏对战、关系证据及预算适配需要另接 |
| GAVEL / Ludii | [论文](https://arxiv.org/abs/2407.09388) · [代码](https://github.com/gdrtodd/gavel) | 用语言模型和进化操作生成/修改游戏规则 | 以 Ludii 游戏描述为基础，不证明任意复杂卡牌规则与自有 core 兼容 |

优先阅读顺序：EvoStone 的评估/搜索边界 → Digital Red Queen 的历史对手循环 → OpenSpiel/RLCard 的环境协议。ShinkaEvolve 可作为候选生成编排的复用候选，先核对接口和成本；不为借鉴上层算法改变已选 core。

## 对照后尚缺的执行决策

1. 策略候选包：脚本/权重、构筑或局内构筑策略、父版本、可修改区域、失败状态与费用血缘。
2. 种群保留规则：固定锚点、独特克制、行为差异、历史威胁；不只按总体胜率淘汰。
3. 预算调度：先低成本筛查、再独立确认；座次/角色和种子控制；有限预算优先补哪些不确定关系。
4. 设计目标：期望哪些多样性、对局长度和先手差等，哪些范围由游戏设计者给定；关系图不自行决定何为好设计。
5. 归因协议：策略收益矩阵是直接结果，卡牌替代/协同结论需条件分层与干预，不能从胜者卡牌频次直接推出。

这些属于策略探索与设计评价，不是重新引入规则实现正确性验证。现有文档已有职责轮廓，上述仍缺具体选择规则、schema 与停止标准。
