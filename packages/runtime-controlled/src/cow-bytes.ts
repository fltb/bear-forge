import {CowStore} from './cow-store.ts';

const pageSize = 4096;
const widths = {Int8: 1, Uint8: 1, Int16: 2, Uint16: 2, Int32: 4, Uint32: 4, Float32: 4, Float64: 8, BigInt64: 8, BigUint64: 8} as const;
export type ByteKind = keyof typeof widths;

/** Fixed-size byte storage. Allocation is logically zero-filled; physical
 * pages appear on write. Fork shares the page trie, and the first write copies
 * at most one 4 KiB page per touched page, never the entire backing buffer.
 * Offsets and lengths arrive after the operation adapter's JS conversions.
 */
export class CowBytes {
  readonly byteLength: number;
  private pages = new CowStore<Uint8Array>();
  private baseline: Uint8Array | undefined;
  constructor(byteLength: number, baseline?: Uint8Array) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new RangeError('Invalid buffer length');
    if (baseline && baseline.byteLength !== byteLength) throw new RangeError('Invalid buffer baseline');
    this.byteLength = byteLength; this.baseline = baseline;
  }
  private range(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
      || offset > this.byteLength || length > this.byteLength - offset) throw new RangeError('Offset outside buffer');
  }
  private writable(index: number): Uint8Array {
    if (!this.pages.has(index)) {
      const page = this.baseline ? this.baseline.slice(index * pageSize, Math.min((index + 1) * pageSize, this.byteLength))
        : new Uint8Array(Math.min(pageSize, this.byteLength - index * pageSize));
      this.pages.set(index, page);
      return page;
    }
    return this.pages.edit(index, page => page.slice());
  }
  fork(): CowBytes {
    const branch = new CowBytes(this.byteLength, this.baseline);
    branch.pages = this.pages.fork();
    return branch;
  }
  clear(): void { this.pages.clear(); this.baseline = undefined; }
  read(offset: number): number {
    this.range(offset, 1);
    return this.pages.get(Math.floor(offset / pageSize))?.[offset % pageSize] ?? this.baseline?.[offset] ?? 0;
  }
  write(offset: number, value: number): void {
    this.range(offset, 1);
    this.writable(Math.floor(offset / pageSize))[offset % pageSize] = value;
  }
  readInto(offset: number, target: Uint8Array): void {
    this.range(offset, target.length);
    for (let written = 0; written < target.length;) {
      const position = offset + written, index = Math.floor(position / pageSize), start = position % pageSize;
      const count = Math.min(pageSize - start, target.length - written), page = this.pages.get(index);
      if (page) target.set(page.subarray(start, start + count), written);
      else if (this.baseline) target.set(this.baseline.subarray(position, position + count), written);
      else target.fill(0, written, written + count);
      written += count;
    }
  }
  writeFrom(offset: number, source: Uint8Array): void {
    this.range(offset, source.length);
    for (let read = 0; read < source.length;) {
      const position = offset + read, index = Math.floor(position / pageSize), start = position % pageSize;
      const count = Math.min(pageSize - start, source.length - read);
      this.writable(index).set(source.subarray(read, read + count), start);
      read += count;
    }
  }
  copyFrom(offset: number, source: CowBytes, sourceOffset: number, length: number): void {
    this.range(offset, length); source.range(sourceOffset, length);
    const reverse = this === source && offset > sourceOffset && offset < sourceOffset + length;
    const scratch = new Uint8Array(Math.min(pageSize, length));
    for (let copied = 0; copied < length;) {
      const count = Math.min(scratch.length, length - copied), start = reverse ? length - copied - count : copied;
      const chunk = scratch.subarray(0, count);
      source.readInto(sourceOffset + start, chunk);
      this.writeFrom(offset + start, chunk);
      copied += count;
    }
  }
  readValue(kind: ByteKind, offset: number, littleEndian = false): number | bigint {
    const width = widths[kind]; this.range(offset, width);
    const page = this.pages.get(Math.floor(offset / pageSize)), start = offset % pageSize;
    if (page && start + width <= page.length) {
      return (DataView.prototype as any)['get' + kind].call(new DataView(page.buffer, page.byteOffset, page.byteLength), start, littleEndian);
    }
    const bytes = new Uint8Array(width); this.readInto(offset, bytes);
    return (DataView.prototype as any)['get' + kind].call(new DataView(bytes.buffer), 0, littleEndian);
  }
  writeValue(kind: ByteKind, offset: number, value: number | bigint, littleEndian = false): void {
    const bytes = new Uint8Array(widths[kind]);
    (DataView.prototype as any)['set' + kind].call(new DataView(bytes.buffer), 0, value, littleEndian);
    this.writeFrom(offset, bytes);
  }
}
