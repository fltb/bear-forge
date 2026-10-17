import { readFile } from 'node:fs/promises';
import { runExperiment } from '../src/experiment/execution.ts';
const config=JSON.parse(await readFile(process.argv[3]!,'utf8'));
let advances=0;
await runExperiment(process.argv[2]!,config,undefined,{point(stage){if(stage==='before-advance'&&++advances===11)process.kill(process.pid,'SIGKILL');}});
