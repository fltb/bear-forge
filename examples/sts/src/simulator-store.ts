import {mkdir,open,readFile,rename,rm,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serialize,deserialize} from 'node:v8';
import type {StoredSimulatorSave,SimulatorStore} from './simulator.types.ts';

async function durableFile(path:string,bytes:Uint8Array){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{
    const file=await open(temp,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await rename(temp,path);
    const directory=await open(dirname(path),'r');
    try{await directory.sync();}finally{await directory.close();}
  }finally{await rm(temp,{force:true});}
}
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';

/** One local process owns a save directory. Never use saves on a shared network filesystem. */
export async function openSimulatorStore(directory:string,mode:'new'|'resume'):Promise<SimulatorStore>{
  const dir=resolve(directory),lock=join(dir,'owner.lock'),nonce=randomUUID();
  await mkdir(dir,{recursive:true});
  // Recovery is serialized by the same exclusive lock. If an owner is live,
  // even another session in this process must not open the directory.
  for(let attempt=0;;attempt++){
    try{
      const owner=await open(lock,'wx',0o600);
      try{await owner.writeFile(JSON.stringify({pid:process.pid,nonce}));await owner.sync();}finally{await owner.close();}
      break;
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST'||attempt>1)throw error;
      const before=await stat(lock),owner=JSON.parse(await readFile(lock,'utf8')) as {pid:number;nonce:string};
      try{process.kill(owner.pid,0);throw Error('存档正在被另一个会话使用：'+dir);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
      // A permanent generation-specific claim prevents two stale-lock reclaimers
      // from unlinking a newly acquired live owner between stat and unlink.
      const claim=await open(join(dir,'.retired-'+owner.nonce),'wx',0o600).catch(error=>{if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('另一进程正在回收旧锁，请稍后重试；不会覆盖当前所有者');throw error;});
      await claim.close();
      const after=await stat(lock);if(before.ino!==after.ino)throw Error('存档锁已改变，请重新打开');
      await rm(lock);
    }
  }
  let closed=false;
  function active(){if(closed)throw Error('存档已关闭');}
  async function close(){if(closed)return;const owner=JSON.parse(await readFile(lock,'utf8'));if(owner.nonce===nonce)await rm(lock);closed=true;}
  const savePath=join(dir,'current.sts'),pendingPath=join(dir,'pending.json');
  try{
    if(mode==='new'){
      const entries=await import('node:fs/promises').then(fs=>fs.readdir(dir));
      if(entries.some(name=>name!=='owner.lock'))throw Error('新局需要空存档目录；已有存档请使用 --resume。');
    }
    const read=async()=>{
      active();
      let bytes:Buffer;try{bytes=await readFile(savePath);}catch(error){if(missing(error))throw Error('没有已提交的完整存档；上次初始化可能中断，保留目录，不自动重开。');throw error;}
      let save:StoredSimulatorSave;
      try{save=deserialize(bytes) as StoredSimulatorSave;}catch{throw Error('存档无法解码，可能损坏或当前 Node 无法读取；原文件保留。');}
      if(save.format!==1&&save.format!==2)throw Error('不兼容的模拟器存档格式；原文件保留。');
      let pending:{sessionId:string;revision:number}|null=null;
      try{pending=JSON.parse(await readFile(pendingPath,'utf8'));}catch(error){if(!missing(error))throw error;}
      if(pending&&(pending.sessionId!==save.sessionId||pending.revision>save.revision))throw Error('上次执行在原子存档提交前中断，最新进展可能已丢失。禁止恢复旧状态补跑；该局保留为 interrupted。');
      return save;
    };
    if(mode==='resume')await read();
    return {read,async pending(sessionId,revision){active();await durableFile(pendingPath,Buffer.from(JSON.stringify({sessionId,revision})));},async commit(save){active();await durableFile(savePath,serialize(save));},close};
  }catch(error){await close();throw error;}
}
