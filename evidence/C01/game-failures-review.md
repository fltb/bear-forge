# F7: Game failures and target lifecycle

2026-10-09. Protocol definition repair plus real reference-adapter evidence. C01 remains in_progress; production Core/compiler/loader is not implemented or certified here.

## Fixed definitions

GameErrorSchema/GameError define plain Promise rejection data. Non-fault kinds are rejected/conflict/unsupported with closed codes and no state field. Faults have state=unchanged or unavailable. execution_uncertain and game_faulted are allowed only with unavailable. Unknown exceptions cannot be interpreted as no-progress receipts. TypeScript Promise has no checked rejection parameter; this is an explicit schema/behavioral contract, not a typed-throws claim.

The protocol now specifies Ready(waiting/ended), Busy, Unavailable and Closed service states. These do not add game rules to Core or fault outcomes to domain results. Pre-acceptance refusal preserves the target; accepted execution failure quarantines it without publishing a successful GameUpdate. Pure read failure can leave the target unchanged. Cleanup remains possible and serializes with advance. Earlier independent snapshots remain valid.

## Proof arguments

1. Error partition: the top discriminant kind has disjoint literals; fault subcases have disjoint state literals. Each allowed kind/state has an explicit code set. Therefore parsing cannot ambiguously classify one payload as both no-progress refusal and unavailable fault. Strict object shapes reject an extra state field on a refusal. This proves grammar partition, not truthful behavior of an arbitrary provider.
2. Core mapping: fromCore is total over the CoreError union. Each non-fault branch preserves kind, maps execution identity codes to Game names, and supplies no state. Each fault maps to unavailable. Boundary faults follow the same mapping. Thus the binding has a constructible error path for every declared Core failure; no failure needs to masquerade as ended.
3. Reference adapter lifecycle: entry.busy is set synchronously before awaiting resume or close, and reset in finally. Every read/advance checks the flag. Known non-fault resume failures do not replace the saved frame. After a successful Core resume, the entry is marked failed until output and execution identity are checked; thrown/outer/boundary faults also mark it failed. Normal access to failed entries rejects; close uses the retained binding and can release it. Hence the inspected adapter code has no path that publishes a normal update from those failure branches.
4. Unknown transport outcomes cannot be solved by a returned type. The binding converts observed host exceptions (including synchronous throws) to execution_uncertain/unavailable. Missing create handles remain a lower provider cleanup obligation, explicitly documented rather than hidden by a rollback claim.

## Evidence

npm run check passes 79 runtime tests, static positives/negatives, dependency boundary checks and 51 schema profiles (game-failures.log). New cases cover closed error combinations, every Core error mapping, outer fault, boundary fault, malformed output, asynchronous/synchronous host exceptions, different execution identity, close/advance exclusion, retry after uncertain cleanup, and already-missing Core cleanup. Existing complete-game/oracle tests still pass. No benchmark or version increase.

## Still open

This establishes the failure data grammar and an executable binding for the inspected reference adapter. It does not certify every test witness, future provider, arbitrary TS program, or complete protocol set. Existing finite-state fixtures must adopt the same public error carrier before being used as error-conformance evidence. Full export-by-export coverage, non-reentrant request rules, capture cursor/lifecycle semantics, snapshot batch/resource laws, author admission, loaded artifacts and actual continuation equivalence still require review. C01-03/05 and C02 are not closed.
