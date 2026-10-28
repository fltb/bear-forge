import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Top-level workspace roots that make up the repository. */
const WORKSPACE_ROOTS = ['packages', 'examples', 'tools'] as const;
type WorkspaceRoot = (typeof WORKSPACE_ROOTS)[number];

/** Directories whose TypeScript sources are generated output or historical archives. */
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'build', 'dist', 'archive']);

export type BoundaryRule = 'R1' | 'R2' | 'R3';

export type BoundaryViolation = {
  rule: BoundaryRule;
  file: string;
  line: number;
  message: string;
};

export type WorkspacePackage = {
  name: string;
  dir: string;
  root: WorkspaceRoot;
  exports: unknown;
};

export type BoundaryReport = {
  scannedFiles: number;
  violations: BoundaryViolation[];
};

export type ModuleReference = {
  specifier: string;
  line: number;
};

type ExportMap = {
  /** Exact subpath keys (including "."), as written in package.json `exports`. */
  exact: string[];
  /** Subpath keys containing a "*" wildcard. */
  wildcard: string[];
};

function walkSourceFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      walkSourceFiles(path, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(path);
    }
  }
}

/** Collect every .ts source file that participates in the workspace boundary ratchet. */
export function listWorkspaceSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const root of WORKSPACE_ROOTS) walkSourceFiles(join(repoRoot, root), files);
  return files.sort();
}

/** Read the package manifests that define workspace identity and export maps. */
export function discoverWorkspacePackages(repoRoot: string): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const root of WORKSPACE_ROOTS) {
    const rootDir = join(repoRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(rootDir, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; exports?: unknown };
      if (typeof manifest.name !== 'string') continue;
      packages.set(manifest.name, { name: manifest.name, dir, root, exports: manifest.exports });
    }
  }
  return packages;
}

function exportMapOf(exportsField: unknown): ExportMap {
  if (typeof exportsField === 'string' || Array.isArray(exportsField) || exportsField === null || exportsField === undefined) {
    // A bare string/conditional/array export only serves the package root.
    return { exact: ['.'], wildcard: [] };
  }
  if (typeof exportsField !== 'object') return { exact: ['.'], wildcard: [] };
  const keys = Object.keys(exportsField as Record<string, unknown>);
  const subpaths = keys.filter(key => key.startsWith('.'));
  if (subpaths.length === 0) {
    // Conditional export object such as {"import": "..."} also serves only ".".
    return { exact: ['.'], wildcard: [] };
  }
  return {
    exact: subpaths.filter(key => !key.includes('*')),
    wildcard: subpaths.filter(key => key.includes('*')),
  };
}

function hasExport(exportsField: unknown, request: string): boolean {
  const map = exportMapOf(exportsField);
  if (map.exact.includes(request)) return true;
  return map.wildcard.some(pattern => {
    const star = pattern.indexOf('*');
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    return request.startsWith(prefix) && request.endsWith(suffix) && request.length >= prefix.length + suffix.length;
  });
}

/** True when a specifier like "@bear-forge/sts/src/cli.ts" names that workspace package. */
function belongsToPackage(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(name + '/');
}

/** Extract every static, re-exported, dynamic, and type-position module reference with a line number. */
export function collectModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  const push = (node: ts.Node, specifier: string): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({ specifier, line: line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      push(node.moduleSpecifier, node.moduleSpecifier.text);
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      push(node.moduleReference.expression, node.moduleReference.expression.text);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) push(node.argument.literal, node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) push(argument, argument.text);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return references;
}

function isInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(directory + sep);
}

function formatRelative(repoRoot: string, file: string): string {
  return relative(repoRoot, file).split(sep).join('/');
}

/**
 * Scan packages/, examples/, and tools/ for cross-workspace boundary violations:
 *
 * R1 - packages may not reach into examples, neither by relative path nor by package name.
 * R2 - examples may not reach into packages by relative path (use package subpath imports).
 * R3 - examples' @bear-forge/<pkg>/<subpath> imports must exist in that package's exports map.
 * R4 - tools/ is the repository development aggregator and may import both layers directly.
 */
export function scanWorkspaceBoundaries(repoRoot: string): BoundaryReport {
  const packages = discoverWorkspacePackages(repoRoot);
  const examplePackages = [...packages.values()].filter(entry => entry.root === 'examples');
  const packagesDir = join(repoRoot, 'packages');
  const examplesDir = join(repoRoot, 'examples');
  const files = listWorkspaceSourceFiles(repoRoot);
  const violations: BoundaryViolation[] = [];

  const report = (rule: BoundaryRule, file: string, line: number, message: string): void => {
    violations.push({ rule, file: formatRelative(repoRoot, file), line, message });
  };

  const api = new API({ cwd: repoRoot });
  try {
    const snapshot = api.updateSnapshot({ openFiles: files });
    for (const file of files) {
      const project = snapshot.getDefaultProjectForFile(file) ?? snapshot.getProjects().find(candidate => candidate.program?.getSourceFile(file));
      const sourceFile = project?.program?.getSourceFile(file);
      if (!sourceFile) throw new Error(`workspace boundaries: AST unavailable for ${file}`);
      const filePath = formatRelative(repoRoot, file);
      const root = filePath.split('/')[0] as WorkspaceRoot;
      for (const reference of collectModuleReferences(sourceFile)) {
        const specifier = reference.specifier;
        const { line } = reference;
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (root === 'packages' && isInside(target, examplesDir)) {
            report('R1', file, line, `packages must not import examples by relative path: "${specifier}" resolves to ${formatRelative(repoRoot, target)}`);
          } else if (root === 'examples' && isInside(target, packagesDir)) {
            report('R2', file, line, `examples must import packages through their public subpaths, not by relative path: "${specifier}" resolves to ${formatRelative(repoRoot, target)}`);
          }
          continue;
        }
        if (!specifier.startsWith('@bear-forge/')) continue;
        if (root === 'packages') {
          for (const examplePackage of examplePackages) {
            if (belongsToPackage(specifier, examplePackage.name)) {
              report('R1', file, line, `packages must not import example package "${examplePackage.name}" (${specifier})`);
            }
          }
          continue;
        }
        if (root === 'examples') {
          const separator = specifier.indexOf('/', '@bear-forge/'.length);
          const packageName = separator === -1 ? specifier : specifier.slice(0, separator);
          const subpath = separator === -1 ? '' : specifier.slice(separator + 1);
          const workspacePackage = packages.get(packageName);
          if (!workspacePackage) {
            report('R3', file, line, `examples import "${specifier}" but no workspace package named "${packageName}" exists`);
            continue;
          }
          const request = subpath === '' ? '.' : './' + subpath;
          if (!hasExport(workspacePackage.exports, request)) {
            const available = [...exportMapOf(workspacePackage.exports).exact, ...exportMapOf(workspacePackage.exports).wildcard];
            report('R3', file, line, `examples import "${specifier}" but "${packageName}" does not export "${request}" (exports: ${available.join(', ')})`);
          }
        }
      }
    }
  } finally {
    api.close();
  }

  return { scannedFiles: files.length, violations };
}

export function formatBoundaryViolations(violations: readonly BoundaryViolation[]): string {
  if (violations.length === 0) return 'no boundary violations';
  return violations.map(violation => `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`).join('\n');
}

export function filterByRule(report: BoundaryReport, ...rules: readonly BoundaryRule[]): BoundaryViolation[] {
  return report.violations.filter(violation => rules.includes(violation.rule));
}
