import {randomUUID} from 'node:crypto';
import {InstanceIdSchema,CallIdSchema} from '@bear-forge/contracts/instance';
import type {CallbackReply,PauseReason,CallId} from '@bear-forge/contracts/instance';
import type {GameModule,GameTypes,RequestData} from '@bear-forge/contracts/authoring';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {RequestIdSchema} from '@bear-forge/contracts/game';
import type {Request,GameBindings,GameState,Accepted,ActionReply,GameError,RequestId} from '@bear-forge/contracts/game';
import type {IO,PortCall} from '@bear-forge/contracts/core';
import type {SessionControl} from '@bear-forge/contracts/session';

/** Native protocol consumer for C01: real author program, public IO, public game contract. */
export async function nativeGame<G extends GameTypes>(module:GameModule<G>,setup:G['setup']):Promise<GameHandle<G>>{
  type State=GameState<G['actions'],G['player'],G['observation'],G['result']>;
  type Binding=GameBindings<G['actions'],G['player'],G['observation'],G['playerEvent']>;
  type Input=Accepted<G['actions'],G['player'],G['control']['input']>;
  type Port=G['ports'];
  const contract=module.contract,id=InstanceIdSchema.parse(randomUUID()),bindings=new Map<G['player'],Binding>();
  const copy=<T>(value:T):T=>structuredClone(value);
  const ok=<T>(value:T)=>({ok:true as const,value});
  const error=(kind:GameError['kind'],code:string,message=code)=>({ok:false as const,error:{kind,code,message} as GameError});
  let closed=false,busy=false,driver:AbortController|undefined;
  let controlHandler:Parameters<SessionControl<G['control']['request'],G['control']['input']>['bindControl']>[0]=null;
  type Pending={callId:CallId;call:PortCall<Port>;resolve:(value:unknown)=>void;reject:(error:unknown)=>void};
  let pending:Pending|undefined,terminal:State|undefined;
  let boundaryReady!:()=>void;
  let boundary=new Promise<void>(resolve=>{boundaryReady=resolve;});
  const io:IO<Port>={call:async call=>new Promise((resolve,reject)=>{
    pending={callId:CallIdSchema.parse(randomUUID()),call:copy(call),resolve:resolve as (value:unknown)=>void,reject};boundaryReady();
  })};
  const task=Promise.resolve().then(()=>module.program.run(module.program.schemas.setup.parse(copy(setup)),io)).then(result=>{
    if(closed)return;
    const end=contract.finish(result as never);contract.schemas.view.parse(end.view);contract.schemas.result.parse(end.result);
    terminal={kind:'ended',result:copy(end.result)};terminalView=copy(end.view);pending=undefined;boundaryReady();
  }).catch(cause=>{if(closed)return;terminal={kind:'fault',error:{kind:'fault',code:'program_failed',message:String(cause)}};pending=undefined;boundaryReady();});
  let terminalView:G['view']|undefined;
  await boundary;
  const requestData=()=>{
    if(!pending)throw new Error('no pending call');
    const port=contract.ports[pending.call.port]!;
    if(port.kind!=='request')throw new Error('view_unavailable');
    const data=port.receive(copy(pending.call.input) as never);
    contract.schemas.view.parse(data.view);
    if(new Set(data.requests.map(r=>r.key)).size!==data.requests.length)throw new Error('duplicate request key');
    for(const r of data.requests){contract.schemas.player.parse(r.player);contract.schemas.actions[r.type]!.request.parse(r.data);}
    return {port,data,callId:pending.callId};
  };
  const project=(view:G['view'],r:RequestData<G>,callId:CallId):Request<G['actions'],G['player'],G['observation']>=>({
    id:{instanceId:id,callId,key:r.key},player:r.player,type:r.type,data:copy(r.data),
    observation:contract.schemas.observation.parse(contract.observe(copy(view) as never,r.player)),
    options:contract.inputs[r.type]!.options.parse(contract.inputs[r.type]!.describe(copy(view) as never,copy(r) as never)),
  }) as Request<G['actions'],G['player'],G['observation']>;
  const inspect=():State=>{
    if(terminal)return copy(terminal);
    if(!pending)throw new Error('computing');
    if(contract.ports[pending.call.port]!.kind==='event')return {kind:'event',callId:pending.callId};
    const {data,callId}=requestData();return {kind:'request',requests:data.requests.map(r=>project(data.view,r,callId))};
  };
  const same=(a:RequestId,b:RequestId)=>a.instanceId===b.instanceId&&a.callId===b.callId&&a.key===b.key;
  const prepare=(player:G['player'],reply:ActionReply<G['actions']>)=>{
    const {port,data,callId}=requestData();
    const r=data.requests.find(r=>same(reply.requestId,{instanceId:id,callId,key:r.key})&&r.type===reply.type&&r.player===player);
    if(!r)return {valid:false as const,reason:'request_mismatch'};
    if(!contract.schemas.actions[r.type]!.action.safeParse(reply.action).success)return {valid:false as const,reason:'invalid_action'};
    if(port.kind!=='request')throw new Error('request port required');
    return port.respond(copy(data.view) as never,copy(r) as never,copy(reply.action) as never);
  };
  const advance=async(output:unknown)=>{
    const call=pending!;
    const schema=module.program.schemas.ports[call.call.port]!.output;
    schema.parse(output);
    boundary=new Promise(resolve=>{boundaryReady=resolve;});pending=undefined;call.resolve(copy(output));await boundary;
  };
  const availability=()=>closed?error('conflict','game_closed'):busy?error('conflict','game_busy'):null;
  const fault=async(cause:unknown)=>{
    driver?.abort();closed=true;pending?.reject(cause);pending=undefined;
    return {kind:'fault' as const,error:{kind:'fault' as const,code:'invalid_output' as const,message:String(cause)}};
  };
  const surface={
    id,
    async bind(binding:Binding|null){const unavailable=availability();if(unavailable)return unavailable;
      if(!binding){bindings.clear();return ok(undefined);}
      if(!contract.schemas.player.safeParse(binding.player).success)return error('rejected','invalid_argument');
      if(!binding.onRequest&&!binding.onEvent)bindings.delete(binding.player);else bindings.set(binding.player,{...binding});return ok(undefined);
    },
    async bindControl(handler:typeof controlHandler){const unavailable=availability();if(unavailable)return unavailable;controlHandler=handler;return ok(undefined);},
    async inspect(){if(closed)return error('conflict','game_closed');if(!pending&&!terminal)return error('conflict','game_busy');try{return ok(inspect());}catch(cause){return {ok:false as const,error:(await fault(cause)).error};}},
    async observe({player}:{player:G['player']}){if(closed)return error('conflict','game_closed');if(!pending&&!terminal)return error('conflict','game_busy');
      if(!contract.schemas.player.safeParse(player).success)return error('rejected','invalid_input');
      if(pending&&contract.ports[pending.call.port]!.kind==='event')return error('conflict','view_unavailable');
      if(terminal?.kind==='fault')return {ok:false as const,error:terminal.error};
      try{const view=terminal?terminalView:requestData().data.view;return ok(copy(contract.schemas.observation.parse(contract.observe(copy(view) as never,player))));}catch(cause){return {ok:false as const,error:(await fault(cause)).error};}
    },
    async describe(input:{requestId:RequestId;type:keyof G['actions']}){
      if(!input||!RequestIdSchema.safeParse(input.requestId).success||!Object.hasOwn(contract.inputs,input.type))return error('rejected','invalid_input');
      if(closed)return error('conflict','game_closed');if(!pending)return terminal?.kind==='ended'?error('conflict','game_ended'):error('conflict','game_busy');
      if(contract.ports[pending.call.port]!.kind==='event')return error('conflict','view_unavailable');
      try{const {data,callId}=requestData();const r=data.requests.find(r=>r.type===input.type&&same(input.requestId,{instanceId:id,callId,key:r.key}));
        if(!r)return error('rejected','request_mismatch');return ok(project(data.view,r,callId).options);
      }catch(cause){return {ok:false as const,error:(await fault(cause)).error};}
    },
    async validate({player,reply}:{player:G['player'];reply:ActionReply<G['actions']>}){
      if(!contract.schemas.player.safeParse(player).success||!reply||!RequestIdSchema.safeParse(reply.requestId).success||!Object.hasOwn(contract.schemas.actions,reply.type))return error('rejected','invalid_input');
      if(closed)return error('conflict','game_closed');if(!pending)return terminal?.kind==='ended'?error('conflict','game_ended'):error('conflict','game_busy');
      if(contract.ports[pending.call.port]!.kind==='event')return error('conflict','view_unavailable');
      try{const result=prepare(player,reply);return ok(result.valid?{valid:true as const}:{valid:false as const,reason:result.reason});}catch(cause){return {ok:false as const,error:(await fault(cause)).error};}
    },
    async run(options?:{signal?:AbortSignal}){
      const unavailable=availability();if(unavailable)return unavailable;
      busy=true;driver=new AbortController();const abort=()=>driver?.abort();options?.signal?.addEventListener('abort',abort,{once:true});if(options?.signal?.aborted)driver.abort();
      let accepted:Input|null=null;
      const stop=(pause:PauseReason|null)=>ok({state:inspect(),accepted:copy(accepted),pause});
      try{
        while(true){
          if(terminal)return stop(null);
          if(driver.signal.aborted)return stop('cancelled');
          const current=pending!,port=contract.ports[current.call.port]!;
          if(port.kind==='event'){
            const batch=port.receive(copy(current.call.input) as never);
            module.program.schemas.ports[current.call.port]!.output.parse(batch.output);
            for(const event of batch.events)contract.schemas.event.parse(event);
            for(const [index,raw] of batch.events.entries())for(const [player,binding] of [...bindings].sort(([a],[b])=>a<b?-1:a>b?1:0)){
              if(driver.signal.aborted)return stop('cancelled');if(!binding.onEvent)continue;
              const projected=contract.projectEvent(copy(raw) as never,player);if(projected===null)continue;
              const event=contract.schemas.playerEvent.parse(projected.event);
              const reply=await cancellable(()=>binding.onEvent!({id:{instanceId:id,callId:current.callId,index},event:copy(event)},{signal:driver!.signal,player}),driver.signal);
              if(reply.kind==='stop')return stop(reply.reason);
              if(reply.value!==null)return stop('invalid_reply');
            }
            if(driver.signal.aborted)return stop('cancelled');await advance(batch.output);continue;
          }
          if(accepted)return stop(null);
          const {data,callId}=requestData();
          const candidates:Array<()=>Promise<{accepted:Input;output:unknown}|{pause:PauseReason}>>=[];
          for(const r of data.requests){const binding=bindings.get(r.player);if(!binding?.onRequest)continue;
            const request=project(data.view,r,callId),requestId=copy(request.id);
            candidates.push(async()=>{
              const result=await cancellable(()=>binding.onRequest!(request as never,{signal:driver!.signal}),driver!.signal);
              if(result.kind==='stop')return {pause:result.reason};
              const reply={requestId,type:r.type,action:result.value} as ActionReply<G['actions']>;
              const prepared=prepare(r.player,reply);if(!prepared.valid)return {pause:'invalid_reply'};
              return {accepted:{kind:'action',player:r.player,reply} as Input,output:prepared.output};
            });
          }
          if(port.session&&controlHandler){const session=port.session,handler=controlHandler;const request=session.requestSchema.parse(session.request(copy(data.view) as never));
            candidates.push(async()=>{
              const result=await cancellable(()=>handler({instanceId:id,callId,data:copy(request)},{signal:driver!.signal}),driver!.signal);
              if(result.kind==='stop')return {pause:result.reason};
              if(!session.inputSchema.safeParse(result.value).success)return {pause:'invalid_reply'};
              const prepared=session.respond(copy(data.view) as never,copy(result.value) as never);if(!prepared.valid)return {pause:'invalid_reply'};
              return {accepted:{kind:'control',callId,input:copy(result.value)} as Input,output:prepared.output};
            });
          }
          if(!candidates.length)return stop('unbound');
          const selected=await firstAccepted(candidates,driver.signal);
          if('pause' in selected)return stop(selected.pause);
          if(driver.signal.aborted)return stop('cancelled');
          // Validate before marking accepted; output schema is part of the author contract.
          module.program.schemas.ports[current.call.port]!.output.parse(selected.output);
          accepted=copy(selected.accepted);driver.abort();driver=new AbortController();if(options?.signal?.aborted)driver.abort();
          await advance(selected.output);
        }
      }catch(cause){return ok({state:await fault(cause),accepted:copy(accepted),pause:null});}
      finally{driver?.abort();options?.signal?.removeEventListener('abort',abort);driver=undefined;busy=false;}
    },
    async close(){if(busy)return error('conflict','game_busy');closed=true;pending?.reject(new Error('closed'));pending=undefined;bindings.clear();controlHandler=null;void task;return ok(undefined);},
  };
  // The generic implementation uses unions internally; public signatures preserve each action key.
  if(!Object.values(contract.ports).some(p=>p.kind==='request'&&p.session))delete (surface as Partial<typeof surface>).bindControl;
  return surface as unknown as GameHandle<G>;
}

async function cancellable<T>(invoke:()=>Promise<CallbackReply<T>>,signal:AbortSignal):Promise<{kind:'value';value:T}|{kind:'stop';reason:PauseReason}>{
  return new Promise(resolve=>{
    let live=true;const finish=(result:{kind:'value';value:T}|{kind:'stop';reason:PauseReason})=>{if(!live)return;live=false;signal.removeEventListener('abort',cancel);resolve(result);};
    const cancel=()=>finish({kind:'stop',reason:'cancelled'});if(signal.aborted){cancel();return;}signal.addEventListener('abort',cancel,{once:true});
    Promise.resolve().then(()=>live?invoke():{kind:'pause'} as const).then(reply=>{
      if(reply?.kind==='pause')finish({kind:'stop',reason:'requested'});
      else if(reply?.kind==='reply')finish({kind:'value',value:reply.value});
      else finish({kind:'stop',reason:'invalid_reply'});
    },()=>finish({kind:'stop',reason:'handler_failed'}));
  });
}
async function firstAccepted<A>(candidates:Array<()=>Promise<A|{pause:PauseReason}>>,signal:AbortSignal):Promise<A|{pause:PauseReason}>{
  return new Promise((resolve,reject)=>{
    let live=true,left=candidates.length;const reasons=new Set<PauseReason>();
    const finish=(value:A|{pause:PauseReason})=>{if(!live)return;live=false;signal.removeEventListener('abort',cancel);resolve(value);};
    const cancel=()=>finish({pause:'cancelled'});signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted){cancel();return;}
    for(const candidate of candidates)Promise.resolve().then(candidate).then(value=>{
      if(!live)return;if(value&&typeof value==='object'&&'pause' in value){reasons.add(value.pause);if(--left===0)finish({pause:reasons.has('invalid_reply')?'invalid_reply':reasons.has('handler_failed')?'handler_failed':'requested'});}
      else finish(value);
    },cause=>{if(!live)return;live=false;signal.removeEventListener('abort',cancel);reject(cause);});
  });
}
