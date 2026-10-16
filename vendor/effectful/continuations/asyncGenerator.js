const persistentBind = require("./persist").defaultBind;
"use strict";

exports.__esModule = true;
exports.asyncGeneratorMethod = asyncGeneratorMethod;
exports.enqueue = enqueue;
exports.frameAG = frameAG;
exports.closAG = closAG;
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
const generatorConstruction = Symbol("async generator construction");
class AsyncGenerator extends AsyncIterableThis {
  constructor(frame, token) {
    super();
    if (token !== generatorConstruction) throw new TypeError("Illegal async generator construction");
    State.context.generatorState.initialize(this, "AsyncGenerator", frame);
  }
}
(0, _serialization.regConstructor)(AsyncGenerator);
exports.AsyncGenerator = AsyncGenerator;
exports.AsyncIterableThis = AsyncIterableThis;
const AsyncGeneratorFunctionPrototype = require("./generator").createFunctionPrototype("AsyncGeneratorFunction", AsyncGenerator.prototype, "AsyncGenerator", Object.getPrototypeOf(async function*() {}));
// Every request owns its promise and completion callbacks. The active frame
// borrows only the head request; advancing the queue cannot replace callbacks
// until the current request has settled and its execution frame has been popped.
function enqueue(frame, step, value) {
  const request = { step, value };
  context.call = Promise;
  request.promise = new Promise(persistentBind.call(_async.scopeInit, request));
  frame.queue.push(request);
  if ((frame.flags & State.FrameFlags.Running) === 0) runQueue(frame);
  return request.promise;
}
function runQueue(frame) {
  if (frame.drainingQueue) return;
  frame.drainingQueue = true;
  try {
    while (frame.queue.length && (frame.flags & State.FrameFlags.Running) === 0) {
      const request = frame.queue.shift();
      frame.flags |= State.FrameFlags.Running;
      frame.sent = request.value;
      frame.promise = request.promise;
      frame.onReturn = request.onReturn;
      frame.onError = request.onError;
      request.step(frame, request.value);
    }
  } finally {
    frame.drainingQueue = false;
  }
}
function asyncGeneratorMethod(name, step) {
  return { [name](value) {
    const record = context.generatorState.record(this);
    if (!record || record.kind !== "AsyncGenerator") {
      return Promise.reject(new TypeError("Incompatible async generator receiver"));
    }
    return enqueue(record.state, step, value);
  } }[name];
}
for (const [name, step] of [["next", nextStep], ["throw", nextThrowStep], ["return", nextReturnStep]]) {
  defineProperty(AsyncGenerator.prototype, name, {
    value: asyncGeneratorMethod(name, step), configurable: true, writable: true
  });
}
function nextStep(frame, value) {
  if (frame.flags & State.FrameFlags.Done) return completeDetached(frame, false, undefined);
  return (0, _engine.resumeLocal)(frame, value);
}
(0, _serialization.regOpaqueObject)(nextStep, "@effectful/debugger/ag#next");
function nextThrowStep(frame, value) {
  if (frame.flags & State.FrameFlags.Done) return completeDetached(frame, true, value);
  frame.error = value;
  frame.meta.errHandler(frame, frame.$);
  return nextStep(frame, value);
}
(0, _serialization.regOpaqueObject)(nextThrowStep, "@effectful/debugger/ag#throw");
function nextReturnStep(frame, value) {
  Promise.prototype.then.call(Promise.resolve(value),
    persistentBind.call(returnResolved, frame),
    persistentBind.call(returnRejected, frame));
  return frame.promise;
}
function returnResolved(value) {
  const frame = this;
  if (frame.flags & State.FrameFlags.Done) return completeDetached(frame, false, value);
  frame.result = value;
  frame.meta.finHandler(frame, frame.$);
  return nextStep(frame, value);
}
function returnRejected(reason) {
  return nextThrowStep(this, reason);
}
(0, _serialization.regOpaqueObject)(returnResolved, "@effectful/debugger/ag#returnResolved");
(0, _serialization.regOpaqueObject)(returnRejected, "@effectful/debugger/ag#returnRejected");
(0, _serialization.regOpaqueObject)(nextReturnStep, "@effectful/debugger/ag#return");
function dequeue(frame) {
  frame.flags &= ~State.FrameFlags.Running;
  runQueue(frame);
}
function iterationResult(value, done) {
  const result = {value, done};
  return context.allocate ? context.allocate(result) : result;
}
function completeDetached(frame, rejected, value) {
  const promise = frame.promise;
  const complete = rejected ? frame.onError : frame.onReturn;
  context.call = complete;
  complete(rejected ? value : iterationResult(value, true));
  dequeue(frame);
  return promise;
}
function closAG(closure) {
  const fn = (0, _engine.clos)(closure, true);
  Object.setPrototypeOf(fn, AsyncGeneratorFunctionPrototype);
  fn.prototype = Object.create(AsyncGenerator.prototype);
  return context.allocateFunction ? context.allocateFunction(fn) : fn;
}
function frameAG(closure, newTarget) {
  const frame = (0, _engine.makeFrame)(closure, newTarget);
  const iter = new AsyncGenerator(frame, generatorConstruction);
  const prototype = context.operations
    ? context.operations.get(context.operations.ref(closure[State.CLOSURE_FUNC], "prototype"))
    : closure[State.CLOSURE_FUNC].prototype;
  if (prototype !== null && (typeof prototype === "object" || typeof prototype === "function")) {
    if (context.operations) context.operations.invoke(Object.setPrototypeOf, Object, [iter, prototype]);
    else Object.setPrototypeOf(iter, prototype);
  }
  frame.iter = iter;
  frame.next = null;
  frame.queue = context.createQueue ? context.createQueue() : [];
  frame.flags &= ~State.FrameFlags.Running;
  return frame;
}
function yldAG(value) {
  const top = context.top;
  const promise = top.promise;
  top.awaiting = _engine.token;
  context.call = top.onReturn;
  top.onReturn(context.value = iterationResult(value, false));
  (0, _engine.popFrame)(top);
  dequeue(top);
  return promise;
}
function retAG(value) {
  const top = context.top;
  const promise = top.promise;
  top.awaiting = _engine.token;
  context.call = top.onReturn;
  top.onReturn(iterationResult(value, true));
  top.flags |= State.FrameFlags.Done;
  top.result = void 0;
  if (context.enabled) {
    (0, _engine.checkExitBrk)(top, top.promise);
  } else if (top.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(top);
  dequeue(top);
  return promise;
}
function unhandledAG(reason) {
  const top = context.top;
  const promise = (0, _async.unhandledA)(reason);
  dequeue(top);
  return promise;
}
// Immutable runtime prototypes are code references, never mutable game state.
_serialization.regOpaqueObject(AsyncGenerator.prototype, 'runtime.AsyncGenerator.prototype', {props:false});
_serialization.regOpaqueObject(AsyncIterableThis.prototype, 'runtime.AsyncIterableThis.prototype', {props:false});
