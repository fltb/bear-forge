/** Ranks 3..14=A, 15=2, 16=small joker, 17=big joker. Suits have no action semantics. */
export type PatternKind = 'single' | 'pair' | 'triple' | 'tripleSingle' | 'triplePair' | 'straight' | 'pairs' | 'airplane' | 'airplaneSingle' | 'airplanePair' | 'fourSingles' | 'fourPairs' | 'bomb' | 'rocket';
export type Pattern = { kind: PatternKind; high: number; length: number };
export type Play = { kind: 'play'; cards: number[]; pattern: Pattern };
export function counts(cards: readonly number[]): number[] {
  const out = Array<number>(18).fill(0);
  for (const card of cards) { if (!Number.isInteger(card) || card < 3 || card > 17) throw new Error('invalid rank'); out[card]!++; }
  return out;
}
export function contained(cards: readonly number[], hand: readonly number[]): boolean {
  const a = counts(cards), b = counts(hand); return a.every((n, i) => n <= b[i]!);
}
export function key(p: Pattern): string { return `${p.kind}:${p.high}:${p.length}`; }
export function beats(a: Pattern, b: Pattern): boolean {
  if (b.kind === 'rocket') return false;
  if (a.kind === 'rocket') return true;
  if (a.kind === 'bomb' && b.kind !== 'bomb') return true;
  return a.kind === b.kind && a.length === b.length && a.high > b.high;
}
function sequence(ranks: number[]): boolean { return ranks.length > 0 && ranks.at(-1)! <= 14 && ranks.every((v, i) => i === 0 || v === ranks[i - 1]! + 1); }
export function classify(cards: readonly number[]): Pattern[] {
  if (!cards.length || cards.length > 20) return [];
  const n = counts(cards), ranks = n.flatMap((c, r) => c ? [r] : []);
  if (n.some((v, r) => v > (r >= 16 ? 1 : 4))) return [];
  const out: Pattern[] = [], total = cards.length;
  const add = (kind: PatternKind, high: number, length = 1) => out.push({ kind, high, length });
  if (total === 1) add('single', ranks[0]!);
  if (total === 2 && n[16] && n[17]) add('rocket', 17);
  if (ranks.length === 1 && ranks[0]! <= 15) {
    if (total === 2) add('pair', ranks[0]!);
    if (total === 3) add('triple', ranks[0]!);
    if (total === 4) add('bomb', ranks[0]!);
  }
  if (ranks.length === 2) {
    const triple = ranks.find(r => n[r] === 3);
    if (triple && total === 4) add('tripleSingle', triple);
    if (triple && total === 5) add('triplePair', triple);
  }
  if (sequence(ranks)) {
    if (total >= 5 && ranks.every(r => n[r] === 1)) add('straight', ranks.at(-1)!, ranks.length);
    if (ranks.length >= 3 && ranks.every(r => n[r] === 2)) add('pairs', ranks.at(-1)!, ranks.length);
    if (ranks.length >= 2 && ranks.every(r => n[r] === 3)) add('airplane', ranks.at(-1)!, ranks.length);
  }
  for (let low = 3; low <= 13; low++) for (let high = low + 1; high <= 14; high++) {
    const length = high - low + 1;
    if (![4 * length, 5 * length].includes(total)) continue;
    const body = Array.from({ length }, (_, i) => low + i);
    if (!body.every(r => n[r] === 3)) continue;
    const rest = ranks.filter(r => r < low || r > high);
    if (n[16] && n[17] || rest.some(r => n[r] === 4 || n[r] === 3 && r <= 14 && (r === low - 1 || r === high + 1))) continue;
    if (total === 4 * length) add('airplaneSingle', high, length);
    if (total === 5 * length && rest.length === length && rest.every(r => n[r] === 2)) add('airplanePair', high, length);
  }
  const quad = ranks.find(r => n[r] === 4);
  if (quad && !(n[16] && n[17])) {
    const rest = ranks.filter(r => r !== quad);
    if (total === 6) add('fourSingles', quad);
    if (total === 8 && rest.length === 2 && rest.every(r => n[r] === 2)) add('fourPairs', quad);
  }
  return out;
}
function combinations(n: number[], size: number, pairsOnly: boolean): number[][] {
  const out: number[][] = [];
  function visit(rank: number, remaining: number, picked: number[]) {
    if (!remaining) { out.push(picked); return; }
    if (rank > 17) return;
    const max = pairsOnly ? Math.min(1, Math.floor(n[rank]! / 2)) : Math.min(n[rank]!, remaining);
    for (let amount = 0; amount <= max; amount++) {
      const used = pairsOnly ? amount * 2 : amount;
      if (used <= remaining) visit(rank + 1, remaining - used, [...picked, ...Array<number>(used).fill(rank)]);
    }
  }
  visit(3, size, []); return out;
}
/** Generate by card families, then independently validate each proposed interpretation. */
export function plays(hand: readonly number[], target: Pattern | null): Play[] {
  const n = counts(hand), found = new Map<string, Play>();
  function add(cards: number[]) {
    cards.sort((a, b) => a - b);
    for (const pattern of classify(cards)) if (!target || beats(pattern, target)) {
      const play: Play = { kind: 'play', cards, pattern }; found.set(`${cards.join(',')}|${key(pattern)}`, play);
    }
  }
  for (let r = 3; r <= 17; r++) for (let amount = 1; amount <= n[r]!; amount++) {
    const body = Array<number>(amount).fill(r); add([...body]);
    if (amount === 3 || amount === 4) {
      const rest = [...n]; rest[r] = 0;
      for (const wing of combinations(rest, amount === 3 ? 1 : 2, false)) add([...body, ...wing]);
      for (const wing of combinations(rest, amount === 3 ? 2 : 4, true)) add([...body, ...wing]);
    }
  }
  if (n[16] && n[17]) add([16, 17]);
  for (let copies = 1; copies <= 3; copies++) for (let low = 3; low <= 14; low++) {
    const body: number[] = [];
    for (let high = low; high <= 14 && n[high]! >= copies; high++) {
      body.push(...Array<number>(copies).fill(high));
      const length = high - low + 1, minimum = copies === 1 ? 5 : copies === 2 ? 3 : 2;
      if (length < minimum) continue;
      add([...body]);
      if (copies === 3) {
        const rest = [...n]; for (let r = low; r <= high; r++) rest[r] = 0;
        for (const wing of combinations(rest, length, false)) add([...body, ...wing]);
        for (const wing of combinations(rest, length * 2, true)) add([...body, ...wing]);
      }
    }
  }
  return [...found.values()].sort((a, b) => {
    const ka = `${key(a.pattern)}:${a.cards.map(r => String(r).padStart(2, '0')).join(',')}`;
    const kb = `${key(b.pattern)}:${b.cards.map(r => String(r).padStart(2, '0')).join(',')}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
