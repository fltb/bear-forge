import {readFile} from 'node:fs/promises';
import type {Writable} from 'node:stream';
import {createSearchExperiment, searchRegistration} from '@bear-forge/sts';

export async function runStsSearch(args: string[], output: Writable = process.stdout) {
  const [directory, configPath, ...extra] = args;
  if (!directory || extra.length) throw Error('Usage: sts search OUTPUT_DIRECTORY [CONFIG.json]');
  const config = configPath ? searchRegistration(JSON.parse(await readFile(configPath,'utf8'))) : undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
  let lastPersistenceIssue:string|undefined;
  try {
    const result = await createSearchExperiment().runExperiment(directory,config,undefined,{signal:controller.signal,
      persistenceWait:state=>{
        const issue=JSON.stringify([state.taskId,state.stage,state.error]);
        if(state.failures===1||issue!==lastPersistenceIssue)output.write(JSON.stringify({status:'persistence-wait',durable:false,...state})+'\n');
        lastPersistenceIssue=issue;
      },
    });
    output.write(JSON.stringify({directory:result.files.directory,registered:result.registration.tasks.length,
      completed:result.results.length,stopReason:result.stopReason,cancelled:controller.signal.aborted,results:result.results})+'\n');
    if (result.stopReason==='fault'||result.stopReason==='prior-fault'||result.results.some(row=>row.status==='fault')) process.exitCode=1;
  } finally {process.off('SIGINT',stop); process.off('SIGTERM',stop);}
}
