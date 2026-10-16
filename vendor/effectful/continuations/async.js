const persistentBind = require("./persist").defaultBind;
"use strict";

exports.__esModule = true;
exports.awt = awt;
exports.awtOnReject = awtOnReject;
exports.frameA = frameA;
exports.closA = closA;
exports.getBoundSelf = getBoundSelf;
exports.retA = retA;
exports.scopeInit = scopeInit;
exports.unhandledA = unhandledA;
var _state = require("./state");
var State = _state;
var _engine = require("./engine");
var _serialization = require("@effectful/serialization");
const {
  context,
  token
} = State;
const AsyncFunctionPrototype = exports.AsyncFunctionPrototype = Object.getPrototypeOf(async function(){});
(0, _serialization.regOpaqueObject)(AsyncFunctionPrototype, "runtime.AsyncFunction.prototype", { props: false });
(0, _serialization.regOpaqueObject)(AsyncFunctionPrototype.constructor, "runtime.AsyncFunction", { props: false });
function closA(closure) {
  const fn = (0, _engine.clos)(closure, true);
  Object.setPrototypeOf(fn, AsyncFunctionPrototype);
  return context.allocateFunction ? context.allocateFunction(fn) : fn;
}
function scopeInit(rs, rj) {
  this.onReturn = rs;
  this.onError = rj;
}
(0, _serialization.regOpaqueObject)(scopeInit, "@effectful/debugger/scopeInit");
function frameA(closure, newTarget) {
  const frame = (0, _engine.frame)(closure, newTarget);
  const savedCall = context.call;
  context.call = Promise;
  frame.promise = new Promise(persistentBind.call(scopeInit,frame));
  context.call = savedCall;
  return frame;
}
function retA(value) {
  const top = context.top;
  context.call = top.onReturn;
  top.onReturn(value);
  top.flags |= State.FrameFlags.Done;
  top.result = void 0;
  if (context.enabled) {
    (0, _engine.checkExitBrk)(top, top.promise);
  } else if (top.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(top);
  return top.promise;
}
function unhandledA(reason) {
  const top = context.top;
  context.call = top.onError;
  top.onError(reason);
  top.flags |= State.FrameFlags.Done;
  if (!context.enabled && top.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(top);
  return top.promise;
}
function awtOnResolve(value) {
  this.awaiting = token;
  (0, _engine.resume)(this, value);
  // This is an internal await reaction, not the async function's return.
  // Returning its outer promise makes every await's unused reaction promise
  // adopt that promise and retain another listener until the function ends.
}
(0, _serialization.regOpaqueObject)(awtOnResolve, "@effectful/debugger/awt#resolve");
function awtOnReject(error) {
  this.awaiting = token;
  if (!context.__budgetExceeded) context.prepareException?.(error);
  this.error = error;
  this.meta.errHandler(this, this.$);
  (0, _engine.resume)(this, error);
}
(0, _serialization.regOpaqueObject)(awtOnReject, "@effectful/debugger/awt#reject");
function awt(asyncValue) {
  const top = context.top;
  top.awaiting = asyncValue;
  (0, _engine.then)(asyncValue, persistentBind.call(awtOnResolve,top), persistentBind.call(awtOnReject,top));
  if (!context.enabled && top.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(top);
  top.next = null;
  return context.value = top.promise;
}
function getBoundSelf(value) {
  var _binds$get;
  if (typeof value !== "function") return undefined;
  return (_binds$get = _state.binds.get(value)) === null || _binds$get === void 0 ? void 0 : _binds$get.self;
}
