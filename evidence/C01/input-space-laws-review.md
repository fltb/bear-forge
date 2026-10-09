# Correction following user challenge

The user questioned the origin of context in the Scope formula. context existed as a field, but the assistant introduced its universal set-filtering semantics. That generic interpretation and its claimed completion are withdrawn. The finite context-partition tests remain evidence only for their own example, not generic exact completeness. The canonical card encoding counterexample/fix remains independently valid. The text below is the prior reasoning retained for audit, not the current accepted protocol.

# F10: exact scopes and canonical input encoding

2026-10-09. Protocol semantics plus a real game representation counterexample. Goal/C01 remain active.

## Formal definition

For a fixed complete waiting boundary b and contract k, A_k is the set accepted by the input schema and L(b,k) is the subset accepted by the authoritative context-free handler validation. The game declares Scope(b,k,c) for each supported query context. An exact reply must have set(values)=L(b,k) intersect Scope(b,k,c), with complete payloads, no duplicate values and stable ordering for equal canonical contexts at the same saved boundary. Scope is a mathematical game convention, not a new public predicate, constructor or interpreter.

Soundness follows from set inclusion. Completeness follows from equality. If contexts cover L, the union of their exact sets equals L; a restricted context does not certify global exploration. Empty exact is allowed for an empty valid scope, not a signal that the game ended. A construct description has game-specific denotation for the same scoped set; callers that do not understand its convention cannot treat it as empty. Finding all members is distinct from representing that set.

These laws make the protocol claim precise. Schema/type acceptance still cannot prove an arbitrary game's describe/validate obey the equality. The formal relation is conditional; it is not an algorithm deciding all input-set equalities.

## Concrete counterexample and repair

Before repair, Dou Dizhu ActionSchema accepted a reversed rocket [17,16], and classify recognized its legal pattern. The exact generator only returned [16,17]. See exact-before.ts and exact-before.log (historical pre-fix witness, not a current successful command).

The game now specifies Play.cards as nondecreasing rank order. Schema and validAction reject noncanonical inputs; neither rewrites the caller's value. Internal card classification remains order-insensitive. The new pure PlaySchema refinement was reviewed and registered in the separate schema-admission tool; its source hash was refreshed explicitly.

For any rank multiset M, sorting yields a unique nondecreasing sequence c(M), and counts(c(M))=M. Pattern interpretation remains a separate field, so multiple valid pattern interpretations are retained. Card classification, containment and removal depend on multiplicities, not the submitted permutation. Thus canonical encoding preserves every selectable rank multiset and pattern interpretation while removing redundant wire representations. This is not a weaker card rule or a claim that listing one representative while accepting every permutation was exhaustive.

The existing standalone Dou Dizhu options capability still returns Action rather than the full runtime Input envelope. Documentation now explicitly distinguishes it from LoadedGame.inputs; the pending module migration has not been certified by this change.

## Evidence

- input-space-laws.test.ts: a public GameModule with actor/time/amount replies checks 16 states across 10 contexts each against an independently enumerated finite universe. Every listed payload validates without context, scoped sets have no duplicates, repeated calls are stable, and the chosen contexts cover the finite legal universe. A game-specific construct convention denotes the same finite sets.
- rules.test.ts: every existing rulebook-family fixture retains all pattern interpretations under canonical encoding; reversed nontrivial encodings fail schema validation while classification is unchanged. Existing independent subset oracle regressions remain.
- game.test.ts: at a real playing boundary, an actual generated canonical multi-rank move remains usable; its reversed encoding is rejected by both validation and advance, and the boundary remains unchanged.
- npm run check passes 90 runtime tests, 53 schema profiles, 103-export coverage and its negative checks (input-space-laws.log).

## Remaining proof scope

The generic scoped-set law is now explicit and has finite construction witnesses. Arbitrary game exact soundness/completeness, canonical data-domain/alias/equality semantics beyond these cases, full author-module migration, state/runtime isolation, generic adapter laws and artifact loading remain independent obligations. No production Core or version change was introduced.
