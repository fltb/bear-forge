/**
 * # Serialization library for @effectful toolchain
 */
export interface State {
    /** name for a property storing descriptor */
    symbol: symbol;
    /** descriptors registered by type's name */
    byName: Map<string, Descriptor>;
    /** descriptors registered by some primitive value */
    byValue: Map<any, Descriptor>;
    /** descriptors registered by some value */
    byObject: WeakMap<any, Descriptor>;
    /** descriptors registered by its prototype value */
    byPrototype: WeakMap<any, Descriptor>;
    /**
     * react uses `$$typeof` property for its values, it is the mapping
     * @private
     */
    byTypeOfProp: Map<symbol, Descriptor>;
}
export interface IncompleteState {
    symbol?: symbol;
    byName?: Map<string, Descriptor>;
    byValue?: Map<any, Descriptor>;
    byObject?: WeakMap<any, Descriptor>;
    byPrototype?: WeakMap<any, Descriptor>;
    byTypeOfProp?: Map<symbol, Descriptor>;
}
/** name of a property to specify `Descriptor` for JS value */
export declare let descriptorSymbol: symbol;
/**
 * Sets new state value
 *
 * After setting this each instance of this module will have own state
 */
export declare function resetState(init?: IncompleteState): void;
export declare function getState(): State;
/**
 * Conversion between JSON values and JS values. JSON values set is a subset
 * of JS values which can be converted to string using `JSON.stringify`
 * function and read back with `JSON.parse`.
 */
/** Options to amend `write` behavior */
export interface WriteOptions {
    /**
     * don't throw exception if there is any writting error
     */
    ignore?: boolean | "opaque" | "placeholder";
    /**
     * execute `console.warn` for each ignored value (if `ignore` isn't falsy)
     */
    warnIgnored?: boolean;
    /**
     * current reference's id assignment state,
     * this can be copied between writes to keep same refs ids
     */
    sharedRefsMap?: Map<any, SharedRefInfo>;
    sharedRefs?: SharedRefInfo[];
    /**
     * holds information about seen local Symbols, it can be copied between runs
     */
    symsByName?: Map<string, SymbolDescr[]>;
    /**
     * holds information about seen local Symbols, it can be copied between runs
     */
    knownSyms?: Map<symbol, SymbolDescr>;
    /**
     * by default the serializer uses references only if the object is referred more than once
     * this may still lead to stack overflow in `JSON.stringify` esp. if the data has some
     * structures like linked lists, this option will always generate a reference
     */
    alwaysByRef?: boolean;
    verbose?: boolean;
    /** if this array is initialized it will be filled with the shared object's values */
    refs?: any[];
    weakMaps?: [WeakMap<any, any>, JSONObject][];
    weakSets?: [WeakSet<any>, JSONObject][];
}
/** Options to amend `write` behavior */
export interface ReadOptions {
    /** don't throw exception if there is any reading error */
    ignore?: boolean | "placeholder";
    warnIgnored?: boolean;
    /**
     * holds information about seen local Symbols, it can be copied between runs
     */
    symsByName?: Map<string, SymbolDescr[]>;
    /**
     * holds information about seen local Symbols, it can be copied between runs
     */
    knownSyms?: Map<symbol, SymbolDescr>;
    /** references to shared object values */
    refs?: any[];
}
/** `JSON.stringify` serializable value */
export type JSONValue = boolean | number | string | JSONObject | JSONArray | null;
/** `JSON.stringify` serializable Object */
export interface JSONObject {
    [name: string]: JSONValue;
}
/** `JSON.stringify` serializable Array */
export interface JSONArray extends Array<JSONValue> {
}
/** Describes how to read values of a type */
export interface ReadDescriptor<T = unknown> {
    /**
     * Reads value from `json` value
     * @param ctx  - recursive reads handling for sub-values
     * @param json - input JSON
     * @returns     - resulting JS value
     */
    read: (_ctx: ReadContext, _json: JSONValue) => T;
    /**
     * The first part of `read`, just creates a corresponding value without traversing into children.
     * This is needed to avoid infinite loops on recursive values.
     * @param ctx  - recursive reads handling for sub-values
     * @param json - input JSON
     * @returns - resulting JS value
     */
    create: (_ctx: ReadContext, _json: JSONValue) => T;
    /**
     * The second part of `read`, creates children and sets them into `value`.
     * This is needed to avoid infinite loops on recursive values.
     * @param ctx  - recursive reads handling for sub-values
     * @param json - input JSON
     * @param value - resulting JS value
     */
    readContent: (_ctx: ReadContext, _json: JSONValue, _value: T) => void;
}
export interface WithTypeofTag {
    $$typeof?: symbol;
}
export interface DescriptorOpts<T = unknown> {
    /** Unique type name */
    name?: string;
    /** dispatching descriptor by value of `$$typeof` property */
    typeofTag?: symbol;
    /**
     * If !== false, the descriptor recognizes shared objects and uses only references for them.
     * The default is `true`.
     */
    refAware?: boolean;
    /**
     * If !== false the descriptor will traverse own properties too
     */
    props?: boolean;
    /**
     * Make a snapshot of its original property values and won't write
     * them if they aren't changed
     */
    propsSnapshot?: boolean;
    /**
     * If !== false the descriptor will add property `$` equal to `name` by default
     */
    default$?: boolean;
    /**
     * `typeof value` for the values this serializes
     */
    typeofHint?: string;
    /** if `props !== false` this is a predicate to specify which properties should be output. */
    overrideProps?: {
        [name: string]: boolean;
    };
    /** don't change the `name` to make it unique */
    strictName?: boolean;
    /** a prototype to be assigned with `Object.setPrototype` in reads */
    valuePrototype?: object | null | false;
    /** Serialized value's constructor */
    valueConstructor?: ValueConstructor<T>;
    /** constant value */
    value?: T;
    /** mask for property descriptor flags (configurable:1,enumerable:2,writable:4,no value = 8)  */
    propsDescrMask?: number;
    /**
     * if an object has this prototype it won't be recorded
     */
    defaultPrototype?: any;
    /**
     * for descriptors traversing properties with stores
     * original values which shouldn't be output
     */
    snapshot?: {
        [name: string]: PropertyDescriptor;
    };
    /** if it is a value in a global scope this will store its name */
    globalName?: string;
}
interface ValueConstructor<T = unknown> {
    name?: string;
    new (...args: any[]): T;
}
/** Describes how write values of a type */
export interface WriteDescriptor<T = unknown> {
    /**
     * Sets `value` into `parent` on `index` position
     * @param ctx    - recursive writes for sub-values
     * @param parent - container for the value output
     * @param index  - either name of a field if parent is an object
     *                 or number index if it is an array
     */
    write: (_ctx: WriteContext, _value: T, _parent: JSONObject | JSONArray, _index: number | string) => JSONValue;
}
export type Descriptor<T = any> = WriteDescriptor<T> & ReadDescriptor<T> & DescriptorOpts<T>;
/**
 * simplified version of a descriptor where missed properties can be calculated
 */
export type IncompleteDescriptor<T = unknown> = DescriptorOpts<T> & {
    create?: (_ctx: ReadContext, _json: JSONValue) => T;
    readContent?: (_ctx: ReadContext, _json: JSONValue, _value: T) => void;
    read?: (_ctx: ReadContext, _json: JSONValue) => T;
    write?: (_ctx: WriteContext, _value: T, _parent: JSONObject | JSONArray, _index: number | string) => JSONValue;
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
export declare function write(value: object, opts?: WriteOptions): JSONObject;
export declare function read(json: JSONObject, opts?: ReadOptions): any;
/**
 * `write` followed by `JSON.stringify`,
 * with same parameters as for `JSON.stringify`
 */
export declare function stringify(value: any, replacer?: (key: string, value: any) => any, spaces?: string | number): string;
/** `JSON.parse` followed by `read` */
export declare function parse(json: string): any;
export declare const boundThisSymbol: unique symbol;
export declare const boundArgsSymbol: unique symbol;
export declare const boundFunSymbol: unique symbol;
export declare function setObjectDescriptor(object: any, descriptor: Descriptor): void;
export declare const BindDescriptor: Descriptor<(...args: any[]) => any>;
/**
 * like `Function.prototype.bind` but returs serializable object if all
 * arguments are serializable
 *
 * @param func
 * @param self - bound `this`
 * @param args - bound arguments
 */
export declare function bind(func: (...args: any[]) => any, self: any, ...args: any[]): (...args: any[]) => any;
interface SharedRefInfo {
    ref: JSONObject | null;
    data: JSONObject | null;
    parent?: JSONObject | JSONArray;
    index?: string | number;
    value?: any;
    descriptor?: Descriptor<any>;
    nextJob?: SharedRefInfo;
    started?: boolean;
    debCtx?: any;
}
/**
 * An object passed to Descriptor's `write` method to support recursive
 * invocation for nested values
 */
export declare class WriteContext {
    sharedRefsMap: Map<any, SharedRefInfo>;
    sharedRefs: SharedRefInfo[];
    opts: WriteOptions;
    symsByName?: Map<string, SymbolDescr[]>;
    knownSyms?: Map<symbol, SymbolDescr>;
    jobs?: SharedRefInfo;
    weakMaps: [WeakMap<any, any>, JSONObject][];
    weakSets: [WeakSet<any>, JSONObject][];
    constructor(opts: WriteOptions);
    /**
     * Invokes write recursively for nested values
     * @param value - value to write
     * @param parent - container for the value output
     * @param key  - either name of a field if parent is an object
     *               or number index if it is an array
     */
    step(value: any, parent: JSONArray | JSONObject, key: number | string): JSONValue;
}
/**
 * An object passed to Descriptor's `read` method to support recursive invocation
 * for nested values
 */
export declare class ReadContext {
    symsByName?: Map<string, SymbolDescr[]>;
    knownSyms: Map<symbol, SymbolDescr>;
    sharedJsons: JSONValue[];
    sharedVals: any[];
    sharedDescriptors: Descriptor[];
    opts: ReadOptions;
    constructor(opts: ReadOptions, sharedJsons: JSONValue[]);
    /**
     * Invokes read recursively for nested values
     * @param json - value to read
     */
    step(json: JSONValue): any;
    /**
     * Invokes create recursively for nested values.
     * @param json - value to read
     */
    createStep(json: JSONValue): any;
}
/**
 * default implementaiton of {@link Descriptor}
 */
export declare const descriptorTemplate: Descriptor;
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
export declare function regDescriptor<T>(descriptor: IncompleteDescriptor<T>): Descriptor<T>;
/**
 * updates `snapshot` with the current values of its properties
 *
 * @param value - an object registered by `regOpaqueObject` before
 */
export declare function updateInitialSnapshot(value: any): void;
/**
 * This function registers `value` as opaque. The library outputs names instead
 * of stored data for them. The values should be registered with the same name
 * on writing and reading sides.
 *
 * @param value
 * @param name
 * @param props - should the properties of the object be output too
 */
export declare function regOpaqueObject(value: any, name?: string, descriptor?: IncompleteDescriptor<any>): Descriptor;
/**
 * Same as `regOpaqueObject` but for non-object types, uses `Map` registry instead of `WeakMap`
 * @see regOpaqObject
 */
export declare function regOpaquePrim<T>(value: T, name?: string): Descriptor<T>;
export declare function regPrim<T>(descriptor: Descriptor<T>, value: any, name?: string): Descriptor<T>;
/**
 * Registers `prototype` of `constructor` as opaque value and use it
 * as the value's type in output.
 * into a prototype.
 *
 * @see regOpaqueObject
 * @param constructor - plain JS constructor function or class
 * @param descriptor
 */
export declare function regConstructor<T>(constr: ValueConstructor<T>, descriptor?: IncompleteDescriptor<T>, inherit?: boolean): Descriptor<T>;
export declare const NotSerializableDescriptor: Descriptor<void>;
/** same as `regConstructor` but it also uses `constr` with new to build the object */
export declare function regNewConstructor<T>(constr: ValueConstructor<T>, descriptor?: IncompleteDescriptor<T>): Descriptor;
export declare const PrimDescriptor: Descriptor;
export declare const NotSerializableToken: {
    _notSerializable: boolean;
};
/** Writing serialized `Object.defineProperty` descriptors to JSON */
export declare function writeProps(ctx: WriteContext, descrs: {
    [name: string]: PropertyDescriptor;
}, pred: {
    [name: string]: boolean;
}, mask: number, snapshot?: {
    [name: string]: PropertyDescriptor;
}): any[];
/** Reading serialized `Object.defineProperty` descriptors from JSON */
export declare function readProps<T>(ctx: ReadContext, props: any[], value: T): void;
/** A descriptor for `Object.getOwnPropertyDescriptors` object */
export declare const ObjectPropertiesDescriptor: {
    write(ctx: WriteContext, value: any): JSONValue;
    create(): {};
    readContent(ctx: ReadContext, json: JSONValue, value: any): void;
};
export declare const undefinedSymbol: unique symbol;
interface SymbolDescr {
    name: string;
    id: number;
    value: symbol;
}
export declare const BigIntDescriptor: Descriptor<number> | Descriptor<bigint>;
export declare let getObjectDescriptor: (value: any) => Descriptor | undefined;
export declare function regObjectDescriptorGetter(impl: (value: any) => Descriptor | undefined): void;
export declare let getValueDescriptor: (value: any) => Descriptor | undefined;
export declare function regValueDescriptorGetter(impl: (value: any) => Descriptor | undefined): void;
export declare function getJsonDescriptor(ctx: ReadContext, json: JSONValue): Descriptor;
export declare const WeakSetWorkaround: {
    new (): {
        prop: symbol;
        add(value: any): /*elided*/ any;
        delete(value: any): boolean;
        has(value: any): boolean;
    };
};
export declare const WeakMapWorkaround: {
    new (): {
        prop: symbol;
        set(key: any, value: any): /*elided*/ any;
        get(key: any): any;
        delete(key: any): boolean;
        has(value: any): boolean;
    };
};
export declare const WeakSetDescriptor: Descriptor<WeakSet<WeakKey>>;
export declare const WeakMapDescriptor: IncompleteDescriptor<WeakMap<any, any>>;
/**
 * registers an object as opaque along with all other
 * values accessible from this object
 */
export declare function regOpaqueRec(value: any, prefix?: string, opts?: {
    deep?: boolean;
    descriptor?: IncompleteDescriptor<any>;
}): void;
/**
 * Opaque object will be added automatically if not known object built with
 * `constr` is encountered when writing.
 */
export declare function regAutoOpaqueConstr(constr: any, silent?: boolean): {
    write(ctx: WriteContext, value: any, parent: any, index: string | number): JSONValue;
};
export declare function rebindGlobal(): void;
/**
 * Monkey patching platform objects to make them serializable,
 * run it as soon as possible if a global serialization is needed
 */
export declare function regGlobal(): void;
/** shorter format for properties descriptors */
export declare const PropertyDescriptorDescriptor: Descriptor<PropertyDescriptor>;
export {};
