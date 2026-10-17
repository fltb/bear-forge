import { readFile } from 'node:fs/promises';
import { RegistrationSchema, runExperiment } from './execution.ts';

const [directory, configPath, ...extra] = process.argv.slice(2);
if (!directory || extra.length) throw Error('Usage: npm run doudizhu:experiment -- OUTPUT_DIRECTORY [CONFIG.json]');
const config = configPath ? RegistrationSchema.parse(JSON.parse(await readFile(configPath, 'utf8'))) : undefined;
const run = await runExperiment(directory, config);
const counts = { ended: 0, truncated: 0, fault: 0 };
for (const row of run.results) counts[row.status]++;
console.log(JSON.stringify({ directory: run.files.directory, games: run.results.length, ...counts,
  decisions: run.results.reduce((sum, row) => sum + row.decisions, 0) }));
if (counts.fault) process.exitCode = 1;
