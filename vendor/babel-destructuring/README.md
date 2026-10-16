# Babel object destructuring lowering

Based on the distributed `@babel/plugin-transform-destructuring` 8.0.5
`lib/index.js`, under the accompanying MIT license. The compiler loads this
source for both execution backends; it does not patch installed dependencies.

Object patterns capture their RHS and check coercibility before evaluating keys.
Each computed key is converted once in property order, interleaved with property
reads and default initializers. Object rest reuses those primitive keys. The
upstream pass instead pre-evaluated impure keys and converted object-valued keys
again when constructing rest exclusions.

Rest with an empty exclusion list also uses the object-rest helper instead of
Object.assign: CreateDataProperty must not invoke the inherited __proto__ setter.
The compiler binds this helper through its helperGenerator API to the guarded
CopyDataProperties implementation shared by both runtimes.

Array patterns step explicit iterator records between each binding/default and
close after binding completion. Array/arguments shortcuts and eager toArray
conversion are removed. Compiler-owned activation metadata connects these
records to iterator-regions.ts, which drains pending records before leaving
their nearest existing exception region. Regions without their own openings
do not receive redundant cleanup. It preserves original expression positions,
including await/yield, rather than putting defaults in async callbacks.
For-loop initializers remain a single declaration with ordered internal steps;
assignment defaults capture the target reference before taking the next value.

Formal semantic regressions belong to the compiler/runtime module tests. No
source identifiers or package names select a different lowering path.
