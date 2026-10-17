import { mkdir, readFile, open, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
export type SnapshotStore = {
  put: (id: string, content: Uint8Array) => Promise<void>;
  get: (id: string) => Promise<Uint8Array | null>;
  known: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
};
export function memorySnapshotStore(): SnapshotStore {
  const data = new Map<string, Uint8Array | null>();
  return {
    async put(id, value) {
      data.set(id, value.slice());
    },
    async get(id) {
      return data.get(id)?.slice() ?? null;
    },
    async known(id) {
      return data.has(id);
    },
    async remove(id) {
      data.set(id, null);
    }
  };
}
export function fileSnapshotStore(directory: string): SnapshotStore {
  const path = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid snapshot reference');
    return join(directory, id + '.snapshot');
  };
  async function put(id: string, value: Uint8Array) {
    const target = path(id),
      temp = target + '.' + randomUUID() + '.tmp';
    await mkdir(directory, {
      recursive: true
    });
    let renamed = false;
    try {
      const file = await open(temp, 'wx');
      try {
        await file.writeFile(value);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
      renamed = true;
      const dir = await open(directory, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      if (!renamed) await rm(temp, { force: true });
    }
  }
  return {
    put,
    async get(id) {
      try {
        const value = new Uint8Array(await readFile(path(id)));
        return value.byteLength ? value : null;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async known(id) {
      try {
        await stat(path(id));
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw e;
      }
    },
    async remove(id) {
      await put(id, new Uint8Array());
    }
  };
}
