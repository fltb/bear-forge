"use strict";

exports.__esModule = true;
exports.THREAD_MASK = exports.THREAD_BITS = exports.MAX_ID = exports.FrameFlags = exports.ForInIterator = exports.Flag = exports.CLOSURE_VARS = exports.CLOSURE_PARENT = exports.CLOSURE_META = exports.CLOSURE_FUNC = exports.BrkFlag = void 0;
exports.afterInterrupt = afterInterrupt;
exports.binds = void 0;
exports.cancelInterrupt = cancelInterrupt;
exports.ctrlToken = exports.context = exports.closures = void 0;
exports.defaultErrHandler = defaultErrHandler;
exports.defaultFinHandler = defaultFinHandler;
exports.forInIterator = forInIterator;
exports.functions = void 0;
exports.idsStore = idsStore;
exports.journal = exports.isWindows = exports.isNode = exports.isBrowser = void 0;
exports.liftSync = liftSync;
exports.mergeModule = mergeModule;
exports.mergeVersions = mergeVersions;
exports.metaDescr = metaDescr;
exports.nativeFuncs = exports.native = void 0;
exports.nop = nop;
exports.normalizePath = exports.normalizeDrive = void 0;
exports.patchNative = patchNative;
exports.pauseEventQueue = pauseEventQueue;
exports.resumeAfterInterrupt = resumeAfterInterrupt;
exports.resumeEventQueue = resumeEventQueue;
exports.sideEffectToken = void 0;
exports.signalThread = signalThread;
exports.stackDescr = stackDescr;
exports.staticToMethod = staticToMethod;
exports.thunks = exports.statusBuf = void 0;
exports.toGlobal = toGlobal;
exports.toLocal = toLocal;
exports.toThread = toThread;
exports.token = void 0;
exports.trace = trace;
exports.undef = void 0;
require("@effectful/serialization");
require("@effectful/serialization/dom");
var _config = require("./config");
/**
 * Full state of a currently running program
 */
// ensuring it process.release.name loaded before anything patched
/** common prototype for call descriptions of each function */
let FrameFlags = exports.FrameFlags = /*#__PURE__*/function (FrameFlags) {
  FrameFlags[FrameFlags["Running"] = 1] = "Running";
  FrameFlags[FrameFlags["Done"] = 2] = "Done";
  FrameFlags[FrameFlags["CatchesCtrlToken"] = 4] = "CatchesCtrlToken";
  return FrameFlags;
}({});
/** function's call desciption */
/** operations trace - callbacks to be executed on reverting state */
const journal = exports.journal = {
  now: null,
  past: null,
  future: null,
  enabled: false
};

/** breakpoint description */
let BrkFlag = exports.BrkFlag = /*#__PURE__*/function (BrkFlag) {
  BrkFlag[BrkFlag["HAS_EH"] = 1] = "HAS_EH";
  BrkFlag[BrkFlag["EXPR"] = 2] = "EXPR";
  BrkFlag[BrkFlag["STMT"] = 4] = "STMT";
  BrkFlag[BrkFlag["DEBUGGER_STMT"] = 8] = "DEBUGGER_STMT";
  BrkFlag[BrkFlag["EXIT"] = 16] = "EXIT";
  BrkFlag[BrkFlag["EMPTY"] = 32] = "EMPTY";
  return BrkFlag;
}({});
/** module's description */
/** function's description */
/** describse variable scope (decl depth, function depth, location) */
/** pre-calculated scope information */
/** passed to this runtime by compiler */
/** known closures */
const closures = exports.closures = new WeakMap();
const functions = exports.functions = new WeakMap();
const thunks = exports.thunks = new WeakMap();
const binds = exports.binds = new WeakMap();
const CLOSURE_PARENT = exports.CLOSURE_PARENT = 0;
const CLOSURE_VARS = exports.CLOSURE_VARS = 1;
const CLOSURE_META = exports.CLOSURE_META = 2;
const CLOSURE_FUNC = exports.CLOSURE_FUNC = 3;
/** a part of context stores information about currently executing function */

const undef = exports.undef = {
  _undef: true
};

/** global storage for the whole state of the running program */
const context = exports.context = {
  enabled: false,
  terminated: false,
  running: false,
  error: false,
  launched: false,
  brk: null,
  top: null,
  modules: {},
  modulesById: {},
  syncStack: [],
  queue: [],
  call: null,
  needsBreak: nop,
  value: void 0,
  moduleId: null,
  brkOnAnyException: false,
  brkOnUncaughtException: false,
  brkOnAnyExceptionFilter: null,
  onNewSource: nop,
  onThread: nop,
  onFirstFrame: nop,
  onStop: nop,
  pausedTop: null,
  threadId: 0,
  exception: undef,
  stopNext: null,
  onLoad: null,
  onAfterLoad: null,
  unwindingTill: null,
  unwindingBody: null
};
function nop() {
  return false;
}
/** original global objects monkey-patched by this runtime */
const native = exports.native = {
  // tslint:disable-next-line:no-console
  console: {
    log: console.log,
    error: console.error,
    warn: console.warn
  },
  Proxy,
  Promise,
  // tslint:disable-next-line:object-literal-shorthand
  eval: eval,
  Function,
  FunctionMethods: {
    call: Function.prototype.call,
    apply: Function.prototype.apply,
    bind: Function.prototype.bind
  },
  PromiseMethods: {
    then: Promise.prototype.then,
    catch: Promise.prototype.catch,
    finally: Promise.prototype.finally
  },
  Object: {
    defineProperty: Object.defineProperty,
    assign: Object.assign,
    setPrototypeOf: Object.setPrototypeOf,
    freeze: Object.freeze,
    isFrozen: Object.isFrozen,
    seal: Object.seal,
    isSealed: Object.isSealed,
    preventExtensions: Object.preventExtensions,
    isExtensible: Object.isExtensible,
    defineProperties: Object.defineProperties,
    entries: Object.entries,
    keys: Object.keys,
    values: Object.values,
    getOwnPropertyNames: Object.getOwnPropertyNames,
    getOwnPropertySymbols: Object.getOwnPropertySymbols,
    getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    getPrototypeOf: Object.getPrototypeOf,
    create: Object.create
  },
  Array: {
    shift: Array.prototype.shift,
    unshift: Array.prototype.unshift,
    push: Array.prototype.push,
    pop: Array.prototype.pop,
    splice: Array.prototype.splice,
    sort: Array.prototype.sort,
    reverse: Array.prototype.reverse,
    slice: Array.prototype.slice,
    from: Array.from,
    filter: Array.prototype.filter,
    map: Array.prototype.map
  },
  Map,
  Set,
  Reflect: {
    construct: Reflect.construct,
    apply: Reflect.apply,
    get: Reflect.get,
    set: Reflect.set,
    has: Reflect.has,
    defineProperty: Reflect.defineProperty,
    deleteProperty: Reflect.deleteProperty,
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    ownKeys: Reflect.ownKeys,
    isExtensible: Reflect.isExtensible,
    preventExtensions: Reflect.preventExtensions,
    setPrototypeOf: Reflect.setPrototypeOf,
    getPrototypeOf: Reflect.getPrototypeOf
  },
  WeakMap: {
    // changes in TS lib makes it unusable with some different TS versions
    set: WeakMap.prototype.set,
    delete: WeakMap.prototype.delete
  },
  WeakSet: {
    add: WeakSet.prototype.add,
    delete: WeakSet.prototype.delete
  },
  setInterval,
  setTimeout,
  clearTimeout,
  clearInterval,
  setImmediate: typeof setImmediate !== "undefined" && setImmediate,
  clearImmediate: typeof clearImmediate !== "undefined" && clearImmediate,
  Error,
  ErrorMethods: {
    prepareStackTrace: Error.prepareStackTrace
  }
};
const token = exports.token = {
  _effectToken: true
};
const sideEffectToken = exports.sideEffectToken = {
  _sideEffectToken: true
};
const ctrlToken = exports.ctrlToken = {
  _ctrlEffectToken: true
};
/** generates number from 0 till `1 << bits`, reuses numbers from `release` call  */
function idsStore(bits = 16) {
  // TODO: ensure optimization with typed arrays and SMI
  const max = 1 << bits;
  // stores elements of a linked list of free ids
  const store = [];
  let head = -1;
  return {
    free(id) {
      store[id] = head;
      head = id;
    },
    allocate() {
      if (head === -1) {
        const id = store.length;
        if (id > max) throw new Error("id's generator overflow");
        store.push(-1);
        return id;
      }
      const id = head;
      head = store[id];
      store[id] = -1;
      return id;
    }
  };
}

/** catch/finally handler state ids mapping */

/** handler function */

/** breakpoint positions */

const THREAD_BITS = exports.THREAD_BITS = 10;
const THREAD_MASK = exports.THREAD_MASK = ~(-1 << THREAD_BITS);
const MAX_ID = exports.MAX_ID = 1 << 32 - THREAD_BITS;
function toGlobal(local) {
  if (local > MAX_ID) throw new Error("id value overflow");
  return local << THREAD_BITS | context.threadId;
}
function toLocal(local) {
  return local >> THREAD_BITS;
}
function toThread(local) {
  return local & THREAD_MASK;
}
const isWindows = exports.isWindows = typeof process !== "undefined" && process.platform === "win32";
const normalizeDrive = exports.normalizeDrive = isWindows ? function normalizeDrive(path) {
  return path && path.length > 2 && path[1] === ":" ? path.charAt(0).toUpperCase() + path.slice(1) : path;
} : function (path) {
  return path;
};
const normalizePath = exports.normalizePath = isWindows ? function normalizePath(path) {
  return normalizeDrive(path.replace(/\\/g, "/"));
} : function normalizePath(path) {
  return path;
};
class ForInIterator {
  constructor(obj, fields) {
    this.fields = fields;
    this.pos = 0;
    this.obj = obj;
  }
  [Symbol.iterator]() {
    return this;
  }
  next() {
    for (;;) {
      if (this.pos >= this.fields.length) return {
        done: true,
        value: undefined
      };
      const value = this.fields[this.pos++];
      if (typeof this.obj !== "object" || value in this.obj) return {
        done: false,
        value
      };
    }
  }
}
exports.ForInIterator = ForInIterator;
function forInIterator(obj) {
  const fields = [];
  for (const i in obj) fields.push(i);
  return new ForInIterator(obj, fields);
}
let Flag = exports.Flag = /*#__PURE__*/function (Flag) {
  Flag[Flag["ASYNC_FUNCTION"] = 1] = "ASYNC_FUNCTION";
  Flag[Flag["GENERATOR_FUNCTION"] = 2] = "GENERATOR_FUNCTION";
  Flag[Flag["ARROW_FUNCTION"] = 4] = "ARROW_FUNCTION";
  Flag[Flag["HAS_THIS"] = 8] = "HAS_THIS";
  Flag[Flag["HAS_ARGUMENTS"] = 16] = "HAS_ARGUMENTS";
  Flag[Flag["FILE_TOP_LEVEL"] = 32] = "FILE_TOP_LEVEL";
  Flag[Flag["BLACKBOX"] = 128] = "BLACKBOX";
  Flag[Flag["SLOPPY"] = 256] = "SLOPPY";
  Flag[Flag["HAS_FUNCTION_SENT"] = 512] = "HAS_FUNCTION_SENT";
  Flag[Flag["HAS_DICTIONARY_SCOPE"] = 1024] = "HAS_DICTIONARY_SCOPE";
  // report uncaught
  Flag[Flag["EXCEPTION_BOUNDARY"] = 2048] = "EXCEPTION_BOUNDARY";
  Flag[Flag["METHOD_FUNCTION"] = 4096] = "METHOD_FUNCTION";
  Flag[Flag["GENERATOR_WRAPPER"] = 8192] = "GENERATOR_WRAPPER";
  Flag[Flag["ASYNC_GENERATOR_WRAPPER"] = 16384] = "ASYNC_GENERATOR_WRAPPER";
  Flag[Flag["ASYNC_WRAPPER"] = 32768] = "ASYNC_WRAPPER";
  return Flag;
}({});
function defaultErrHandler(f) {
  f.state = f.goto = f.meta.errState;
}
function defaultFinHandler(f) {
  f.state = f.goto = f.meta.finState;
}
const nativeFuncs = exports.nativeFuncs = new WeakSet();
function patchNative(obj, name, value) {
  nativeFuncs.add(value);
  native.Object.defineProperty(obj, name, {
    configurable: true,
    writable: true,
    value
  });
}
let statusBufImpl = null;
try {
  statusBufImpl = new SharedArrayBuffer(4);
} catch (_e) {
  // this may be disabled in some browsers due to Spectre
  // tslint:disable-next-line
  console.warn("DEBUGGER: no SharedArrayBuffer, so pausing running code won't work");
}
const statusBuf = exports.statusBuf = statusBufImpl;
let interruptTimeoutHandler = 0;
let afterInterruptCallback = null;
let eventQueuePaused = false;
function pauseEventQueue() {
  eventQueuePaused = true;
}
function resumeEventQueue() {
  eventQueuePaused = false;
  signalThread();
}
const nativeSetTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;
function afterInterrupt(cb) {
  nativeClearTimeout(interruptTimeoutHandler);
  afterInterruptCallback = cb;
  interruptTimeoutHandler = nativeSetTimeout(resumeAfterInterrupt, 0);
}
function resumeAfterInterrupt() {
  const callback = afterInterruptCallback;
  if (callback) {
    interruptTimeoutHandler = 0;
    afterInterruptCallback = null;
    callback();
  }
}
function cancelInterrupt() {
  nativeClearTimeout(interruptTimeoutHandler);
  afterInterruptCallback = null;
  interruptTimeoutHandler = 0;
}
let threadScheduled = false;
function liftSync(fun) {
  return function () {
    const savedDebug = context.enabled;
    try {
      context.enabled = false;
      return fun.__effectful__nativeApply(this, arguments);
    } finally {
      context.enabled = savedDebug;
    }
  };
}
const asap = typeof process !== "undefined" && typeof process.nextTick === "function" ? process.nextTick : typeof setImmediate === "function" ? setImmediate : setTimeout;

/**
 * scheduling some job (usually async calls) in managable event queue
 */
function signalThread() {
  if (!context.enabled) return;
  if (threadScheduled) return;
  threadScheduled = true;
  asap(function thread() {
    threadScheduled = false;
    if (eventQueuePaused) return;
    if (_config.default.onBeforeExec) liftSync(_config.default.onBeforeExec)();
    context.onThread();
  });
}
if (_config.default.patchRT) {
  Object.defineProperty(Function.prototype, "__effectful__nativeCall", {
    configurable: true,
    writable: true,
    value: native.FunctionMethods.call
  });
  Object.defineProperty(Function.prototype, "__effectful__nativeApply", {
    configurable: true,
    writable: true,
    value: native.FunctionMethods.apply
  });
  Object.defineProperty(Function.prototype, "__effectful__nativeBind", {
    configurable: true,
    writable: true,
    value: native.FunctionMethods.bind
  });
}

/** # for debugger's debug */
function metaDescr(meta) {
  if (!meta) return "<NO META>";
  return `${meta.origName}/${meta.name}@${meta.module.name}:${meta.line}`;
}
function frameLocaction(frame, state) {
  const brk = frame.meta.states[state];
  if (brk) return `${state}@${brk.line}:${brk.column}`;
  return `${state}`;
}
function frameInfoDescr(frame) {
  if (!frame) return "<NO FRAME>";
  return `${frame.restoreEnabled !== undef ? "! " : "  "}${metaDescr(frame.meta)},S:${frameLocaction(frame, frame.state)},G:${frameLocaction(frame, frame.goto)}`;
}
function stackDescr(top = context.top || context.pausedTop) {
  const res = [];
  for (let i = top; i; i = i.next) {
    res.push(frameInfoDescr(i));
  }
  for (let i = 0, len = res.length; i < len; ++i) res[i] = `F${len - i}:${res[i]}`;
  return res;
}
function trace(...args) {
  native.console.log.apply(native.console, args);
}
if (_config.default.verbose) Error.stackTraceLimit = Infinity;
function mergeVersions(from, to) {
  if (typeof from !== "object" || typeof to !== "object") return;
  for (const i of native.Object.keys(to)) {
    const fromProp = from[i];
    const toProp = to[i];
    if (typeof fromProp !== "function" || typeof toProp !== "function") continue;
    const fromClos = closures.get(fromProp);
    const toClos = closures.get(toProp);
    if (!fromClos || !toClos) return;
    const fromMeta = fromClos[CLOSURE_META];
    const toMeta = toClos[CLOSURE_META];
    if (fromMeta.onReload) {
      fromMeta.onReload(fromClos, toClos);
    } else native.Object.assign(fromMeta, toMeta);
    native.Object.assign(fromClos, toClos);
    closures.set(fromProp, toClos);
  }
}
function mergeModule(mod, prevMod) {
  if (!prevMod) return;
  const cjs = mod.cjs;
  const prevCjs = prevMod.cjs;
  if (!cjs || !prevCjs) return;
  if (prevMod.onReload) {
    mod.onReload = prevMod.onReload;
    prevMod.onReload(mod);
  } else {
    mergeVersions(prevCjs.exports, cjs.exports);
  }
}
const isNode = exports.isNode = typeof process !== "undefined" && process.release && process.release.name === "node";
const isBrowser = exports.isBrowser = typeof window !== "undefined" && !isNode;
if (module.hot) module.hot.addStatusHandler(resumeEventQueue);
function staticToMethod(stat) {
  return function () {
    const args = native.Array.from(arguments);
    native.Array.unshift.call(args, this);
    return stat.apply(undefined, args);
  };
}
