# Whole-protocol proof continuation

2026-10-09. Goal remains active; C01 remains in_progress. This report adds evidence, not a claim of universal protocol correctness.

## F5: union registry erasure

Before repair, the public schema entry accepted interactions = {left: Entry} | {right: Entry}. Yet InteractionRequest<interactions> was never: keyof a union exposes only common keys. This is a counterexample to the earlier unconditional claim that every accepted finite table has the same keys as its request mapping. Source: union-table-before.ts; actual successful compiler output: union-table-before.log. This retained source is historical and excluded from current positive compilation.

Repair: FiniteTableGuard rejects whole-table unions before evaluating key restrictions. IsUnion distributes over constituents while retaining the whole type; if a constituent cannot contain the whole type, the registry is not one fixed table and the guard is never. FiniteStringKeys then propagates rejection to all derived call unions. Fields within a single table may still have union values. Empty registries remain valid.

Evidence: strict-types.ts rejects disjoint and overlapping registries, asserts that query calls, LoadedGame and CompiledGame reject them, and checks numeric/string pattern indexes. Positive cases retain finite template expansion, Unicode keys, empty tables and union-valued fields. No any/assertion is used to construct the counterexample. This is a proof about the declared admitted table domain, not a soundness theorem for all TypeScript.

## F6: terminal search preconditions

The earlier phrase "all valid snapshots support describe/validate" omitted waiting-boundary preconditions. A terminal snapshot has no BoundaryId or next action. The corrected law is: all owned live snapshots resolve through the same read target; queries and inspect accept terminal states, while describe/validate/transition reject terminal use. Closure induction applies at waiting nodes; terminal nodes are base cases that end expansion.

Evidence: search-closure.test.ts exercises all eight terminal leaves in the existing three-level tree: queries succeed, describe/validate/transition fail, and inspection remains unchanged. This tests a finite-state witness, not a production continuation implementation.

## F7: failure/rollback contradiction (open)

The earlier unqualified "advance rejection never changes state" conflicts with Core fault after accepting a reply. Clarified semantic requirement: pre-acceptance refusal preserves the boundary; post-acceptance failure quarantines the execution, emits no successful update, and does not promise rollback. Old independent snapshots remain usable. A rejected Promise alone is not a no-progress receipt.

Still missing: a stable public Game call failure carrier that distinguishes refusal/conflict from execution faults, plus mapping for Core outer fault versus fault boundary and unknown transport outcomes. This round does not label F7 closed or claim that the documentation clarification is an implementation proof.

## Remaining proof obligations (not exhaustive certification)

- Complete export-by-export specification and requirement trace; this list is not a replacement for checking all exports.
- Game failure classification and post-fault lifecycle, including reads and resource cleanup.
- Exactly one pending request; semantic contract for unawaited requests/concurrent effects and author-code admission.
- Atomic validation/consumption, immutable read views, capture ordering/cursor lifetime, resource batch failure semantics.
- Exact-input soundness/completeness relative to context and validation; construct interpreter agreement belongs to each game/caller.
- Schema profile premises and transitive controlled admission; TypeScript alone does not establish safety.
- Loader provenance/type association, Core/Game binding and native/controlled equivalence.
- Snapshot continuation/alias/random isolation and version compatibility; production implementation remains C02.
- Full game-module migration and all pending C01 items remain open.

## Verification

npm run check: current type positives/negatives, 71 runtime tests, boundary checks and 50 schema profiles pass (proof-continuation.log). Tests support the named properties only. Version remains 0.3.0. No production loader/compiler, benchmark or alternate game interface introduced.
