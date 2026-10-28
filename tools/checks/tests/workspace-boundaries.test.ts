import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  filterByRule,
  formatBoundaryViolations,
  scanWorkspaceBoundaries,
  type BoundaryReport,
} from '../src/workspace-boundaries.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');

function assertClean(report: BoundaryReport, rules: ReadonlyArray<'R1' | 'R2' | 'R3' | 'R4'>): void {
  const violations = report.violations.filter(violation => rules.includes(violation.rule as 'R1' | 'R2' | 'R3' | 'R4'));
  assert.deepEqual(
    violations,
    [],
    `workspace boundary violations detected (${report.scannedFiles} files scanned):\n${formatBoundaryViolations(violations)}`,
  );
}

test('R1/R2: packages never reach into examples and examples never reach into packages by relative path', () => {
  const report = scanWorkspaceBoundaries(repoRoot);
  assert.ok(report.scannedFiles > 0, 'expected the scan to see TypeScript sources');
  assertClean(report, ['R1', 'R2']);
});

test('R3: every @bear-forge subpath imported by examples exists in that package exports map', () => {
  const report = scanWorkspaceBoundaries(repoRoot);
  assertClean(report, ['R3']);
});

test('R4: tools may import examples and packages directly without tripping the ratchet', () => {
  const report = scanWorkspaceBoundaries(repoRoot);
  assertClean(report, ['R4']);
});

/** Build a throwaway workspace shaped like the repository, with deliberate boundary violations. */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'bear-forge-boundaries-'));
  const files: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
      },
      include: ['packages/**/*.ts', 'examples/**/*.ts', 'tools/**/*.ts'],
    }),
    'packages/lib/package.json': JSON.stringify({
      name: '@bear-forge/lib',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts', './sub': './src/sub.ts' },
    }),
    'packages/lib/src/index.ts': [
      "import { app } from '../../../examples/app/src/index.ts';",
      "export { app as viaName } from '@bear-forge/app';",
      'export const lib = app;',
      '',
    ].join('\n'),
    'packages/lib/src/sub.ts': 'export const sub = 1;\n',
    'examples/app/package.json': JSON.stringify({
      name: '@bear-forge/app',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' },
    }),
    'examples/app/src/index.ts': [
      "import { sub } from '../../../packages/lib/src/sub.ts';",
      'export const app = sub;',
      '',
    ].join('\n'),
    'examples/app/src/deep.ts': [
      "import { lib } from '@bear-forge/lib';",
      "import { missing } from '@bear-forge/lib/nope';",
      "import { sub } from '@bear-forge/lib/sub';",
      'export const deep = [lib, missing, sub];',
      '',
    ].join('\n'),
    'examples/app/src/dynamic.ts': [
      "const relative = await import('../../../packages/lib/src/sub.ts');",
      "const byName = await import('@bear-forge/lib/nope-dynamic');",
      "export type Missing = import('@bear-forge/lib/nope-type').Missing;",
      'export const dynamic = [relative, byName];',
      '',
    ].join('\n'),
    'examples/app/src/unknown-package.ts': "import '@bear-forge/not-a-workspace-package';\nexport const unknownPackage = 1;\n",
    'tools/dev/package.json': JSON.stringify({ name: '@bear-forge/dev', private: true, type: 'module' }),
    'tools/dev/src/main.ts': [
      "import { app } from '../../../examples/app/src/index.ts';",
      "import { lib } from '@bear-forge/lib';",
      'export const dev = [app, lib];',
      '',
    ].join('\n'),
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

test('scanner detects injected R1/R2/R3 violations and exempts tools (R4)', () => {
  const fixtureRoot = createFixture();
  try {
    const violations = filterByRule(scanWorkspaceBoundaries(fixtureRoot), 'R1', 'R2', 'R3');
    const rendered = formatBoundaryViolations(violations);
    const expected = [
      'packages/lib/src/index.ts:1 [R1]',
      'packages/lib/src/index.ts:2 [R1]',
      'examples/app/src/index.ts:1 [R2]',
      'examples/app/src/dynamic.ts:1 [R2]',
      'examples/app/src/deep.ts:2 [R3]',
      'examples/app/src/dynamic.ts:2 [R3]',
      'examples/app/src/dynamic.ts:3 [R3]',
      'examples/app/src/unknown-package.ts:1 [R3]',
    ];
    for (const fragment of expected) {
      assert.match(rendered, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing expected violation "${fragment}" in:\n${rendered}`);
    }
    assert.equal(violations.length, expected.length, `unexpected extra violations:\n${rendered}`);
    assert.ok(!rendered.includes('tools/dev'), `tools/ must be exempt from boundary rules, but got:\n${rendered}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
