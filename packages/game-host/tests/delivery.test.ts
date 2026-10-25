import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {z} from 'zod';
import {card,type CardDefinition} from '@bear-forge/card-engine';
import type {GameContract} from '@bear-forge/contracts/authoring';
import {createCardLoader} from '@bear-forge/runtime-card';
import {registerEventReceipt} from '../../runtime/src/continuation.ts';
import {createGameBinder,restoreGameDelivery} from '../src/binder.ts';
import {saveGameDelivery} from '../src/current.ts';

type Ports={event:{kind:'event';input:number[];output:null}};
type G={setup:null;ports:Ports;programResult:number;view:number;player:'a'|'b';observation:number;
  actions:{};event:number;playerEvent:number;result:number;control:never};
const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};

test('partial event delivery persists each recipient receipt and visibility ordinal without executing the original reply twice',async()=>{
  const counts={initial:0,completed:0,received:0,projected:0};
  const definition:CardDefinition<{},null,Ports,number>={id:'retained-delivery-prefix',
    schemas:{setup:z.null(),result:z.number(),ports:{event:{input:z.array(z.number()),output:z.null()}}},
    initialize(){counts.initial++;return{};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'event',input:[10,20,30]})),card.operation(()=>{counts.completed++;}),card.return(()=>7)
    ]}]};
  const contract:GameContract<G>={
    schemas:{view:z.number(),player:z.enum(['a','b']),observation:z.number(),event:z.number(),playerEvent:z.number(),result:z.number(),actions:{}},
    ports:{event:{kind:'event',receive(events){counts.received++;return{events:[...events],output:null};}}},inputs:{},
    observe:view=>view,projectEvent(event,player){counts.projected++;return player==='b'&&event===20?null:{event};},
    finish:result=>({view:result,result})
  };
  const loaded=unwrap(await createCardLoader().load(definition));
  let instance=unwrap(await loaded.core.start(null));
  let game=unwrap(await createGameBinder().bind<G>({instance,contract,persistence:loaded.persistence!}));
  const seen:{player:string;value:number;index:number;instanceId:string}[]=[];
  try{
    for(let round=0;round<3;round++){
      const cancellation=new AbortController();
      for(const player of ['a','b'] as const){
        const onEvent=async(delivery:{id:{instanceId:string;index:number};event:number})=>{
          seen.push({player,value:delivery.event,index:delivery.id.index,instanceId:delivery.id.instanceId});
          if(round===0&&player==='b'&&delivery.event===10||round===1&&player==='a'&&delivery.event===20)cancellation.abort();
          return{kind:'reply' as const,value:null};
        };
        registerEventReceipt(onEvent);unwrap(await game.bind({player,onEvent}));
      }
      const stop=unwrap(await game.run({signal:cancellation.signal}));assert.equal(stop.accepted,null);
      if(round===2){assert.deepEqual(stop.state,{kind:'ended',result:7});assert.equal(saveGameDelivery(game),null);break;}
      assert.equal(stop.pause,'cancelled');assert.equal(stop.state.kind,'event');assert.equal(counts.completed,0);
      const delivery=deserialize(serialize(saveGameDelivery(game)));assert.ok(delivery.progress.rows.every((row:{acknowledged:boolean})=>row.acknowledged));
      const saved=unwrap(await game.save!()),oldId=game.id,before={...counts};
      unwrap(await game.close());unwrap(await loaded.capture!.release(oldId));
      instance=unwrap(await loaded.persistence!.restore(saved));
      const bad=deserialize(serialize(delivery));bad.progress.rows[0].delivery.id.index=99;
      assert.equal((await restoreGameDelivery({instance,contract,persistence:loaded.persistence},bad)).ok,false);
      assert.equal((await instance.inspect()).ok,true,'rejected receipts cannot consume the current owner');
      const restored=await restoreGameDelivery({instance,contract,persistence:loaded.persistence},delivery);
      assert.equal(restored.ok,true);game=restored.value;
      assert.deepEqual(counts,before,'restore cannot repeat projections, event receive or program operations');
      unwrap(await loaded.persistence!.release(saved));
    }
    assert.deepEqual(seen.filter(row=>row.player==='a').map(row=>[row.value,row.index]),[[10,0],[20,1],[30,2]]);
    assert.deepEqual(seen.filter(row=>row.player==='b').map(row=>[row.value,row.index]),[[10,0],[30,1]]);
    assert.equal(new Set(seen.filter(row=>row.player==='a').map(row=>row.instanceId)).size,3,'future deliveries use each new owner identity');
    assert.deepEqual(counts,{initial:1,completed:1,received:1,projected:6});
  }finally{unwrap(await game.close());unwrap(await loaded.capture!.release(game.id));}
});
