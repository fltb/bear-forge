import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, readdir, readFile, writeFile, rename, rm, stat} from 'node:fs/promises';
import {dirname, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
export const revision = '7476a81954020087da31d41d16fddf475746ec2d';
export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const source = resolve(process.env.STS_REFERENCE_SOURCE ?? resolve(root, '../sts_lightspeed'));
const directory = resolve(root, 'build/sts-reference');
const bridge = fileURLToPath(new URL('./reference.cpp', import.meta.url));
let building: Promise<string> | undefined;
let rawBuilding:Promise<string>|undefined;
async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, {withFileTypes: true});
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(resolve(path,e.name)) : [resolve(path,e.name)]))).flat().sort();
}
async function modified(path: string) { try { return (await stat(path)).mtimeMs; } catch { return 0; } }
async function build(raw=false): Promise<string> {
  const adapter=raw?fileURLToPath(new URL('./raw-benchmark.cpp',import.meta.url)):bridge;
  const actual = (await exec('git',['rev-parse','HEAD'],{cwd:source})).stdout.trim();
  if (actual !== revision) throw Error(`STS reference must be ${revision}, found ${actual}`);
  await exec('git',['diff','--exit-code','HEAD','--','src','include'],{cwd:source});
  if((await exec('git',['ls-files','--others','--exclude-standard','--','src','include'],{cwd:source})).stdout.trim())
    throw Error('Untracked rule sources invalidate the pinned STS reference');
  const sources=(await files(resolve(source,'src'))).filter(p=>p.endsWith('.cpp'));
  const headers=(await files(resolve(source,'include'))).filter(p=>p.endsWith('.h'));
  if (!sources.length || !headers.length) throw Error('Incomplete STS reference checkout');
  const newestHeader=Math.max(...await Promise.all(headers.map(modified)));
  await mkdir(resolve(directory,'objects'),{recursive:true});
  const compiler=process.env.CXX ?? 'clang++';
  const flags=['-std=c++17','-O2','-ffp-contract=off','-Wno-header-guard','-Wno-shift-count-overflow',
    '-Wno-switch','-I'+resolve(source,'include'),'-I'+resolve(source,'json/include')];
  // The pinned upstream has Curiosity commented out. Compile an explicit
  // corrected copy; keep the upstream checkout clean and all boundary assertions.
  const battleSource=resolve(source,'src/combat/BattleContext.cpp');
  const original=await readFile(battleSource,'utf8');
  const missing=`//    auto &m = monsters.optionMap[2];
//    if (m.hasStatusInternal<MS::CURIOSITY>()) {
//        m.buff<MS::STRENGTH>(m.getStatus<MS::CURIOSITY>());
//    }`;
  if(original.split(missing).length!==2)throw Error('Pinned Curiosity correction no longer matches');
  const corrected=original.replace(missing,`    if (item.triggerOnUse && !item.purgeOnUse) {
        for (int i = 0; i < monsters.monsterCount; ++i) {
            auto &m = monsters.arr[i];
            if (m.isAlive() && m.hasStatus<MS::CURIOSITY>()) {
                m.buff<MS::STRENGTH>(m.getStatus<MS::CURIOSITY>());
            }
        }
    }`);
  const correctedPath=resolve(directory,'BattleContext.cpp');
  if(await readFile(correctedPath,'utf8').catch(()=>null)!==corrected)await writeFile(correctedPath,corrected);
  // Upstream reward enumeration omits the gold index and duplicates reward 0.
  // Correct the producer explicitly; do not weaken ordered legal-action assertions.
  const actionSource=resolve(source,'src/sim/search/GameAction.cpp');
  const originalActions=await readFile(actionSource,'utf8');
  const missingIndex='actions.emplace_back(search::GameAction::RewardsActionType::GOLD);';
  if(originalActions.split(missingIndex).length!==2)throw Error('Pinned reward index correction no longer matches');
  const missingKeyOrder=`r.removeRelicReward(a.getIdx1());
            if (a.getIdx1() == r.relicCount-1) {
                r.sapphireKey = false;
            }`;
  if(originalActions.split(missingKeyOrder).length!==2)throw Error('Pinned sapphire key correction no longer matches');
  // Compare the linked last index before removal, preserving chest mutual exclusion.
  const correctedActions=originalActions.replace(missingIndex,'actions.emplace_back(search::GameAction::RewardsActionType::GOLD, i);').replace(missingKeyOrder,`if (a.getIdx1() == r.relicCount-1) {
                r.sapphireKey = false;
            }
            r.removeRelicReward(a.getIdx1());`);
  const correctedActionPath=resolve(directory,'GameAction.cpp');
  if(await readFile(correctedActionPath,'utf8').catch(()=>null)!==correctedActions)await writeFile(correctedActionPath,correctedActions);
  const input=[...sources,adapter];
  const objects=input.map(p=>resolve(directory,'objects',p===adapter?(raw?'raw-benchmark.o':'reference.o'):relative(source,p).replaceAll('/','_')+'.o'));
  let position=0;
  await Promise.all(Array.from({length:3},async()=>{
    for (;;) {
      const i=position++; if(i>=input.length)return;
      const src=input[i]!,obj=objects[i]!;
      if(await modified(obj)>=Math.max(newestHeader,await modified(src),await modified(fileURLToPath(import.meta.url))))continue;
      const temporary=`${obj}.${process.pid}.tmp`;
      try {
        await exec(compiler,[...flags,'-c',src===battleSource?correctedPath:src===actionSource?correctedActionPath:src,'-o',temporary],{maxBuffer:4*1024*1024});
        await rename(temporary,obj);
      }
      catch(e) { throw Error(`STS reference compile failed for ${src}\n${String((e as {stderr?:string}).stderr ?? e)}`); }
      finally { await rm(temporary,{force:true}); }
    }
  }));
  const binary=resolve(directory,raw?'raw-benchmark':'reference');
  if(await modified(binary)<Math.max(...await Promise.all(objects.map(modified)))) {
    const temporary=`${binary}.${process.pid}.tmp`;
    try {
      await exec(compiler,[...objects,'-o',temporary],{maxBuffer:4*1024*1024});
      await rename(temporary,binary);
    } finally { await rm(temporary,{force:true}); }
  }
  return binary;
}
export function buildReference(): Promise<string> { return building ??= build(); }
export function buildRawBenchmark():Promise<string>{return rawBuilding??=build(true);}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.stdout.write(await buildReference()+'\n');
