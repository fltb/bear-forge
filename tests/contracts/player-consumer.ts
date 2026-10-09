import type {
  CallbackControl, CallbackReply, CallId, DecisionData, EventDelivery, GameBindings,
  GameContract, GameRequest, GameTypes, InstanceId, PauseReason, PreparedReturn,
  QueryShape, ReadView, Submission,
} from '@bear-forge/contracts';

/** Executable native consumer of the player projection and callback contracts. */
export function playerConsumer<G extends GameTypes, Q extends {[K in keyof Q]:QueryShape}>(
  contract:GameContract<G,Q>, instanceId:InstanceId,
) {
  type Binding=GameBindings<G['interactions'],G['actor'],G['delivery'],G['signal'],G['player'],G['observation'],G['playerEvent']>;
  type DecisionResult=
    | {kind:'accepted';player:G['player'];input:Submission<G>;output:unknown}
    | {kind:'paused';reason:PauseReason};
  const bindings=new Map<G['player'],Binding>();
  const clone=<T>(value:T):T=>structuredClone(value);
  const observe=(view:ReadView<G['view']>,player:G['player']):G['observation']=>
    contract.schemas.observation.parse(contract.observe(clone(view),contract.schemas.player.parse(player)));
  const request=(data:DecisionData<G>,player:G['player'],callId:CallId):GameRequest<G['interactions'],G['actor'],G['observation']>=>({
    decisionId:{instanceId,callId},
    observation:observe(data.view as ReadView<G['view']>,player),
    acceptsSignal:data.signalPlayers.includes(player),
    offers:data.choices.filter(choice=>contract.playerFor(choice.actor as ReadView<G['actor']>)===player).map(choice=>({
      choice:clone(choice),
      options:clone(contract.inputs[choice.type]!.describe(data.view as ReadView<G['view']>,clone(choice) as never)),
    })),
  });
  const validate=(data:DecisionData<G>,player:G['player'],input:Submission<G>):boolean=>{
    if(!input||typeof input!=='object')return false;
    if(input.kind==='signal')return data.signalPlayers.includes(player)&&contract.schemas.signal.safeParse(input.signal).success;
    if(input.kind!=='choice'||!input.input)return false;
    const choice=data.choices.find(choice=>choice.id===input.choiceId&&choice.type===input.input.type);
    return !!choice&&contract.playerFor(choice.actor as ReadView<G['actor']>)===player&&
      contract.schemas.delivery.safeParse(input.delivery).success&&
      contract.schemas.interactions[choice.type]!.input.safeParse(input.input.value).success;
  };
  return {
    bind(binding:Binding|null){
      if(binding===null){bindings.clear();return;}
      const player=contract.schemas.player.parse(binding.player);
      if(!binding.onDecision&&!binding.onEvent)bindings.delete(player);
      else bindings.set(player,{...binding,player});
    },
    observe,request,validate,
    async decision(
      data:DecisionData<G>,callId:CallId,
      respond:(view:ReadView<G['view']>,input:ReadView<Submission<G>>,player:G['player'])=>PreparedReturn<unknown>,
      signal?:AbortSignal,
    ):Promise<DecisionResult>{
      const players=[...new Set([
        ...data.choices.map(choice=>contract.playerFor(choice.actor as ReadView<G['actor']>)),
        ...data.signalPlayers,
      ])].sort();
      const eligible=players.flatMap(player=>{
        const binding=bindings.get(player);return binding?.onDecision?[binding]:[];
      });
      if(signal?.aborted)return {kind:'paused',reason:'cancelled'};
      if(!eligible.length)return {kind:'paused',reason:'unbound'};
      return new Promise<DecisionResult>((resolve,reject)=>{
        const controller=new AbortController();let active=true,remaining=eligible.length;
        const reasons=new Set<PauseReason>();
        const finish=(result:DecisionResult)=>{
          if(!active)return;active=false;signal?.removeEventListener('abort',cancel);controller.abort();resolve(result);
        };
        const fail=(error:unknown)=>{if(!active)return;active=false;signal?.removeEventListener('abort',cancel);controller.abort();reject(error);};
        const cancel=()=>finish({kind:'paused',reason:'cancelled'});
        const rejected=(reason:PauseReason)=>{
          reasons.add(reason);remaining--;
          if(remaining===0)finish({kind:'paused',reason:reasons.has('invalid_reply')?'invalid_reply':reasons.has('handler_failed')?'handler_failed':'requested'});
        };
        signal?.addEventListener('abort',cancel,{once:true});
        for(const binding of eligible){
          let projected:GameRequest<G['interactions'],G['actor'],G['observation']>;
          try { projected=request(data,binding.player,callId); } catch(error) {fail(error);break;}
          const control:CallbackControl&{player:G['player']}={signal:controller.signal,player:binding.player};
          Promise.resolve().then(()=>active?binding.onDecision!(projected,control):{kind:'pause'} as const).then(reply=>{
            if(!active)return;
            if(reply?.kind!=='pause'&&reply?.kind!=='reply'){rejected('invalid_reply');return;}
            if(reply.kind==='pause'){rejected('requested');return;}
            try {
              if(!validate(data,binding.player,reply.value)){rejected('invalid_reply');return;}
              const prepared=respond(clone(data.view) as ReadView<G['view']>,clone(reply.value) as ReadView<Submission<G>>,binding.player);
              if(!prepared.valid){rejected('invalid_reply');return;}
              finish({kind:'accepted',player:binding.player,input:clone(reply.value),output:clone(prepared.output)});
            }catch(error){fail(error);}
          },()=>{if(active)rejected('handler_failed');});
        }
      });
    },
    async events(events:G['event'][],callId:CallId):Promise<CallbackReply<null>>{
      for(const [index,event] of events.entries())for(const [player,binding] of [...bindings].sort(([a],[b])=>a<b?-1:a>b?1:0)){
        if(!binding.onEvent)continue;
        const projected=contract.projectEvent(clone(event) as ReadView<G['event']>,player);
        if(projected===null)continue;
        const delivery:EventDelivery<G['playerEvent']>={id:{instanceId,callId,index},event:contract.schemas.playerEvent.parse(projected.event)};
        const controller=new AbortController();
        try {
          const reply=await binding.onEvent(clone(delivery),{signal:controller.signal,player});
          if(reply.kind==='pause')return reply;
          if(reply.value!==null)throw new Error('invalid event acknowledgment');
        }finally{controller.abort();}
      }
      return {kind:'reply',value:null};
    },
  };
}
