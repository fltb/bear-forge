# C00 验收绑定

- C00-01：python3 tools/audit_c00.py，检查归档 manifest 的 22 份原文哈希全部相同；归档原始清单另见 archive.log。
- C00-02：python3 tools/audit_c00.py 与 python3 tools/check_project.py，检查有效文件、链接、需求/关卡 ID、清单和状态。语义核对记录在 review.md，工具不替代语义审阅。
- C00-03：python3 tools/check_project.py --self-test，8 类错误状态必须被拒绝；python3 tools/check_project.py 验证最终状态证据一致。

临时副本先构建待验收完成态，运行负向测试；测试通过后才将实际账本标 done，再核验真实目录。不在实际账本先假设测试通过。

本轮 C00-02 追加语义审阅：architecture.md 包含模块图、拟建代码树、P1–P7 公共协议、15 个场景映射及跨模块接缝；requirements/plan 不再固定旧解释器候选。此为文档验收，不运行引擎或 bench。
