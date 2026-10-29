import {emitKeypressEvents,type Key} from 'node:readline';
import {fit} from './sts-tui-view.ts';
import type {SaveEntry} from '../simulator-library.ts';

/** A launcher over save summaries, with no game/executor access. */
export async function chooseTuiSave(entries:SaveEntry[],input:NodeJS.ReadStream,output:NodeJS.WriteStream):Promise<{resume:string}|{character:'ironclad'|'volibear'}|null>{
  const options=[...entries.map(e=>({label:e.label,available:e.available,value:{resume:e.directory}})),
    {label:'新开一局 · 沃利贝尔',available:true,value:{character:'volibear' as const}},
    {label:'新开一局 · 铁甲',available:true,value:{character:'ironclad' as const}}];
  let selected=Math.max(0,options.findIndex(e=>e.available));
  const draw=()=>{
    const rows=Math.max(1,(output.rows??24)-6),start=Math.max(0,selected-rows+1),entry=entries[selected];
    const detail=entry?`上次保存：${entry.savedAt?new Date(entry.savedAt).toLocaleString('zh-CN'):'未知'} · ${entry.directory}`:'新局使用最新规则，每次动作自动保存';
    output.write('\x1b[2J\x1b[HSTS · 继续游戏或开始新局\r\n\r\n'+options.slice(start,start+rows).map((e,i)=>fit(`${i+start===selected?'▶':' '} ${e.available?'':'[不可继续] '}${e.label}`,(output.columns??80)-1)).join('\r\n')+'\r\n\r\n'+fit(detail,(output.columns??80)-1)+'\r\n↑↓ 选择，Enter 打开，q 退出\r\n');
  };
  return new Promise((resolve,reject)=>{
    function finish(value:Awaited<ReturnType<typeof chooseTuiSave>>){cleanup();resolve(value);}
    function fail(error:Error){cleanup();reject(error);}
    function stop(){finish(null);}
    function keypress(_text:string,key:Key){
      if(key.name==='q'||key.ctrl&&key.name==='c'){finish(null);return;}
      if(key.name==='up')selected=Math.max(0,selected-1);
      if(key.name==='down')selected=Math.min(options.length-1,selected+1);
      if(key.name==='return'&&options[selected]!.available){finish(options[selected]!.value);return;}
      draw();
    }
    function cleanup(){
      input.off('keypress',keypress);input.off('end',stop);input.off('close',stop);input.off('error',fail);output.off('error',fail);output.off('resize',draw);
      for(const signal of ['SIGINT','SIGTERM','SIGHUP'] as const)process.off(signal,stop);
      if(!input.destroyed)input.setRawMode(false);input.pause();
    }
    emitKeypressEvents(input);input.setRawMode(true);input.resume();input.on('keypress',keypress);input.on('end',stop);input.on('close',stop);input.on('error',fail);output.on('error',fail);output.on('resize',draw);
    for(const signal of ['SIGINT','SIGTERM','SIGHUP'] as const)process.on(signal,stop);
    draw();
  });
}
