import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import type {Policy,Proposal} from '@bear-forge/policies';
import type {LoadedCore} from '@bear-forge/contracts/loading';
import type {SnapshotStore} from '@bear-forge/runtime-card';
import type {Action,Setup,StsEvent,Ports,Frame} from './game.schemas.ts';
import {cardDefinition} from './card.ts';
import {contract} from './contract.ts';
import {validatePresentationCatalog} from './presentation.ts';
import type {SimulatorStore,SimulatorView,EventBatch,SimulatorCommand,SimulatorSave,DisplayEvent,DisplayIdentity,CommandReceipt,SimulatorPolicyState} from './simulator.types.ts';

const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const snapshots=memorySnapshotStore();
async function loadProgram(){
  validatePresentationCatalog();
  return unwrap(await createCardLoader({recordCore:false,controlled:true,snapshots,instructionsPerSlice:100_000}).load(cardDefinition));
}
const ownedStores=new WeakSet<SimulatorStore>();
let shared:ReturnType<typeof loadProgram>|undefined;
let signature:Promise<string>|undefined;
async function programSignature(){
  const root=fileURLToPath(new URL('../../../',import.meta.url)),hash=createHash('sha256');
  async function visit(path:string){
    for(const entry of (await readdir(join(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const next=path+'/'+entry.name;
      if(entry.isDirectory())await visit(next);
      else if(entry.name.endsWith('.ts')){hash.update(next);hash.update(await readFile(join(root,next)));}
    }
  }
  for(const path of ['examples/sts/src','packages/card-engine/src','packages/runtime-card/src','packages/runtime/src','packages/game-host/src','packages/contracts/src','packages/boundary/src'])await visit(path);
  return hash.update('node'+process.versions.node.split('.')[0]).digest('hex');
}

/** Shared Program, independently owned Context; persistence never executes inputs. */
export async function createSimulator(options:{store:SimulatorStore;setup?:Setup;resume?:boolean}){
  const loaded=await(shared??=loadProgram()),program=await(signature??=programSignature());
  return openSimulator({store:options.store,setup:{...options.setup,seed:options.setup?.seed??'0',detailedEvents:true},resume:options.resume??false,kernel:{loaded,snapshots,program,character:options.setup?.character??'ironclad'}});
}

/** Internal host seam: tests may supply original content fixtures, never alternate settlement. */
export async function openSimulator<S>(options:{store:SimulatorStore;setup:S;resume:boolean;kernel:{loaded:LoadedCore<S,Ports,Frame>;snapshots:SnapshotStore;program:string;character:'ironclad'|'volibear'}}){
  const {loaded,snapshots,program}=options.kernel,storage=options.store;
  if(ownedStores.has(storage))throw Error('存档句柄已属于一个会话');
  ownedStores.add(storage);
  try{
  const restored=options.resume?await storage.read():null;
  if(restored&&restored.program!==program)throw Error('存档与当前规则代码或 Node 主版本不匹配；请使用创建存档时的版本。未启动或重放游戏。');
  if(restored)await snapshots.put(restored.snapshotId,restored.context);
  const instance=await (async()=>{try{return restored?unwrap(await loaded.persistence!.restore({snapshotId:restored.snapshotId})):unwrap(await loaded.core.start(options.setup));}finally{if(restored)await snapshots.remove(restored.snapshotId);}})();
  const bound=await createGameBinder().bind({instance,contract,persistence:loaded.persistence!});
  if(!bound.ok){await instance.close();throw Error(JSON.stringify(bound.error));}
  const game=bound.value,sessionId=restored?.sessionId??randomUUID(),character=restored?.character??options.kernel.character;
  let revision=restored?.revision??0,cursor=restored?.cursor??0,entities:Record<string,DisplayIdentity>=restored?.entities??{},lastCommand:CommandReceipt|null=restored?.lastCommand??null;
  let policyState:SimulatorPolicyState=restored?.policyState??{version:null,encoderVersion:null,memory:null,random:{state:0,position:0}};
  let pending:Action|null=null,events:DisplayEvent[]=[],actionId=sessionId+':initial',batch:EventBatch|undefined=restored?.batch;
  let closed=false,fault:string|null=null,dirty=false,markerUncertain=false,tail:Promise<unknown>=Promise.resolve();
  const timings={advance:[] as number[],save:[] as number[]};
  function serial<T>(work:()=>Promise<T>):Promise<T>{const result=tail.then(work);tail=result.catch(()=>{});return result;}
  function usable(){if(closed)throw Error('会话已关闭');if(fault)throw Error('执行故障，禁止继续：'+fault);}
  function event(raw:StsEvent):StsEvent{
    if(raw.kind!=='detail')return raw;
    const data={...raw.data};
    const battle=typeof data.displayBattle==='number'?String(data.displayBattle):null;
    if(battle!==null){entities[battle]??={id:'e'+Object.keys(entities).length,kind:'entity'};data.displayBattle=entities[battle]!.id;}
    for(const field of ['entity','actor','card','enemy','source','target','blockTarget','battle','deck','piles','registry','controller']){
      const value=data[field];if(typeof value!=='number'||value<0)continue;
      const key=String(value);
      const identity=entities[key]??={id:'e'+Object.keys(entities).length,kind:'entity'};
      if(battle!==null)identity.battle=entities[battle]!.id;
      if((field==='card'||field==='entity')&&typeof data.uniqueId==='number'){identity.kind='card';identity.card=data.uniqueId;}
      if(data[field+'Role']==='player')identity.kind='player';
      if(data[field+'Role']==='enemy'){identity.kind='enemy';identity.index=Number(data[field+'Index']);}
      data[field]=identity.id;
    }
    return {...raw,data};
  }
  unwrap(await game.bind({player:'0',onRequest:async()=>{if(pending===null)return {kind:'pause'};const value=pending;pending=null;return {kind:'reply',value};},onEvent:async packet=>{events.push({sequence:++cursor,actionId,event:event(packet.event)});return {kind:'reply',value:null};}}));
  async function view():Promise<SimulatorView>{
    usable();const state=unwrap(await game.inspect());
    if(state.kind==='fault')throw Error(JSON.stringify(state.error));
    if(state.kind==='ended')return {sessionId,revision,character,observation:unwrap(await game.observe({player:'0'})),request:null,result:state.result,termination:state.result.outcome==='death'?'death':state.result.heartDefeated?'heart-victory':'act3-clear'};
    if(state.kind!=='request'||!state.requests[0])throw Error('未抵达玩家决策边界');
    const request=state.requests[0];
    return {sessionId,revision,character,observation:request.observation,request,result:null,termination:'playing'};
  }
  async function collect(fromRevision:number){const state=await view();batch={fromRevision,revision,actionId,events,cursor,identities:Object.fromEntries(Object.values(entities).map(e=>[e.id,{...e}])),state};events=[];}
  async function persist(){
    usable();const started=performance.now();
    const reference=unwrap(await game.save!());
    try{
      const context=(await snapshots.get(reference.snapshotId))!;
      const save:SimulatorSave={format:1,program,sessionId,character,revision,cursor,entities,lastCommand,policyState,batch:batch!,snapshotId:reference.snapshotId,context};
      await storage.commit(save);
      if(markerUncertain){await storage.pending(sessionId,revision);markerUncertain=false;}
      dirty=false;
    }finally{await snapshots.remove(reference.snapshotId);timings.save.push(performance.now()-started);}
  }
  try{
    if(!restored){await storage.pending(sessionId,0);unwrap(await game.run());await collect(-1);dirty=true;await persist();}
    else { // Rebind a new instance identity, retaining the same logical request/revision.
      batch={...batch!,state:await view()};
    }
  }catch(error){await game.close();throw error;}
  async function submit(command:SimulatorCommand,proposal:Proposal|null=null){command=structuredClone(command);return serial(async()=>{
    usable();
    if(!command||typeof command!=='object')return {accepted:false as const,reason:'需要动作命令对象'};
    const candidate=command.action as Partial<Action>|null;
    if(command.sessionId!==sessionId||typeof command.id!=='string'||!command.id)return {accepted:false as const,reason:'会话或命令标识无效'};
    if(lastCommand?.id===command.id){
      if(lastCommand.revision!==command.revision||lastCommand.bits!==candidate?.bits)return {accepted:false as const,reason:'重复命令标识对应不同输入'};
      return {accepted:true as const,duplicate:true,batch:structuredClone(batch!),saved:!dirty};
    }
    if(dirty)return {accepted:false as const,reason:'当前进展尚未保存；请先重试保存，不能继续或回退'};
    if(command.revision!==revision)return {accepted:false as const,reason:'过期决策；请刷新当前状态'};
    const current=await view(),request=current.request;
    if(!request)return {accepted:false as const,reason:'该局已结束'};
    if(!candidate||typeof candidate!=='object'||Object.keys(candidate).length!==1||!Number.isInteger(candidate.bits)||request.options.kind!=='exact'||!request.options.values.some(a=>(a as Action).bits===candidate.bits))return {accepted:false as const,reason:'非法动作；没有执行任何操作'};
    try{await storage.pending(sessionId,revision+1);markerUncertain=false;}catch(error){markerUncertain=true;return {accepted:false as const,reason:'执行前存档标记失败，动作未执行：'+String(error)};} // Durable BEFORE advance.
    actionId=command.id;events=[];pending={bits:candidate.bits!};const started=performance.now();
    try{
      const result=unwrap(await game.run());if(!result.accepted)throw Error('原宿主未接受已提交动作');
      if(proposal)policyState={version:proposal.policyVersion,encoderVersion:proposal.encoderVersion,memory:structuredClone(proposal.nextMemory),random:structuredClone(proposal.nextRandom)};
      revision++;lastCommand={id:command.id,revision:command.revision,bits:candidate.bits!,accepted:true,resultRevision:revision};
      await collect(command.revision);dirty=true;
    }catch(error){fault=String(error);throw error;}finally{timings.advance.push(performance.now()-started);}
    try{await persist();return {accepted:true as const,duplicate:false,batch:structuredClone(batch!),saved:true};}
    catch(error){return {accepted:true as const,duplicate:false,batch:structuredClone(batch!),saved:false,saveError:String(error)};}
  });}
  return {
    act:(command:SimulatorCommand)=>submit(command),
    observe:()=>serial(async()=>{usable();return structuredClone(batch!);}),
    save:()=>serial(async()=>{await persist();return {revision,saved:true as const};}),
    async decide(policy:Policy,signal:AbortSignal){
      const current=(await this.observe()).state;if(!current.request)throw Error('该局已结束');
      const actor=policyState.version===policy.version&&policyState.encoderVersion===policy.encoderVersion?structuredClone(policyState):{memory:null,random:{state:0,position:0}};
      const proposal=await policy.decide({request:current.request,visibleHistory:[],memory:actor.memory,random:actor.random,signal});
      signal.throwIfAborted();return submit({id:randomUUID(),sessionId,revision:current.revision,action:proposal.action},proposal);
    },
    metrics:()=>structuredClone(timings),
    close:()=>serial(async()=>{if(closed)return;await game.close();await storage.close();closed=true;ownedStores.delete(storage);}),
  };
  }catch(error){ownedStores.delete(storage);throw error;}
}
export type Simulator=Awaited<ReturnType<typeof createSimulator>>;
