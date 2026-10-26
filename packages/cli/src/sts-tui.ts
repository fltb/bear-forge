import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {emitKeypressEvents} from 'node:readline';
import type {Key} from 'node:readline';
import {createHumanPolicy} from '@bear-forge/policies';
import type {JsonValue} from '@bear-forge/contracts/game';
import {createSimulator} from '../../../examples/sts/src/simulator.ts';
import {openSimulatorStore} from '../../../examples/sts/src/simulator-store.ts';
import {decisionPresentation,chooseMultiple,eventLines,renderTui,tabs} from './sts-tui-view.ts';
import type {TuiModel} from './sts-tui-view.ts';

export async function runTui(args=process.argv.slice(2),input=process.stdin,output=process.stdout){
  const flags=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const key=args[i]!;
    if(key==='--help'){output.write('STS TUI\n新局: npm run sts:tui -- --save data/sts-saves/my-run --character ironclad\n继续: npm run sts:tui -- --resume data/sts-saves/my-run\n可选 --seed 十进制uint64；现有角色 ironclad / volibear，难度 A20。\n方向键选择，Enter 执行，左右切页，Tab 切焦点，PgUp/PgDn 滚动，/ 筛选，s 保存，q 保存退出。\n');return;}
    if(!['--save','--resume','--character','--seed'].includes(key)||flags.has(key)||!args[i+1]||args[i+1]!.startsWith('--'))throw Error('未知、重复或缺少值的参数：'+key);
    flags.set(key,args[++i]!);
  }
  if(!input.isTTY||!output.isTTY)throw Error('TUI 需要交互终端；请在终端运行 npm run sts:tui（--help 查看用法）。');
  if(flags.has('--resume')&&['--save','--character','--seed'].some(k=>flags.has(k)))throw Error('--resume 不能与新局设置混用');
  const character=flags.get('--character')??'ironclad';if(character!=='ironclad'&&character!=='volibear')throw Error('角色必须是 ironclad 或 volibear');
  const seed=flags.get('--seed')??randomBytes(8).readBigUInt64LE().toString();if(!/^\d+$/.test(seed)||BigInt(seed)>0xffffffffffffffffn)throw Error('seed 必须是十进制 uint64');
  const directory=resolve(flags.get('--resume')??flags.get('--save')??`data/sts-saves/${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
  output.write(`正在${flags.has('--resume')?'恢复':'创建'} STS；存档：${directory}\n`);
  const started=performance.now(),store=await openSimulatorStore(directory,flags.has('--resume')?'resume':'new');
  let session:Awaited<ReturnType<typeof createSimulator>>;
  try{session=await createSimulator({store,resume:flags.has('--resume'),setup:{character,seed}});}catch(error){await store.close();throw error;}
  const initial=await session.observe(),model:TuiModel={batch:initial,tab:0,scroll:0,selected:0,filter:'',filtering:false,message:`${flags.has('--resume')?'直接恢复':'已创建'}；耗时 ${(performance.now()-started).toFixed(0)}ms；自动存档开启`,busy:false,log:eventLines(initial),focus:'actions',confirm:false,multi:null};
  let settle:((action:JsonValue)=>void)|null=null,finished=false,exitRequested=false,saved=true,abandonRequested=false,abandoned=false,faulted=false;
  const abort=new AbortController(),drawTimes:number[]=[];
  const policy=createHumanPolicy((_request,signal)=>new Promise<JsonValue>((accept,reject)=>{settle=value=>{signal.removeEventListener('abort',cancel);settle=null;accept(value);};function cancel(){settle=null;reject(signal.reason);}signal.addEventListener('abort',cancel,{once:true});}));
  const draw=()=>{const t=performance.now();output.write(renderTui(model,output.columns??80,output.rows??24));drawTimes.push(performance.now()-t);};
  let done!:()=>void;const completion=new Promise<void>(resolve=>{done=resolve;});
  async function quit(){
    if(finished)return;
    if(model.busy){exitRequested=true;model.message='本次执行结束并成功保存后退出';draw();return;}
    model.busy=true;draw();
    try{await session.save();saved=true;finished=true;abort.abort(Error('保存退出'));done();}
    catch(error){model.busy=false;model.message='保存失败，仍保留当前现场（s 重试；连续两次大写 X 中止）：'+String(error);draw();}
  }
  async function save(){if(model.busy)return;model.busy=true;draw();try{await session.save();saved=true;model.message='当前真实状态已保存';}catch(error){saved=false;model.message='保存失败：'+String(error);}finally{model.busy=false;draw();}}
  async function prompt(){
    if(finished||!model.batch.state.request)return;
    try{
      const result=await session.decide(policy,abort.signal);
      if(result.accepted){model.batch=result.batch;saved=result.saved;model.log.push(...eventLines(result.batch));model.log=model.log.slice(-1000);model.filter='';model.selected=0;model.scroll=0;model.confirm=false;model.multi=null;model.message=result.saved?'已执行并保存':`动作已执行，但保存失败：${'saveError' in result?result.saveError:''}；按 s 重试，不能继续。`;}
      else model.message=result.reason;
      model.busy=false;draw();
      if(exitRequested&&saved){await quit();return;}
      void prompt();
    }catch(error){if(finished)return;model.busy=false;faulted=true;model.message='执行故障：'+String(error)+'；禁止回退。连续按两次大写 X 关闭。';draw();}
  }
  function keypress(text:string,key:Key){
    if(finished)return;
    if((key.ctrl&&key.name==='c')||(!model.filtering&&key.name==='q')){void quit();return;}
    if(model.busy)return;
    if(!model.filtering&&text==='X'){if(abandonRequested){abandoned=true;finished=true;abort.abort(Error('中止'));done();}else{abandonRequested=true;model.message='再次按大写 X 中止并关闭，不宣称保存成功；未提交进展将不可恢复。';draw();}return;}
    abandonRequested=false;
    if(model.filtering){if(key.name==='escape'){model.filtering=false;model.filter='';}else if(key.name==='return')model.filtering=false;else if(key.name==='backspace')model.filter=[...model.filter].slice(0,-1).join('');else if(text&&!key.ctrl&&!key.meta)model.filter+=text;model.selected=0;draw();return;}
    if(key.name==='s'){void save();return;}
    if((output.columns??80)<60||(output.rows??24)<16)return;
    const actions=decisionPresentation(model.batch).actions.filter(a=>a.label.toLowerCase().includes(model.filter.toLowerCase())),candidates=model.batch.state.observation.battle?.select?.candidates??[],last=Math.max(0,(model.multi===null?actions.length:candidates.length)-1);
    if(key.name==='escape'){model.confirm=false;model.filter='';model.selected=0;model.multi=null;}
    else if(key.name==='m'&&actions.some(a=>a.bits>>>29===3)){model.multi=model.multi===null?[]:null;model.selected=0;model.filter='';model.message='多选：↑↓ 移动，Space 勾选，Enter 提交原规则允许的组合；Esc 返回完整动作列表。';}
    else if(key.name==='space'&&model.multi!==null&&candidates[model.selected]){const index=candidates[model.selected]!.index;model.multi=model.multi.includes(index)?model.multi.filter(i=>i!==index):[...model.multi,index];}
    else if(text==='/'){model.multi=null;model.filtering=true;model.confirm=false;}
    else if(text==='?')model.message='↑↓ 选动作；Enter 执行；Tab 切内容焦点；←→ 切页；PgUp/Dn 滚动；/ 筛选目标或组合；q 保存退出。多选动作明确列出所选牌。';
    else if(key.name==='tab')model.focus=model.focus==='actions'?'content':'actions';
    else if(key.name==='left'||key.name==='right'){model.tab=(model.tab+(key.name==='right'?1:tabs.length-1))%tabs.length;model.scroll=0;}
    else if(key.name==='pageup'||key.name==='pagedown')model.scroll=Math.max(0,model.scroll+(key.name==='pageup'?-1:1)*Math.max(1,(output.rows??24)-8));
    else if(key.name==='up'||key.name==='down'){const change=key.name==='up'?-1:1;if(model.focus==='content')model.scroll=Math.max(0,model.scroll+change);else model.selected=Math.max(0,Math.min(last,model.selected+change));if(model.focus==='actions'&&model.tab===5)model.scroll=0;model.confirm=false;}
    else if(key.name==='home'||key.name==='end'){if(model.focus==='actions')model.selected=key.name==='home'?0:last;else model.scroll=key.name==='home'?0:1e9;model.confirm=false;}
    else if(key.name==='return'&&settle&&(actions[model.selected]||model.multi!==null)){
      if(!saved){model.message='尚未保存，请按 s 重试。';draw();return;}
      const action=model.multi===null?actions[model.selected]:chooseMultiple(model.batch,model.multi);
      if(!action){model.message='当前组合不在原规则合法动作中；请调整选择，没有执行。';draw();return;}
      if(['discard-potion','leave','skip-card','skip-relic','end-turn'].includes(action.kind)&&!model.confirm){model.confirm=true;draw();return;}
      model.busy=true;model.confirm=false;settle({bits:action.bits});
    }
    draw();
  }
  const onResize=()=>draw(),onSignal=()=>{void quit();};
  output.write('\x1b[?1049h\x1b[?25l');emitKeypressEvents(input);input.setRawMode(true);input.resume();input.on('keypress',keypress);output.on('resize',onResize);process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
  try{draw();void prompt();await completion;}
  finally{finished=true;abort.abort(Error('关闭界面'));input.off('keypress',keypress);output.off('resize',onResize);process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);input.setRawMode(false);input.pause();output.write('\x1b[?25h\x1b[?1049l');await session.close();}
  const metric=(v:number[])=>{const a=[...v].sort((a,b)=>a-b);return a.length?`n=${a.length}, median=${a[Math.floor(a.length/2)]!.toFixed(1)}ms, max=${a.at(-1)!.toFixed(1)}ms`:'n=0';};
  const quotedDirectory="'"+directory.replaceAll("'", "'\"'\"'")+"'";
  const continuation=faulted||abandoned
    ? `现场目录：${directory}；未提交进展不可恢复，禁止从旧检查点补跑。`
    : `${model.batch.state.termination==='playing'?'继续':'查看终局'}：npm run sts:tui -- --resume ${quotedDirectory}`;
  output.write(`${abandoned?'已中止，未宣称保存成功':'已保存退出'}。状态：${faulted?'fault':abandoned?'aborted':model.batch.state.termination}，决策 ${model.batch.revision}\n${continuation}\n动作 ${metric(session.metrics().advance)}；保存 ${metric(session.metrics().save)}；绘制 ${metric(drawTimes)}\n`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runTui().catch(error=>{console.error(String(error));process.exitCode=1;});
