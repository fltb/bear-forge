import { access, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parse } from '@babel/parser';

const sourceExtension = /\.(?:[cm]?[jt]s)$/;
const trackedExtension = /\.(?:[cm]?[jt]s|json)$/;
const resolutionExtensions = ['', '.mjs', '.js', '.json', '.ts', '.mts', '.cjs', '.cts'];

type LocalRequest = { specifier: string; optional: boolean };
function localRequests(source: string, path: string, strict: boolean): LocalRequest[] {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: /\.[cm]?ts$/.test(path) ? ['typescript'] : []
  });
  const requests: LocalRequest[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    const value = node as Record<string, unknown>;
    if (value.type === 'ImportDeclaration' || value.type === 'ExportNamedDeclaration' || value.type === 'ExportAllDeclaration') {
      const request = value.source as { value?: unknown } | undefined;
      if (typeof request?.value === 'string') requests.push({ specifier: request.value, optional: false });
    } else if (value.type === 'ImportExpression') {
      const request = value.source as { type?: string; value?: unknown } | undefined;
      if (request?.type === 'StringLiteral' && typeof request.value === 'string') requests.push({ specifier: request.value, optional: true });
      else if (strict) throw new Error(`Computed module dependency cannot be frozen: ${path}`);
    } else if (value.type === 'CallExpression') {
      const callee = value.callee as { type?: string; name?: string } | undefined;
      if (callee?.type === 'Import' || callee?.type === 'Identifier' && callee.name === 'require') {
        const first = (value.arguments as { type?: string; value?: unknown }[] | undefined)?.[0];
        if (first?.type === 'StringLiteral' && typeof first.value === 'string') requests.push({ specifier: first.value, optional: false });
        else if (strict) throw new Error(`Computed module dependency cannot be frozen: ${path}`);
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) visit(child);
      else if (child && typeof child === 'object' && 'type' in child) visit(child);
    }
  };
  visit(ast.program);
  return requests.filter(request => request.specifier.startsWith('./') || request.specifier.startsWith('../'));
}
/** Frozen business implementation identity, derived from the actual production source. */
export async function implementationIdentity(directories: readonly string[], metadata: Record<string, unknown>) {
  const root = fileURLToPath(new URL('../../../', import.meta.url)),
    hash = createHash('sha256'),
    files = new Set<string>(['package.json', 'package-lock.json']),
    authorFiles = new Set<string>();
  async function add(directory: string, author: boolean) {
    for (const entry of (await readdir(join(root, directory), {
      withFileTypes: true
    })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = directory + '/' + entry.name;
      if (entry.isDirectory()) await add(path, author);
      else if (trackedExtension.test(entry.name)) {
        files.add(path);
        if (author) authorFiles.add(path);
      }
    }
  }
  const platformDirectories = ['packages/contracts/src', 'packages/game-sdk/src', 'packages/boundary/src', 'packages/runtime/src', 'packages/runtime-native/src', 'packages/runtime-controlled/src', 'packages/compiler/src', 'vendor/effectful/core', 'vendor/effectful/continuations', 'vendor/effectful/serialization', 'packages/experiments/src', 'packages/game-host/src', 'packages/policies/src'];
  for (const [index, directory] of [...platformDirectories, ...directories].entries()) {
    await add(directory, index >= platformDirectories.length);
    for (let parent = dirname(directory); parent !== '.' && parent !== '/'; parent = dirname(parent)) {
      const manifest = parent + '/package.json';
      try { await access(join(root, manifest)); files.add(manifest); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  const visited = new Set<string>();
  const absent = new Set<string>();
  const pending = [...files];
  for (let index = 0; index < pending.length; index++) {
    const importer = pending[index]!;
    const strict = authorFiles.has(importer), key = importer + (strict ? ':author' : ':platform');
    if (!sourceExtension.test(importer) || visited.has(key)) continue;
    visited.add(key);
    const source = await readFile(join(root, importer), 'utf8');
    for (const request of localRequests(source, importer, strict)) {
      const base = resolve(root, dirname(importer), request.specifier);
      let found: string | undefined;
      for (const prefix of [base, join(base, 'index')]) {
        for (const suffix of extname(prefix) ? [''] : resolutionExtensions) {
          const candidate = prefix + suffix;
          try {
            if ((await stat(candidate)).isFile()) { found = candidate; break; }
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
        }
        if (found) break;
      }
      if (!found) {
        if (request.optional) { absent.add(JSON.stringify([importer, request.specifier])); continue; }
        throw new Error(`Unresolved local implementation dependency: ${importer} -> ${request.specifier}`);
      }
      const path = relative(root, found);
      if (path === '..' || path.startsWith('..' + sep) || !trackedExtension.test(path)) {
        throw new Error(`Implementation dependency cannot be frozen: ${importer} -> ${request.specifier}`);
      }
      const discovered = !files.has(path), upgraded = strict && !authorFiles.has(path);
      if (discovered) files.add(path);
      if (upgraded) authorFiles.add(path);
      if (discovered || upgraded) pending.push(path);
      for (let parent = dirname(path); parent !== '.' && parent !== '/'; parent = dirname(parent)) {
        const manifest = parent + '/package.json';
        try { await access(join(root, manifest)); files.add(manifest); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
  }
  for (const request of [...absent].sort()) hash.update(JSON.stringify(['absent dynamic import', request]) + '\n');
  for (const path of [...files].sort()) {
    const content = await readFile(join(root, path));
    hash.update(JSON.stringify([path, content.byteLength]) + '\n');
    hash.update(content);
  }
  return {
    ...metadata,
    sourceDigest: hash.digest('hex')
  };
}
