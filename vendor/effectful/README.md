# EffectfulJS local adaptations

Sources come from the latest 2026-10-11 npm distributions of `@effectful/core`, `@effectful/debugger`, and `@effectful/serialization` (2.0.12), from https://github.com/awto/effectfuljs. Their MIT licenses are retained. These are production source dependencies, not package caches.

`core` keeps the upstream compiler and replaces workspace dependency metadata with exact versions; Babel dependencies use the current 8.x release. `serialization` corrects unnamed symbol registration and restores data properties without invoking inherited setters while the graph is incomplete. Array properties preserve holes, length, additional keys, and prototypes. Dedicated primitive descriptors preserve negative zero and both infinities through JSON encoding.

`continuations` is the dependency closure of the debugger's continuation runtime, without its UI, transport, precompiled third-party packages, or runtime compiler. Function registration accepts a factory emitted by Bear Forge's compiler instead of using Function. Eval/compiler entry points are unavailable, automatic host timers are disabled, and debugger options are disabled. Persistent bound functions retain constructor behavior and their own property descriptors, including aliases and self references. The private binding record uses `b` for its target, leaving `f` to the serializer's property table. Closure persistence records the captured variable array separately from the frame's current variable array; restoration fills inline captures after graph creation. Function prototype chains preserve lowered class inheritance. Saving bound async frames does not modify their live links. The Bear Forge adapter separates static function registration from source initialization. Context retains the selected run closure and schema values with their captured environments; code references resolve through shared registration tables. Export namespaces are retained only when used by author code, and a used entry receiver preserves its identity and aliases. The compiled ABI remains effectful-v2-main-3; the private lexical-cells layout marker rejects old artifacts and snapshots.

Bear Forge supplies an explicit IO device, serializable deterministic promise jobs, Program-shared registries, Context-local queues/configuration and array iterator adapters without patching host builtins. These changes are validated by native/compiled differential and snapshot/fork tests. An upstream version number is not a claim that all required tests have passed; progress is tracked only in docs/plan.md.

Main-runtime adaptation: internal async callbacks use explicit persistent binding. Compiled member calls adapt array iterators and Function.bind by identity, without replacing host prototypes. MessagePort/MessageChannel auto-registration is removed: its inherited descriptors would retain instance registries on host prototypes. The bundled runtime exports an ordinary factory with lexical serialization state, globals and Promise implementation; native host Promise and builtins are unchanged. Generated catch handlers propagate a latched budget fault instead of re-entering the continuation exception dispatcher indefinitely.

Capture adaptation: compiler-generated factories receive a projection of shared lexical variable cells instead of an entire parent activation. Arrow receivers are explicit small capture objects. Persistence reconstructs those cells and closure bindings in two phases; in-memory forks use the dedicated graph copier without invoking the persistence codec. Static code and metadata remain registered once per Program.

Generator adaptation: synchronous and asynchronous execution frames live in the runtime's private intrinsic-state registry, not an author-visible `_frame` property. Internal construction requires a private token; reflected generator constructors cannot accept an author-supplied frame or compile dynamic code. Serialization identifies registered instances rather than treating objects that inherit their prototypes as genuine generators. Formal iterator tests cover author-owned names, fork/restore, external IO inside an async generator, and rejected forged construction.

The shared Program Realm uses V8's actual generator-function prototype and constructor identity. Its configurable `prototype` data property points to the controlled iterator prototype used by lowered functions, so the standard relationship `Object.getPrototypeOf(fn).prototype === Object.getPrototypeOf(fn.prototype)` remains true. Invocation of dynamic constructors still goes through the common runtime denial path.

Generator return/throw resume through the internal next implementation instead of an author-replaced `next` property, matching native control semantics. Promise catch dispatches an overridden `then` through the guarded invocation boundary. These runtime callbacks do not grant a route around the native-entry whitelist.

Generated iterator calls (`mcall`, `iterNext`, `iterErr`, `iterFin`) also use the guarded invocation boundary. The v2 CFG stores a completed delegate return's value in the enclosing generator's return slot, instead of discarding it and returning the original caller-supplied value. Delegation tests exercise both native comparison and blocked intrinsic mutation.

Iterator acquisition now creates a Context-owned record with a cached `next`; throw/return methods are read only when needed. The runtime adapter validates result objects and adapts synchronous iterators to async iteration. Delegated generator return has a separate CFG edge from ordinary finally unwinding, so normal resumption and throw do not close the iterator. Frame scheduling and return dispatch include that edge, including a delegate yielding during return. Async return awaits its argument before forwarding it. CFG operand extraction retains earlier expression values before later mutations. Author numeric updates use the shared guarded operation implementation rather than upstream arithmetic expansion, preserving numeric coercion and BigInt behavior.

Generator lifecycle correction: synchronous next/throw/return validate the receiver brand and reject running frames before changing completion state. Async requests retain individual promise/callback records in Context. Yield, return and failure settle the current request and pop its frame before advancing the queue; completed generators settle requests without reentering the body. Queue draining uses an iterative pump rather than recursive request dispatch. These changes address lifecycle invariants and do not add source-pattern or game-specific exceptions.

The v2 scope pass now updates the new.target occurrence list's own tail rather than the function.sent tail. Previously, multiple new.target occurrences could leave earlier references unconverted inside generated handlers. Class construction and inheritance differential tests exercise this correction alongside Bear Forge's class-identity preservation pass.

Method identity uses bit 12, leaving the runtime's existing bit 11 EXCEPTION_BOUNDARY distinct. The static factory reads the compiler's method flag rather than duplicating its allocation; the controlled runtime's formal metadata check verifies compiler/runtime agreement and non-overlapping flag bits. Lexical new.target in arrows is normalized to captured variable cells by Bear Forge before continuation conversion; it does not repurpose a frame's actual constructor invocation state.

Loop continuation targets include every contiguous enclosing label, rather than
only the innermost label. Scope-owning loops route normal completion and all
continue edges through the same per-iteration cell-copy block. This prevents
labelled continues through finally from sharing the next iteration's bindings
with closures captured in the previous iteration.

For-of CFG exception regions now distinguish iterator advancement/result reads
from binding assignment and loop-body evaluation. Only the latter unwind through
IteratorClose. Iterator finalizers retain the incoming completion kind and error
in explicit local slots; a close failure preserves an existing throw, while
normal break/return propagates that failure. All normal unwind paths reset the
completion-kind slot, including generator return dispatch. This also prevents
Async-from-Sync rejected values from triggering a second close in the loop.
The loop continuation bridge leaves the close-protected body without invoking
IteratorClose, while still unwinding intervening author finally blocks. This
applies to both fallthrough and same-loop continue; leaving the loop for an
outer continue or break still closes normally.

The Babel compiler invocation now restores `context.root` and `config.babelFile`
in `finally`, including failure paths. Those references are invocation-owned
compiler graphs, not runtime state; retaining them kept the previous CFG/scopes
and Babel paths alive while the caller built its factory AST. The production
continuation stage also consumes its exclusively owned input AST without Babel's
otherwise-default full clone. Neither change alters author language semantics or
runtime snapshot layout.

Persistent closures now derive their FunctionDescriptor from the existing private
closure metadata table rather than registering each function again in the
serializer's weak map. Explicit object registrations still take precedence.
The persistence module installs this fallback when persistence is enabled; Bear
Forge's brand-based descriptor selector implements the same lookup without
calling author properties. Closure bodies, captures, own descriptors and the
snapshot format are unchanged.

The compilation-unit File can carry compiler-owned bearAsyncModule metadata.
Its continuation scope then uses the existing async-function completion/frame
protocol, so top-level awaits settle a Future and preserve rejection values.
This fixes single-unit completion, not async dependency scheduling: the current
flattening linker still loses independent sibling evaluation order.

Compiled construction can supply a one-shot new.target to frame creation. The controlled adapter allocates a neutral object identity and invokes the compiled body, so V8 allocation maps do not retain obsolete authored constructors or prototypes. Frame creation consumes this override before parameter defaults or nested calls; normal calls and native constructors retain their separate paths.
