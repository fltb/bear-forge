import {CowIdentityStore} from './cow-identities.ts';
import {types} from 'node:util';
import {CowBytes, type ByteKind} from './cow-bytes.ts';
import {CowHeap} from './cow-heap.ts';

// Runtime bookkeeping must retain native ephemeron storage even when the
// language global exposes the controlled WeakMap constructor.
const NativeWeakMap = WeakMap;

export type TypedKind = ByteKind | 'Uint8Clamped';
export type ViewKind = TypedKind | 'DataView';
export type MemoryView = {buffer: ArrayBuffer; kind: ViewKind; byteOffset: number; byteLength: number; length: number};
type BufferState = {kind: 'buffer'; bytes: CowBytes};
type ViewState = {kind: 'view'; view: MemoryView};
type IdentityTable = {ids: WeakMap<object, number>; nextId: number};
const constructors = {Int8: Int8Array, Uint8: Uint8Array, Uint8Clamped: Uint8ClampedArray, Int16: Int16Array, Uint16: Uint16Array,
  Int32: Int32Array, Uint32: Uint32Array, Float32: Float32Array, Float64: Float64Array, BigInt64: BigInt64Array, BigUint64: BigUint64Array};
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Internal-slot adapter for fixed ArrayBuffer/TypedArray/DataView identities.
 * Native allocations supply brands and an immutable byte baseline. Subsequent
 * writes live in branch pages; native methods must use the operation adapter.
 * Ordinary own properties and prototypes belong to the separate object heap.
 */
export class CowMemory {
  private records = new CowIdentityStore<BufferState | ViewState>();
  private identities: IdentityTable;
  readonly objects: CowHeap | undefined;
  constructor(identities: IdentityTable = {ids: new NativeWeakMap(), nextId: 0}, objects?: CowHeap) {
    this.identities = identities; this.objects = objects;
  }
  private add<T extends object>(identity: T, state: BufferState | ViewState): T {
    const id = this.identities.nextId++;
    this.identities.ids.set(identity, id); this.records.register(id, identity); this.records.set(id, state, identity);
    if (this.objects && !this.objects.has(identity)) this.objects.register(identity, Object.getPrototypeOf(identity), []);
    return identity;
  }
  private state(identity: object): BufferState | ViewState {
    const id = this.identities.ids.get(identity), state = id === undefined ? undefined : this.records.get(id, identity);
    if (!state) throw new TypeError('Unknown buffer or view');
    return state;
  }
  has(identity: object): boolean {
    const id = this.identities.ids.get(identity);
    return id !== undefined && this.records.has(id, identity);
  }
  isBuffer(identity: object): boolean { return this.has(identity) && this.state(identity).kind === 'buffer'; }
  isView(identity: object): boolean { return this.has(identity) && this.state(identity).kind === 'view'; }
  private bytes(buffer: object, write = false): CowBytes {
    const state = this.state(buffer);
    if (state.kind !== 'buffer') throw new TypeError('Incompatible ArrayBuffer receiver');
    if (!write) return state.bytes;
    const next = this.records.edit(this.identities.ids.get(buffer)!, value => {
      if (value.kind !== 'buffer') throw new TypeError('Incompatible ArrayBuffer receiver');
      return {kind: 'buffer', bytes: value.bytes.fork()};
    }, buffer);
    return (next as BufferState).bytes;
  }
  bufferLength(buffer: object): number { return this.bytes(buffer).byteLength; }
  createBuffer(length: number): ArrayBuffer { return this.adoptBuffer(new ArrayBuffer(length)); }
  /** Only newly allocated, unexposed native results may be adopted. */
  adoptBuffer(buffer: ArrayBuffer): ArrayBuffer {
    if (this.has(buffer)) {this.bytes(buffer); return buffer;}
    if (this.identities.ids.has(buffer)) throw new TypeError('Buffer does not belong to this Context');
    const length = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!.call(buffer);
    return this.add(buffer, {kind: 'buffer', bytes: new CowBytes(length, new Uint8Array(buffer))});
  }
  adoptView(identity: ArrayBufferView): ArrayBufferView {
    if (this.has(identity)) {this.view(identity); return identity;}
    if (this.identities.ids.has(identity)) throw new TypeError('View does not belong to this Context');
    const data = types.isDataView(identity), prototype = data ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype);
    const field = (key: string | symbol) => Object.getOwnPropertyDescriptor(prototype, key)!.get!.call(identity);
    const buffer = this.adoptBuffer(field('buffer'));
    const kind: ViewKind = data ? 'DataView' : field(Symbol.toStringTag).replace(/Array$/, '');
    if (kind !== 'DataView' && !Object.hasOwn(constructors, kind)) throw new TypeError('Unsupported typed array brand');
    const byteLength = field('byteLength');
    return this.add(identity, {kind: 'view', view: {buffer, kind, byteOffset: field('byteOffset'), byteLength, length: data ? byteLength : field('length')}});
  }
  createView(kind: ViewKind, buffer: ArrayBuffer, offset = 0, length?: number): ArrayBufferView {
    const total = this.bufferLength(buffer), width = kind === 'DataView' ? 1 : constructors[kind].BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > total || offset % width) throw new RangeError('Invalid view offset');
    const remaining = total - offset;
    if (length === undefined && remaining % width) throw new RangeError('Invalid view length');
    const count = length ?? remaining / width;
    if (!Number.isSafeInteger(count) || count < 0 || count > Math.floor(remaining / width)) throw new RangeError('Invalid view length');
    const shell = kind === 'DataView' ? new DataView(buffer, offset, count) : new constructors[kind](buffer, offset, count);
    return this.add(shell, {kind: 'view', view: {buffer, kind, byteOffset: offset, byteLength: count * width, length: count}});
  }
  view(identity: object): MemoryView {
    const state = this.state(identity);
    if (state.kind !== 'view') throw new TypeError('Incompatible view receiver');
    return {...state.view};
  }
  fork(objects = this.objects?.fork()): CowMemory {
    const child = new CowMemory(this.identities, objects); child.records = this.records.fork(); return child;
  }
  clear(): void { this.records.clear(); }
  readElement(identity: object, index: number): number | bigint | undefined {
    const view = this.view(identity);
    if (view.kind === 'DataView') throw new TypeError('Expected typed array');
    if (!Number.isInteger(index) || index < 0 || Object.is(index, -0) || index >= view.length) return undefined;
    const kind = view.kind === 'Uint8Clamped' ? 'Uint8' : view.kind;
    return this.bytes(view.buffer).readValue(kind, view.byteOffset + index * constructors[view.kind].BYTES_PER_ELEMENT, littleEndian);
  }
  writeElement(identity: object, index: number, value: number | bigint): void {
    const view = this.view(identity);
    if (view.kind === 'DataView') throw new TypeError('Expected typed array');
    // Native element conversion includes clamping/ties and BigInt type checks,
    // and precedes the validity test even for an out-of-bounds integer index.
    const converted = new constructors[view.kind](1);
    (converted as any)[0] = value;
    if (!Number.isInteger(index) || index < 0 || Object.is(index, -0) || index >= view.length) return;
    const kind = view.kind === 'Uint8Clamped' ? 'Uint8' : view.kind;
    this.bytes(view.buffer, true).writeValue(kind, view.byteOffset + index * constructors[view.kind].BYTES_PER_ELEMENT, converted[0]!, littleEndian);
  }
  readData(identity: object, kind: ByteKind, offset: number, little = false): number | bigint {
    const view = this.view(identity);
    if (view.kind !== 'DataView') throw new TypeError('Expected DataView');
    const width = constructors[kind].BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > view.byteLength - width) throw new RangeError('Offset outside view');
    return this.bytes(view.buffer).readValue(kind, view.byteOffset + offset, little);
  }
  writeData(identity: object, kind: ByteKind, offset: number, value: number | bigint, little = false): void {
    const view = this.view(identity);
    if (view.kind !== 'DataView') throw new TypeError('Expected DataView');
    const width = constructors[kind].BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > view.byteLength - width) throw new RangeError('Offset outside view');
    this.bytes(view.buffer, true).writeValue(kind, view.byteOffset + offset, value, little);
  }
  readBytes(buffer: object, offset: number, target: Uint8Array): void { this.bytes(buffer).readInto(offset, target); }
  writeBytes(buffer: object, offset: number, source: Uint8Array): void { this.bytes(buffer, true).writeFrom(offset, source); }
  copyBytes(buffer: object, offset: number, source: object, sourceOffset: number, length: number): void {
    // Resolve the destination first: when both identities are equal, the
    // source must be that same editable CowBytes for overlap-safe memmove.
    const destination = this.bytes(buffer, true);
    destination.copyFrom(offset, this.bytes(source), sourceOffset, length);
  }
}
