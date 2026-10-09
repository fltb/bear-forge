# F8: execution phases, capture cursors and resource laws

2026-10-09. C01 protocol definitions and finite/native witnesses only; goal remains active.

## Counterexamples and definitions repaired

- The native peer previously left its old waiting view visible while resume was in flight. close could cancel publication, leaving the original resume unresolved. Core now has conflict/execution_busy; Running rejects inspect/resume/close/save instead of publishing stale boundaries. The peer clears its view before resuming and closes only stable instances.
- A second request could overwrite the first reply continuation. The protocol now requires one serialized controlled effect chain and terminal fault on violation. The native peer detects effects outside Running and prevents a caught boundary fault from later becoming completed. Transitive static admission remains a separate obligation.
- Capture accepted an afterSequence beyond the current tail as a successful empty page. CaptureSequenceSchema/CaptureReadInputSchema now validate fixed coordinates, and the provider must reject a future cursor. Pages are immutable append-only prefixes, not speculative cursor advancement.
- Batch release had no declared duplicate, partial-failure or in-flight-read law. Game snapshot arrays now denote a set: validate all, then atomically release; empty is valid; duplicate entries collapse; foreign/released entries reject the entire batch. Subsequent reads reject released refs; already-acquired operations and independent children retain their state.
- Saved capture history now has an explicit law: restored instances retain the saved prefix and numbering without re-executing or re-emitting it. Live parent/child append streams are logically independent. Actual continuation/retention implementation remains C02.

## Proof arguments and bounds

Lifecycle: normal effects enter only Running; a waiting request uniquely owns its reply slot; resume clears that slot and the exposed boundary synchronously before running the continuation. In-flight external mutations cannot acquire the same instance. Completion/fault closes the effect path; close cannot strand an active resume because it refuses Running. This establishes the abstract operation ordering and the observed peer paths; it is not a proof of arbitrary native task cancellation or controlled source safety.

Pagination: at a read linearization point, let N be log length and a=-1 for null, otherwise 0<=a<N. The page is [a+1,min(N,a+1+limit)). A continuation cursor is the last returned sequence only when that read has remaining entries. Therefore page chaining partitions that finite prefix with no overlap or gaps. For polling, retaining the last actually received sequence covers subsequently appended entries; an empty page cannot move it. This relies on no eviction/rewrites before close, as now specified. Close ends capture-handle access; snapshots retain their independent prefix dependencies.

Batch release: let U be unique requested identities and L live identities. If U is not a subset of L, refuse and retain L. Otherwise return L\U. Empty U is identity; duplicate inputs leave U unchanged; no partial deletion occurs on validation failure. In-flight operations must acquire a stable state/lease before removal; memory management is left to the provider. The finite-state peer executes validation/deletion without an await boundary and clones its states, witnessing these laws for its representation.

## Evidence

npm run check: 86 runtime tests pass, no skips; type checks, Core/Game boundary checks and 53 schema profiles pass (execution-laws.log). Tests cover a deterministic host gate for close/resume races, duplicate requests, caught output faults, malformed/future pagination coordinates, append polling, detached pages, closed capture lifetime, batch duplicates/empty/foreign refs and child survival after parent/source release. The host-gated program intentionally is not admitted controlled source; it only schedules a service race.

The pinned Core source hash in the schema audit was refreshed after reviewing the changes: only error enum and fixed capture schemas changed; the existing min<max predicate is unchanged. The earlier full Core code matrix test initially failed because execution_busy was new; its allowed set was explicitly updated to the approved new conflict grammar. Tests do not certify a production Core or every existing fixture. Known read-target fixture errors now use GameError; complete arbitrary-argument fixture conformance remains outside its finite witness scope.

## Remaining work

Build a complete export-to-law/proof-obligation inventory so uncovered definitions cannot hide behind aggregate test counts. Review artifact/type provenance, schema/data domain precision, generic state construction/evaluation semantics and authoring adapter obligations. Full controlled admission, general continuation correctness, production loaders and full game-module migration remain unproved. No checkpoint is completed on the strength of this witness subset.
