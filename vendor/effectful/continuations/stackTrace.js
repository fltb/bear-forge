"use strict";

exports.__esModule = true;
exports.captureStackTraceFrom = captureStackTraceFrom;
var _state = require("./state");
var _config = require("./config");
/**
 * Implementation (partial) of v8 Stack-Trace API
 * https://v8.dev/docs/stack-trace-api
 *
 * This is needed for npm packages such as "bindings"
 *
 * TODO: monkey patch runtime Error constructors
 */

const NativeError = _state.native.Error;
class CallSite {
  constructor(frame, brk) {
    this.frame = frame;
    this.brk = brk;
  }
  getFunctionName() {
    return this.frame.meta.origName || "unknown";
  }
  getFileName() {
    if (!_state.isNode || Error._edbg_short_file_names) return this.frame.meta.module.name;
    return this.frame.meta.module.fullPath || this.frame.meta.module.name;
  }
  getLineNumber() {
    return this.brk ? this.brk.line : 0;
  }
  getColumnNumber() {
    return this.brk && this.brk.column || 0;
  }
  getThis() {
    return this.frame.self;
  }
  getTypeName() {
    return undefined; // TODO
  }
  getFunction() {
    return this.frame.closure[_state.CLOSURE_FUNC];
  }
  getMethodName() {
    return this.getFunctionName(); // TODO:
  }
  getEvalOrigin() {
    return undefined; // TODO:
  }
  isToplevel() {
    return false; // TODO:
  }
  isEval() {
    return false; // TODO:
  }
  isNative() {
    return false; // TODO;
  }
  isConstructor() {
    return this.frame.newTarget != null;
  }
  isAsync() {
    return false; // TODO:
  }
  isPromiseAll() {
    return false; // TODO:
  }
  isPromiseAny() {
    return false; // TODO:
  }
  getPromiseIndex() {
    return null;
  }
}
function captureStackTrace(e, constructorOpt) {
  const frame = _state.context.top || _state.context.pausedTop;
  return captureStackTraceFrom(e, constructorOpt, frame, false);
}
function captureStackTraceFrom(e, constructorOpt, frame, eager) {
  const stack = [];
  if (frame) {
    let i = frame;
    if (constructorOpt) {
      for (; i; i = i.caller) {
        if (i.closure[_state.CLOSURE_FUNC] === constructorOpt) {
          i = i.caller;
          break;
        }
      }
    }
    let count = Error.stackTraceLimit || -1;
    for (; i && count >= 0; i = i.caller) {
      const brk = i.brk; // i.meta.states[i.state];
      _state.native.Array.push.call(stack, new CallSite(i, brk));
      --count;
    }
  }
  if (_config.default.debuggerDebug) {
    const nativeStack = _state.native.Object.getOwnPropertyDescriptor(e, "stack");
    if (nativeStack) _state.native.Object.defineProperty(e, "_deb_stack", nativeStack);
  }
  let memo = null;
  function get() {
    if (memo) return memo;
    if (Error.prepareStackTrace) {
      // return (context.call = (<any>Error).prepareStackTrace), (<any>Error).prepareStackTrace(e, stack);
      memo = Error.prepareStackTrace(e, stack);
      return memo;
    }
    const res = [`${e.name}: ${e.message}`];
    for (const i of stack) _state.native.Array.push.call(res, `    at ${i.getFunctionName()} (${i.getFileName()}:${i.getLineNumber()}:${i.getColumnNumber()})`);
    memo = res.join("\n");
    return memo;
  }
  try {
    if (eager) {
      _state.native.Object.defineProperty(e, "stack", {
        configurable: true,
        writable: true,
        enumerable: true,
        value: undefined
      });
      e.stack = get();
    } else _state.native.Object.defineProperty(e, "stack", {
      configurable: true,
      enumerable: true,
      get
    });
  } catch (e) {
    // tslint:disable-next-line:no-console
    console.error("DEBUGGER: could't reset stack", e);
  }
}
if (_config.default.patchRT) {
  NativeError.captureStackTrace = captureStackTrace;
}
