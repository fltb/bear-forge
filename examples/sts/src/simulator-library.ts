import {homedir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {readdir,readFile,stat} from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {simulatorContextVersion} from './simulator-save.ts';
import type {StoredSimulatorSave} from './simulator.types.ts';

export function simulatorSaveDirectory(){
  const configured=process.env.BEAR_FORGE_STS_SAVES;
  if(configured&&!isAbsolute(configured))throw Error('BEAR_FORGE_STS_SAVES 必须是绝对路径，避免切换目录后找不到存档。');
  return resolve(configured??join(homedir(),'.bear-forge','sts','saves'));
}
export type SaveEntry={directory:string;label:string;available:boolean;savedAt:string;status:'playing'|'ended'|'interrupted'|'incompatible'|'damaged'|'busy'};

/** Discovery only. Never acquire a session, initialize rules or execute a save. */
export async function listSimulatorSaves(root=simulatorSaveDirectory()):Promise<SaveEntry[]>{
  let directories;try{directories=await readdir(root,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const entries=await Promise.all(directories.filter(d=>d.isDirectory()).map(async d=>{
    const directory=join(root,d.name);let savedAt='';
    try{
      const file=join(directory,'current.sts'),save=deserialize(await readFile(file)) as StoredSimulatorSave;
      savedAt=save.format===2?save.savedAt:(await stat(file)).mtime.toISOString();
      if(save.format!==2||save.contextVersion!==simulatorContextVersion)return {directory,label:`${d.name} · 旧版现场，暂不兼容`,available:false,savedAt,status:'incompatible' as const};
      let status:SaveEntry['status']=save.batch.state.termination==='playing'?'playing':'ended';
      try{
        const pending=JSON.parse(await readFile(join(directory,'pending.json'),'utf8')) as {sessionId:string;revision:number};
        if(pending.sessionId!==save.sessionId||pending.revision>save.revision)status='interrupted';
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      try{
        const owner=JSON.parse(await readFile(join(directory,'owner.lock'),'utf8')) as {pid:number};
        try{process.kill(owner.pid,0);status='busy';}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')status='busy';}
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const g=save.batch.state.observation.game,description={playing:'继续',ended:'查看终局',interrupted:'执行中断',incompatible:'不兼容',damaged:'损坏',busy:'正在使用'}[status];
      return {directory,label:`${description} · ${save.character==='volibear'?'沃利贝尔':'铁甲'} · 第${g.act}幕 ${g.floor}层 · ${g.hp}/${g.maxHp}生命 · 决策${save.revision} · ${new Date(savedAt).toLocaleString('zh-CN')}`,available:status==='playing'||status==='ended',savedAt,status};
    }catch(error){return {directory,label:`${d.name} · 无法读取：${String(error)}`,available:false,savedAt,status:'damaged' as const};}
  }));
  return entries.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.directory.localeCompare(b.directory));
}
