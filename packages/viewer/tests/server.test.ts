import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentFiles } from '@bear-forge/experiments';
import { createEvidenceServer } from '../src/server.ts';
test('readonly evidence API separates private player packets and audit facts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bear-view-')),
    files = new ExperimentFiles(dir);
  await files.commit('test', {
    id: 'test',
    status: 'ended',
    decisions: [],
    result: {
      scores: {
        '0': 1,
        '1': 0
      }
    },
    packets: [{
      player: '0',
      value: 'private0'
    }, {
      player: '1',
      value: 'private1'
    }],
    facts: [{
      secret: 'audit'
    }]
  });
  const server = createEvidenceServer(dir);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const addr = server.address() as any,
      base = 'http://127.0.0.1:' + addr.port;
    const p = await (await fetch(base + '/api/evidence?task=test&player=0')).json();
    assert.deepEqual(p.values, [{
      player: '0',
      value: 'private0'
    }]);
    const audit = await (await fetch(base + '/api/evidence?task=test&player=audit')).json();
    assert.equal(audit.scope, 'analysis-audit');
    assert.equal((await fetch(base + '/api/evidence?task=test&player=unknown')).status, 400);
    assert.equal((await fetch(base + '/api/tasks', {
      method: 'POST'
    })).status, 405);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
