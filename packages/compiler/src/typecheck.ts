import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { access, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
const require = createRequire(import.meta.url),
  execute = promisify(execFile);
const flags = ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions'];
async function check(args: string[]) {
  try {
    await execute(process.execPath, [join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'), ...args], {
      maxBuffer: 1024 * 1024
    });
  } catch (e) {
    throw Error('TypeScript check failed: ' + ((e as any).stdout || (e as Error).message));
  }
}
export async function typecheckEntry(entry: string) {
  let directory = dirname(resolve(entry));
  while (true) {
    const project = join(directory, 'tsconfig.json');
    try {
      await access(project);
      await check(['--noEmit', '--project', project]);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  await check([...flags, resolve(entry)]);
}
export async function typecheckSource(source: string) {
  const directory = await mkdtemp(join(process.cwd(), '.bear-typecheck-')),
    file = join(directory, 'program.mts');
  try {
    await writeFile(file, source);
    await check([...flags, file]);
  } finally {
    await unlink(file);
    await rmdir(directory);
  }
}
