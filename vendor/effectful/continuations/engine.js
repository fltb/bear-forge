"use strict";

exports.__esModule = true;
exports.FunctionConstr = void 0;
exports.__effectful_mcall = __effectful_mcall;
exports.argsWrap = argsWrap;
exports.brk = brk;
exports.checkErrBrk = checkErrBrk;
exports.checkExitBrk = checkExitBrk;
exports.clos = void 0;
exports.compileEval = compileEval;
exports.compileEvalToString = compileEvalToString;
exports.compileModule = compileModule;
exports.context = void 0;
exports.copyScope = copyScope;
exports.evalAt = evalAt;
exports.execModule = execModule;
exports.force = force;
exports.frame = void 0;
exports.fun = fun;
exports.getCurModule = getCurModule;
exports.handle = handle;
exports.indirEval = indirEval;
exports.isDelayedResult = isDelayedResult;
exports.iterErr = iterErr;
exports.iterErrUndef = iterErrUndef;
exports.iterFin = iterFin;
exports.iterNext = iterNext;
exports.iterator = iterator;
exports.iteratorM = iteratorM;
exports.location = location;
exports.loop = loop;
exports.makeFrame = makeFrame;
exports.module = _module;
exports.parentTag = void 0;
exports.popFrame = popFrame;
exports.popScope = popScope;
exports.pushFrame = pushFrame;
exports.pushScope = pushScope;
exports.raise = raise;
exports.reset = reset;
exports.resume = resume;
exports.resumeLocal = resumeLocal;
exports.ret = ret;
exports.retModule = retModule;
exports.step = step;
exports.then = then;
exports.token = void 0;
exports.unhandled = unhandled;
var _config = require("./config");
exports.config = _config.default;
var _state = require("./state");
var State = _state;
var TT = require("./timeTravel/frame");
var _parser = {parse(){throw new Error("Dynamic compilation forbidden")}};
var _generator = {default(){throw new Error("Dynamic compilation forbidden")}};
var T = {};
var path = require("path");
var _serialization = require("@effectful/serialization");
var _persist = require("./persist");
var _types = {isValidIdentifier: name => /^[a-zA-Z_$][\w$]*$/.test(name)};
var _stackTrace = require("./stackTrace");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; } /**
 * Functions called from code generated
 * by @effectful/debugger/transform preset
 */
const globalNS = _config.default.globalNS;
const {
  journal,
  context,
  token,
  ctrlToken,
  closures,
  functions,
  thunks,
  CLOSURE_PARENT,
  CLOSURE_VARS,
  CLOSURE_META,
  CLOSURE_FUNC
} = State;
exports.token = token;
exports.context = context;
const nativeFunction = _state.native.Function;
const nativeObject = _state.native.Object;
const __effectful__nativeApply = _state.native.FunctionMethods.apply;
const __effectful__nativeCall = _state.native.FunctionMethods.call;
const defineProperty = nativeObject.defineProperty;
const nativeToString = Function.prototype.toString;
const weakMapSet = _state.native.WeakMap.set;
const weakMapDelete = _state.native.WeakMap.delete;
const setPrototypeOf = nativeObject.setPrototypeOf;
const __effectful__reflectApply = _state.native.Reflect.apply;
let curModule = undefined; // this is always used in context where this is inited
let moduleChanged = false;
const recordFrame = _config.default.timeTravel ? function recordFrame(top) {
  if (top && journal.enabled) TT.recordFrame(top);
} : function recordFrame() {};
class ArgsTraps {
  constructor(func) {
    this.func = func;
    this.$ = func.$;
  }
  set(target, prop, value) {
    if (typeof prop === "symbol" || isNaN(prop)) return Reflect.set(target, prop, value);
    const {
      func
    } = this;
    func.$[func.meta.shift + +prop].value = value;
    return Reflect.set(target, prop, value);
  }
  get(target, prop) {
    if (typeof prop === "symbol" || isNaN(prop)) return Reflect.get(target, prop);
    const meta = this.func.meta;
    const index = +prop;
    if (meta.params.length > index) return this.$[meta.shift + index].value;
    return Reflect.get(target, prop);
  }
}
const objectValues = Object.values;
function compileModule() {
  if (!moduleChanged) {
    if (curModule.exports) curModule.cjs.exports = curModule.exports;
    return null;
  }
  if (curModule.version === void 0) curModule.version = 0;else curModule.version++;
  if (!curModule.topLevel || curModule.topLevel.blackbox) return curModule;
  const funcs = objectValues(curModule.functions).reverse();
  const lines = curModule.lines = new Array(curModule.topLevel.endLine);
  for (const meta of funcs) {
    const states = meta.states;
    for (const state of states) {
      if (state.flags | State.BrkFlag.STMT && state.line) {
        (lines[state.line] || (lines[state.line] = [])).push(state);
      }
    }
    for (let x = states.length; --x;) {
      const state = states[x];
      if (state.flags | State.BrkFlag.STMT && state.line) {
        for (let j = state.line + 1, end = state.endLine; j <= end; ++j) (lines[j] || (lines[j] = [])).push(state);
      }
    }
  }
  let cur = null;
  for (let i = lines.length; i--;) {
    const line = lines[i];
    if (!line) lines[i] = cur;else cur = lines[i];
  }
  return curModule;
}
function getCurModule() {
  return curModule;
}
function argsWrap(frame, value) {
  const arr = _state.native.Array.from(value);
  defineProperty(arr, "callee", {
    writable: true,
    enumerable: false,
    value: frame.func
  });
  return new _state.native.Proxy(arr, new ArgsTraps(frame));
}
function _module(modName, evalContext, cjs, require, safePrefix, closSyms, params, sourceText) {
  let fullPath;
  let name;
  let id;
  curModule = null;
  if (typeof modName === "number") {
    id = modName;
    name = `#eval_${id}.js`;
  } else {
    name = modName;
    fullPath = (0, _state.normalizeDrive)(path.join(_config.default.srcRoot, name));
  }
  let prevVersion = _config.default.hot === false ? null : context.modules[fullPath || id];
  if (_config.default.hot === true) curModule = prevVersion;
  if (!require) require = closSyms["__webpack_require__"];
  if (cjs) {
    if (_config.default.hot === true && cjs.hot) {
      cjs.hot.accept();
    }
    // something is loaded with node and webpack for example
    if (prevVersion && (!prevVersion.cjs || prevVersion.cjs.id !== cjs.id)) prevVersion = curModule = null;
  }
  (0, _persist.regOpaqueObject)(cjs, `cjs#${name}`);
  moduleChanged = !curModule;
  if (!curModule) {
    curModule = {
      functions: {},
      prevVersion
    };
    if (prevVersion) prevVersion.prevVersion = null;
  }
  curModule.sourceText = sourceText;
  curModule.topLevel = null;
  (0, _persist.regOpaqueObject)(cjs, name + "$mod");
  context.modules[fullPath || id] = curModule;
  (0, _serialization.setObjectDescriptor)(curModule, _persist.ModuleDescriptor);
  if (cjs) {
    context.modulesById[cjs.id] = curModule;
    (0, _persist.regOpaqueObject)(cjs, `${cjs.id}$mod`);
  }
  curModule.name = name;
  curModule.require = require;
  curModule.fullPath = fullPath;
  curModule.id = id;
  context.moduleId = cjs && cjs.id || null;
  curModule.cjs = cjs;
  curModule.evalContext = evalContext;
  curModule.safePrefix = safePrefix;
  curModule.api = this;
  curModule.closSyms = closSyms;
  curModule.params = params;
  curModule.onReload = null;
  return curModule;
}
let metaCount = 0;
const parentTag = exports.parentTag = {
  _parentTag: true
};
function fun(name, origName, calleeName, parentConstr, params, localsNum, varsNum, loc, flags, handler, errHandler, finHandler, scopeDepth, states, compiledFactory, sourceRange) {
  const top = !curModule.topLevel;
  let meta = curModule.functions[name];
  if (meta) {
    if (nativeToString.call(handler) === nativeToString.call(meta.handler)) {
      if (top) curModule.topLevel = meta;
      meta.handler = handler;
      return meta.func;
    }
    moduleChanged = true;
  } else if (!meta) meta = curModule.functions[name] = {};
  if (top) curModule.topLevel = meta;
  if (!errHandler) errHandler = _state.defaultErrHandler;
  if (!finHandler) finHandler = _state.defaultFinHandler;
  const names = [origName || "*"];
  let parent = null;
  if (parentConstr) parent = functions.get(parentConstr);
  for (let p = parent; p; p = p.parent) names.unshift(p.name);
  const uniqName = `${curModule.name}#${names.join(".")}`;
  const fullName = `${uniqName}@${loc || "?"}`;
  let persistName = parent ? parent.persistName : curModule.name;
  if (!top) persistName += "#" + (origName || "*");
  const memo = [];
  const evalContext = curModule.evalContext || {};
  if (loc) {
    meta.location = loc;
    [meta.line, meta.column, meta.endLine, meta.endColumn] = location(loc);
  }
  for (const [flags, loc, scope] of states) {
    const [line, column, endLine, endColumn] = location(loc);
    const id = memo.length;
    const brk = {
      flags,
      id,
      meta,
      line,
      column,
      endLine,
      endColumn,
      scope: scope ? buildScope(scope, evalContext) : evalContext,
      scopeDepth: scope[2],
      location: strLoc(line, column, endLine, endColumn),
      breakpoint: null,
      logPoint: null
    };
    (0, _persist.regOpaqueObject)(brk, `s#${persistName}#${id}`);
    memo.push(brk);
  }
  meta.sourceRange = sourceRange;
  meta.varsNum = varsNum;
  meta.shift = calleeName ? 2 : 1;
  meta.exitBreakpoint = memo[memo.length - 1];
  meta.blackbox = (flags & _state.Flag.BLACKBOX) !== 0;
  meta.origName = origName || "(anonymous)";
  meta.calleeName = calleeName;
  meta.module = curModule;
  meta.flags = flags || 0;
  meta.handler = handler;
  meta.errHandler = errHandler;
  meta.finHandler = finHandler;
  meta.name = name;
  meta.fullName = fullName;
  meta.parent = parent;
  meta.uniqName = uniqName;
  meta.persistName = persistName;
  meta.params = params;
  meta.localsNum = localsNum;
  meta.errState = states.length - 2;
  meta.finState = states.length - 1;
  if (meta.id == null) meta.id = metaCount++;
  meta.states = memo;
  meta.statesByLine = memo.filter(hasLine).sort(byLine);
  meta.deps = [];
  meta.scopeDepth = scopeDepth;
  meta.onReload = null;
  if (parent) parent.deps.push(meta);
  const headLines = [];
  const ctx = curModule.safePrefix;
  let funcName = meta.origName;
  if (funcName) {
    if (!(0, _types.isValidIdentifier)(funcName) || meta.params.indexOf(funcName) !== -1) funcName = ctx + funcName.replace(/\W/g, "_");
  } else {
    funcName = ctx + meta.name;
  }
  const varsInit = [`${ctx}.$`];
  if (meta.calleeName) varsInit.push(funcName);
  varsInit.push.apply(varsInit, _toConsumableArray(meta.params));
  varsInit.fill("void 0", varsInit.length, varsInit.length = meta.varsNum);
  headLines.push(`${ctx}.$ = [${varsInit.join()}]`);
  const isArrow = flags & _state.Flag.ARROW_FUNCTION;
  const isAsync = flags & _state.Flag.ASYNC_FUNCTION;
  const isGenerator = flags & _state.Flag.GENERATOR_FUNCTION;
  const wrapperKind = flags & (_state.Flag.GENERATOR_WRAPPER | _state.Flag.ASYNC_GENERATOR_WRAPPER);
  if (flags & _state.Flag.HAS_THIS) headLines.push(`${ctx}.self = ${isArrow ? ctx + "$.self" : "this"}`);
  if (flags & _state.Flag.HAS_ARGUMENTS) headLines.push(`${ctx}.args = ${isArrow ? ctx + "$.args" : `${ctx}args(${ctx},arguments)`}`);
  const api = curModule.api;
  let headCode;
  if (isGenerator) {
    headCode = `return ${ctx}.iter /* regenerator */`;
  } else {
    headCode = `
      try {
        ${ctx}pushFrame(${ctx},${funcName});
        return ${ctx}.meta.handler(${ctx}, ${ctx}.$, null);
      } catch(e) {
        return ${ctx}M.handle(${ctx}, e);
      }`;
  }
  const constrParams = ["module", "exports", `${ctx}args`, `${ctx}context`, `${ctx}m`, `${ctx}M`, `${ctx}clos`, `${ctx}frame`, `${ctx}pushFrame`];
  const cjs = curModule.cjs;
  const closureFactory = flags & _state.Flag.ASYNC_WRAPPER ? api.closA
    : wrapperKind ? flags & _state.Flag.ASYNC_GENERATOR_WRAPPER ? api.closAG : api.closG
    : isGenerator ? isAsync ? api.closAG : api.closG : isAsync ? api.closA : api.clos;
  const frameFactory = isAsync ? isGenerator ? api.frameAG : api.frameA : isGenerator ? api.frameG : api.frame;
  const args = [cjs, cjs && cjs.exports, argsWrap, context, meta, api, closureFactory, frameFactory, api.pushFrame];
  constrParams.push(`return (function(${ctx}$){
    var ${ctx}x = [${ctx}$,${ctx}$ && ${ctx}$.$,${ctx}m,function ${funcName}(${meta.params.join()}) {
      ${flags & _state.Flag.SLOPPY ? "" : '"use strict";'}
      var ${ctx} = ${ctx}frame(${ctx}x,new.target);
      ${headLines.join("\n")}
      ${headCode}
    }]
    return ${ctx}clos(${ctx}x);
})`);
  if (typeof compiledFactory !== "function") throw new Error("Missing compiled function factory");
  const constr = compiledFactory(...args);
  meta.func = constr;
  weakMapSet.call(functions, constr, meta);
  if (_config.default.expFunctionConstr) constr.constructor = FunctionConstr;
  if (_config.default.persistState) (0, _persist.regFun)(meta);
  return meta.func;
}
function hasLine(b) {
  return (b.flags & State.BrkFlag.STMT) !== 0 && b.line > 0;
}
function byLine(a, b) {
  return a.line - b.line;
}
function strLoc(line, column, endLine, endColumn) {
  return `${line || "?"}:${column == null ? "?" : column}-${endLine || "?"}:${endColumn == null ? "?" : endColumn}`;
}
function buildScope(scope, parent) {
  if (scope == null) return parent;
  if (scope.length === 4) return scope[3];
  const [vars, par, depth] = scope;
  const scopeInfo = Object.create(null);
  scope.push(scopeInfo);
  const parScope = par ? buildScope(par, parent) : parent;
  if (parScope) Object.assign(scopeInfo, parScope);
  for (const [i, info] of vars) {
    if (!info) continue;
    const [declDepth, declLoc] = info;
    scopeInfo[i] = [declDepth, depth, declLoc];
  }
  return scopeInfo;
}
const clos = exports.clos = _config.default.persistState ? function clos(closure, deferred) {
  const func = closure[CLOSURE_FUNC];
  weakMapSet.call(closures, func, closure);
  return !deferred && context.allocateFunction ? context.allocateFunction(func) : func;
} : function clos(closure, deferred) {
  const func = closure[CLOSURE_FUNC];
  setPrototypeOf(func, FunctionConstr.prototype);
  weakMapSet.call(closures, func, closure);
  return !deferred && context.allocateFunction ? context.allocateFunction(func) : func;
};
function __effectful__apply() {
  if (context.call === __effectful__apply) context.call = this;
  return __effectful__reflectApply(__effectful__nativeApply, this, arguments);
}
function __effectful__call() {
  if (context.call === __effectful__call) context.call = this;
  return __effectful__reflectApply(__effectful__nativeCall, this, arguments);
}
function pushScope(varsNum) {
  const top = context.top;
  const cur = Array(varsNum);
  cur[0] = top.$;
  return top.$ = cur;
}
function copyScope() {
  const top = context.top;
  return top.$ = top.$.slice();
}
function popScope() {
  const top = context.top;
  return top.$ = top.$[0];
}
function __effectful_mcall(prop, ...args) {
  if (context.operations) {
    const operations = context.operations;
    // The compiler's own helper table is frozen and has only own data methods.
    // Looking up one of these methods cannot enter author code. Keep invoke
    // (argument admission, result charging and dispatcher state) unchanged;
    // only omit the redundant generic property lookup on this exact table.
    const method = args[0] === operations && typeof prop === 'string' && Object.hasOwn(operations, prop)
      ? operations[prop] : operations.get(operations.ref(args[0], prop));
    return operations.invoke(method, args[0], args.slice(1));
  }
  if ((prop === 'call' || prop === 'apply') && context.methods?.has(args[0])) args[0] = context.methods.get(args[0]);
  const original = args[0][prop];
  const func = context.methods?.get(original) ?? original;
  if (!func) throw new TypeError(`${prop} isn't a function`);
  return __effectful__reflectApply(__effectful__nativeCall, context.call = func, args);
}

/**
 * runs a computation until it encounters some breakpoint (returns `token`)
 * or finishes the whole computation (returns the resulting value or throws an exception)
 */
function step(till = null) {
  try {
    context.running = true;
    let value = context.value;
    let top = context.top;
    let error = context.error;
    context.value = void 0;
    context.error = false;
    if (!top) return value;
    if (error) {
      if (value === ctrlToken) {
        if (checkCtrlToken(value, top, till)) return loop(context.value, till);
        top = context.top;
        value = context.value;
        context.value = void 0;
        if (!top) throw value;
        error = true;
      }
      if (!context.__budgetExceeded) context.prepareException?.(value);
      top.error = value;
      top.meta.errHandler(top, top.$);
    }
    if (top.brk && top.brk.flags & _state.BrkFlag.EXIT) {
      if (!context.enabled) {
        const restoreDebug = top.restoreEnabled;
        if (restoreDebug !== _state.undef) {
          context.enabled = true;
          context.call = restoreDebug;
        }
      }
      popFrame(top);
    }
    return loop(value, till);
  } finally {
    context.running = false;
  }
}
function checkCtrlToken(e, top, till) {
  for (let i = top.next; i; i = i.next) {
    if (i === till) throw e;
    if (i === context.unwindingTill) {
      context.unwindingTill = null;
      const body = context.unwindingBody;
      context.unwindingBody = null;
      context.top = i;
      try {
        context.value = body();
        return true;
      } catch (e) {
        if (e === ctrlToken) continue;
        context.value = e;
        return false;
      }
    }
  }
  throw new Error("INTERNAL: shouldn't happen");
}
function loop(value, till = null) {
  let top = context.top;
  while (top && top !== till) {
    try {
      recordFrame(top);
      value = top.meta.handler(top, top.$, value);
      top = context.top;
    } catch (ep) {
      let e = ep;
      if (e === ctrlToken) {
        const cont = checkCtrlToken(e, top, till);
        top = context.top;
        if (cont) {
          value = context.value;
          context.value = void 0;
          continue;
        }
        e = context.value;
        context.value = void 0;
      }
      if (e === token) {
        if (till) throw e;
        context.onStop();
        return e;
      }
      const frame = top;
      if (!context.__budgetExceeded) context.prepareException?.(e);
      frame.error = e;
      if (!frame.meta.blackbox && context.exception !== e && checkErrBrk(frame, e)) {
        context.value = e;
        context.error = true;
        context.top = top;
        context.onStop();
        return token;
      }
      top = context.top;
      if (!top || top === till) {
        if (_config.default.verbose) {
          // tslint:disable-next-line:no-console
          console.error(`Uncaught exception: ${e}(on any:${!!context.brkOnAnyException},on uncaught:${!!context.brkOnUncaughtException})`);
          if (_config.default.debuggerDebug && e.stack) {
            // tslint:disable-next-line:no-console
            console.error("Real stack:", e.stack);
            // tslint:disable-next-line:no-console
            console.error("Original stack:", e._deb_stack);
          }
        }
        throw e;
      }
      top.error = value = e;
      top.meta.errHandler(top, top.$);
    }
  }
  return value;
}

/** resumes execution of the current stack */
function resume(frame, e) {
  try {
    frame.next = context.top;
    context.top = frame;
    recordFrame(frame);
    return frame.meta.handler(frame, frame.$, e);
  } catch (e) {
    return handle(frame, e);
  }
}

/** like `resume` but appends the frame to the current stack */
function resumeLocal(frame, e) {
  try {
    frame.caller = frame.next = context.top;
    context.top = frame;
    recordFrame(frame);
    return frame.meta.handler(frame, frame.$, e);
  } catch (e) {
    return handle(frame, e);
  }
}

/** checks if the current frame's state has an exception handler */
function hasEH(frame) {
  return (frame.meta.states[frame.state].flags & _state.BrkFlag.HAS_EH) !== 0;
}
function checkErrBrk(frame, e) {
  if (!context.enabled || e === ctrlToken) return false;
  context.exception = e;
  if (e && e.stack) {
    (0, _stackTrace.captureStackTraceFrom)(e, null, frame, true);
  }
  let needsStop = false;
  if (context.brkOnAnyException) {
    if (context.brkOnAnyExceptionFilter == null || context.brkOnAnyExceptionFilter(e)) needsStop = true;
  } else if (context.brkOnUncaughtException) {
    // avoiding running finally blocks
    needsStop = true;
    for (let i = frame; i; i = i.caller) {
      if (hasEH(i)) {
        needsStop = (i.meta.flags & _state.Flag.EXCEPTION_BOUNDARY) !== 0;
        break;
      }
    }
  }
  if (needsStop) frame.stopReason = "exception";
  return needsStop;
}
function handle(frame, e) {
  // A latched execution budget is terminal, including when an async rejection
  // resumes a frame. Redispatching its catch handler would throw the same fault
  // back into this loop without ever unwinding to the instance boundary.
  if (context.__budgetExceeded) throw e;
  if (e === ctrlToken) {
    if (frame.next === context.unwindingTill) {
      const body = context.unwindingBody;
      context.unwindingTill = null;
      context.unwindingBody = null;
      context.top = frame.next;
      return body();
    }
    throw e;
  }
  for (;;) {
    if (context.__budgetExceeded) throw e;
    if (e === token) {
      if (context.running || frame.next) throw e;
      context.onStop();
      return e;
    }
    if (frame !== context.top) throw e;
    // tslint:disable-next-line:no-console
    const meta = frame.meta;
    context.prepareException?.(e);
    frame.error = e;
    if (!meta.blackbox && e !== context.exception && checkErrBrk(frame, e)) {
      context.value = e;
      context.error = true;
      context.top = frame;
      if (frame.next) throw token;
      context.onStop();
      return token;
    }
    meta.errHandler(frame, frame.$);
    try {
      recordFrame(frame);
      return frame.meta.handler(frame, frame.$, null);
    } catch (ex) {
      e = ex;
    }
  }
}
function evalAt(src) {
  const top = context.top;
  const meta = top.meta;
  const state = top.meta.states[top.state];
  const memo = meta.evalMemo || (meta.evalMemo = new _state.native.Map());
  const key = `${src}@${meta.module.name}@${meta.uniqName}@${state ? state.id : "*"}/${context.enabled}}`;
  let resMeta = memo.get(key);
  if (!resMeta) {
    resMeta = compileEval(src, meta.module, state.scope, state.scopeDepth + 1, !context.enabled, null);
    memo.set(key, resMeta);
  }
  const func = resMeta.func(top);
  context.call = func;
  return __effectful__nativeCall.call(func, top.self);
}
const locationRE = /^(\d+):(\d+)-(\d+):(\d+)$/;
const undefLoc = [0, 0, 0, 0];

/** parses location string into a tuple with a line, a column, a last last and a last column */
function location(str) {
  if (!str) return undefLoc;
  const res = [];
  const re = locationRE.exec(str);
  if (!re || re.length < 5) return res;
  for (let i = 1; i < 5; i++) res.push(+re[i]);
  return res;
}
let evalCnt = 0;
const indirMemo = new _state.native.Map();

/**
 * Like `compileEval` but returns a self-sufficient string, which can be
 * passed to, say, "vm". However, it doesn't memoize meta-data construction
 * (like `compileEval` does) though.
 */
function compileEvalToString(code, params) {
  const savedEnabled = journal.enabled;
  try {
    journal.enabled = false;
    const top = context.top;
    const meta = top && top.meta;
    const blackbox = !meta || meta.blackbox;
    const key = code + "@" + blackbox;
    let tgt = indirMemo.get(key);
    if (tgt) return tgt;
    const id = (0, _state.toGlobal)(++evalCnt);
    if (!blackbox) context.onNewSource(id, code);
    const ast = (0, _parser.parse)(code, {
      allowReturnOutsideFunction: true
    });
    if (params == null) {
      const body = ast.program.body;
      if (body.length === 1 && body[0].type === "ExpressionStatement") body[0] = {
        type: "ReturnStatement",
        argument: body[0].expression
      };
    }
    tgt = (0, _generator.default)(T.run(ast, {
      preInstrumentedLibs: true,
      blackbox,
      pureModule: true,
      evalContext: null,
      evalParams: params,
      rt: false,
      ns: globalNS,
      relativeName: id,
      filename: `VM${id}.js`,
      iifeWrap: true,
      moduleExports: params == null ? "execModule" : "retModule",
      constrParams: {
        code
      },
      timeTravel: _config.default.timeTravel,
      implicitCalls: _config.default.implicitCalls
    }), {
      compact: true
    }).code;
    indirMemo.set(key, tgt);
    return `/*!EDBG!*/(function() { ${tgt}; })()`;
  } finally {
    journal.enabled = savedEnabled;
  }
}

/**
 * executes a top level function for a current module
 * this is an API required for `compileEvalToString`
 */
function execModule() {
  compileModule();
  return (context.call = curModule.topLevel.func(null))();
}

/**
 * returns a top level function for a current module
 * this is an API required for `compileEvalToString`
 */
function retModule() {
  compileModule();
  return curModule.topLevel.func(null);
}
const functionConstrMemo = new _state.native.Map();
const savedEval = eval;
const FunctionConstr = exports.FunctionConstr = function Function(...args) {
  let res;
  if (context.enabled && context.call === Function) {
    const code = args.pop();
    const key = `${code}@Fn@/${context.enabled}/${args.join()}`;
    let meta = functionConstrMemo.get(key);
    if (!meta) {
      meta = compileEval(code, context.top && context.top.meta && context.top.meta.module || null, null, 0, !context.enabled, args);
      functionConstrMemo.set(key, meta);
    }
    res = meta.func(null);
  } else res = _state.native.Reflect.construct(nativeFunction, args);
  res.constructor = Function;
  return res;
};
if (_config.default.patchRT) {
  FunctionConstr.prototype = Function.prototype;
  defineProperty(FunctionConstr.prototype, "call", {
    configurable: true,
    writable: true,
    value: __effectful__call
  });
  defineProperty(FunctionConstr.prototype, "apply", {
    configurable: true,
    writable: true,
    value: __effectful__apply
  });
  defineProperty(FunctionConstr.prototype, "bind", {
    configurable: true,
    writable: true,
    value: _persist.defaultBind
  });
  defineProperty(FunctionConstr.prototype, "toString", {
    configurable: true,
    writable: true,
    value() {
      // nothing to see here (lodash refuses to work with not native functions)
      const params = "";
      const name = this.name;
      const data = closures.get(this);
      if (data && data[CLOSURE_META] && !data[CLOSURE_META].blackbox || !State.nativeFuncs.has(this)) return nativeToString.call(this);
      return `function ${name || ""}(${params}) { [native code] }`;
    }
  });
}
(0, _persist.regOpaqueObject)(FunctionConstr, "@effectful/debugger/Function");
(0, _persist.regOpaqueObject)(__effectful__call, "@effectful/debugger/call");
(0, _persist.regOpaqueObject)(__effectful__apply, "@effectful/debugger/apply");
(0, _persist.regOpaqueObject)(_persist.defaultBind, "@effectful/debugger/bind");
function indirEval(code) {
  if (!context.enabled || context.call !== indirEval) return savedEval(code);
  const meta = compileEval(code, context.top ? context.top.meta.module : null, null, 0, !context.enabled, null);
  const func = meta.func(null);
  context.call = func;
  return __effectful__nativeCall.call(func, void 0);
}
function trim(n) {
  return n.trim();
}
function splitParams(param) {
  return param.split(",").map(trim);
}
function compileEval(code, mod, evalContext, scopeDepth, blackbox, params, id) {
  const savedEnabled = journal.enabled;
  blackbox = blackbox || !context.top || context.top.meta.blackbox;
  try {
    journal.enabled = false;
    if (id == null) id = (0, _state.toGlobal)(++evalCnt);
    if (!blackbox) context.onNewSource(id, code);
    const ast = (0, _parser.parse)(code, {
      allowReturnOutsideFunction: true
    });
    if (params == null) {
      const body = ast.program.body;
      if (body.length === 1 && body[0].type === "ExpressionStatement") body[0] = {
        type: "ReturnStatement",
        argument: body[0].expression
      };
    } else {
      var _ref;
      params = (_ref = []).concat.apply(_ref, _toConsumableArray(params.map(splitParams)));
    }
    const tgt = (0, _generator.default)(T.run(ast, {
      preInstrumentedLibs: true,
      blackbox,
      exclude: false,
      pureModule: true,
      evalContext,
      evalParams: params,
      rt: false,
      ns: globalNS,
      relativeName: id,
      filename: `VM${id}.js`,
      moduleExports: null,
      iifeWrap: false,
      scopeDepth,
      constrParams: null,
      timeTravel: _config.default.timeTravel,
      implicitCalls: _config.default.implicitCalls
    }), {
      compact: true
    }).code;
    const cjs = mod && mod.cjs;
    new nativeFunction("exports", "require", "module", "__filename", "__dirname", tgt)(
    // exports,
    mod && mod.exports, mod && mod.require || cjs && cjs.require, mod, mod ? mod.fullPath : ".", mod && mod.fullPath ? path.dirname(mod.fullPath) : "");
    curModule.params = {
      code,
      parent: mod && (mod.fullPath || mod.id),
      evalContext,
      scopeDepth,
      id,
      params,
      blackbox
    };
    compileModule();
    const res = curModule.topLevel;
    return res;
  } finally {
    journal.enabled = savedEnabled;
  }
}
function isDelayedResult(value) {
  return value === token;
}
let frameCounter = 0;
function makeFrame(closure, newTarget, transient = false) {
  if (!newTarget && context.takeConstructTarget) newTarget = context.takeConstructTarget(closure[CLOSURE_FUNC]);
  if (context.operations) newTarget = context.operations.originalNewTarget(newTarget);
  const $g = global;
  const frame = {
    $: closure[CLOSURE_VARS],
    id: frameCounter++,
    closure,
    func: closure[CLOSURE_FUNC],
    $g,
    meta: closure[CLOSURE_META],
    state: 0,
    goto: 0,
    flags: 0,
    parent: closure[CLOSURE_PARENT],
    newTarget,
    brk: null,
    next: null,
    caller: null,
    restoreEnabled: _state.undef,
    awaiting: token,
    stopReason: null,
    onReturn: null,
    onError: null,
    promise: null,
    timestamp: journal.now,
    result: void 0,
    error: void 0,
    self: void 0,
    args: void 0
  };
  return context.createFrame ? context.createFrame(frame, transient) : frame;
}
let TOP_LINES_STACK_NUM = 2;
const isStackFrameLine = State.isNode ? function isStackFrameLine(line) {
  line = line.trim();
  if (line.length === 0) return false;
  let f = line;
  for (;;) {
    const m = /\((.+):\d+:\d+\)/g.exec(f);
    if (!m) break;
    f = m[1];
  }
  if (!path.isAbsolute(f) && f[0] !== ".") return false;
  return !/__effectful__/g.test(line);
} : function isStackFrameLine(line) {
  return line.trim().length > 0 && !/__effectful__|\(events\.js:|\(net\.js:|\bprocess\/browser\.js|\bdrainQueue\b/g.test(line);
};
function numFrames(e) {
  const s = String(e.stack).split("\n").filter(isStackFrameLine);
  return s.length;
}

// maybe there is a better way, but we need to know if the function call is async
// we just compare stack trace lines size here
const nativeSetTimeout = _state.native.setTimeout;
if (context.enabled) nativeSetTimeout(function setupTopNumFrames() {
  TOP_LINES_STACK_NUM = numFrames(new Error("__effectful__stack")) + 1;
}, 0);

// let schedulingThread = false;

function scheduleCurrentThread() {
  context.queue.push({
    top: context.top,
    debug: context.enabled,
    value: context.value
  });
  if (_config.default.verbose) (0, _state.trace)(`DEBUGGER: schedule a thread: ${State.stackDescr().join(" ==> ")}`);
  context.top = null;
  (0, _state.signalThread)();
  throw token;
}
function pushFrame(frame, redir) {
  const next = context.top;
  frame.next = frame.caller = next;
  const res = context.top = frame;
  if (next) {
    if (context.enabled) {
      if (!context.launched && !frame.meta.blackbox) {
        State.pauseEventQueue();
        scheduleCurrentThread();
      }
      if (context.call !== redir) {
        // maybe it is called via older version
        frame.restoreEnabled = context.call;
        context.enabled = false;
      }
    }
  } else {
    context.onFirstFrame();
    if (!context.running && context.enabled) {
      // so suddenly some transpiled function is executed
      // we could use `caller === null` but it could be called from a strict mode
      // on FF this is one line, but on Chrome two
      // the condition probably not always works
      if (numFrames(new Error("__effectful__stack")) <= TOP_LINES_STACK_NUM) {
        // we don't want that code to run if something is stopped on a breakpoint already
        // this way order of async functions is preserved
        if (context.pausedTop || context.queue.length) scheduleCurrentThread();
      }
    }
  }
  return res;
}
function popFrame(top) {
  const next = top.next;
  if ((context.top = next) == null) (0, _state.signalThread)();else recordFrame(next);
}
const frame = exports.frame = _config.default.timeTravel ? function frame(closure, newTarget) {
  const top = context.top;
  recordFrame(top);
  return makeFrame(closure, newTarget);
} : makeFrame;
function checkExitBrk(top, value) {
  const meta = top.meta;
  if (meta.blackbox) return;
  const brk = context.brk = top.brk = meta.exitBreakpoint;
  if (brk && context.needsBreak(brk, top, value)) {
    context.value = value;
    context.error = false;
    throw token;
  }
}
function ret(value) {
  const top = context.top;
  if (top.meta.flags & (_state.Flag.GENERATOR_WRAPPER | _state.Flag.ASYNC_GENERATOR_WRAPPER)) {
    const prototype = context.operations
      ? context.operations.get(context.operations.ref(top.func, "prototype"))
      : top.func.prototype;
    const fallback = top.meta.flags & _state.Flag.ASYNC_GENERATOR_WRAPPER
      ? top.meta.module.api.AsyncGenerator.prototype : top.meta.module.api.Generator.prototype;
    const targetPrototype = prototype !== null && (typeof prototype === "object" || typeof prototype === "function") ? prototype : fallback;
    if (context.operations) context.operations.invoke(nativeObject.setPrototypeOf, nativeObject, [value, targetPrototype]);
    else nativeObject.setPrototypeOf(value, targetPrototype);
  }
  if (top.newTarget && (!value || typeof value !== "object" && typeof value !== "function")) value = top.self;
  top.result = void 0;
  top.flags |= State.FrameFlags.Done;
  if (top.onReturn) {
    context.call = top.onReturn;
    top.onReturn(value);
  }
  if (context.enabled) {
    checkExitBrk(top, value);
  } else if (top.restoreEnabled !== _state.undef) {
    context.enabled = true;
    context.call = top.restoreEnabled;
  }
  popFrame(top);
  return value;
}
function unhandled(e) {
  const top = context.top;
  // top.state = top.goto = 0;
  if (top.onError) {
    context.call = top.onError;
    top.onError(e);
  }
  top.error = void 0;
  top.flags |= State.FrameFlags.Done;
  if (!context.enabled) {
    const restoreDebug = top.restoreEnabled;
    if (restoreDebug !== _state.undef) {
      context.enabled = true;
      context.call = restoreDebug;
    }
  }
  popFrame(top);
  throw e;
}
function brk() {
  const {
    needsBreak,
    top
  } = context;
  if (!top) return;
  const p = top.brk = context.brk = top.meta.states[top.state];
  if (!p) return;
  if (!needsBreak(p, top) || !context.enabled) return;
  throw token;
}
function iterator(v) {
  return __effectful_mcall(Symbol.iterator, v);
}
function iteratorM(v) {
  return __effectful_mcall(v[Symbol.asyncIterator] ? Symbol.asyncIterator : Symbol.iterator, v);
}
function then(p, onResolve, onReject) {
  const operations = context.operations;
  if (!operations) throw new TypeError("Controlled await requires operations");
  context.call = Promise.resolve;
  const res = operations.invoke(Promise.resolve, Promise, [p]);
  // Await uses the intrinsic Promise continuation, not an own `then` that
  // author code may have installed on an already-resolved Promise instance.
  const method = Promise.prototype.then;
  context.call = method;
  return operations.invoke(method, res, [onResolve, onReject]);
}
function raise(e) {
  context.exception = _state.undef;
  throw e;
}
/** resets module's states (for tests) */
function reset() {
  metaCount = 0;
  indirMemo.clear();
  functionConstrMemo.clear();
  context.pausedTop = context.top = null;
  context.running = false;
  context.brk = null;
  context.queue.length = 0;
  context.launched = false;
}
function iterErr(iter, reason) {
  const method = context.operations ? context.operations.get(context.operations.ref(iter, 'throw')) : iter.throw;
  if (method == null) throw reason;
  if (context.operations) return context.operations.invoke(method, iter, [reason]);
  context.call = method; return method.call(iter, reason);
}
function iterErrUndef() {
  return TypeError("The iterator does not provide a 'throw' method.");
}
function iterFin(iter, value) {
  const method = context.operations ? context.operations.get(context.operations.ref(iter, 'return')) : iter.return;
  if (method == null) return {
    value,
    done: true
  };
  if (context.operations) return context.operations.invoke(method, iter, [value]);
  context.call = method; return method.call(iter, value);
}
function iterNext(iter, value) {
  return __effectful_mcall('next', iter, value);
}

/**
 * if `value` is a lazy thunk it is executed and its result is returned
 * otherwise `value` is returned as is
 */
function force(value) {
  if (!value) return value;
  const thunk = thunks.get(value);
  if (thunk === void 0) {
    return value;
  }
  // defineProperty(value, thunkSymbol, { value: null, configurable: true });
  weakMapDelete.call(thunks, value);
  return thunk();
}
(0, _persist.regOpaqueObject)(__effectful__nativeCall, "@effectful/debugger/native/call");
(0, _persist.regOpaqueObject)(__effectful__nativeApply, "@effectful/debugger/native/apply");
