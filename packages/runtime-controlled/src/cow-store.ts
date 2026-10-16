/** Branch-local storage for runtime identities. Values returned by get are
 * read-only: mutable payloads must be acquired with edit before writing.
 *
 * Nodes use an ownership token, never a parent-branch link. Fork invalidates
 * both writers' tokens in O(1); subsequent edits copy only the radix path.
 * Runtime identities are safe integers, so lookup depth is bounded by 11.
 */
type Entry<T> = { owner: object; value: T };
type Node<T> = { owner: object; slots: (Node<T> | Entry<T> | undefined)[]; count: number };
const width = 32;
const powers = Array.from({length: 11}, (_, level) => width ** level);

export class CowStore<T> {
  private owner: object = {};
  private root: Node<T> | undefined;
  private height = 0;
  private count = 0;

  get size(): number { return this.count; }

  private key(key: number): void {
    if (!Number.isSafeInteger(key) || key < 0) throw new RangeError('Invalid state identity');
  }

  private entry(key: number): Entry<T> | undefined {
    this.key(key);
    if (key >= powers[this.height]! * width) return undefined;
    let node = this.root;
    for (let level = this.height; node && level > 0; level--) {
      node = node.slots[Math.floor(key / powers[level]!) % width] as Node<T> | undefined;
    }
    return node?.slots[key % width] as Entry<T> | undefined;
  }

  has(key: number): boolean { return this.entry(key) !== undefined; }
  get(key: number): T | undefined { return this.entry(key)?.value; }

  private writable(node?: Node<T>): Node<T> {
    if (!node) return {owner: this.owner, slots: [], count: 0};
    if (node.owner === this.owner) return node;
    return {owner: this.owner, slots: node.slots.slice(), count: node.count};
  }

  set(key: number, value: T): void {
    this.key(key);
    while (key >= powers[this.height]! * width) {
      if (this.root) this.root = {owner: this.owner, slots: [this.root], count: 1};
      this.height++;
    }
    let node = this.root = this.writable(this.root);
    for (let level = this.height; level > 0; level--) {
      const index = Math.floor(key / powers[level]!) % width;
      const child = node.slots[index] as Node<T> | undefined;
      if (!child) node.count++;
      node = node.slots[index] = this.writable(child);
    }
    const index = key % width;
    const previous = node.slots[index] as Entry<T> | undefined;
    // Repeated local writes need no new entry once this branch owns it.
    // Fork invalidates the owner, so shared entries still get replaced.
    if (previous?.owner === this.owner) previous.value = value;
    else {
      if (!previous) { node.count++; this.count++; }
      node.slots[index] = {owner: this.owner, value};
    }
  }

  /** clone is a trusted runtime shallow/page clone, never an author callback.
   * A thrown clone leaves the branch unchanged. Identity links in the payload
   * stay shared; they are resolved through this store, not recursively copied.
   */
  edit(key: number, clone: (value: T) => T): T {
    const entry = this.entry(key);
    if (!entry) throw new RangeError('Unknown state identity');
    if (entry.owner === this.owner) return entry.value;
    const value = clone(entry.value);
    this.set(key, value);
    return value;
  }

  delete(key: number): boolean {
    if (!this.has(key)) return false;
    const remove = (source: Node<T>, level: number): Node<T> | undefined => {
      const node = this.writable(source);
      const index = Math.floor(key / powers[level]!) % width;
      const next = level ? remove(node.slots[index] as Node<T>, level - 1) : undefined;
      node.slots[index] = next;
      if (!next) node.count--;
      return node.count ? node : undefined;
    };
    this.root = remove(this.root!, this.height);
    this.count--;
    if (!this.root) this.height = 0;
    return true;
  }

  fork(): CowStore<T> {
    const branch = new CowStore<T>();
    branch.root = this.root;
    branch.height = this.height;
    branch.count = this.count;
    // Neither writer owns the previously mutable nodes or payloads now.
    this.owner = {};
    return branch;
  }

  clear(): void {
    this.root = undefined;
    this.height = 0;
    this.count = 0;
    this.owner = {};
  }

  *entries(minimum = 0): IterableIterator<[number, T]> {
    this.key(minimum);
    function* visit(node: Node<T>, level: number, prefix: number): IterableIterator<[number, T]> {
      for (let index = 0; index < node.slots.length; index++) {
        const slot = node.slots[index];
        if (!slot) continue;
        const key = prefix + index * powers[level]!;
        if (key < minimum && minimum - key >= powers[level]!) continue;
        if (level) yield* visit(slot as Node<T>, level - 1, key);
        else yield [key, (slot as Entry<T>).value];
      }
    }
    if (this.root) yield* visit(this.root, this.height, 0);
  }
}
