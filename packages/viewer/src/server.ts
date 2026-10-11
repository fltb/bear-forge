import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ExperimentFiles, trajectories } from '@bear-forge/experiments';
import type { TaskResult } from '@bear-forge/experiments';
export function createEvidenceServer(directory: string) {
  const files = new ExperimentFiles(directory);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }
      let data: any;
      if (url.pathname === '/api/experiment') {
        const registration: any = await files.read('registration'),
          results = await files.summaries();
        data = {
          config: registration?.config ?? null,
          total: registration?.tasks.length ?? 0,
          completed: results.length,
          counts: Object.fromEntries(['ended', 'fault', 'truncated'].map(k => [k, results.filter(r => r.status === k).length]))
        };
      } else if (url.pathname === '/api/relations') {
        data = await files.read('analysis');
      } else if (url.pathname === '/api/tasks') {
        const results = await files.summaries();
        data = results.slice(0, 200).map(r => ({
          id: r.id,
          input: r.input,
          status: r.status,
          result: r.result,
          cost: r.cost
        }));
      } else if (url.pathname === '/api/evidence') {
        const taskId = url.searchParams.get('task') ?? '',
          player = url.searchParams.get('player');
        const row = await files.read<TaskResult>('task-' + taskId);
        if (!row) {
          res.writeHead(404);
          res.end();
          return;
        }
        const offset = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || !['0', '1', 'audit'].includes(player ?? '')) {
          res.writeHead(400);
          res.end();
          return;
        }
        const values = player === 'audit' ? row.facts : row.packets.filter(p => p.player === player);
        data = {
          id: row.id,
          status: row.status,
          scope: player === 'audit' ? 'analysis-audit' : 'player-visible',
          trajectory: player === 'audit' ? null : trajectories(row)[player!],
          values: values.slice(offset, offset + 100),
          next: offset + 100 < values.length ? offset + 100 : null
        };
      } else {
        const root = fileURLToPath(new URL('../dist/', import.meta.url));
        const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (relative.includes('..') || !/^[-a-zA-Z0-9_./]+$/.test(relative)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const content = await readFile(join(root, relative));
        res.setHeader('Content-Type', relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
        res.end(content);
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: String(e)
      }));
    }
  });
}
