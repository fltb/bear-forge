# Babel resource management lowering

Based on the distributed `@babel/plugin-transform-explicit-resource-management`
8.0.5 `lib/index.js`, under the accompanying MIT license. Both compiler backends
load this source; installed dependencies are not patched.

When moving a for-of resource declaration into its per-iteration body, preserve
the original declaration kind (`using` or `await using`). Upstream unconditionally
emits `using`, causing async-only resources to throw and omitting awaited cleanup.
This change applies structurally to all resource loop heads, without matching
source names, packages or test identities.

The production native/controlled differential regression lives in
`packages/runtime-controlled/tests/resource-management.test.ts` and includes IO
inside asynchronous cleanup with fork and persistent restoration.
