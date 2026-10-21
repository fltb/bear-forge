/** Context-owned identity deque. Removal, prepend and append touch only the
 * affected links, including when the queue is shared by a fork. */
export type RuleDeque = { first: number | null; last: number | null; size: number; links: Record<number, { previous: number | null; next: number | null }> };
export function createDeque(): RuleDeque { return { first: null, last: null, size: 0, links: {} }; }
export function appendDeque(queue: RuleDeque, id: number, front = false): void {
  const previous = front ? null : queue.last, next = front ? queue.first : null;
  queue.links[id] = { previous, next };
  if (previous === null) queue.first = id; else queue.links[previous]!.next = id;
  if (next === null) queue.last = id; else queue.links[next]!.previous = id;
  queue.size++;
}
export function removeDeque(queue: RuleDeque, id: number): boolean {
  const link = queue.links[id]; if (!link) return false;
  if (link.previous === null) queue.first = link.next; else queue.links[link.previous]!.next = link.next;
  if (link.next === null) queue.last = link.previous; else queue.links[link.next]!.previous = link.previous;
  delete queue.links[id]; queue.size--; return true;
}
export function takeDeque(queue: RuleDeque): number | null {
  const id = queue.first; if (id !== null) removeDeque(queue, id); return id;
}
