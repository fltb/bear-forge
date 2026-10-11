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
class Generator extends IterableThis {
  constructor(frame) {
    super();
    this._frame = frame;
  }
}
(0, _serialization.regConstructor)(Generator);
const Gp = Generator.prototype;
defineProperty(Gp, "throw", {
  value: function raise(e) {
    context.call = context.call === raise ? next : null;
    const frame = this._frame;
    frame.error = e;
    frame.meta.errHandler(frame, frame.$);
    return this.next(e);
  },
  configurable: true,
  writable: true
});
function next(value) {
  const frame = this._frame;
  if ((frame.flags & State.FrameFlags.Running) !== 0) throw new Error("Generator is already running");
  frame.sent = value;
  frame.flags |= State.FrameFlags.Running;
  (0, _engine.pushFrame)(frame, next);
  context.call = null;
  try {
    return frame.meta.handler(frame, frame.$, value);
  } catch (e) {
    return (0, _engine.handle)(frame, e);
  }
}
defineProperty(Gp, "return", {
  value: function ret(r) {
    context.call = context.call === ret ? next : null;
    const frame = this._frame;
    frame.meta.finHandler(frame, frame.$);
    frame.result = r;
    return this.next(r);
  },
  configurable: true,
  writable: true
});
defineProperty(Gp, "next", {
  value: next,
  configurable: true,
  writable: true
});
function GeneratorFunction() {}
(0, _serialization.regOpaqueObject)(GeneratorFunction);
function GeneratorFunctionPrototype() {}
setPrototypeOf(GeneratorFunctionPrototype, _engine.FunctionConstr.prototype);
(0, _serialization.regOpaqueObject)(GeneratorFunctionPrototype);
GeneratorFunctionPrototype.prototype = Gp;
GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
GeneratorFunctionPrototype.constructor = GeneratorFunction;
GeneratorFunctionPrototype[Symbol.toStringTag] = GeneratorFunction.displayName = "GeneratorFunction";
function closG($$, meta, closure) {
  const res = (0, _engine.clos)($$, meta, closure);
  Object.setPrototypeOf(res, GeneratorFunctionPrototype);
  /*
  const proto = (res.prototype = Object.create(Gp));
  defineProperty(proto, "next", {
    value: meta.handler,
    configurable: true
  });*/
  res.prototype = Object.create(Gp);
  return res;
}
function frameG(closure, newTarget) {
  const frame = (0, _engine.makeFrame)(closure, newTarget);
  const iter = Object.create(closure[CLOSURE_FUNC].prototype);
  frame.iter = iter;
  iter._frame = frame;
  return frame;
}
function yld(value) {
  const frame = context.top;
  const res = context.value = {
    value,
    done: false
  };
  if (!context.enabled && frame.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(frame);
  frame.flags &= ~State.FrameFlags.Running;
  return res;
}
function retG(value) {
  const frame = context.top;
  const res = context.value = {
    value,
    done: true
  };
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