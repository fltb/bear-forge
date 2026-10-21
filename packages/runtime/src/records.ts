/** Owned bounded chunks make branching independent of history length.
 * Records are copied at ingress/egress by Controller and capture, not per fork. */
type Chunk<T> = { owner: object; previous: Chunk<T> | null; start: number; values: T[] };
export class Records<T> {
  private owner: object = {};
  private tail: Chunk<T> | null = null;
  length = 0;
  fork(): Records<T> {
    const result = new Records<T>();
    result.tail = this.tail;
    result.length = this.length;
    this.owner = {};
    return result;
  }
  push(value: T): void {
    if (this.tail && this.tail.values.length < 64) {
      if (this.tail.owner !== this.owner) this.tail = { ...this.tail, owner: this.owner, values: this.tail.values.slice() };
      this.tail.values.push(value);
    } else this.tail = { owner: this.owner, previous: this.tail, start: this.length, values: [value] };
    this.length++;
  }
  slice(from = 0, to = this.length): T[] {
    const end = Math.min(to, this.length);
    const result: T[] = Array(Math.max(0, end - from));
    for (let chunk = this.tail; chunk && chunk.start + chunk.values.length > from; chunk = chunk.previous) {
      for (let i = Math.max(from, chunk.start); i < Math.min(end, chunk.start + chunk.values.length); i++) {
        result[i - from] = chunk.values[i - chunk.start]!;
      }
    }
    return result;
  }
}
