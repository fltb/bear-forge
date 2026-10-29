import {openJsonlTrace} from '../simulator-trace.ts';
import {randomBytes,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {emitKeypressEvents} from 'node:readline';
import type {Key} from 'node:readline';
import {createHumanPolicy} from '@bear-forge/policies';
import type {JsonValue} from '@bear-forge/contracts/game';
import {createSimulator} from '../simulator.ts';
import {openSimulatorStore} from '../simulator-store.ts';
import {listSimulatorSaves,simulatorSaveDirectory} from '../simulator-library.ts';
import {chooseTuiSave} from './sts-tui-start.ts';
import {bindTuiShutdown} from './sts-tui-lifecycle.ts';
import {decisionPresentation,actionMatches,chooseMultiple,eventLines,renderTui,tabs,needsConfirmation,resultSummary} from './sts-tui-view.ts';
import type {TuiModel} from './sts-tui-view.ts';

export async function runTui(args=process.argv.slice(2),input=process.stdin,output=process.stdout){
  const flags=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const key=args[i]!;
    if(key==='--help'){output.write('STS TUI\n直接运行：选择继续游戏或新局\n新局: npm run sts:tui -- --new --character volibear\n继续最近一局: npm run sts:tui -- --resume latest\n指定目录: --save 目录 / --resume 目录；--list 查看存档\n默认存档：'+simulatorSaveDirectory()+'\n可选 --trace 新JSONL路径（默认存档目录内新trace文件），--trace off 关闭；--seed 十进制uint64；现有角色 ironclad / volibear，难度 A20。\n方向键选择，Enter 执行，左右切页，Tab 切焦点，PgUp/PgDn 滚动，/ 筛选，s 保存，q 保存退出。\n');return;}
    if(key==='--new'||key==='--list'){if(flags.has(key))throw Error('重复参数：'+key);flags.set(key,'true');continue;}
    if(!['--save','--resume','--character','--seed','--trace'].includes(key)||flags.has(key)||!args[i+1]||args[i+1]!.startsWith('--'))throw Error('未知、重复或缺少值的参数：'+key);
    flags.set(key,args[++i]!);
  }
  if(flags.has('--resume')&&['--save','--character','--seed','--new'].some(k=>flags.has(k)))throw Error('--resume 不能与新局设置混用');
  if(flags.has('--list')){for(const entry of await listSimulatorSaves())output.write(`${entry.label}\n${entry.directory}\n`);return;}
  if(!input.isTTY||!output.isTTY)throw Error('TUI 需要交互终端；请在终端运行 npm run sts:tui（--help 查看用法）。');
  if(!['--new','--save','--resume','--character','--seed'].some(k=>flags.has(k))){
    const choice=await chooseTuiSave(await listSimulatorSaves(),input,output);
    if(choice===null)return;
    if('resume' in choice)flags.set('--resume',choice.resume);else flags.set('--character',choice.character);
  }
  if(flags.get('--resume')==='latest'){
    const latest=(await listSimulatorSaves()).find(e=>e.available&&e.status==='playing');
    if(!latest)throw Error('没有可继续的存档；请从启动菜单查看状态或新开一局。');
    flags.set('--resume',latest.directory);
  }
  const character=flags.get('--character')??'ironclad';if(character!=='ironclad'&&character!=='volibear')throw Error('角色必须是 ironclad 或 volibear');
  const seed=flags.get('--seed')??randomBytes(8).readBigUInt64LE().toString();if(!/^\d+$/.test(seed)||BigInt(seed)>0xffffffffffffffffn)throw Error('seed 必须是十进制 uint64');
  const directory=resolve(flags.get('--resume')??flags.get('--save')??join(simulatorSaveDirectory(),`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`));
  output.write(`正在${flags.has('--resume')?'恢复':'创建'} STS；存档：${directory}\n`);
  let bootstrapExit=false,bootstrapDisconnected=false;
  const unbindBootstrap=bindTuiShutdown(input,output,lost=>{bootstrapExit=true;bootstrapDisconnected||=lost;});
  let store:Awaited<ReturnType<typeof openSimulatorStore>>;
  try{store=await openSimulatorStore(directory,flags.has('--resume')?'resume':'new');}catch(error){unbindBootstrap();throw error;}
  let trace:Awaited<ReturnType<typeof openJsonlTrace>>|undefined;
  if(flags.get('--trace')!=='off'){
    const tracePath=resolve(flags.get('--trace')??`${directory}/trace-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`);
    try{trace=await openJsonlTrace(tracePath);output.write(`运行日志：${tracePath}\n`);}catch(error){output.write(`日志未启用（游戏仍可继续）：${String(error)}\n`);}
  }
  let session:Awaited<ReturnType<typeof createSimulator>>;
  try{session=await createSimulator({store,...(trace?{trace}:{}),resume:flags.has('--resume'),setup:{character,seed}});}catch(error){unbindBootstrap();await trace?.close?.();await store.close();throw error;}
  const initial=await session.observe(),model:TuiModel={batch:initial,tab:initial.state.observation.game.screen==='MAP_SCREEN'?2:0,scroll:0,selected:0,filter:'',filtering:false,message:'自动保存已开启',busy:false,log:eventLines(initial),focus:'actions',confirm:false,multi:null};
  let settle:((action:JsonValue)=>void)|null=null,finished=false,exitRequested=bootstrapExit,saved=true,abandonRequested=false,abandoned=false,faulted=false,disconnected=bootstrapDisconnected;
  const abort=new AbortController(),drawTimes:number[]=[];
  const policy=createHumanPolicy((_request,signal)=>new Promise<JsonValue>((accept,reject)=>{settle=value=>{signal.removeEventListener('abort',cancel);settle=null;accept(value);};function cancel(){settle=null;reject(signal.reason);}signal.addEventListener('abort',cancel,{once:true});}));
  const draw=()=>{if(disconnected)return;const t=performance.now();output.write(renderTui(model,output.columns??80,output.rows??24));drawTimes.push(performance.now()-t);};
  let done!:()=>void;const completion=new Promise<void>(resolve=>{done=resolve;});
  async function quit(){
    if(finished)return;
    if(model.busy){exitRequested=true;model.message='本次执行结束并成功保存后退出';draw();return;}
    model.busy=true;draw();
    try{await session.save();saved=true;finished=true;abort.abort(Error('保存退出'));done();}
    catch(error){model.busy=false;model.message='保存失败，仍保留当前现场（s 重试；连续两次大写 X 中止）：'+String(error);
      if(disconnected){saved=false;abandoned=true;finished=true;process.exitCode=1;abort.abort(error);done();}else draw();}
  }
  async function save(){if(model.busy)return;model.busy=true;draw();try{await session.save();saved=true;model.message='当前真实状态已保存';}catch(error){saved=false;model.message='保存失败：'+String(error);}finally{model.busy=false;draw();if(exitRequested&&(saved||disconnected))await quit();}}
  async function prompt(){
    if(finished||!model.batch.state.request)return;
    try{
      const result=await session.decide(policy,abort.signal);
      if(result.accepted){const summary=resultSummary(model.batch,result.batch);const wasMap=model.batch.state.observation.game.screen==='MAP_SCREEN';model.batch=result.batch;if(model.batch.state.observation.game.screen==='MAP_SCREEN')model.tab=2;else if(wasMap)model.tab=0;saved=result.saved;model.log.push(...eventLines(result.batch));model.log=model.log.slice(-1000);model.filter='';model.selected=0;model.scroll=0;model.confirm=false;model.multi=null;model.message=result.saved?summary:`动作已执行，但保存失败：${'saveError' in result?result.saveError:''}；按 s 重试，不能继续。`;}
      else model.message=result.reason;
      if(session.traceStatus().failed)model.message+='；日志写入已停止：'+session.traceStatus().error;
      model.busy=false;draw();
      if(exitRequested&&(saved||disconnected)){await quit();return;}
      void prompt();
    }catch(error){if(finished)return;model.busy=false;faulted=true;model.message='执行故障：'+String(error)+'；禁止回退。连续按两次大写 X 关闭。';
      if(exitRequested||disconnected){abandoned=true;finished=true;process.exitCode=1;done();}else draw();}
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
    const actions=decisionPresentation(model.batch).actions.filter(a=>actionMatches(model.batch,a,model.filter)),candidates=model.batch.state.observation.battle?.select?.candidates??[],last=Math.max(0,(model.multi===null?actions.length:candidates.length)-1);
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
      if(needsConfirmation(model.batch,action)&&!model.confirm){model.confirm=true;draw();return;}
      model.busy=true;model.confirm=false;settle({bits:action.bits});
    }
    draw();
  }
  const onResize=()=>draw();
  const unbindShutdown=bindTuiShutdown(input,output,lost=>{disconnected||=lost;exitRequested=true;if(faulted){abandoned=true;finished=true;done();}else void quit();});
  unbindBootstrap();
  if(!disconnected)output.write('\x1b[?1049h\x1b[?25l');emitKeypressEvents(input);if(!disconnected&&!input.destroyed){input.setRawMode(true);input.resume();}input.on('keypress',keypress);output.on('resize',onResize);
  try{if(exitRequested)await quit();else{draw();void prompt();}await completion;}
  finally{finished=true;abort.abort(Error('关闭界面'));input.off('keypress',keypress);output.off('resize',onResize);unbindShutdown();if(!disconnected&&!input.destroyed)input.setRawMode(false);input.pause();if(!disconnected)output.write('\x1b[?25h\x1b[?1049l');await session.close();}
  if(disconnected){if(!saved||abandoned||faulted)process.stderr.write(`终端已断开，未能保存最新现场：${directory}；不能恢复旧动作补跑。\n`);return;}
  const traceResult=session.traceStatus();
  output.write(`日志：${traceResult.failed?'已失败，存在缺口':traceResult.enabled?'已关闭':'关闭'}；${traceResult.records}条；写入累计${traceResult.milliseconds.toFixed(1)}ms${traceResult.error?'；'+traceResult.error:''}\n`);
  const metric=(v:number[])=>{const a=[...v].sort((a,b)=>a-b);return a.length?`n=${a.length}, median=${a[Math.floor(a.length/2)]!.toFixed(1)}ms, max=${a.at(-1)!.toFixed(1)}ms`:'n=0';};
  const quotedDirectory="'"+directory.replaceAll("'", "'\"'\"'")+"'";
  const continuation=faulted||abandoned
    ? `现场目录：${directory}；未提交进展不可恢复，禁止从旧检查点补跑。`
    : `${model.batch.state.termination==='playing'?'继续':'查看终局'}：npm run sts:tui -- --resume ${quotedDirectory}`;
  output.write(`${abandoned?'已中止，未宣称保存成功':'已保存退出'}。状态：${faulted?'fault':abandoned?'aborted':model.batch.state.termination}，决策 ${model.batch.revision}\n${continuation}\n动作 ${metric(session.metrics().advance)}；保存 ${metric(session.metrics().save)}；绘制 ${metric(drawTimes)}\n`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runTui().catch(error=>{console.error(String(error));process.exitCode=1;});
