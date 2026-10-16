# merve

Unmodified merve 1.2.2 single-header distribution from Node.js v26.5.0:

- https://github.com/nodejs/node/blob/v26.5.0/deps/merve/merve.h
- https://github.com/nodejs/node/blob/v26.5.0/deps/merve/merve.cpp

Upstream: https://github.com/nodejs/merve/tree/v1.2.2
Licenses: upstream `LICENSE-MIT` and `LICENSE-APACHE`, retained here.

The compiler uses this pinned static CommonJS export parser instead of assuming
that different host Node versions or cjs-module-lexer releases discover the same
exports. Source is never executed to discover exports. This parser is not a
replacement for language admission or syntax/type checking.

`packages/compiler/src/commonjs-lexer.cpp` is Bear Forge's stdin/JSON transport.
`packages/compiler/src/commonjs-lexer.ts` builds it with a C++20 compiler and calls
it during compilation only. No native parser, process handle, or parser state is
included in a loaded game Program or Context. SIMD acceleration is disabled, so
there is no additional simdutf dependency.
