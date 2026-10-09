import type {BaseGame,Request,ActionReply} from '@bear-forge/contracts/game';
import type {GameModule} from '@bear-forge/contracts/authoring';
import type {GameHandle,BaseGameBinder,LoadedCore,CompiledProgram} from '@bear-forge/contracts/loading';
import type {DouDizhuTypes,DouDizhuPorts} from '../../games/doudizhu/src/index.ts';
import {game} from '../../games/doudizhu/src/index.ts';
type T={bid:{request:{minimum:number};action:{amount:number};description:never};text:{request:null;action:string;description:{grammar:'expression'}}};
type B=BaseGame<T,'a'|'b',{hand:number[]},string,number>;
export async function consume(base:B,request:Request<T,'a'|'b',{hand:number[]}>) {
  await base.bind({player:'a',onRequest:async()=>({kind:'pause'})});
  if(request.type==='bid'){
    const result=await base.describe({requestId:request.id,type:'bid'});if(result.ok){const n:number=result.value.values[0]!.amount;void n;}
    await base.validate({player:'a',reply:{requestId:request.id,type:'bid',action:{amount:2}}});
  }
  await base.run();await base.observe({player:'a'});
  // @ts-expect-error action payloads retain their type correlation
  const bad:ActionReply<T>={requestId:request.id,type:'text',action:{amount:1}};void bad;
  // @ts-expect-error actions have no generic delivery envelope
  const timed:ActionReply<T>={requestId:request.id,type:'bid',action:{amount:1},delivery:{at:1}};void timed;
  // @ts-expect-error binding selects a concrete player
  await base.bind({onRequest:async()=>({kind:'pause'})});
  // @ts-expect-error single-step operation has no input count setting
  await base.run({limits:{maxInputs:1}});
  // @ts-expect-error session input is an optional separate capability
  base.bindControl;
  // @ts-expect-error branching is optional, outside the basic game capability
  base.fork;
  // @ts-expect-error persistence is optional, outside the basic game capability
  base.save;
}
type DDZ=GameHandle<DouDizhuTypes>;
export async function callbacks(base:DDZ){
  const onRequest:NonNullable<Parameters<DDZ['bind']>[0]>['onRequest']=async request=>({kind:'reply',value:request.options.values.at(-1)!});
  for(const player of ['0','1','2'] as const)await base.bind({player,onRequest,onEvent:async delivery=>{
    const visible:DouDizhuTypes['playerEvent']=delivery.event;void visible;
    // @ts-expect-error callback receives projected event, not raw visibility metadata
    const raw:DouDizhuTypes['event']=delivery.event;void raw;
    return {kind:'reply',value:null};
  }});
  if(!base.bindControl)throw new Error('session control required');await base.bindControl(async request=>({kind:'reply',value:{kind:'timeout',slotId:request.data.deadlines[0]!.slotId,at:request.data.deadlines[0]!.at}}));
  const run=await base.run();if(run.ok&&run.value.accepted?.kind==='action'){
    const action:DouDizhuTypes['actions']['action']['action']=run.value.accepted.reply.action;void action;
  }
}
export async function bindAndSearch(binder:BaseGameBinder,loaded:LoadedCore<DouDizhuTypes['setup'],DouDizhuPorts,DouDizhuTypes['programResult']>){
  const started=await loaded.core.start({game:{profile:'competitive-2016-bear-1',firstBidder:'0',initialGameTime:0},seed:1});if(!started.ok)return;
  const bound=await binder.bind({instance:started.value,contract:game.contract,...(loaded.persistence?{persistence:loaded.persistence}:{})});if(!bound.ok)return;
  const base=bound.value;
  if(loaded.capture)await loaded.capture.read(base.id,{after:null,limit:10});
  try{await walk(base,2);
    if(base.save&&loaded.persistence){const saved=await base.save();if(saved.ok){
      const restored=await loaded.persistence.restore(saved.value);if(restored.ok){const rebound=await binder.bind({instance:restored.value,contract:game.contract,persistence:loaded.persistence});if(rebound.ok)await rebound.value.close();}
      await loaded.persistence.release(saved.value);
    }}
  }finally{await base.close();if(loaded.capture)await loaded.capture.release(base.id);}
}
export async function walk(base:DDZ,depth:number):Promise<void>{
  const read=await base.inspect();if(!read.ok)throw read.error;
  if(depth<=0||read.value.kind!=='request')return;if(!base.fork)throw new Error('fork required');
  for(const request of read.value.requests)for(const action of request.options.values){
    const forked=await base.fork();if(!forked.ok)throw forked.error;const child=forked.value;
    try{const current=await child.inspect();if(!current.ok)throw current.error;if(current.value.kind!=='request')throw new Error('request expected');
      const own=current.value.requests.find(r=>r.id.key===request.id.key)!;
      const valid=await child.validate({player:own.player,reply:{requestId:own.id,type:'action',action}});if(!valid.ok)throw valid.error;if(!valid.value.valid)continue;
      await child.bind({player:own.player,onRequest:async r=>r.id.key===own.id.key?{kind:'reply',value:action}:{kind:'pause'}});
      const advanced=await child.run();if(!advanced.ok)throw advanced.error;if(advanced.value.accepted?.kind!=='action')throw new Error('not accepted');
      await walk(child,depth-1);
    }finally{await child.close();}
  }
}
export function moduleTypes(module:GameModule<DouDizhuTypes>,narrow:CompiledProgram<{x:1},DouDizhuPorts,number>){
  // @ts-expect-error declared output schema required
  module.program.schemas.ports.decision={input:module.program.schemas.setup};
  // @ts-expect-error compiled artifact type association remains invariant
  const wide:CompiledProgram<{x:number},DouDizhuPorts,number>=narrow;void wide;
}
