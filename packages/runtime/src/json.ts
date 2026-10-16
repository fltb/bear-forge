import {types} from 'node:util';

type JsonOperations = {
  get(object: any, key: PropertyKey): any;
  invoke(fn: Function, receiver: any, args: any[]): any;
  string(value: any): string;
  number(value: any): number;
  length(value: any): number;
  tick(): void;
  keys?(object: object): string[];
  prototype?(object: object): object | null;
  allocate?: ((object: object) => void) | undefined;
};
const scalarStringify = JSON.stringify;
const isRawJSON = Object.getOwnPropertyDescriptor(JSON, 'isRawJSON')?.value as ((value: unknown) => boolean) | undefined;
const booleanValue = Boolean.prototype.valueOf, bigintValue = BigInt.prototype.valueOf;
/** The JSON algorithms inspect all own keys before filtering enumerable string
 * keys. Preserve one OwnPropertyKeys call and its descriptor order. */
function enumerableKeys(value: object, tick: () => void): string[] {
  const names: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    tick();
    if (typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable) names.push(key);
  }
  return names;
}

/** ECMA-262 JSON serialization, with every author-observable read/call routed
 * through the runtime. V8 retains primitive quoting/number formatting. The
 * traversal stack belongs to this synchronous call and is never a Context root. */
export function stringify(value: any, replacer: any, space: any, ops: JsonOperations): string | undefined {
  const replacerFunction = typeof replacer === 'function' ? replacer : undefined;
  let propertyList: string[] | undefined;
  if (!replacerFunction && Array.isArray(replacer)) {
    propertyList = [];
    const seen = new Set<string>(), length = ops.length(ops.get(replacer, 'length'));
    for (let index = 0; index < length; index++) {
      ops.tick();
      const item = ops.get(replacer, String(index));
      if (typeof item !== 'string' && typeof item !== 'number' && !types.isStringObject(item) && !types.isNumberObject(item)) continue;
      const key = ops.string(item);
      if (!seen.has(key)) {seen.add(key);propertyList.push(key);}
    }
  }
  if (types.isNumberObject(space)) space = ops.number(space);
  else if (types.isStringObject(space)) space = ops.string(space);
  const gap = typeof space === 'number' ? ' '.repeat(Number.isNaN(space) ? 0 : Math.max(0, Math.min(10, Math.trunc(space))))
    : typeof space === 'string' ? space.slice(0, 10) : '';
  const active = new Set<object>();
  const stack: object[] = [], keys: string[] = [];
  function circularError(start: number, closingKey: string): never {
    // The original graph has already been traversed through guarded reads.
    // Re-running native stringify on it would repeat getters and toJSON calls.
    // Build only the active cycle with data properties and let this V8 produce
    // its own path/constructor diagnostic without invoking author code.
    const path = stack.slice(start);
    const shadows = path.map(value => {
      const prototype = ops.prototype ? ops.prototype(value) : Object.getPrototypeOf(value);
      const shadow = Array.isArray(value) ? [] : Object.create(prototype);
      if (Array.isArray(value)) Object.setPrototypeOf(shadow, prototype);
      Object.defineProperty(shadow, 'toJSON', {value: undefined, configurable: true});
      return shadow;
    });
    for (let index = 1; index < path.length; index++) {
      Object.defineProperty(shadows[index - 1], keys[start + index]!, {
        value: shadows[index], enumerable: true, configurable: true
      });
    }
    Object.defineProperty(shadows.at(-1)!, closingKey, {
      value: shadows[0], enumerable: true, configurable: true
    });
    scalarStringify(shadows[0]);
    throw new Error('Circular diagnostic graph did not reproduce a cycle');
  }
  function property(holder: any, key: string, indent: string): string | undefined {
    ops.tick();
    let item = ops.get(holder, key);
    if (item !== null && (typeof item === 'object' || typeof item === 'function' || typeof item === 'bigint')) {
      const toJSON = ops.get(item, 'toJSON');
      if (typeof toJSON === 'function') item = ops.invoke(toJSON, item, [key]);
    }
    if (replacerFunction) item = ops.invoke(replacerFunction, holder, [key, item]);
    if (item !== null && typeof item === 'object') {
      if (isRawJSON?.(item)) return scalarStringify(item);
      if (types.isNumberObject(item)) item = ops.number(item);
      else if (types.isStringObject(item)) item = ops.string(item);
      else if (types.isBooleanObject(item)) item = Reflect.apply(booleanValue, item, []);
      else if (types.isBigIntObject(item)) item = Reflect.apply(bigintValue, item, []);
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number') return scalarStringify(item);
    // The scalar is already fully reduced; V8 supplies its own observable
    // BigInt failure without reading any author object or calling a hook.
    if (typeof item === 'bigint') return scalarStringify(item);
    if (typeof item !== 'object') return undefined;
    if (active.has(item)) return circularError(stack.indexOf(item), key);
    active.add(item);
    stack.push(item); keys.push(key);
    try {
      const array = Array.isArray(item), nextIndent = indent + gap, pieces: string[] = [];
      if (array) {
        const length = ops.length(ops.get(item, 'length'));
        for (let index = 0; index < length; index++) pieces.push(property(item, String(index), nextIndent) ?? 'null');
      } else {
        for (const name of propertyList ?? (ops.keys ? ops.keys(item) : enumerableKeys(item, ops.tick))) {
          const text = property(item, name, nextIndent);
          if (text !== undefined) pieces.push(scalarStringify(name) + (gap ? ': ' : ':') + text);
        }
      }
      const open = array ? '[' : '{', close = array ? ']' : '}';
      return open + (pieces.length === 0 ? '' : gap ? '\n' + nextIndent + pieces.join(',\n' + nextIndent) + '\n' + indent : pieces.join(',')) + close;
    } finally {stack.pop();keys.pop();active.delete(item);}
  }
  const holder = {'':value}; ops.allocate?.(holder);
  return property(holder, '', '');
}


type ParseOperations = Pick<JsonOperations, 'get' | 'invoke' | 'string' | 'length' | 'tick' | 'keys' | 'allocate'> & {
  define(object: object, key: string, value: unknown): void;
  remove(object: object, key: string): void;
};
type ParseRecord = {value: any; context: object; children: Map<string, ParseRecord> | undefined};
const nativeParse = JSON.parse;

/** V8 parses the text and supplies source records. The recording walk cannot
 * execute program code: all its objects were just created by the JSON parser.
 * Only the subsequent guarded walk invokes the program's reviver. */
export function parse(text: any, reviver: any, ops: ParseOperations): any {
  const source = ops.string(text);
  // V8 parses the entire input before returning even when the resulting value
  // is tiny. Charge the text before entering that uninterruptible native call;
  // malformed input also consumes work if the author catches its SyntaxError.
  for (let remaining = source.length; remaining >= 1024; remaining -= 1024) ops.tick();
  if (typeof reviver !== 'function') return ops.allocate ? nativeParse(source, (_key, value) => {
    ops.tick();
    if (value !== null && typeof value === 'object') ops.allocate!(value);
    return value;
  }) : nativeParse(source);
  const children = new WeakMap<object, Map<string, ParseRecord>>();
  let root: any, rootRecord: ParseRecord | undefined, withContext = false;
  nativeParse(source, function(this: any, key: string, value: any, ...extra: any[]) {
    ops.tick();
    withContext = extra.length !== 0;
    const record: ParseRecord = {value, context: extra[0] ?? {},
      children: value !== null && typeof value === 'object' ? children.get(value) : undefined};
    if (value !== null && typeof value === 'object') ops.allocate?.(value);
    ops.allocate?.(record.context);
    let entries = children.get(this);
    if (!entries) children.set(this, entries = new Map());
    entries.set(key, record);
    root = this; rootRecord = record;
    return value;
  });
  ops.allocate?.(root);
  function internalize(holder: any, key: string, record?: ParseRecord): any {
    ops.tick();
    const value = ops.get(holder, key);
    const original = record !== undefined && Object.is(record.value, value);
    const context = original ? record.context : {};
    if (!original) ops.allocate?.(context);
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      function visit(name: string): void {
        const next = internalize(value, name, original ? record!.children?.get(name) : undefined);
        if (next === undefined) ops.remove(value, name);
        else ops.define(value, name, next);
      }
      if (Array.isArray(value)) {
        const length = ops.length(ops.get(value, 'length'));
        for (let index = 0; index < length; index++) visit(String(index));
      } else for (const name of ops.keys ? ops.keys(value) : enumerableKeys(value, ops.tick)) visit(name);
    }
    return ops.invoke(reviver, holder, withContext ? [key, value, context] : [key, value]);
  }
  return internalize(root, '', rootRecord);
}
