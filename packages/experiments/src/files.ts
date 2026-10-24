import type { TaskResult } from './experiment.types.ts';
import { mkdir, open, rename, readFile, readdir, unlink, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { randomUUID } from 'node:crypto';
import { sameData } from '@bear-forge/boundary';
/** One atomic file contains a complete task commit. There is no database. */
export class ExperimentFiles<R extends { id: string } = TaskResult, S extends { id: string } = R> {
  readonly directory: string;
  private readonly summarize: (value: R) => S;
  constructor(directory: string, summarize: (value: R) => S) {
    this.directory = resolve(directory);
    this.summarize = summarize;
  }
  private path(key: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw Error('Invalid file identity');
    return join(this.directory, key + '.bin');
  }
  async read<T>(key: string): Promise<T | null> {
    try {
      return deserialize(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async write(key: string, value: unknown) {
    // These are runner-owned records. Serialization already takes a detached
    // byte snapshot synchronously; cloning the entire history first doubles
    // its live heap at every checkpoint. Capture before the first await so
    // later caller mutations cannot change this write.
    const target = this.path(key), bytes = serialize(value);
    await mkdir(this.directory, {
      recursive: true
    });
    const temporary = target + '.' + randomUUID() + '.tmp',
      file = await open(temporary, 'wx');
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const directory = await open(this.directory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async receipt(taskId: string, logicalStep: number) {
    if (!Number.isSafeInteger(logicalStep) || logicalStep < 0) throw Error('Invalid logical step');
    const result = await this.read<R>('task-' + taskId),
      checkpoint: any = result ?? (await this.read('checkpoint-' + taskId));
    return checkpoint?.commits?.find((commit: any) => commit.taskId === taskId && commit.logicalStep === logicalStep) ?? null;
  }
  async remove(key: string) {
    try {
      await unlink(this.path(key));
      const directory = await open(this.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  /** Called by the exclusive experiment writer; checkpoint references are the leases. */
  async collectSnapshots() {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const referenced = new Set<string>();
    for (const name of names.filter(n => n.startsWith('checkpoint-') && n.endsWith('.bin'))) {
      const checkpoint: any = await this.read(name.slice(0, -4));
      if (checkpoint?.snapshot?.snapshotId) referenced.add(checkpoint.snapshot.snapshotId);
    }
    const directory = join(this.directory, 'snapshots');
    let snapshots: string[];
    try {
      snapshots = await readdir(directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const name of snapshots) {
      if (/^[a-f0-9-]{36}\.snapshot(?:\.tmp)?$/.test(name) && !referenced.has(name.split('.')[0]!)) await unlink(join(directory, name));
    }
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async register(config: unknown, tasks: unknown) {
    const existing = await this.read('registration');
    if (existing) {
      if (!sameData(existing, {
        config,
        tasks
      })) throw Error('Frozen registration mismatch');
      return;
    }
    await this.write('registration', {
      config,
      tasks
    });
  }
  async commit(taskId: string, value: R) {
    const key = 'task-' + taskId;
    const existing = await this.read(key);
    if (existing) return existing;
    await this.write(key, value);
    await this.write('summary-' + taskId, this.summarize(value));
    return value;
  }
  /** Publish the same immutable commit into an evaluation index on the same filesystem. */
  async linkCommit(taskId: string, source: ExperimentFiles<R, S>) {
    await mkdir(this.directory, { recursive: true });
    if (!(await source.read('summary-' + taskId))) {
      const task = await source.read<R>('task-' + taskId);
      if (!task) throw Error('Missing immutable source commit');
      await source.write('summary-' + taskId, source.summarize(task));
    }
    for (const key of ['task-' + taskId, 'summary-' + taskId]) {
      try { await link(source.path(key), this.path(key)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!sameData(await this.read(key), await source.read(key))) throw Error('Published commit identity mismatch');
      }
    }
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async summaries(): Promise<S[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const result: S[] = [];
    for (const name of names.filter(n => n.startsWith('task-') && n.endsWith('.bin')).sort()) {
      const id = name.slice(5, -4);
      let summary = await this.read<S>('summary-' + id);
      if (!summary) {
        summary = this.summarize((await this.read<R>(name.slice(0, -4)))!);
      }
      result.push(summary);
    }
    return result;
  }
  async results<T>(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const results: T[] = [];
    for (const name of names.filter(n => n.startsWith('task-') && n.endsWith('.bin')).sort()) {
      results.push((await this.read<T>(name.slice(0, -4)))!);
    }
    return results;
  }
}
