# Public-definition coverage and F9 artifact association

2026-10-09. Scope is the actual root exports of packages/contracts/src/index.ts. The inventory covers 103 definitions in 15 law groups. It is not an assertion that all definitions are proved.

## Coverage method

check_protocol_coverage.ts asks the TypeScript module checker for every root export, resolves aliases, checks its defining source, and compares the exact export set with protocol-proof-index.json. All transitively loaded local contract source hashes are checked, including private helpers and the root barrel. Every export needs a named law with an explicit claim, assumptions, argument, evidence and remaining obligations. Missing/extra/duplicate/uncovered exports, unknown laws, stale sources, missing evidence and invented completion statuses have negative checks. Source changes require review; the normal check never rewrites the inventory.

The gate proves coverage of the declared export set and registration freshness only. It cannot establish that a written proof is true, that a test exercises the stated law, or that a provider implements it. All 15 groups currently retain outstanding obligations. An all-green inventory gate must not close the goal or C01.

## Arguments by law group

| ID | Argument and boundary |
| --- | --- |
| identity | Branded UUID schemas separate static reference namespaces and strict envelopes. UUID syntax cannot establish service ownership, uniqueness or liveness; those are provider premises. |
| failure | Disjoint kind/state literals partition error payloads. The exhaustive Core-to-Game mapping preserves class and marks execution faults unavailable. See game-failures-review.md; arbitrary providers still need evidence. |
| execution | Given serialized effects, each accepted resume consumes exactly one pending request and returns one complete boundary or faults. Running cannot be mistaken for Waiting. See execution-laws-review.md; source admission and real continuations remain open. |
| capture | For fixed append-only prefix length N and cursor a, pages are intervals [a+1,min(N,a+1+limit)). Chaining partitions the prefix. See execution-laws-review.md; restoration/retention are production obligations. |
| state | ReadView recursively removes writable field access but does not prove ownership or runtime immutability. ManagedState declares the necessary port; actual initialization, data-domain and alias laws remain open. |
| random | Safe integer input bounds establish a nonempty integer interval, not a distribution. Explicit seed/state can express deterministic replay; the algorithm and seed interpretation remain unselected and unproved. |
| schema | Copy/parse/equality-gate construction proves successful value preservation under genuine admitted constructors and fixed pure checks. See strict-repair-review.md. It is not an arbitrary-JS sandbox proof. |
| inputs | exact/construct is a disjoint structural union; membership/exhaustiveness is a domain law, not entailed by array shape. Context-relative completeness and construct consumer agreement still need formal review. |
| registry | The union of whole tagged arguments excludes cross-key pairings. A fixed finite required-string-key table retains its keys under derivation. F5 additionally rejects whole-table unions. See strict-repair-review.md and proof-continuation-review.md. |
| queries | Correlated call objects preserve input/result association, while GameReadTarget closes the path over simulation children. Waiting-only operations stop at terminal base cases. Purity/authorization remain provider/admission premises. |
| game | Substituting concrete data slots yields game-neutral waiting/ended boundaries and independent optional simulation/persistence. Conditional search closure and actual reference-game tests are evidence; not general provider correctness. |
| neutral | The signatures do not mandate players or scalar rewards. That is a syntactic boundary fact. Construction result ownership, semantics of config/source/entropy, determinism, encoding/fact laws are not proved by these signatures and remain open. |
| author | Schemas and mapped handler tables define one author module; the run context has explicit effect ports. Handler purity and all reachable closure state still require controlled admission. No proof of arbitrary TS validity follows. |
| mapping | Assuming compliant Core, admission and binding, initialization and each accepted/rejected step have corresponding Game packets; induction gives matching finite successful traces plus distinct faults. Premises remain independent obligations. |
| artifacts | F9 invariant witness closes implicit type reassociation. It does not prove that content bytes implement the witnessed type. Loading/deserialization and code/schema provenance remain open. |

## F9 concrete counterexample

The original CompiledGame witness was readonly {game:G;queries:Q}. Under TS covariance, CompiledGame<{setup:1;...},{}> could be assigned to CompiledGame<{setup:number;...},{}>. The latter promises that create accepts 2 even though the actual artifact only accepts 1. artifact-before.ts and artifact-before.log retain the pre-fix successful compilation, without any or assertions.

The witness is now a function-property type (x:{game:G;queries:Q})=>{game:G;queries:Q}. Under strictFunctionTypes, assignment requires both contravariant input compatibility and covariant output compatibility. Thus implicit widening or narrowing of the witnessed contracts is rejected. It is a type-only phantom property, not an executable function serialized inside an artifact. Schemas remain data definitions; no factory was added. Normal inferred loader calls retain their exact game type. This is structural TypeScript invariance, not nominal game identity or protection against any/casts.

## Remaining completion work

The index explicitly retains 15 open groups. State/data-domain laws, random algorithm semantics, exact/context agreement and generic adapters need further protocol analysis; artifact creation/load provenance needs a usable specified path. Controlled source checking, production snapshots/loaders, native/controlled equivalence and full game migration remain unimplemented. The current result does not justify marking the goal complete.
