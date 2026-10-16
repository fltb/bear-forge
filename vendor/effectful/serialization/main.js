"use strict";
/**
 * # Serialization library for @effectful toolchain
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyDescriptorDescriptor = exports.WeakMapDescriptor = exports.WeakSetDescriptor = exports.WeakMapWorkaround = exports.WeakSetWorkaround = exports.getValueDescriptor = exports.getObjectDescriptor = exports.BigIntDescriptor = exports.undefinedSymbol = exports.ObjectPropertiesDescriptor = exports.NotSerializableToken = exports.PrimDescriptor = exports.NotSerializableDescriptor = exports.descriptorTemplate = exports.ReadContext = exports.WriteContext = exports.BindDescriptor = exports.boundFunSymbol = exports.boundArgsSymbol = exports.boundThisSymbol = exports.descriptorSymbol = void 0;
exports.resetState = resetState;
exports.getState = getState;
exports.write = write;
exports.read = read;
exports.stringify = stringify;
exports.parse = parse;
exports.setObjectDescriptor = setObjectDescriptor;
exports.bind = bind;
exports.regDescriptor = regDescriptor;
exports.updateInitialSnapshot = updateInitialSnapshot;
exports.regOpaqueObject = regOpaqueObject;
exports.regOpaquePrim = regOpaquePrim;
exports.regPrim = regPrim;
exports.regConstructor = regConstructor;
exports.regNewConstructor = regNewConstructor;
exports.writeProps = writeProps;
exports.readProps = readProps;
exports.prepareOwnKeys = prepareOwnKeys;
exports.regObjectDescriptorGetter = regObjectDescriptorGetter;
exports.regValueDescriptorGetter = regValueDescriptorGetter;
exports.getJsonDescriptor = getJsonDescriptor;
exports.regOpaqueRec = regOpaqueRec;
exports.regAutoOpaqueConstr = regAutoOpaqueConstr;
exports.rebindGlobal = rebindGlobal;
exports.regGlobal = regGlobal;
/* eslint-disable @typescript-eslint/no-wrapper-object-types */
const savedConsole = { log: console.log, warn: console.warn };
const weakMapSet = WeakMap.prototype.set;
function showStack(ctx, key, value) {
    savedConsole.warn("Not serializable ", key, debCtx, value);
    let i = ctx.jobs;
    let num = 0;
    for (;;) {
        while (i && !i.started)
            i = i.nextJob;
        if (!i)
            break;
        savedConsole.warn(`SF#${++num}:`, i.index, i.debCtx, ":", i.value);
        if (num > 200)
            break;
        i = i.nextJob;
    }
}
const LocMap = Map;
const LocWeakMap = WeakMap;
const LocSet = Set;
function initializeState(init) {
    if (!init.symbol)
        init.symbol = Symbol("@effectful/serialization/descriptor");
    if (!init.byName)
        init.byName = new LocMap();
    if (!init.byValue)
        init.byValue = new LocMap();
    if (!init.byObject)
        init.byObject = new LocWeakMap();
    if (!init.byPrototype)
        init.byPrototype = new LocWeakMap();
    if (!init.byTypeOfProp)
        init.byTypeOfProp = new LocMap();
    return init;
}
if (!globalThis.__effectfulSerializationState)
    globalThis.__effectfulSerializationState = {};
let state = initializeState(__effectfulSerializationState);
let ObjectConstr = Object;
/** name of a property to specify `Descriptor` for JS value */
exports.descriptorSymbol = state.symbol;
let descriptorByName = state.byName;
let descriptorByValue = state.byValue;
let descriptorByObject = state.byObject;
let descriptorByPrototype = state.byPrototype;
let descriptorByTypeOfProp = state.byTypeOfProp;
/**
 * Sets new state value
 *
 * After setting this each instance of this module will have own state
 */
function resetState(init = {}) {
    state = initializeState(init);
    exports.descriptorSymbol = state.symbol;
    descriptorByName = state.byName;
    descriptorByValue = state.byValue;
    descriptorByObject = state.byObject;
    descriptorByPrototype = state.byPrototype;
    descriptorByTypeOfProp = state.byTypeOfProp;
}
function getState() {
    return state;
}
/* TODO after TS supports symbol indexes `{ [name: string | symbol]: boolean } */
const defaultOverrideProps = {
    [exports.descriptorSymbol]: false
};
const funcOverrideProps = {
    arguments: false,
    caller: false,
    length: false,
    name: false
};
/**
 * Conversion between JSON values and JS values. JSON values set a subset of JS
 * values which can be converted to a string using `JSON.stringify` function and
 * read back with `JSON.parse`
 */
/**
 * Converts JS Plain Object into JSON Object
 *
 * It supports only plain objects as root value. To serialize anything else
 * just wrap it, e.g. `write({arr:[1]})`
 *
 * @param value - original object
 * @param opts - options
 */
function write(value, opts = {}) {
    if (typeof value !== "object" || Array.isArray(value))
        throw new TypeError("wrong argument type");
    const ctx = new WriteContext(opts);
    const res = [];
    res.push(ctx.step(value, res, 0));
    const { sharedRefs: refs } = ctx;
    const alwaysByRef = opts.alwaysByRef;
    const x = [];
    const resRefs = opts.refs;
    const weakMaps = ctx.weakMaps;
    for (;;) {
      for (let job; (job = ctx.jobs) != null;) {
          if (job.started) {
              if (alwaysByRef) {
                  if (job.ref)
                      job.ref.r = x.push(job.data) - 1;
                  if (resRefs)
                      resRefs.push(job.value);
              }
              else
                  refs.push(job);
              ctx.jobs = job.nextJob;
              continue;
          }
          job.started = true;
          const value = job.value;
          job.data = (job.descriptor.write(ctx, value, job.parent, job.index));
          for (const [map, json] of weakMaps) {
              if (map.has(value)) {
                  const { k, v } = json;
                  k.push(ctx.step(value, k, k.length));
                  v.push(ctx.step(map.get(value), v, v.length));
              }
          }
      }
      if (!ctx.weakEntries.drain() && ctx.jobs == null) break;
    }
    if (ctx.weakSets.length) {
        for (const info of ctx.sharedRefs.values()) {
            const ty = typeof info.value;
            if (ty !== "object" && ty !== "function")
                continue;
            for (const [wm, val] of ctx.weakSets) {
                if (!wm.has(info.value))
                    continue;
                if (!info.ref)
                    info.ref = {};
                val.v.push(info.ref);
            }
        }
    }
    if (!alwaysByRef && refs.length) {
        for (const info of refs) {
            if (info.ref) {
                info.ref.r = x.push(info.data) - 1;
                if (info.parent)
                    info.parent[info.index] = info.ref;
            }
            else if (info.parent)
                info.parent[info.index] = info.data;
        }
        if (resRefs != null)
            for (const info of refs)
                resRefs.push(info.value);
    }
    return x.length
        ? Object.assign({ x }, res[0])
        : res[0];
}
/**
 * Converts JSON Object returned by {@link write} back to JS Object
 *
 * @param json - object to read
 */
const emptyArr = [];
function read(json, opts = {}) {
    if (typeof json !== "object")
        throw new TypeError("root value must be Object");
    const jsons = json.x;
    const len = jsons ? jsons.length : 0;
    const ctx = new ReadContext(opts, jsons || emptyArr);
    if (len) {
        const vals = ctx.sharedVals;
        const descriptors = ctx.sharedDescriptors;
        for (let i = 0; i < len; ++i) {
            const propJson = jsons[i];
            descriptors[i] = getJsonDescriptor(ctx, propJson);
        }
        for (let i = 0; i < len; ++i) {
            const value = vals[i];
            if (value !== undef)
                continue;
            vals[i] = descriptors[i].create(ctx, jsons[i]);
        }
        for (let i = 0; i < len; ++i)
            descriptors[i].readContent(ctx, jsons[i], vals[i]);
    }
    return getJsonDescriptor(ctx, json).read(ctx, json);
}
/**
 * `write` followed by `JSON.stringify`,
 * with same parameters as for `JSON.stringify`
 */
function stringify(value, replacer, spaces) {
    return JSON.stringify(write(value), replacer, spaces);
}
/** `JSON.parse` followed by `read` */
function parse(json) {
    return read(JSON.parse(json));
}
exports.boundThisSymbol = Symbol("@effectful/bind/this");
exports.boundArgsSymbol = Symbol("@effectful/bind/args");
exports.boundFunSymbol = Symbol("@effectful/bind/fun");
function makeBind() {
    function bind(...rest) {
        return bind[exports.boundFunSymbol].apply(bind[exports.boundThisSymbol], [
            ...bind[exports.boundArgsSymbol],
            ...rest
        ]);
    }
    weakMapSet.call(descriptorByObject, bind, exports.BindDescriptor);
    return bind;
}
function setObjectDescriptor(object, descriptor) {
    weakMapSet.call(descriptorByObject, object, descriptor);
}
exports.BindDescriptor = regDescriptor({
    name: "Bind",
    create() {
        return makeBind();
    },
    write() {
        return {};
    },
    overrideProps: Object.assign(Object.assign({}, funcOverrideProps), { prototype: false })
});
/**
 * like `Function.prototype.bind` but returs serializable object if all
 * arguments are serializable
 *
 * @param func
 * @param self - bound `this`
 * @param args - bound arguments
 */
function bind(func, self, ...args) {
    const res = makeBind();
    res[exports.boundThisSymbol] = self;
    res[exports.boundFunSymbol] = func;
    res[exports.boundArgsSymbol] = args;
    return res;
}
let debCtx = null;
// Ephemeron processing: each entry waits on one key and is scheduled once.
// Newly reachable values may wake more entries; no pending-list rescans.
class WeakEntryQueue {
    constructor() {
        this.reached = new Set();
        this.pending = new Map();
        this.ready = [];
    }
    mark(key) {
        const type = typeof key;
        if (key === null || type !== "object" && type !== "function" && type !== "symbol" || this.reached.has(key)) return;
        this.reached.add(key);
        const waiting = this.pending.get(key);
        if (waiting) {
            for (const write of waiting) this.ready.push(write);
            this.pending.delete(key);
        }
    }
    add(key, write, shared = false) {
        if (shared || this.reached.has(key)) this.ready.push(write);
        else {
            let waiting = this.pending.get(key);
            if (!waiting) this.pending.set(key, waiting = []);
            waiting.push(write);
        }
    }
    drain() {
        if (!this.ready.length) return false;
        for (let i = 0; i < this.ready.length; i++) this.ready[i]();
        this.ready.length = 0;
        return true;
    }
}
exports.WeakEntryQueue = WeakEntryQueue;
/**
 * An object passed to Descriptor's `write` method to support recursive
 * invocation for nested values
 */
class WriteContext {
    constructor(opts) {
        this.sharedRefsMap =
            opts.sharedRefsMap || (opts.sharedRefsMap = new LocMap());
        this.sharedRefs = opts.sharedRefs || [];
        this.opts = opts;
        this.symsByName = opts.symsByName || (opts.symsByName = new LocMap());
        this.knownSyms = opts.knownSyms || (opts.knownSyms = new LocMap());
        this.weakMaps = opts.weakMaps || (opts.weakMaps = []);
        this.weakSets = opts.weakSets || (opts.weakSets = []);
        this.weakEntries = new WeakEntryQueue();
        this.jobs = void 0;
    }
    /**
     * Invokes write recursively for nested values
     * @param value - value to write
     * @param parent - container for the value output
     * @param key  - either name of a field if parent is an object
     *               or number index if it is an array
     */
    step(value, parent, key) {
        this.weakEntries.mark(value);
        let descriptor = (0, exports.getValueDescriptor)(value);
        if (!descriptor) {
            const { opts } = this;
            if (opts.warnIgnored && opts.verbose)
                showStack(this, key, value);
            if (!opts.ignore)
                throw new TypeError(`not serializable value "${value}" at "${key}"(${debCtx}) of "${parent}"`);
            // tslint:disable-next-line
            if (opts.warnIgnored && savedConsole.warn && !opts.verbose) {
                // tslint:disable-next-line
                savedConsole.warn(`not serializable value "${value}" at "${key}"(${debCtx}) of "${parent}"`);
            }
            if (opts.ignore === true)
                return exports.NotSerializableToken;
            if (opts.ignore === "opaque") {
                descriptor =
                    typeof value === "object" || typeof value === "function"
                        ? regOpaqueObject(value)
                        : regOpaquePrim(value);
            }
            else if (opts.ignore === "placeholder") {
                descriptor = NotSerializablePlaceholderDescriptor;
            }
            else
                throw new TypeError(`unsupported value for ignore option = ${opts.ignore}`);
        }
        if (descriptor) {
            return descriptor.write(this, value, parent, key);
        }
        return {};
    }
}
exports.WriteContext = WriteContext;
WriteContext.prototype.showStack = function (key, value) {
    showStack(this, key, value);
};
const undef = { _undef: true };
/**
 * An object passed to Descriptor's `read` method to support recursive invocation
 * for nested values
 */
class ReadContext {
    constructor(opts, sharedJsons) {
        this.knownSyms = opts.knownSyms || (opts.knownSyms = new LocMap());
        this.symsByName = opts.symsByName || (opts.symsByName = new LocMap());
        this.opts = opts;
        const len = sharedJsons.length;
        this.sharedJsons = sharedJsons;
        this.sharedVals = opts.refs || (opts.refs = Array(len).fill(undef));
        this.sharedDescriptors = Array(len);
    }
    /**
     * Invokes read recursively for nested values
     * @param json - value to read
     */
    step(json) {
        return getJsonDescriptor(this, json).read(this, json);
    }
    /**
     * Invokes create recursively for nested values.
     * @param json - value to read
     */
    createStep(json) {
        return getJsonDescriptor(this, json).create(this, json);
    }
}
exports.ReadContext = ReadContext;
function defaultWrite(ctx, value) {
    const json = {};
    if (this.valuePrototype !== void 0)
        return json;
    const proto = Object.getPrototypeOf(value);
    if (proto === ObjectConstr.prototype || proto === this.defaultPrototype)
        return json;
    // ensuring prototype reference is ahead
    json.p = ctx.step(proto, json, "p");
    return json;
}
function defaultCreate(ctx, json) {
    if (this.valueConstructor)
        return new this.valueConstructor();
    if (this.valuePrototype !== void 0 && this.valuePrototype !== false)
        return Object.create(this.valuePrototype);
    const protoJson = json.p;
    if (protoJson === void 0)
        return ((this.defaultPrototype ? Object.create(this.defaultPrototype) : {}));
    if (protoJson === null)
        return Object.create(null);
    let protoValue;
    // TODO: since prototypes cannot be cyclic it could ensure this
    // on proper ordering objects in `r`, this way there are no needs
    // for `Object.setPrototype`
    if (protoJson.r != null) {
        protoValue = ctx.sharedVals[protoJson.r];
        if (protoValue === undef)
            protoValue = null;
    }
    else if (protoJson.$ && !protoJson.f)
        protoValue = ctx.step(protoJson);
    return Object.create(protoValue || null);
}
/**
 * default implementaiton of {@link Descriptor}
 */
exports.descriptorTemplate = {
    read: defaultRead,
    write: defaultWrite,
    create: defaultCreate,
    readContent(ctx, json, value) {
        if (json.p && Object.getPrototypeOf(value) === null) {
            Object.setPrototypeOf(value, ctx.step(json.p));
        }
    }
};
/**
 * Enhances descriptor by adding reference handling. It some value is referenced
 * in more than one sub-value it will have a unique value id instead of the
 * value in the output.
 */
function refAwareDescriptor(descriptor) {
    return Object.assign({}, descriptor, {
        name: descriptor.name,
        read(ctx, json) {
            const ref = json.r;
            if (ref != null) {
                const res = this.create(ctx, json);
                this.readContent(ctx, json, res);
                return res;
            }
            return descriptor.read(ctx, json);
        },
        write(ctx, value, parent, index) {
            let info = ctx.sharedRefsMap.get(value);
            if (info == null) {
                ctx.sharedRefsMap.set(value, (ctx.jobs = info =
                    {
                        ref: null,
                        data: null,
                        parent,
                        value,
                        descriptor,
                        index,
                        nextJob: ctx.jobs,
                        started: false,
                        debCtx
                    }));
                ctx.jobs = info;
                if (!ctx.opts.alwaysByRef)
                    return null;
            }
            if (info.ref == null)
                info.ref = {};
            return info.ref;
        },
        create(ctx, json) {
            const ref = json.r;
            if (ref != null) {
                const value = ctx.sharedVals[ref];
                if (value !== undef)
                    return value;
                return (ctx.sharedVals[ref] = ctx.sharedDescriptors[ref].create(ctx, ctx.sharedJsons[ref]));
            }
            return descriptor.create(ctx, json);
        },
        readContent(ctx, json, value) {
            if (json.r != null)
                return;
            descriptor.readContent(ctx, json, value);
        }
    });
}
/**
 * Adds a descriptor to an internal global registry for creating value instances
 * by type names on reading.
 *
 * The name will be changed to a unique value if some other descriptor with the
 * same name is already registered.
 *
 * Adds missed functionality into the descriptor. This includes:
 *  - This includes reference awareness (if `descriptor.refAware !== false`)
 *  - Saving object's properties (if `descriptor.props !== false`)
 *  - Default methods (`read` from `create` and `readContent`)
 *  - Adding "$" property (if `descriptor.default$ !== false`)
 *
 * @param descriptor
 * @returns
 */
function regDescriptor(descriptor) {
    let { read: readImpl, readContent: readContentImpl, create: createImpl, write: writeImpl } = descriptor;
    if (!readImpl) {
        if (descriptor.create)
            readImpl = descriptor.readContent ? defaultRead : descriptor.create;
    }
    if (!descriptor.defaultPrototype &&
        descriptor.props !== false &&
        descriptor.propsSnapshot !== false &&
        descriptor.value)
        descriptor.defaultPrototype = Object.getPrototypeOf(descriptor.value);
    const overrideProps = Object.assign({}, defaultOverrideProps, descriptor.typeofHint === "function" && funcOverrideProps, descriptor.overrideProps);
    if (!readContentImpl)
        readContentImpl = function readContent() { };
    if (!readImpl)
        readImpl = function readCreate(ctx, json) {
            return this.create(ctx, json);
        };
    if (!createImpl)
        createImpl = exports.descriptorTemplate.create;
    if (!writeImpl)
        writeImpl = function noWrite(_, val) {
            throw new TypeError(`not writable ${val}`);
        };
    const name = guessDescriptorName(descriptor);
    let uniq = name;
    let i = 0;
    if (!descriptor.strictName)
        for (; descriptorByName.get(uniq) != null; uniq = `${name}_${++i}`) { }
    let final = Object.assign({}, descriptor, {
        read: readImpl,
        readContent: readContentImpl,
        create: createImpl,
        write: writeImpl,
        name: uniq,
        overrideProps
    });
    if (descriptor.props !== false)
        final = propsDescriptor(final);
    if (descriptor.default$ !== false && uniq !== "Object") {
        const saved = final;
        final = Object.assign({}, final, {
            write(ctx, val, parent, index) {
                const json = saved.write(ctx, val, parent, index);
                if (!json.$)
                    json.$ = uniq;
                return json;
            }
        });
    }
    const noRefs = final;
    descriptorByName.set(uniq, noRefs);
    if (descriptor.typeofTag)
        descriptorByTypeOfProp.set(descriptor.typeofTag, noRefs);
    if (descriptor.refAware !== false)
        final = refAwareDescriptor(final);
    final = {
        name: uniq,
        read: final.read,
        write: final.write,
        readContent: final.readContent,
        create: final.create,
        overrideProps,
        value: descriptor.value,
        props: descriptor.props,
        default$: descriptor.default$,
        snapshot: final.snapshot
    };
    return final;
}
/**
 * updates `snapshot` with the current values of its properties
 *
 * @param value - an object registered by `regOpaqueObject` before
 */
function updateInitialSnapshot(value) {
    const descriptor = (0, exports.getValueDescriptor)(value);
    if (!descriptor)
        throw new TypeError("not serializable value");
    if (!descriptor.snapshot || !descriptor.value || descriptor.value !== value)
        throw new TypeError("the object doesn't contain another snapshot");
    Object.assign(descriptor.snapshot, Object.getOwnPropertyDescriptors(value));
}
/**
 * Tries to derive name for the `value`
 *
 * @param value
 */
function guessObjectName(value) {
    return (value.name || (value.constructor && value.constructor.name) || "Object");
}
/**
 * Tries to derive name for the `descriptor`.
 *
 * @param descriptor
 */
function guessDescriptorName(descriptor) {
    if (descriptor.name)
        return descriptor.name;
    if (descriptor.valuePrototype && descriptor.valuePrototype.name)
        return descriptor.valuePrototype.name;
    if (descriptor.valueConstructor && descriptor.valueConstructor.name)
        return descriptor.valueConstructor.name;
    if (descriptor.valuePrototype &&
        descriptor.valuePrototype.constructor &&
        descriptor.valuePrototype.constructor.name)
        return descriptor.valuePrototype.constructor.name;
    return "Object";
}
/**
 * This function registers `value` as opaque. The library outputs names instead
 * of stored data for them. The values should be registered with the same name
 * on writing and reading sides.
 *
 * @param value
 * @param name
 * @param props - should the properties of the object be output too
 */
function regOpaqueObject(value, name = guessObjectName(value), descriptor = { props: true, propsSnapshot: true }) {
    if (!value)
        return null;
    let descr;
    if ((descr = descriptorByObject.get(value)) != null)
        return descr;
    descr = regDescriptor(Object.assign({}, OpaqueDescriptor, { name, typeofHint: typeof value }, descriptor, { value }));
    weakMapSet.call(descriptorByObject, value, descr);
    return descr;
}
/**
 * Same as `regOpaqueObject` but for non-object types, uses `Map` registry instead of `WeakMap`
 * @see regOpaqObject
 */
function regOpaquePrim(value, name = String(value)) {
    let descriptor = descriptorByValue.get(value);
    if (descriptor)
        return descriptor;
    descriptor = regDescriptor(Object.assign({}, OpaquePrimDescriptor, {
        name,
        value,
        refAware: false
    }));
    descriptorByValue.set(value, descriptor);
    return descriptor;
}
function regPrim(descriptor, value, name = String(value)) {
    descriptor = regDescriptor(Object.assign({}, descriptor, { name, value, refAware: false }));
    descriptorByValue.set(value, descriptor);
    return descriptor;
}
/**
 * Registers `prototype` of `constructor` as opaque value and use it
 * as the value's type in output.
 * into a prototype.
 *
 * @see regOpaqueObject
 * @param constructor - plain JS constructor function or class
 * @param descriptor
 */
function regConstructor(constr, descriptor = {}, inherit) {
    const descr = regDescriptor(Object.assign({ valuePrototype: constr.prototype, name: constr.name }, exports.descriptorTemplate, descriptor, {
        overrideProps: Object.assign({}, descriptor.overrideProps),
        propsSnapshot: descriptor.propsSnapshot
    }));
    if (inherit)
        Object.defineProperty(constr.prototype, exports.descriptorSymbol, {
            value: descr,
            configurable: true
        });
    else
        weakMapSet.call(descriptorByPrototype, constr.prototype, descr);
    return descr;
}
exports.NotSerializableDescriptor = regDescriptor({
    name: "NotSerializableToken",
    read() {
        throw new TypeError("Trying to use not serializable value");
    },
    create() { },
    readContent() { },
    write() {
        return exports.NotSerializableToken;
    },
    props: false,
    refAware: false,
    default$: false
});
const NotSerializablePlaceholderDescriptor = regDescriptor({
    name: "NotSerializable",
    read: notSerializableRead,
    create: notSerializableRead,
    readContent() { },
    write() {
        return {};
    },
    props: false,
    refAware: false
});
function notSerializableRead() {
    if (this.name === "NotSerializable")
        return notSerializablePlaceholder;
    const res = function () { };
    weakMapSet.call(descriptorByObject, res, this);
    return new Proxy(res, notSerializableTraps);
}
/** same as `regConstructor` but it also uses `constr` with new to build the object */
function regNewConstructor(constr, descriptor = {}) {
    return regConstructor(constr, Object.assign({ valueConstructor: constr }, exports.descriptorTemplate, descriptor));
}
const PojsoDescriptor = regDescriptor(Object.assign(Object.assign({}, exports.descriptorTemplate), { name: "Object" }));
exports.PrimDescriptor = regDescriptor({
    name: "Prim",
    read(_, json) {
        return json;
    },
    create(_, json) {
        return json;
    },
    write(_, value) {
        return value;
    },
    refAware: false,
    props: false,
    default$: false
});
const RefDescriptor = regDescriptor({
    name: "Ref",
    read(ctx, json) {
        return ctx.sharedVals[json.r];
    }
});
exports.NotSerializableToken = { _notSerializable: true };
function writeProp(ctx, info, descr, flags) {
    if ((flags & 8) === 0) {
        const valueJson = ctx.step(descr.value, info, 1);
        if (valueJson === exports.NotSerializableToken)
            return;
        info.push(valueJson);
    }
    else {
        info.push(null);
    }
    if (flags || descr.set || descr.get)
        info.push(flags);
    if (descr.get)
        info[3] = ctx.step(descr.get, info, 3);
    if (descr.set)
        info[4] = ctx.step(descr.set, info, 4);
    return info;
}
function descrFlags(descr) {
    let flags = 0;
    if (!descr.configurable)
        flags = flags | 1;
    if (!descr.enumerable)
        flags = flags | 2;
    if (!descr.writable)
        flags = flags | 4;
    if (!("value" in descr)) {
        flags = flags | 8;
    }
    return flags;
}
function propFlags(snapshot, pred, name, descr, mask) {
    let flags;
    if (pred[name] === false || ((flags = descrFlags(descr)) & mask) !== 0)
        return void 0;
    if (snapshot) {
        const init = snapshot[name];
        if (init &&
            (("value" in init && Object.is(init.value, descr.value)) ||
                ("get" in init && init.get === descr.get)))
            return void 0;
    }
    return flags;
}
/** Writing serialized `Object.defineProperty` descriptors to JSON */
function writeProps(ctx, descrs, pred, mask, snapshot) {
    const props = [];
    let flags;
    for (const name of Object.getOwnPropertyNames(descrs)) {
        const descr = descrs[name];
        // TODO: check why with jest + jsdom this sometimes returns `undefined`
        if (!descr)
            continue;
        if ((flags = propFlags(snapshot, pred, name, descr, mask)) === void 0)
            continue;
        debCtx = name;
        const propInfo = writeProp(ctx, [name], descr, flags);
        if (propInfo)
            props.push(propInfo);
    }
    for (const name of Object.getOwnPropertySymbols(descrs)) {
        const descr = descrs[name];
        if ((flags = propFlags(snapshot, pred, name, descr, mask)) ===
            void 0)
            continue;
        debCtx = String(name);
        const propJson = [];
        const sym = writeSym(ctx, name, propJson, 0, !ctx.opts.ignore && !ctx.knownSyms);
        if (sym === exports.NotSerializableToken)
            continue;
        propJson.push(sym);
        writeProp(ctx, propJson, descr, flags);
        if (propJson.length)
            props.push(propJson);
    }
    debCtx = null;
    return props;
}
function readPropName(ctx, key) {
    if (typeof key === "string")
        return key;
    let name;
    if (key.$) {
        const descr = descriptorByName.get(key.$);
        if (descr)
            name = descr.read(ctx, key);
    }
    if (name === undefined)
        name = readSym(ctx, key);
    return name;
}
function readPropDescriptor(ctx, pjson, flags, get, set, pdescr) {
    pdescr.configurable = (flags & 1) === 0;
    pdescr.enumerable = (flags & 2) === 0;
    if ((flags & 8) === 0)
        pdescr.writable = (flags & 4) === 0;
    if ((flags & 8) === 0)
        pdescr.value = ctx.step(pjson);
    if (get)
        pdescr.get = ctx.step(get);
    if (set)
        pdescr.set = ctx.step(set);
    weakMapSet.call(descriptorByObject, pdescr, exports.PropertyDescriptorDescriptor);
    return pdescr;
}
/** Reconcile allocation-time keys before restoring complete own descriptors.
 * Integer indices have numeric order; strings and symbols have separate insertion
 * orders. Keep an existing prefix and remove the configurable remainder. */
function prepareOwnKeys(value, keys, storage) {
    const ordered = key => typeof key === "symbol" ||
        !(String(Number(key) >>> 0) === key && Number(key) < 4294967295);
    const allocated = (storage ? storage.ownKeys(value) : Reflect.ownKeys(value)).filter(key => key !== exports.descriptorSymbol && ordered(key));
    if (!allocated.length) return;
    for (const type of ["string", "symbol"]) {
        if (!allocated.some(key => typeof key === type)) continue;
        const expected = keys.filter(key => typeof key === type && ordered(key));
        let next = 0;
        for (const key of allocated) {
            if (typeof key !== type) continue;
            if (key === expected[next]) { next++; continue; }
            if (!(storage ? storage.deleteProperty(value, key) : Reflect.deleteProperty(value, key)))
                throw new TypeError("Allocated own-property order cannot represent saved state");
        }
    }
}
/** Reading serialized `Object.defineProperty` descriptors from JSON */
function readProps(ctx, props, value, storage) {
    const own = name => storage ? storage.getOwnPropertyDescriptor(value, name) : Object.getOwnPropertyDescriptor(value, name);
    const define = (name, descriptor) => {
        if (storage) {
            if (!storage.defineProperty(value, name, descriptor)) throw new TypeError('Cannot restore property');
        } else Object.defineProperty(value, name, descriptor);
    };
    for (const [key, pjson, flags, get, set] of props) {
        const name = readPropName(ctx, key);
        if (flags != null) {
            const pdescr = readPropDescriptor(ctx, pjson, flags, get, set, {});
            try {
                define(name, pdescr);
                continue;
            }
            catch (e) {
                const sdescr = own(name);
                if (!sdescr || sdescr.configurable || !sdescr.writable)
                    throw e;
            }
        }
        // Restoring data properties must not invoke inherited or previously
        // restored setters before the rest of a cyclic graph is initialized.
        const existing = own(name);
        define(name, existing && !existing.configurable
            ? { value: ctx.step(pjson) }
            : { value: ctx.step(pjson), writable: true, enumerable: true, configurable: true });
    }
}
/** A descriptor for `Object.getOwnPropertyDescriptors` object */
exports.ObjectPropertiesDescriptor = {
    write(ctx, value) {
        return {
            f: writeProps(ctx, value, defaultOverrideProps, 0)
        };
    },
    create() {
        return {};
    },
    readContent(ctx, json, value) {
        for (const [key, pjson, flags, get, set] of json.f) {
            value[readPropName(ctx, key)] = readPropDescriptor(ctx, pjson, flags, get, set, {});
        }
    }
};
/** wraps descriptor by adding its own property into the saved dictionary */
function propsDescriptor(descriptor) {
    const pred = descriptor.overrideProps || defaultOverrideProps;
    let snapshot;
    if (descriptor.props !== false &&
        descriptor.propsSnapshot !== false &&
        descriptor.value) {
        snapshot = Object.getOwnPropertyDescriptors(descriptor.value);
    }
    return {
        name: descriptor.name,
        write(ctx, value, parent, index) {
            const json = descriptor.write(ctx, value, parent, index);
            const storage = descriptor.propertyStorage?.(value);
            // Instance values retain their actual prototype and extensibility,
            // including subclasses of types with native internal slots.
            json.p = ctx.step(storage ? storage.getPrototypeOf(value) : Object.getPrototypeOf(value), json, "p");
            if (!(storage ? storage.isExtensible(value) : Object.isExtensible(value))) json.extensible = false;
            const props = writeProps(ctx, descriptor.ownDescriptors ? descriptor.ownDescriptors(value) : Object.getOwnPropertyDescriptors(value), pred, descriptor.propsDescrMask || 0, this.snapshot);
            if (props.length)
                json.f = props;
            return json;
        },
        read: defaultRead,
        readContent(ctx, json, value) {
            descriptor.readContent(ctx, json, value);
            const storage = descriptor.propertyStorage?.(value);
            const props = json.f;
            if (descriptor.completeOwnProperties)
                prepareOwnKeys(value, (props || []).map(prop => readPropName(ctx, prop[0])), storage);
            if (props)
                readProps(ctx, props, value, storage);
            if (Object.prototype.hasOwnProperty.call(json, "p")) {
                const prototype = ctx.step(json.p);
                if (storage) {
                    if (!storage.setPrototypeOf(value, prototype)) throw new TypeError('Cannot restore prototype');
                } else if (Object.getPrototypeOf(value) !== prototype) Object.setPrototypeOf(value, prototype);
            }
            if (json.extensible === false) {
                if (storage) storage.preventExtensions(value);
                else Object.preventExtensions(value);
            }
        },
        create(ctx, json) {
            return descriptor.create(ctx, json);
        },
        snapshot
    };
}
function defaultRead(ctx, json) {
    const value = this.create(ctx, json);
    this.readContent(ctx, json, value);
    return value;
}
const OpaqueDescriptor = {
    write(ctx, value) {
        if (value !== this.value || !this.name)
            return defaultWrite.call(this, ctx, value); // PojsoPropsDescriptor.write(ctx, value, par, index);
        return { $: this.name };
    },
    create() {
        return this.value;
    },
    default$: false
};
const OpaquePrimDescriptor = Object.assign(Object.assign({}, OpaqueDescriptor), { props: false });
function writeSym(ctx, sym, parent, index, ignore) {
    ctx.weakEntries.mark(sym);
    const key = Symbol.keyFor(sym);
    if (key !== undefined)
        return { key };
    const globalSym = descriptorByValue.get(sym);
    if (globalSym)
        return globalSym.write(ctx, sym, parent, index);
    if (!ignore && ctx.knownSyms) {
        let descr = ctx.knownSyms.get(sym);
        if (!descr) {
            if (!ctx.symsByName)
                throw new TypeError(`couldn't write "${String(sym)}"`);
            const name = sym.description === undefined ? null : sym.description;
            let tup = ctx.symsByName.get(name);
            if (!tup)
                ctx.symsByName.set(name, (tup = []));
            descr = { name, id: tup.length, value: sym };
            tup.push(descr);
            ctx.knownSyms.set(sym, descr);
        }
        const res = { name: descr.name };
        if (descr.id)
            res.id = descr.id;
        return res;
    }
    if (!ignore && !ctx.opts.ignore)
        throw new TypeError(`couldn't write "${String(sym)}"`);
    return exports.NotSerializableToken;
}
exports.undefinedSymbol = Symbol("@effectful/serialization/undefined");
function readSym(ctx, json) {
    if (json.key !== undefined)
        return Symbol.for(json.key);
    const { name } = json;
    if (name !== undefined && ctx.symsByName) {
        let local = ctx.symsByName.get(name);
        const id = json.id || 0;
        if (local) {
            const descr = local[id];
            if (descr)
                return descr.value;
        }
        // creating new symbols
        const descr = {
            name: name,
            id,
            value: Symbol(json.name === null ? undefined : json.name)
        };
        if (!local)
            ctx.symsByName.set(name, (local = []));
        local[id] = descr;
        if (ctx.knownSyms)
            ctx.knownSyms.set(descr.value, descr);
        return descr.value;
    }
    if (!ctx.opts.ignore)
        throw new TypeError(`couldn't read "${JSON.stringify(json)}"`);
    return exports.undefinedSymbol;
}
function specValueDescriptor(name, value) {
    return regDescriptor({
        name,
        write() {
            return { $: name };
        },
        create() {
            return value;
        },
        refAware: false,
        props: false,
        default$: false
    });
}
const NaNDescriptor = specValueDescriptor("NaN", NaN);
const NegativeZeroDescriptor = specValueDescriptor("NegativeZero", -0);
const PositiveInfinityDescriptor = specValueDescriptor("PositiveInfinity", Infinity);
const NegativeInfinityDescriptor = specValueDescriptor("NegativeInfinity", -Infinity);
const UndefDescriptor = specValueDescriptor("undefined", void 0);
const SymbolDescriptor = regDescriptor({
    write: writeSym,
    read: readSym,
    name: "Symbol",
    refAware: false,
    props: false
});
exports.BigIntDescriptor = typeof BigInt === "function"
    ? regDescriptor({
        read(_, json) {
            return BigInt(json.int);
        },
        write(_, value) {
            return { int: value.toString() };
        },
        name: "Int",
        refAware: false,
        props: false
    })
    : regDescriptor({
        name: "Int",
        read(_, json) {
            return json.int;
        },
        write(_, value) {
            return { int: String(value) };
        },
        refAware: false,
        props: false
    });
let getObjectDescriptor = function getObjectDescriptorImpl(value) {
    let descriptor = descriptorByObject.get(value);
    if (descriptor)
        return descriptor;
    const proto = Object.getPrototypeOf(value);
    descriptor = descriptorByPrototype.get(proto);
    if (descriptor)
        return descriptor;
    if (proto && proto !== Object && exports.descriptorSymbol in proto)
        return proto[exports.descriptorSymbol];
    if (value.$$typeof)
        descriptor = descriptorByTypeOfProp.get(value.$$typeof);
    return descriptor;
};
exports.getObjectDescriptor = getObjectDescriptor;
function regObjectDescriptorGetter(impl) {
    exports.getObjectDescriptor = impl;
}
let getValueDescriptor = function getValueDescriptorImpl(value) {
    if (value === void 0)
        return UndefDescriptor;
    switch (typeof value) {
        case "number":
            if (isNaN(value))
                return NaNDescriptor;
            if (Object.is(value, -0)) return NegativeZeroDescriptor;
            if (value === Infinity) return PositiveInfinityDescriptor;
            if (value === -Infinity) return NegativeInfinityDescriptor;
        case "undefined":
        case "boolean":
        case "string":
            return exports.PrimDescriptor;
        case "object":
            if (!value)
                return exports.PrimDescriptor;
            return (0, exports.getObjectDescriptor)(value) || PojsoDescriptor;
        case "function":
            return (0, exports.getObjectDescriptor)(value);
        case "symbol":
            return SymbolDescriptor;
        case "bigint":
            return exports.BigIntDescriptor;
    }
    return descriptorByValue.get(value);
};
exports.getValueDescriptor = getValueDescriptor;
function regValueDescriptorGetter(impl) {
    exports.getValueDescriptor = impl;
}
function getJsonDescriptor(ctx, json) {
    if (typeof json !== "object" || json === null)
        return exports.PrimDescriptor;
    if (Array.isArray(json))
        return ArrayDescriptor;
    if ("$" in json) {
        const descriptor = descriptorByName.get(json.$);
        if (!descriptor) {
            if (ctx.opts.warnIgnored)
                // tslint:disable-next-line
                console.warn(`reading value with not registered type "${json.$}"`, json);
            if (!ctx.opts.ignore)
                throw new TypeError(`not registered type:${json.$}`);
            if (ctx.opts.ignore === "placeholder")
                return regDescriptor(Object.assign({}, NotSerializablePlaceholderDescriptor, {
                    name: json.$
                }));
            return UndefDescriptor;
        }
        return descriptor;
    }
    if ("r" in json)
        return RefDescriptor;
    return PojsoDescriptor;
}
const ArrayDescriptor = regNewConstructor(Array, Object.assign(Object.assign({}, exports.descriptorTemplate), { write(ctx, value) {
        const json = {};
        json.h = ctx.step(Object.getPrototypeOf(value), json, "h");
        return json;
    },
    readContent(ctx, json, value) {
        if (Array.isArray(json)) {
            for (const i of json) value.push(ctx.step(i));
        } else if (json.h) Object.setPrototypeOf(value, ctx.step(json.h));
    }, props: true, default$: true, globalName: "Array" }));
function iterableDescriptor(descriptor) {
    return Object.assign({}, exports.descriptorTemplate, {
        write(ctx, value) {
            const json = [];
            for (const i of value)
                json.push(ctx.step(i, json, json.length));
            return { $: this.name || "Iterable", l: json };
        }
    }, descriptor);
}
const WeakSetWorkaround = class WeakSet {
    constructor() {
        this.prop = Symbol("@effectful/weakset");
    }
    add(value) {
        switch (typeof value) {
            case "function":
            case "object":
                Object.defineProperty(value, this.prop, {
                    configurable: true,
                    writable: true,
                    value: true
                });
                break;
            default:
                throw TypeError("Invalid value used in weak set");
        }
        return this;
    }
    delete(value) {
        if (!value[this.prop])
            return false;
        delete value[this.prop];
        return true;
    }
    has(value) {
        return !!value[this.prop];
    }
};
exports.WeakSetWorkaround = WeakSetWorkaround;
const WeakMapWorkaround = class WeakMap {
    constructor() {
        this.prop = Symbol("@effectful/weakmap");
    }
    set(key, value) {
        switch (typeof key) {
            case "function":
            case "object":
                Object.defineProperty(key, this.prop, {
                    configurable: true,
                    writable: true,
                    value
                });
                break;
            default:
                throw TypeError("Invalid value used in weak map");
        }
        return this;
    }
    get(key) {
        return key[this.prop];
    }
    delete(key) {
        if (!key[this.prop])
            return false;
        delete key[this.prop];
        return true;
    }
    has(value) {
        return Object.prototype.hasOwnProperty.call(value, this.prop);
    }
};
exports.WeakMapWorkaround = WeakMapWorkaround;
regConstructor(exports.WeakSetWorkaround, { name: "WeakSet#" });
regConstructor(exports.WeakMapWorkaround, { name: "WeakMap#" });
const weakSetAdd = WeakSet.prototype.add;
exports.WeakSetDescriptor = regConstructor(WeakSet, {
    name: "WeakSet",
    write(ctx, value) {
        const res = { v: [] };
        ctx.weakSets.push([value, res]);
        return res;
    },
    create() {
        return new WeakSet();
    },
    readContent(ctx, json, value) {
        const { v } = json;
        for (const i of v)
            weakSetAdd.call(value, ctx.step(i));
    }
});
exports.WeakMapDescriptor = {
    name: "WeakMap",
    write(ctx, value) {
        const k = [];
        const v = [];
        const res = { k, v };
        for (const i of ctx.sharedRefsMap.values()) {
            if (value.has(i.value)) {
                k.push(ctx.step(i.value, k, k.length));
                v.push(ctx.step(value.get(i.value), v, v.length));
            }
        }
        ctx.weakMaps.push([value, res]);
        return res;
    },
    create() {
        return new WeakMap();
    },
    readContent(ctx, json, value) {
        const { k, v } = json;
        for (let i = 0, len = k.length; i < len; ++i)
            weakMapSet.call(value, ctx.step(k[i]), ctx.step(v[i]));
    }
};
regConstructor(WeakMap, exports.WeakMapDescriptor);
regNewConstructor(LocSet, iterableDescriptor({
    readContent(ctx, json, value) {
        for (const i of json.l)
            value.add(ctx.step(i));
    },
    globalName: "Set"
}));
regNewConstructor(LocMap, iterableDescriptor({
    write(ctx, value) {
        const k = [];
        const v = [];
        for (const [ki, vi] of value) {
            k.push(ctx.step(ki, k, k.length));
            v.push(ctx.step(vi, v, v.length));
        }
        return { k, v };
    },
    readContent(ctx, json, value) {
        const { k, v } = json;
        for (let i = 0, len = k.length; i < len; ++i)
            value.set(ctx.step(k[i]), ctx.step(v[i]));
    },
    globalName: "Map"
}));
regNewConstructor(RegExp, {
    name: "RegExp",
    write(_, value) {
        const json = { src: value.source, flags: value.flags };
        if (value.lastIndex)
            json.last = value.lastIndex;
        return json;
    },
    create(_, json) {
        const value = new RegExp(json.src, json.flags);
        if (json.last)
            value.lastIndex = json.last;
        return value;
    },
    props: false,
    refAware: false,
    globalName: "RegExp"
});
/**
 * registers an object as opaque along with all other
 * values accessible from this object
 */
function regOpaqueRec(value, prefix = value.constructor.name, opts = {}) {
    if (!value ||
        !(typeof value === "function" || typeof value === "object") ||
        descriptorByObject.has(value))
        return;
    const descrs = Object.getOwnPropertyDescriptors(value);
    for (const i of Object.getOwnPropertySymbols(descrs)) {
        reg(descrs[i], `${prefix}#${String(i)}`);
    }
    regOpaqueObject(value, prefix, opts.descriptor || { props: false });
    for (const i of Object.getOwnPropertyNames(descrs))
        reg(descrs[i], `${prefix}#${i}`);
    if (opts.deep) {
        const proto = Object.getPrototypeOf(value);
        if (proto)
            regOpaqueRec(proto, `${prefix}#proto`, opts);
    }
    function reg(descr, name) {
        const val = descr.value;
        if (!val)
            return;
        const ty = typeof val;
        if (ty === "function" || ty === "object") {
            if (opts.deep) {
                regOpaqueRec(val, name, opts);
            }
            else {
                regOpaqueObject(val, name, opts.descriptor);
            }
        }
        else if (ty === "symbol" && Symbol.keyFor(val) == null)
            regOpaquePrim(val, `${prefix}#${name}#${String(val)}`);
    }
}
/**
 * Opaque object will be added automatically if not known object built with
 * `constr` is encountered when writing.
 */
function regAutoOpaqueConstr(constr, silent) {
    return (constr.prototype[exports.descriptorSymbol] = {
        write(ctx, value, parent, index) {
            let name = constr.name;
            if (value.name)
                name += `:${value.name}`;
            else if (value.constructor !== constr)
                name += value.constructor.name;
            // tslint:disable-next-line
            if (!silent && console.warn) {
                showStack(ctx, name, value);
                // tslint:disable-next-line
                console.warn("auto opaque", name, value, new Error().stack);
            }
            return regOpaqueObject(value, name).write(ctx, value, parent, index);
        }
    });
}
function rebindGlobal() {
    if (descriptorByObject.has(globalThis))
        return;
    const oldState = state;
    ObjectConstr = globalThis.Object;
    state = {
        byName: new LocMap(),
        byValue: new LocMap(state.byValue),
        byObject: state.byObject,
        byTypeOfProp: new LocMap(state.byTypeOfProp)
    };
    globalThis.__effectfulSerializationState = {};
    for (let [name, descriptor] of oldState.byName) {
        if (descriptor.globalName) {
            const value = globalThis[descriptor.globalName];
            if (!value)
                continue;
            descriptor = Object.assign({}, descriptor, { value });
            weakMapSet.call(descriptorByObject, value, descriptor);
        }
        state.byName.set(name, descriptor);
    }
    state = initializeState(__effectfulSerializationState);
}
/**
 * Monkey patching platform objects to make them serializable,
 * run it as soon as possible if a global serialization is needed
 */
function regGlobal() {
    if (descriptorByObject.has(globalThis))
        return;
    regOpaqueObject(globalThis, "#global", {
        props: true,
        propsSnapshot: true,
        overrideProps: { AnonymousContent: false }
    });
    for (const name of Object.getOwnPropertyNames(globalThis)) {
        try {
            const obj = globalThis[name];
            if (!obj)
                continue;
            if (typeof obj !== "function" && typeof obj !== "object")
                continue;
            if (name === "location") {
                regOpaqueObject(globalThis.location, "location", { props: false });
                continue;
            }
            const descr = descriptorByObject.get(obj);
            if (descr && descr.props === false)
                continue;
            regOpaqueObject(obj, `#${name}`);
            for (const i of Object.getOwnPropertyNames(obj)) {
                // not registering prototypes to avoid unintended descriptor's inheritance
                if (i === "prototype")
                    continue;
                const descr = Object.getOwnPropertyDescriptor(obj, i);
                if (typeof descr.value !== "function")
                    continue;
                regOpaqueObject(descr.value, `#G#${name}#{j}`);
            }
            if (typeof obj === "function" && obj.prototype) {
                for (const j of Object.getOwnPropertyNames(obj.prototype)) {
                    if (j === "prototype")
                        continue;
                    const descr = Object.getOwnPropertyDescriptor(obj.prototype, j);
                    if (typeof descr.value !== "function")
                        continue;
                    regOpaqueObject(descr.value, `#G##${name}#{j}`);
                }
            }
        }
        catch (_e) {
            continue;
        }
    }
}
regOpaquePrim(exports.boundThisSymbol, "#this");
regOpaquePrim(exports.boundArgsSymbol, "#args");
regOpaquePrim(exports.boundFunSymbol, "#fun");
const notSerializableTraps = {};
for (const i of [
    "apply",
    "construct",
    "defineProperty",
    "deleteProperty",
    "enumerate",
    "getOwnPropertyDescriptor",
    "getPrototypeOf",
    "has",
    "isExtensible",
    "ownKeys",
    "preventExtensions",
    "set",
    "setPrototypeOf"
]) {
    notSerializableTraps[i] = function (target) {
        const descriptor = descriptorByObject.get(target);
        throw new TypeError(`${i} in a not restored object${descriptor ? ` (${descriptor.name})` : ""}`);
    };
}
notSerializableTraps.get = function (target, prop) {
    const descriptor = descriptorByObject.get(target);
    throw new TypeError(`getting ${prop} in a not restored object${descriptor ? ` (${descriptor.name})` : ""}`);
};
/** an object which is replaces all not serializable values after read */
const notSerializablePlaceholder = new Proxy(function () { }, notSerializableTraps);
/** shorter format for properties descriptors */
exports.PropertyDescriptorDescriptor = regDescriptor({
    read(_ctx, _json) {
        return {};
    },
    readContent(ctx, json, value) {
        readPropDescriptor(ctx, json.v, json.f || 0, json.s, json.g, value);
    },
    write(ctx, value) {
        const res = writeProp(ctx, [], value, descrFlags(value));
        if (!res)
            return {};
        return { v: res[0], f: res[1], s: res[2], g: res[3] };
    },
    name: "PD",
    props: false
});
regConstructor(String, {
    create(_ctx, json) {
        return new String(json.v);
    },
    write(_ctx, value) {
        return { v: String(value) };
    }
});
regConstructor(Number, {
    create(_ctx, json) {
        return new Number(json.v);
    },
    write(_ctx, value) {
        return { v: Number(value) };
    }
});
if (typeof ArrayBuffer !== "undefined") {
    const { encode, decode } = require("base64-arraybuffer");
    const ArrayBufferDescr = regConstructor(ArrayBuffer, {
        name: "ArrayBuffer",
        write(_ctx, value) {
            return { d: encode(value) };
        },
        create(_ctx, json) {
            return decode(json.d);
        },
        props: false
    });
    for (const name of [
        "DataView",
        "Int8Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "Int16Array",
        "Uint16Array",
        "Int32Array",
        "Uint32Array",
        "Float32Array",
        "Float64Array",
        "BigInt64Array",
        "BigUint64Array"
    ]) {
        const Constr = globalThis[name];
        if (!Constr)
            continue;
        regConstructor(Constr, {
            name,
            write(ctx, value) {
                const res = { o: value.byteOffset, l: value.length };
                res.b = ArrayBufferDescr.write(ctx, value.buffer, res, "b");
                return res;
            },
            create(ctx, json) {
                return new Constr(ArrayBufferDescr.read(ctx, json.b), json.o, json.l);
            },
            props: false
        });
    }
}
