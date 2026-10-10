import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {assertSourceBoundaries} from './support/source-boundaries.ts';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
test('contracts source respects its dependency boundary',()=>{
  assertSourceBoundaries(fileURLToPath(new URL('../src',import.meta.url)),'contracts');
});

test('the default contracts entry exposes only the ten basic public types',()=>{
  const path=fileURLToPath(new URL('../src/index.ts',import.meta.url));
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  const names=source.statements.flatMap(node=>
    ts.isExportDeclaration(node)&&node.exportClause&&ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(item=>item.name.text) : []);
  assert.deepEqual(names.sort(),['Core','Program','ProgramModule','IO','Instance','BaseGame','Request','InputOptions','GameModule','GameSDK'].sort());
});
