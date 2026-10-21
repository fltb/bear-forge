import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { card as c, CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
import { definition } from './fixtures/nested.ts';
test('dedicated backend has no compiler, generic continuation engine or source evaluation dependency', () => {
  const root = new URL('../src/', import.meta.url);
  for (const file of readdirSync(root)) if (file.endsWith('.ts')) assert.doesNotMatch(readFileSync(new URL(file, root), 'utf8'), /@bear-forge\/(?:compiler|runtime-controlled|runtime-native)|new Function\s*\(|\beval\s*\(/);
});
test('snapshot root is data-only; definition and synchronous functions are shared outside it', () => {
  const program = new CardProgram(definition), storage = plainCardStorage(program.initial(1), structuredClone), machine = new CardMachine(program, storage);
  machine.advance(); const data = structuredClone(machine.root);
  assert.ok(data.frames.length > 1); assert.equal(Object.hasOwn(data, 'program'), false); assert.equal(Object.hasOwn(data, 'definition'), false);
  assert.equal(data.waiting?.call.port, 'choose');
});

test('reused composition nodes link independently and the loaded schedule is immutable', () => {
  const shared = c.branch<ReturnType<typeof definition.initialize>>(() => true, [c.return(() => 7)]);
  const p = new CardProgram({ ...definition, entry: 'root', effects: [
    { id: 'root', steps: [c.invoke('a'), c.invoke('b'), c.return(() => 9)] },
    { id: 'a', steps: [shared] }, { id: 'b', steps: [shared] },
  ] });
  if (shared.kind === 'branch') shared.test = () => false;
  const names: string[] = [], machine = new CardMachine(p, plainCardStorage(p.initial(1)), event => { if (event.kind === 'return') names.push(event.effect); });
  assert.deepEqual(machine.advance(), { kind: 'done', result: 9 }); assert.deepEqual(names, ['a', 'b', 'root']);
});

test('assembly rejects invalid opcodes and cyclic structural blocks', () => {
  assert.throws(() => new CardProgram({ ...definition, effects: [{ id: 'root', steps: [{ kind: 'bad' } as any] }] }), /Unknown card instruction/);
  const block: any[] = []; block.push(c.repeat(() => true, block));
  assert.throws(() => new CardProgram({ ...definition, effects: [{ id: 'root', steps: block }] }), /cyclic/);
});

if(false){
  // @ts-expect-error trusted Core predicates must return boolean, not Promise
  c.repeat(async()=>true,[]);
}

test('a projection can canonicalize data but cannot replace a request or hide a fault', () => {
  const p = new CardProgram({ ...definition, project: () => ({ kind: 'done' as const, result: {} as any }) });
  const machine = new CardMachine(p, plainCardStorage(p.initial(1)));
  const stop = machine.advance(); assert.equal(stop.kind, 'fault'); assert.deepEqual(machine.advance(8), stop);
});
