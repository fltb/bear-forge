"use strict";

exports.__esModule = true;
exports.closG = closG;
exports.frameG = frameG;
exports.retG = retG;
exports.unhandledG = unhandledG;
exports.yld = yld;
var State = require("./state");
var _engine = require("./engine");
var _serialization = require("@effectful/serialization");
const {
  context,
  native,
  CLOSURE_FUNC
} = State;
const {
  defineProperty,
  setPrototypeOf
} = native.Object;
class IterableThis {
  [Symbol.iterator]() {
    return this;
  }
}
(0, _serialization.regConstructor)(IterableThis);
const generatorConstruction = Symbol("generator construction");
class Generator extends IterableThis {
  constructor(frame, token) {
    super();
    if (token !== generatorConstruction) throw new TypeError("Illegal generator construction");
    State.context.generatorState.initialize(this, "Generator", frame);
  }
}
(0, _serialization.regConstructor)(Generator);
exports.Generator = Generator;
exports.IterableThis = IterableThis;
const Gp = Generator.prototype;
function resumableFrame(receiver) {
  const record = context.generatorState.record(receiver);
  if (!record || record.kind !== "Generator") throw new TypeError("Incompatible generator receiver");
  const frame = record.state;
  // Validate before a throw/return request can change the live continuation.
  if ((frame.flags & State.FrameFlags.Running) !== 0) throw new TypeError("Generator is already running");
  return frame;
}
const methods = {
  next(value) {
    const frame = resumableFrame(this);
    frame.sent = value;
    frame.flags |= State.FrameFlags.Running;
    (0, _engine.pushFrame)(frame, methods.next);
    context.call = null;
    try {
      return frame.meta.handler(frame, frame.$, value);
    } catch (e) {
      return (0, _engine.handle)(frame, e);
    }
  },
  throw(e) {
    const frame = resumableFrame(this);
    context.call = context.call === methods.throw ? methods.next : null;
    frame.error = e;
    frame.meta.errHandler(frame, frame.$);
    return methods.next.call(this, e);
  },
  return(r) {
    const frame = resumableFrame(this);
    context.call = context.call === methods.return ? methods.next : null;
    frame.meta.finHandler(frame, frame.$);
    frame.result = r;
    return methods.next.call(this, r);
  }
};
for (const key of ["next", "return", "throw"]) defineProperty(Gp, key, {
  value: methods[key], configurable: true, writable: true
});
// Shared intrinsic objects are registered once; per-function prototypes remain Context data.
function createFunctionPrototype(name, iteratorPrototype, tag, prototype) {
  Object.defineProperties(iteratorPrototype, {
    constructor: { value: prototype, writable: false, configurable: true },
    [Symbol.toStringTag]: { value: tag, configurable: true }
  });
  const link = Object.getOwnPropertyDescriptor(prototype, "prototype");
  if (!link || !Object.prototype.hasOwnProperty.call(link, "value")) throw new TypeError("Generator function prototype has no iterator link");
  Object.defineProperty(prototype, "prototype", { ...link, value: iteratorPrototype });
  (0, _serialization.regOpaqueObject)(prototype.constructor, "runtime." + name, { props: false });
  (0, _serialization.regOpaqueObject)(prototype, "runtime." + name + ".prototype", { props: false });
  return prototype;
}
exports.createFunctionPrototype = createFunctionPrototype;
const GeneratorFunctionPrototype = createFunctionPrototype("GeneratorFunction", Gp, "Generator", Object.getPrototypeOf(function*() {}));
function closG(closure) {
  const res = (0, _engine.clos)(closure, true);
  Object.setPrototypeOf(res, GeneratorFunctionPrototype);
  res.prototype = Object.create(Gp);
  return context.allocateFunction ? context.allocateFunction(res) : res;
}
function frameG(closure, newTarget) {
  const frame = (0, _engine.makeFrame)(closure, newTarget);
  const prototype = context.operations
    ? context.operations.get(context.operations.ref(closure[CLOSURE_FUNC], "prototype"))
    : closure[CLOSURE_FUNC].prototype;
  const iter = Object.create(prototype !== null && (typeof prototype === "object" || typeof prototype === "function") ? prototype : Gp);
  frame.iter = iter;
  State.context.generatorState.initialize(iter, "Generator", frame);
  return frame;
}
function iterationResult(value, done) {
  const result = {value, done};
  return context.allocate ? context.allocate(result) : result;
}
function yld(value) {
  const frame = context.top;
  const res = context.value = iterationResult(value, false);
  if (!context.enabled && frame.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(frame);
  frame.flags &= ~State.FrameFlags.Running;
  return res;
}
function retG(value) {
  const frame = context.top;
  const res = context.value = iterationResult(value, true);
  frame.result = void 0;
  frame.flags = frame.flags & ~State.FrameFlags.Running | State.FrameFlags.Done;
  if (context.enabled) (0, _engine.checkExitBrk)(frame, res);else if (frame.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(frame);
  return res;
}
function unhandledG(e) {
  const frame = context.top;
  frame.flags = frame.flags & ~State.FrameFlags.Running | State.FrameFlags.Done;
  return (0, _engine.unhandled)(e);
}
// Immutable runtime prototypes are code references, never mutable game state.
_serialization.regOpaqueObject(Generator.prototype, 'runtime.Generator.prototype', {props:false});
_serialization.regOpaqueObject(IterableThis.prototype, 'runtime.IterableThis.prototype', {props:false});
