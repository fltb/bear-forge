"use strict";

exports.__esModule = true;
exports.awt = awt;
exports.awtOnReject = awtOnReject;
exports.frameA = frameA;
exports.getBoundSelf = getBoundSelf;
exports.getSuspendedFrameByPromise = getSuspendedFrameByPromise;
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
const AsyncFunctionPrototype = Object.getPrototypeOf(async function(){});
function scopeInit(rs, rj) {
  this.onReturn = rs;
  this.onError = rj;
}
(0, _serialization.regOpaqueObject)(scopeInit, "@effectful/debugger/scopeInit");
function frameA(closure, newTarget) {
  const frame = (0, _engine.frame)(closure, newTarget);
  const savedCall = context.call;
  context.call = Promise;
  frame.promise = new Promise(scopeInit.bind(frame));
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
  context.suspended.delete(this);
  this.awaiting = token;
  return (0, _engine.resume)(this, value);
}
(0, _serialization.regOpaqueObject)(awtOnResolve, "@effectful/debugger/awt#resolve");
function awtOnReject(error) {
  context.suspended.delete(this);
  this.awaiting = token;
  this.error = error;
  this.meta.errHandler(this, this.$);
  return (0, _engine.resume)(this, error);
}
(0, _serialization.regOpaqueObject)(awtOnReject, "@effectful/debugger/awt#reject");
function awt(asyncValue) {
  const top = context.top;
  context.suspended.add(top);
  top.awaiting = asyncValue;
  (0, _engine.then)(asyncValue, awtOnResolve.bind(top), awtOnReject.bind(top));
  if (!context.enabled && top.restoreEnabled !== State.undef) context.enabled = true;
  (0, _engine.popFrame)(top);
  top.next = null;
  return context.value = top.promise;
}
function getSuspendedFrameByPromise(promise) {
  for (const frame of context.suspended) {
    if (frame.promise === promise) return frame;
  }
  return undefined;
}
function getBoundSelf(value) {
  var _binds$get;
  if (typeof value !== "function") return undefined;
  return (_binds$get = _state.binds.get(value)) === null || _binds$get === void 0 ? void 0 : _binds$get.self;
}