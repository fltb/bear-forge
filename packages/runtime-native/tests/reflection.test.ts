import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileNativeEntry } from '@bear-forge/compiler';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transformSync} from '@babel/core';
import { nativeProgram } from '../src/index.ts';

test('native lowering preserves prelink JavaScript callable source, hoisting, method identity and IO reflection', async () => {
  const entry = new URL('./reflection-fixture.ts', import.meta.url).pathname;
  // TypeScript has no ECMAScript SourceText. Use the JS after type erasure as
  // the reference, before linking or any Bear Forge execution transformations.
  const erased=transformSync(await readFile(entry,'utf8'),{
    filename:entry,configFile:false,babelrc:false,comments:false,
    plugins:[[createRequire(import.meta.url)('@babel/plugin-transform-typescript'),{onlyRemoveTypeImports:true}]]
  })!.code!;
  const referenceURL='data:text/javascript;base64,'+Buffer.from(erased.replace("from 'zod'",`from ${JSON.stringify(import.meta.resolve('zod'))}`)).toString('base64');
  const reference=(await import(referenceURL)).program;
  const artifact = await compileNativeEntry(entry);
  for (const input of [0, 1, 2]) {
    const program = await nativeProgram(artifact);
    const actualCalls: unknown[] = [], expectedCalls: unknown[] = [];
    const expected = await reference.run(input, { call: async (call: unknown) => { expectedCalls.push(call); return input + 5; } });
    const actual = await program.run(input, { call: async (call: unknown) => { actualCalls.push(call); return input + 5; } } as any);
    assert.deepEqual(actualCalls, expectedCalls);
    assert.deepEqual(actual, expected);
  }
});
