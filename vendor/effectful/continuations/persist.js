"use strict";

exports.__esModule = true;
exports.extra = exports.defaultBind = exports.ModuleDescriptor = exports.FunctionDescriptor = void 0;
exports.opaqueWeakMap = opaqueWeakMap;
exports.opaqueWeakSet = opaqueWeakSet;
exports.makeBind = makeBind;
exports.regDescriptor = exports.regConstructor = exports.regAutoOpaqueConstr = void 0;
exports.regFun = regFun;
exports.regModule = regModule;
exports.setObjectDescriptor = exports.regOpaqueRec = exports.regOpaqueObject = void 0;
var State = require("./state");
var S = require("@effectful/serialization");
var _config = require("./config");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function nop() {}
const {
  context,
  defaultErrHandler,
  defaultFinHandler,
  native,
  closures,
  binds,
  undef,
  CLOSURE_META,
  CLOSURE_PARENT,
  CLOSURE_VARS
} = State;
const weakMapSet = native.WeakMap.set;
const nativeReflectApply = native.Reflect.apply;
const regOpaqueRec = exports.regOpaqueRec = _config.default.persistState ? S.regOpaqueRec : nop;
const regAutoOpaqueConstr = exports.regAutoOpaqueConstr = _config.default.persistState ? S.regAutoOpaqueConstr : nop;
const setObjectDescriptor = exports.setObjectDescriptor = _config.default.persistState ? S.setObjectDescriptor : nop;
const noProps = {
  props: false,
  propsSnapshot: false
};
const regOpaqueObject = exports.regOpaqueObject = _config.default.persistState ? function (obj, name) {
  S.regOpaqueObject(obj, name, noProps);
} : nop;
const regDescriptor = exports.regDescriptor = _config.default.persistState ? S.regDescriptor : nop;
const regConstructor = exports.regConstructor = _config.default.persistState ? S.regConstructor : nop;
function propertyStorage(value) {
  const storage = context.objects || context.memory?.objects;
  return storage?.has(value) ? storage : undefined;
}
function ownDescriptors(value) {
  const storage = propertyStorage(value);
  if (!storage) return Object.getOwnPropertyDescriptors(value);
  const descriptors = Object.create(null);
  for (const key of storage.ownKeys(value)) descriptors[key] = storage.getOwnPropertyDescriptor(value, key);
  return descriptors;
}
function restoreFunction(value) {
  return context.allocate ? context.allocate(value) : value;
}
// Runtime-owned metadata initialization must not consume author execution
// budget after a completion has already been committed.
exports.defineFunctionProperties = function(value, descriptors) {
  const storage = propertyStorage(value);
  if (!storage) return Object.defineProperties(value, descriptors);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (!storage.defineProperty(value, key, descriptors[key])) throw new TypeError('Cannot initialize function metadata');
  }
  return value;
};

/** `Serialization.regOpaqueDeep` for module exports */
function regModule(exp, name) {
  // Exported schema/program closures capture mutable module environments.
  // They must use their real object/function descriptors, not opaque names.
}

// Host message ports/channels are not capabilities; never patch their prototypes.
const ModuleDescriptor = exports.ModuleDescriptor = S.regDescriptor({
  name: "@effectful/debugger/module",
  create(_ctx, json) {
    return context.modules[json.id] || {};
  },
  readContent(ctx, json, module) {
    if (module.cjs && json.exports) {
      module.exports = module.cjs.exports = ctx.step(json.exports);
    }
  },
  write(ctx, module) {
    const res = {
      id: module.fullPath || module.id
    };
    if (module.cjs) res.exports = ctx.step(module.cjs.exports, res, "exports");
    return res;
  },
  props: false
});
const FunctionDescriptor = exports.FunctionDescriptor = S.regDescriptor({
  name: "#F",
  completeOwnProperties: true,
  propertyStorage, ownDescriptors,
  create(ctx, json) {
    const meta = ctx.createStep(json.m);
    const parentJson = json.c;
    let parent = null;
    if (parentJson) {
      parent = ctx.createStep(parentJson);
    }
    return restoreFunction(meta.func(parent, json.v ? ctx.createStep(json.v) : undefined, true));
  },
  readContent(ctx, json, value) {
    if (json.c) State.closures.get(value)[CLOSURE_PARENT] = ctx.step(json.c);
    if (json.v) State.closures.get(value)[CLOSURE_VARS] = ctx.step(json.v);
  },
  write(ctx, value) {
    const json = {};
    const descr = State.closures.get(value);
    json.m = ctx.step(descr[CLOSURE_META], json, "m");
    const parent = descr[CLOSURE_PARENT];
    if (parent) {
      // `p` is reserved by the own-property codec for [[Prototype]].
      json.c = ctx.step(parent, json, "c");
    }
    if (descr[CLOSURE_VARS]) json.v = ctx.step(descr[CLOSURE_VARS], json, "v");
    return json;
  }
});
// Closure identity already lives in the private closure table. Resolve its
// codec on demand instead of allocating a duplicate weak-map entry per clone.
const previousObjectDescriptor = S.getObjectDescriptor;
if (_config.default.persistState)
  S.regObjectDescriptorGetter(value => S.getState().byObject.get(value) ||
    (closures.has(value) ? FunctionDescriptor : previousObjectDescriptor(value)));
function regFun(meta) {
  const constr = meta.func;
  regOpaqueObject(constr, `c#${meta.persistName}`);
  regOpaqueObject(meta, `i#${meta.persistName}`);
  regOpaqueObject(meta.handler, `h#${meta.persistName}`);
  if (meta.errHandler && meta.errHandler !== defaultErrHandler) regOpaqueObject(meta.errHandler, `eh#${meta.persistName}`);
  if (meta.finHandler && meta.finHandler !== defaultFinHandler) regOpaqueObject(meta.finHandler, `fh#${meta.persistName}`);
}
function stripAsyncFrameRuntime(value) {
  if (!value || typeof value !== "object") return value;
  if (!("meta" in value) || !("awaiting" in value) || !("promise" in value)) {
    return null;
  }
  return {
    next: value.next,
    caller: value.caller,
    onReturn: value.onReturn,
    onError: value.onError,
    promise: value.promise,
    restoreEnabled: value.restoreEnabled
  };
}
function stepDeferred(ctx, value, parent, index) {
  const json = ctx.step(value, parent, index);
  if (json !== null || value === null || typeof value !== "object" && typeof value !== "function") {
    return json;
  }
  const info = ctx.sharedRefsMap.get(value);
  if (info) {
    if (info.ref == null) info.ref = {};
    return info.ref;
  }
  return json;
}
function stepAsyncFrame(ctx, value, parent, index) {
  if (!stripAsyncFrameRuntime(value)) return stepDeferred(ctx, value, parent, index);
  value.next = null;
  value.caller = null;
  value.onReturn = null;
  value.onError = null;
  if (typeof value.restoreEnabled === "function") {
    value.restoreEnabled = State.undef;
  }
  return stepDeferred(ctx, value, parent, index);
}
const BindDescriptor = regDescriptor({
  name: "#b",
  completeOwnProperties: true,
  propertyStorage, ownDescriptors,
  create(ctx, json) {
    const res = restoreFunction(makeBind(json.c));
    weakMapSet.call(binds, res, {
      fun: ctx.createStep(json.b),
      self: ctx.createStep(json.s),
      args: ctx.createStep(json.a) || [],
      constructable: json.c
    });
    return res;
  },
  readContent(ctx, json, value) {
    const binding = binds.get(value);
    binding.fun = ctx.step(json.b);
    binding.self = ctx.step(json.s);
    binding.args = ctx.step(json.a) || [];
  },
  write(ctx, value) {
    const binding = binds.get(value);
    const json = {};
    if (!binding) return json;
    // `f` belongs to the serializer's own-property records.
    json.b = stepDeferred(ctx, binding.fun, json, "b");
    json.s = stepDeferred(ctx, binding.self, json, "s");
    json.a = stepDeferred(ctx, binding.args, json, "a");
    json.c = binding.constructable;
    return json;
  },
  props: true
});
function makeBind(constructable) {
  if (typeof constructable !== 'boolean') throw new TypeError('Missing bound function construction kind');
  let result;
  function __effectful__Bind(...rest) {
    const {
      fun,
      self,
      args: boundArgs
    } = binds.get(result);
    if (context.operations) {
      const args = [].concat(_toConsumableArray(boundArgs), rest);
      return new.target
        ? context.operations.construct(fun, args, new.target === __effectful__Bind ? fun : new.target)
        : context.operations.invoke(fun, self === undef ? this : self, args);
    }
    if (context.call === result) context.call = fun;
    if (new.target) return native.Reflect.construct(fun, [].concat(_toConsumableArray(boundArgs), rest), new.target === __effectful__Bind ? fun : new.target);
    return nativeReflectApply(fun, self === undef ? this : self, [].concat(_toConsumableArray(boundArgs), rest));
  }
  // A native bound wrapper retains [[Construct]] without introducing an own
  // prototype. Its target captures only the binding identity; execution data
  // stays in `binds` and is rebuilt by the existing Context copy paths.
  const target = constructable ? __effectful__Bind : {
    invoke(...rest) { return nativeReflectApply(__effectful__Bind, this, rest); }
  }.invoke;
  result = nativeReflectApply(Function.prototype.bind, target, [undefined]);
  weakMapSet.call(binds, result, { constructable });
  if (BindDescriptor) S.setObjectDescriptor(result, BindDescriptor);
  return context.allocate ? context.allocate(result) : result;
}
const defaultBind = exports.defaultBind = _config.default.persistState ? function bind(self, ...args) {
  // This replacement is also reached by reflected calls to the original
  // intrinsic. Preserve its early receiver validation before allocating a
  // persistent binding; the original failure cannot observe bound arguments.
  if (typeof this !== "function") return nativeReflectApply(Function.prototype.bind, this, []);
  const constructable = context.operations.isConstructor(this);
  const res = makeBind(constructable);
  weakMapSet.call(binds, res, {
    fun: this,
    self,
    args,
    constructable
  });
  return res;
} : Function.prototype.bind;
const extra = exports.extra = new Set();
function opaqueWeakMap(map, name) {
  const descr = native.Object.assign({}, S.WeakMapDescriptor);
  descr.name = name;
  descr.create = function () {
    return map;
  };
  S.setObjectDescriptor(map, S.regDescriptor(descr));
}
function opaqueWeakSet(set, name) {
  const descr = native.Object.assign({}, S.WeakSetDescriptor);
  descr.name = name;
  descr.create = function () {
    return set;
  };
  S.setObjectDescriptor(set, S.regDescriptor(descr));
}
opaqueWeakMap(State.functions, "@effectful/debugger/context/functions");
opaqueWeakMap(closures, "@effectful/debugger/context/closures");
opaqueWeakMap(binds, "@effectful/debugger/context/binds");
