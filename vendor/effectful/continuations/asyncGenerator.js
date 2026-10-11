const persistentBind = require("./persist").defaultBind;
"use strict";

exports.__esModule = true;
exports.asyncGeneratorMethod = asyncGeneratorMethod;
exports.enqueue = enqueue;
exports.frameAG = frameAG;
exports.retAG = retAG;
exports.unhandledAG = unhandledAG;
exports.yldAG = yldAG;
var State = require("./state");
var _engine = require("./engine");
var _async = require("./async");
var _serialization = require("@effectful/serialization");
const {
  context
} = State;
const {
  defineProperty
} = State.native.Object;
class AsyncIterableThis {
  [Symbol.asyncIterator]() {
    return this;
  }
}
(0, _serialization.regConstructor)(AsyncIterableThis);
class AsyncGenerator extends AsyncIterableThis {
  constructor(frame) {
    super();
    this._frame = frame;
  }
}
(0, _serialization.regConstructor)(AsyncGenerator);
function runQueue(step, value, rs, rj) {
  this.sent = value;
  this.onReturn = rs;
  this.onError = rj;
  step(this, value);
}
(0, _serialization.regOpaqueObject)(runQueue, "@effectful/debugger/ag#runQueue");
function enqueue(step, value, rs, rj) {
  this.queue.push(persistentBind.call(runQueue,this, step, value, rs, rj));
}
function asyncGeneratorMethod(step) {
  return function (value) {
    const frame = this._frame;
    context.call = Promise;
    if ((frame.flags & State.FrameFlags.Running) !== 0) return new Promise(persistentBind.call(enqueue,frame, step, value));
    frame.flags |= State.FrameFlags.Running;
    frame.sent = value;
    frame.promise = new Promise(persistentBind.call(_async.scopeInit,frame));
    return step(frame, value);
  };
}
defineProperty(AsyncGenerator.prototype, "next", {
  value: asyncGeneratorMethod(nextStep),
  configurable: true
});
defineProperty(AsyncGenerator.prototype, "throw", {
  value: asyncGeneratorMethod(nextThrowStep)
});
defineProperty(AsyncGenerator.prototype, "return", {
  value: asyncGeneratorMethod(nextReturnStep),
  configurable: true
});
function nextStep(frame, value) {
  return (0, _engine.resumeLocal)(frame, value);
}
(0, _serialization.regOpaqueObject)(nextStep, "@effectful/debugger/ag#next");
function nextThrowStep(frame, value) {
  frame.error = value;
  frame.meta.errHandler(frame, frame.$);
  return nextStep(frame, value);
}
(0, _serialization.regOpaqueObject)(nextThrowStep, "@effectful/debugger/ag#throw");
function nextReturnStep(frame, value) {
  frame.meta.finHandler(frame, frame.$);
  return nextStep(frame, value);
}
(0, _serialization.regOpaqueObject)(nextReturnStep, "@effectful/debugger/ag#return");
function dequeue(frame) {
  if (frame.queue.length) frame.queue.shift()();else frame.flags &= ~State.FrameFlags.Running;
}
function frameAG(closure, newTarget) {
  const frame = (0, _engine.makeFrame)(closure, newTarget);
  const iter = new AsyncGenerator(frame);
  frame.iter = iter;
  frame.next = null;
  frame.queue = [];
  frame.flags &= ~State.FrameFlags.Running;
  return frame;
}
function yldAG(value) {
  const top = context.top;
  context.suspended.delete(top);
  top.awaiting = _engine.token;
  context.call = top.onReturn;
  top.onReturn(context.value = {
    value,
    done: false
  });
  (0, _engine.popFrame)(top);
  dequeue(top);
  return top.promise;
}
function retAG(value) {
  const top = context.top;
  context.suspended.delete(top);
  top.awaiting = _engine.token;
  context.call = top.onReturn;
  top.onReturn({
    value,
    done: true
  });
  top.flags = State.FrameFlags.Done;
  top.result = void 0;
  dequeue(top);
  if (context.enabled) {
    (0, _engine.checkExitBrk)(top, top.promise);
  } else if (top.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(top);
  return top.promise;
}
function unhandledAG(reason) {
  dequeue(context.top);
  return (0, _async.unhandledA)(reason);
}
// Immutable runtime prototypes are code references, never mutable game state.
_serialization.regOpaqueObject(AsyncGenerator.prototype, 'runtime.AsyncGenerator.prototype', {props:false});
_serialization.regOpaqueObject(AsyncIterableThis.prototype, 'runtime.AsyncIterableThis.prototype', {props:false});
