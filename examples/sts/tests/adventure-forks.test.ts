import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deserialize} from 'node:v8';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import type {Instance,Outcome} from '@bear-forge/contracts/instance';
import {cardDefinition} from '../src/card.ts';
import type {Ports,Frame,GameEvent} from '../src/game.schemas.ts';
import {oracleView} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {publishReference} from './reference/publication.ts';
import {assertSameState} from './reference/compare.ts';
import type {Trace} from './reference/play.ts';
const unwrap=<T,E>(r:Outcome<T,E>):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
async function boundary(instance:Instance<Ports,Frame>):Promise<Frame>{
  unwrap(await instance.bind({event:async()=>({kind:'reply',value:null})}));
  for(;;){const stop=unwrap(await instance.inspect());if(stop.kind==='done')return stop.result;if(stop.kind==='fault')throw Error(JSON.stringify(stop));if(stop.call.port==='decision')return stop.call.input;unwrap(await instance.run());}
}
async function advance(instance:Instance<Ports,Frame>,bits:number){unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits}})}));unwrap(await instance.run());return boundary(instance);}

test('normal adventure map, rewards, shop, event and permanent selection fork different inputs through two generations and survive parent close',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-adventure-forks-')),store=fileSnapshotStore(directory),reference=await ReferenceClient.create();
  const trace=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as Trace;
  let starts=0;
  const loaded=unwrap(await createCardLoader({controlled:true,stepBudget:100_000_000,snapshots:store}).load({...cardDefinition,initialize(setup){starts++;return cardDefinition.initialize(setup);}}));
  const parent=unwrap(await loaded.core.start({seed:trace.seed})),persistence=loaded.persistence!,wanted=new Set(['EVENT_SCREEN','MAP_SCREEN','REWARDS','SHOP_ROOM','CARD_SELECT']),seen=new Set<string>();
  let held:Instance<Ports,Frame>|undefined,heldHistory:GameEvent[]=[];
  const sourceAt=async(history:readonly GameEvent[])=>{let state=await reference.call({op:'start',seed:trace.seed});for(const action of history)state=await reference.call({op:'advance',bits:action.bits});return state;};
  const compare=async(instance:Instance<Ports,Frame>,history:GameEvent[])=>{
    const expected=await sourceAt(history),frame=await boundary(instance),saved=unwrap(await persistence.save(instance));
    try{const bytes=await store.get(saved.snapshotId);assert.ok(bytes);const state=oracleView(deserialize(bytes).root.state,frame);assertSameState(publishReference(expected,history),frame,'alternate adventure publication');assertSameState(expected.game,state.game,'alternate adventure private game');assertSameState(expected.battle,state.battle,'alternate adventure private battle');}
    finally{unwrap(await persistence.release(saved));}
    return frame;
  };
  try{
    let frame=await boundary(parent);
    for(let index=0;index<trace.actions.length&&seen.size<wanted.size;index++){
      const selected=trace.actions[index]!,screen=frame.game.screen,alternative=frame.actions.find(a=>a.bits!==selected.bits);
      if(frame.battle===null&&wanted.has(screen)&&!seen.has(screen)&&alternative){
        const branch=unwrap(await parent.fork!());let grandchild:Instance<Ports,Frame>|undefined;
        const history:GameEvent[]=[...trace.actions.slice(0,index),{kind:'game',bits:alternative.bits}];
        try{
          await advance(branch,alternative.bits);const next=await compare(branch,history);grandchild=unwrap(await branch.fork!());assert.notEqual(branch.id,parent.id);assert.notEqual(grandchild.id,branch.id);assert.deepEqual(await boundary(grandchild),next);
          if(next.actions.length){
            const first=next.actions[0]!.bits,last=next.actions.at(-1)!.bits,kind=next.battle?'battle' as const:'game' as const;
            await advance(branch,first);await compare(branch,[...history,{kind,bits:first}]);
            await advance(grandchild,last);heldHistory=[...history,{kind,bits:last}];await compare(grandchild,heldHistory);
          }else heldHistory=history;
          assert.deepEqual(await boundary(parent),frame,'alternate generations cannot mutate their ancestor');
          if(held){await held.close();await loaded.capture?.release(held.id);}held=grandchild;grandchild=undefined;seen.add(screen);assert.equal(starts,1);
        }finally{await branch.close();await loaded.capture?.release(branch.id);if(grandchild){await grandchild.close();await loaded.capture?.release(grandchild.id);}}
      }
      if(seen.size===wanted.size)break;
      frame=await advance(parent,selected.bits);
    }
    assert.deepEqual([...seen].sort(),[...wanted].sort());assert.ok(held);await parent.close();
    const surviving=await boundary(held);if(surviving.actions.length){const bits=surviving.actions[0]!.bits,kind=surviving.battle?'battle' as const:'game' as const;await advance(held,bits);await compare(held,[...heldHistory,{kind,bits}]);}
    assert.equal(starts,1,'forks must not initialize or replay the game');
  }finally{await parent.close();await loaded.capture?.release(parent.id);if(held){await held.close();await loaded.capture?.release(held.id);}await reference.close();await rm(directory,{recursive:true,force:true});}
});
