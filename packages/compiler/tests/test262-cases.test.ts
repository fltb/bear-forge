import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test262Cases, hasUnsupportedImportAttributes, hasUnsupportedDynamicImport } from './test262-cases.ts';

test('dynamic module loading is classified by syntax even without a feature tag',()=>{
  for(const source of ['import("./x.js")','const p=()=>import(`./${name}.js`);','await import("./x.js");'])
    assert.equal(hasUnsupportedDynamicImport(source),true,source);
  for(const source of ['import x from "./x.js";','const text="import(\\"./x.js\\")";','// import("./x.js")\nexport{};'])
    assert.equal(hasUnsupportedDynamicImport(source),false,source);
});

test('module attribute scope follows the target Node loader by syntax, not case name',()=>{
  for(const source of ["import './x.js';", "import './x.js' with {};", "import x from './x.json' with {type:'json'};"])
    assert.equal(hasUnsupportedImportAttributes(source),false,source);
  for(const source of ["import './x.js' with {if:''};", "export * from './x.js' with {tag:'a'};",
    "import x from './x.json' with {type:'text'};", "import x from './x.json' with {type:'json',extra:''};"])
    assert.equal(hasUnsupportedImportAttributes(source),true,source);
});

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'bear-test262-input-'));
  try {
    await mkdir(join(root, 'test')); await mkdir(join(root, 'harness'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '5.0.0' }));
    for (const name of ['assert.js', 'sta.js', 'doneprintHandle.js', 'helper.js']) await writeFile(join(root, 'harness', name), `// ${name}\n`);
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function collect(root: string, paths?: string[]) {
  const result = [];
  for await (const item of test262Cases(root, paths)) result.push(item);
  return result;
}

test('Test262 preparation preserves scripts and separates the global harness from modules', async () => fixture(async root => {
  const inputs = {
    'plain.js': '/*---\ndescription: Plain\n---*/\nvar x = this;\n',
    'strict.js': '/*---\nflags: [onlyStrict]\n---*/\nvar x = 1;\n',
    'sloppy.js': '/*---\nflags: [noStrict]\n---*/\nvar x = 1;\n',
    'module.js': '/*---\nflags: [module]\nincludes: [helper.js]\n---*/\nexport const x = 1;\n',
    'raw.js': '/*---\nflags: [raw]\n---*/\nvar x = 1;\n',
    'ignored_FIXTURE.js': 'export default 1;\n'
  };
  for (const [name, source] of Object.entries(inputs)) await writeFile(join(root, 'test', name), source);
  const cases = await collect(root);
  assert.equal(cases.length, 6);
  for (const item of cases) {
    const original = inputs[item.file.slice(5) as keyof typeof inputs];
    assert.equal(item.source, item.mode === 'strict' ? '"use strict";\n' + original : original);
    assert.ok(!item.source.includes('// assert.js'));
    assert.deepEqual(item.harness.map(x => x.file), item.mode === 'raw' ? [] : item.mode === 'module' ? ['assert.js', 'sta.js', 'helper.js'] : ['assert.js', 'sta.js']);
  }
  assert.deepEqual(cases.filter(x => x.file === 'test/plain.js').map(x => x.mode).sort(), ['non-strict', 'strict']);
  assert.equal(cases.filter(x => x.mode === 'module').length, 1);
}));

test('Test262 preparation keeps async completion and negative phase/type explicit', async () => fixture(async root => {
  await writeFile(join(root, 'test', 'async.js'), '/*---\nflags: [async, onlyStrict]\nfeatures: [Promise]\nnegative:\n  phase: runtime\n  type: TypeError\n---*/\n$DONE();\n');
  const [item] = await collect(root);
  assert.equal(item!.asynchronous, true);
  assert.deepEqual(item!.features, ['Promise']);
  assert.deepEqual(item!.negative, { phase: 'runtime', type: 'TypeError' });
  assert.deepEqual(item!.harness.map(x => x.file), ['assert.js', 'sta.js', 'doneprintHandle.js']);
}));

test('Test262 preparation rejects missing helpers and overlapping or escaped selections', async () => fixture(async root => {
  await writeFile(join(root, 'test', 'test.js'), '/*---\nflags: [raw]\n---*/\n0;');
  await assert.rejects(collect(root, ['test', 'test/test.js']), /Overlapping/);
  await assert.rejects(collect(root, ['../outside']), /escapes/);
  await assert.rejects(collect(root, []), /empty/);
  await writeFile(join(root, 'test', 'test.js'), '/*---\nincludes: [missing.js]\n---*/\n0;');
  await assert.rejects(collect(root), /ENOENT/);
}));
