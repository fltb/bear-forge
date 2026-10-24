import {readFile} from 'node:fs/promises';
import type {Writable} from 'node:stream';
import {createSearchExperiment, SearchRegistrationSchema} from '@bear-forge/sts';

export async function runStsSearch(args: string[], output: Writable = process.stdout) {
  const [directory, configPath, ...extra] = args;
  if (!directory || extra.length) throw Error('Usage: sts search OUTPUT_DIRECTORY [CONFIG.json]');
  const config = configPath ? SearchRegistrationSchema.parse(JSON.parse(await readFile(configPath,'utf8'))) : undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
  try {
    const result = await createSearchExperiment().runExperiment(directory,config,undefined,{signal:controller.signal});
    output.write(JSON.stringify({directory:result.files.directory,registered:result.registration.tasks.length,
      completed:result.results.length,stopReason:result.stopReason,cancelled:controller.signal.aborted,results:result.results})+'\n');
    if (result.stopReason==='fault'||result.stopReason==='prior-fault'||result.results.some(row=>row.status==='fault')) process.exitCode=1;
  } finally {process.off('SIGINT',stop); process.off('SIGTERM',stop);}
}
