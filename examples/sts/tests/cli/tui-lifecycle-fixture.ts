import {runTui} from '../../src/cli/sts-tui.ts';

// A fresh real TUI process with pipe-backed terminal transport, never a recorded run.
Object.defineProperty(process.stdin,'isTTY',{value:true});
process.stdin.setRawMode=()=>process.stdin;
Object.defineProperty(process.stdout,'isTTY',{value:true});
Object.defineProperty(process.stdout,'columns',{value:100});
Object.defineProperty(process.stdout,'rows',{value:30});
const write=process.stdout.write.bind(process.stdout);let ready=false,busy=false;
process.stdout.write=((...args:Parameters<typeof process.stdout.write>)=>{
  const result=write(...args);
  if(process.argv[3]==='startup-hangup'&&String(args[0]).includes('正在创建 STS'))process.send?.('startup');
  if(!ready&&String(args[0]).includes('自动保存已开启')){ready=true;process.send?.('ready');}
  if(ready&&!busy&&String(args[0]).includes('正在执行并保存')){
    busy=true;
    if(process.argv[3]==='busy-quit')process.stdin.emit('keypress','q',{name:'q'});
  }
  if(String(args[0]).includes('保存失败'))process.send?.('save-failed');
  return result;
}) as typeof process.stdout.write;
try{await runTui(['--save',process.argv[2]!,'--seed','130','--trace','off']);}
catch(error){console.error(error);process.exitCode=1;}
process.disconnect?.();
