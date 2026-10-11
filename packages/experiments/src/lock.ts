import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export async function withWriter<T>(directory: string, run: () => Promise<T>): Promise<T> {
  await mkdir(directory, {
    recursive: true
  });
  const path = join(directory, '.writer.lock');
  let file;
  try {
    file = await open(path, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const pid = Number(await readFile(path, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;else throw error;
    }
    if (alive) throw Error('This output directory already has an active writer');
    await unlink(path);
    file = await open(path, 'wx');
  }
  try {
    await file.writeFile(String(process.pid));
    await file.sync();
    return await run();
  } finally {
    await file.close();
    await unlink(path);
  }
}
