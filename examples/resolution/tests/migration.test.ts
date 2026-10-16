import test from 'node:test';
import assert from 'node:assert/strict';
import { program } from '../src/program.ts';
import { program as reference } from './reference/program.ts';
import type { Setup } from '../src/program.ts';
import type { Action } from '../src/resolution.schemas.ts';

for (const variant of ['normal', 'empty-first', 'counter', 'return-wolf', 'double-prevent', 'fail-discard'] as Setup['variant'][]) {
  test(`shared kernel preserves old resolution trace: ${variant}`, async () => {
    const tape: Array<{ call: any; output: Action }> = [];
    let expected: unknown;
    let oldError: unknown;
    try {
      expected = await reference.run({ variant }, { async call(call) {
        const { kind, options } = call.input;
        let wanted: Action;
        if (kind.includes('response')) wanted = {
          kind: variant === 'counter' ? 'counter' : variant === 'return-wolf' && kind === 'spell-response' ? 'return' : 'pass',
          value: variant === 'return-wolf' && kind === 'spell-response' ? 'L' : null,
        };
        else if (kind.endsWith('target')) wanted = { kind: 'target', value: kind === 'wave-0-target' ? (variant === 'return-wolf' ? 'L2' : variant === 'double-prevent' ? 'G' : 'L') : 'G' };
        else if (kind.endsWith('prevent')) wanted = { kind: 'prevent', value: variant === 'double-prevent' ? (kind === 'wave-0-prevent' ? 'U1' : 'U2') : kind === 'wave-1-prevent' ? 'U' : null };
        else if (kind === 'take') wanted = { kind: 'take', value: 'B' };
        else wanted = { kind: 'beneficiary', value: '0' };
        const output = options.find(a => a.kind === wanted.kind && a.value === wanted.value) ?? options[0]!;
        assert.ok(output);
        tape.push(structuredClone({ call, output }));
        return output;
      } });
    } catch (error) { oldError = error; }
    let cursor = 0;
    const execute = () => program.run({ variant }, { async call(call) {
      const recorded = tape[cursor++];
      assert.ok(recorded, 'extra request');
      assert.deepEqual(call, recorded.call, `call ${cursor}`);
      return structuredClone(recorded.output);
    } });
    if (oldError) {
      assert.equal(variant, 'fail-discard');
      await assert.rejects(execute, error => error instanceof Error && oldError instanceof Error && error.message === oldError.message);
    } else assert.deepEqual(await execute(), expected);
    assert.equal(cursor, tape.length);
  });
}
