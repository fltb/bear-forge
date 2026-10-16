import {CowStore} from './cow-store.ts';

/** FIFO for immutable runtime jobs. Fork shares the index root; removing the
 * first item never reverses or copies the remaining queue. Job payloads and
 * their identity links are read-only and resolve through the active Context.
 */
export class CowQueue<T> {
  private items = new CowStore<T>();
  private head = 0;
  private tail = 0;
  private count = 0;
  get length(): number { return this.count; }
  private next(index: number): number { return index === Number.MAX_SAFE_INTEGER ? 0 : index + 1; }
  push(value: T): number {
    if (this.count === Number.MAX_SAFE_INTEGER) throw new RangeError('Job queue is full');
    this.items.set(this.tail, value);
    this.tail = this.next(this.tail);
    return ++this.count;
  }
  shift(): T | undefined {
    if (!this.count) return undefined;
    const value = this.items.get(this.head);
    this.items.delete(this.head);
    this.head = this.next(this.head);
    if (!--this.count) this.clear();
    return value;
  }
  fork(): CowQueue<T> {
    const branch = new CowQueue<T>();
    branch.items = this.items.fork();
    branch.head = this.head; branch.tail = this.tail; branch.count = this.count;
    return branch;
  }
  clear(): void { this.items.clear(); this.head = this.tail = this.count = 0; }
  *[Symbol.iterator](): IterableIterator<T> {
    for (let index = this.head, remaining = this.count; remaining; remaining--, index = this.next(index)) {
      yield this.items.get(index)!;
    }
  }
}
