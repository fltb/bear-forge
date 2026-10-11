import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
test('production execution modules do not depend on VM, workers, child processes or dynamic function constructors', () => {
  for (const folder of ['runtime', 'runtime-native', 'runtime-controlled']) {
    const directory = new URL(`../../${folder}/src/`, import.meta.url).pathname;
    for (const file of readdirSync(directory)) {
      if (!/\.(ts|cjs)$/.test(file)) continue;
      const source = readFileSync(join(directory, file), 'utf8');
      assert.doesNotMatch(source, /(?:node:)?(?:vm|worker_threads|child_process)['"]|new\s+(?:Worker|Function)\s*\(|\beval\s*\(/, folder + '/' + file);
    }
  }
});
