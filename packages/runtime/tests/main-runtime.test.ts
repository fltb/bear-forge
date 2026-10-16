import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
test('only Program loading may create a Realm; execution uses no workers, processes or dynamic function constructors', () => {
  for (const folder of ['runtime', 'runtime-native', 'runtime-controlled']) {
    const directory = new URL(`../../${folder}/src/`, import.meta.url).pathname;
    for (const file of readdirSync(directory)) {
      if (!/\.(ts|cjs)$/.test(file)) continue;
      const source = readFileSync(join(directory, file), 'utf8');
      if (folder === 'runtime-controlled' && file === 'program-realm.ts') {
        assert.match(source, /createContext\(constants\.DONT_CONTEXTIFY\)/);
        assert.equal((source.match(/createContext\(/g) ?? []).length,1);
        assert.doesNotMatch(source, /(?:node:)?(?:worker_threads|child_process)['"]|new\s+(?:Worker|Function)\s*\(|\beval\s*\(/);
      } else assert.doesNotMatch(source, /(?:node:)?(?:vm|worker_threads|child_process)['"]|new\s+(?:Worker|Function)\s*\(|\beval\s*\(/, folder + '/' + file);
    }
  }
});
