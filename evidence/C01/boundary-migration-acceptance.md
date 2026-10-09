> Historical acceptance evidence. Current requirements: convergence-acceptance.md.

# Core / Instance / BaseGame migration acceptance

User scope: replace the old boundary, preserve equivalent capabilities, migrate the complete Dou Dizhu author package, prove the declarations, and report exact fields and dataflow. Production execution and binding are accepted in C02/C03.

## Requirements and evidence

| ID | Required outcome | Verification / expected evidence |
| --- | --- | --- |
| B01 | Core is game-neutral; Instance owns complete execution continuation; all external functions use declared ports | Source audit of every contract declaration and dependency; public correlated port call/return type negatives |
| B02 | BaseGame owns game interaction conventions, not a second rules loop | Game adapter definitions and complete Dou Dizhu module; no concrete host runtime in game source |
| B03 | Schema/TS correspondence, finite typed registries, correlated keys and payloads, no protocol factories | npm run typecheck; npm run check:schemas; npm run check:boundaries; positive and negative protocol consumers |
| B04 | Execution, capture, save/restore, native differential authoring entry, compiled artifact association remain expressible | Field-by-field protocol reference and conditional trace/restore proof; declaration consumers. No runtime implementation claimed |
| B05 | Observation, exact/construct options, authoritative validation, game queries, multiplayer and explicit timeout remain expressible | Concrete Dou Dizhu projections and complete submission validation; caller-visible data checked for privacy; no generic context filter |
| B06 | Generic transition, resource release, hidden-state construction, evaluation, encoding, facts and history remain expressible | Generic capability consumers; no player/max/min assumption; reads available on same-type child games without advancing them |
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


Current player acceptance: [player-acceptance.md](player-acceptance.md).
