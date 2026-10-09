# Core / Instance / BaseGame migration acceptance

User scope: replace the old boundary, preserve equivalent capabilities, migrate the complete Dou Dizhu author package, prove the declarations, and report exact fields and dataflow. No compatibility exports or production runtime implementation.

## Requirements and evidence

| ID | Required outcome | Verification / expected evidence |
| --- | --- | --- |
| B01 | Core is game-neutral; Instance owns complete execution continuation; all external functions use declared ports | Source audit of every contract declaration and dependency; public correlated port call/return type negatives |
| B02 | BaseGame owns game interaction conventions, not a second rules loop | Game adapter definitions and complete Dou Dizhu module; no concrete host runtime in game source |
| B03 | Schema/TS correspondence, finite typed registries, correlated keys and payloads, no protocol factories | npm run typecheck; npm run check:schemas; npm run check:boundaries; positive and negative protocol consumers |
| B04 | Execution, capture, save/restore, native differential authoring entry, compiled artifact association remain expressible | Field-by-field protocol reference and conditional trace/restore proof; declaration consumers. No runtime implementation claimed |
| B05 | Observation, exact/construct options, authoritative validation, game queries, multiplayer and explicit timeout remain expressible | Concrete Dou Dizhu projections and complete submission validation; caller-visible data checked for privacy; no generic context filter |
| B06 | Generic transition, resource release, hidden-state construction, evaluation, encoding, facts and history remain expressible | Generic capability consumers; no player/max/min assumption; reads available on child snapshots without advancing them |
| B07 | Dou Dizhu actual rule program and SDK use only new public author contracts | npm test: complete games, all rule families, independently checked legal plays, timeout/redeal/doubling/scoring/invalid inputs; no private execution API |
| B08 | All effective documentation and contract/test entrypoints use the new boundary | Source/doc inventory, no compatibility aliases; historical evidence explicitly historical, not normative |
| B09 | Final report contains every public data/type field, ownership, direction and original-function mapping | evidence/C01/boundary-migration-review.md plus chat report; exported-symbol inventory cross-check |
| B10 | Evidence matches real files and checks | npm run check; python3 tools/check_project.py; python3 tools/check_project.py --self-test; actual logs and artifact hashes |

## Preservation baseline

Retain Dou Dizhu setup/rule profile, complete bidding/dealing/redeal/doubling/redoubling/playing/scoring loop, all pattern variants, canonical action encoding, per-seat observations, private simultaneous choices, explicit time events, rejection behavior and full-game fixtures. Replace the binding mechanics, not the independent rule coverage.

Existing full Input envelopes include actor/stage/slot/time. Existing exact lists contain Action only. Migration must explicitly separate decision payload from delivery metadata and session events, or provide a complete representation; it must not call an Action list an exhaustive list of the larger Input envelope. This is a required design check, not permission to weaken exact.

## Proof obligations

P1 internal computation + declared external call is trace-expressive under a semantics-preserving executor.
P2 BaseGame advancement is a segment of the actual Instance trace, not a second state transition implementation.
P3 all read handlers operate on explicitly published immutable boundary data; no arbitrary stack inspection.
P4 game restore captures Instance and necessary owned service state; siblings isolate mutable state and resource identity.
P5 identical explicit inputs/services produce identical game behavior independent of human/script/model origin.
P6 neutral state transitions support algorithm-owned DFS/alpha-beta/MCTS; legal input construction and evaluation remain game/caller-owned.
P7 type/schema structural checks are distinguished from semantic runtime obligations; no claim that arbitrary TS passing typecheck is controlled.

Initial check: python3 tools/check_project.py failed on five stale artifact entries left by the prior interrupted correction. This is recorded, not treated as passed. Reports will be regenerated only after the new authoritative files and relevant checks exist.

## BaseGame branching convergence (current request)

- One BaseGame facade keeps inspect/observe/describe/validate/query and bind/run/close; no separate reader or search service layer.
- Replace game persistence/simulation and loaded-game wrappers with optional branching.save/step/restore/release directly on BaseGame. No compatibility aliases.
- All reads accept current/snapshot; child reads require neither restore nor duplicate inspect. Parent and current instance remain unchanged by step. restore returns an independent BaseGame.
- Factory returns game and initial update directly. Keep Core persistence/capture and neutral upper-level capabilities.
- Verification: npm run check (type consumers include direct play without branching, concrete Dou Dizhu branch/read/restore, DFS and shared search operation types; negative consumers reject removed methods and wrong inputs); python3 evidence/C01/verify-migration.py; python3 tools/check_project.py and --self-test.
- Preserve all rule files and native tests. Update authoritative protocol, architecture, field report and proof index; no runtime implementation or project numbering.

Convergence start audit found stale hashes for docs/plan.md and this acceptance file from the reopened checkpoint; final reports are refreshed after verification. npm check passed after declaration/consumer migration. No production runtime was added.

## Two-sided game contract and single Instance state (current request)

- Instance owns all continuation-relevant mutable state, including inner SDK/service locals. No outer game snapshot composition.
- Instance fork returns same Instance type; BaseGame fork returns same BaseGame type. Save/restore use only InstanceSnapshot and underlying persistence provider.
- BaseGame binds an existing Instance and a pure GameContract. All ordinary reads target that bound Instance. Remove Branching, GameSnapshot, GameReadTarget, GameFactory and outer ServiceModule ownership.
- GameModule separates program from shared GameContract; inner GameSDK uses declared ports. Dou Dizhu inner SDK owns deterministic random state, outer projections remain pure. Preserve rule/pattern/oracle files unchanged and complete native game tests.
- Record proof of state closure, projection consistency, fork bisimulation up to identity, search interface closure and native/controlled equivalence; state implementation assumptions explicitly.
- Acceptance: npm run check; concrete positive/negative type consumers for bind/fork/save/restore/search; full native games, seed isolation, inner-port consumption; migration audit; document/evidence integrity and negative self-test. No production interpreter, compiler or fork implementation.

Current two-sided migration verification: 56 native/schema tests, 39 admitted schemas, 80 public definitions with conditional law coverage, type consumers and boundary audit passed. Previous branching convergence is superseded by the latest section; its old operations are forbidden exports in the migration audit. Production continuation execution remains outside this declaration task.

## Complete inner/outer control protocol and publish (current request)

- Specify Instance bind/run, correlated callbacks, explicit reply/pause, one run entrypoint, limits/cancellation, callback errors, lease/late-return rules, and unbound fork/restore.
- Specify BaseGame callback binding/run, typed decision offers (actor-visible observations and options), event delivery identity, callback-only advancement, event/decision/terminal boundaries and multiplayer routing. BaseGame adapts Instance callbacks without a second executor.
- Preserve internal IO/GameSDK and single Instance state. Update types, fixed schemas, pure game contract, all consumers and proofs. Protocol phase only; no production driver.
- Validate positive and negative type consumers for raw Instance callbacks, game callbacks and manual/search use, complete native Dou Dizhu and explicit emitted-event SDK use.
- Acceptance commands: npm run check; python3 evidence/C01/verify-migration.py; python3 tools/check_project.py and --self-test; git diff --check. Update proof inventory/field appendix and all active documents.
- Finally commit the reviewed project worktree, push to fltb/bear-forge without force, and verify remote branch commit equals local HEAD.

Historical callback/control verification before removal: npm run check passed (57 tests, 44 schemas, 101 public definitions); full field/source correspondence and unchanged rule baseline audit passed. Public transfer supplies the ownership primitive required by BaseGameBinder. Commit/push verification is reported from actual Git results after these checks.

## 删除重复的 BaseGame 推进入口

- `npm run check`：公共类型不再提供 submit/GameUpdate；binder 直接返回 GameHandle；搜索消费者使用 bind/run(maxInputs:1)，负向类型检查拒绝 submit。现有游戏/schema 测试全部通过。
- `node evidence/C01/freeze-audit/check.mjs`：检查当前声明与规范无第二条游戏推进/批量事件返回路径；捕捉闭合由后续本文件的清理验收项验证。
- `python3 evidence/C01/verify-migration.py` 与 `python3 tools/check_project.py`：公共声明附录、证据与账本一致。不启动生产运行器实现。

## 清除剩余混合边界与冻结审核

- `npm run check`：Instance 无第二推进入口；decision/terminal 不携带事件；事件身份仅来自 event 调用；capture 在 transfer 后仍可按实例身份读取，close 与记录释放分离。正向消费者和负向类型/schema 检查覆盖这些边界。
- `node evidence/C01/freeze-audit/check.mjs`：检查唯一入口、事件来源、捕捉接线的实际声明，不能以文字自称修复。
- 逐项审核协议操作、生命周期、错误、作者契约与 R03–R08 接线；冻结需有限需求集合上的构造证明和状态转换覆盖，生产实现义务独立列出。不能把类型通过当作任意程序正确性证明。
