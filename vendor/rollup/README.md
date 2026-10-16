# Rollup build linker

Vendored from Rollup 4.64.5, upstream commit
`05a293809848a3d772e7ff2ba44adcbd23bd84b8` (see the distribution header).
`node-entry.js`, `parseAst.js`, and `LICENSE.md` come from that release.
Only the build `rollup` entry is exposed; this directory does not provide watch.
`native.js` loads the installed matching release's parser and rejects a version
mismatch. Installed dependency files are not patched.

Local resolver changes preserve star-search context through indirect reexports
and imported local bindings, and cache namespace resolution only for root
searches. A cycle-pruned search result must not become a context-free cache hit.
Quoted export names beginning with `*` remain ordinary names: namespace imports
carry an explicit marker through linking and ESM emission, while explicit
exports and star forwarding resolve by their actual names. The synthetic
external-star entry is distinguished from a quoted export name.
The parser bridge import paths are adjusted for this directory.

The compiler also links the original admitted ESM graph in target V8 without
evaluating it. This preserves target-engine rejection behavior where corrected
export resolution alone differs from V8. This check runs only during compilation;
Instance execution, fork and restore never invoke it. Regression tests belong to
`packages/compiler/tests/export-resolution.test.ts` and `module-link.test.ts`.
