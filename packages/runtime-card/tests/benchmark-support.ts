import assert from 'node:assert/strict';
import { CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
import { createNativeLoader } from '@bear-forge/runtime-native';
import { createCardLoader } from '../src/index.ts';
import { CardGraph } from '../src/graph.ts';
import { Records } from '../../runtime/src/records.ts';
import { interactiveGame, type GameWorkload } from './game-benchmark.ts';
const unwrap = (r: any): any => { if (!r.ok) throw Error(JSON.stringify(r)); return r.value; };

/** Build each response from this execution's current request. Transcripts below
 * are read-only comparison evidence and never supply replies to another run. */
function currentReply(contract:any,call:any,choose:GameWorkload['choose']){
  const port=contract.ports[call.port],delivery=port.receive(call.input);
  if(!delivery.requests?.length)return delivery.output;
  const request=delivery.requests[0],options=contract.inputs[request.type].describe(delivery.view,request);
  const action=choose({...request,options,observation:contract.observe(call.input,request.player)});
  const reply=port.respond(delivery.view,request,action);
  if(!reply.valid)throw Error('Current benchmark policy returned an invalid action');
  return reply.output;
}

/** Formal benchmark entry. Policy/contract work is included and is reported;
 * comparison against independently driven reference games is outside timing. */
export async function benchmarkCards(workload:GameWorkload,lane=process.argv[2]??'card-controlled'){
  if(!['card-native','card-controlled','card-controlled-recorded','instance-native','instance-controlled','basegame-native','basegame-controlled'].includes(lane))throw Error('Unknown lane');
  const {definition,contract,reference,setups,players,choose}=workload;
  if(!setups.length)throw Error('Benchmark requires setups');
  const basegame=lane.startsWith('basegame'),program=new CardProgram(definition);
  const loaded:any=lane.startsWith('instance')||basegame?unwrap(await createCardLoader({controlled:lane.endsWith('-controlled')}).load(definition)):null;
  async function run(input:any,capture:boolean){
    const setup=structuredClone(input),calls:any[]|undefined=capture?[]:undefined;
    let result:unknown,decisions=0;
    const reply=(call:any)=>{
      const output=currentReply(contract,call,choose);decisions++;
      calls?.push({call:structuredClone(call),output:structuredClone(output)});return output;
    };
    const begin=performance.now();
    if(basegame){
      const game=await interactiveGame(loaded,contract,setup,players,choose,capture);
      return{ms:performance.now()-begin,game};
    }
    if(loaded){
      const instance=unwrap(await loaded.core.start(setup));
      try{
        let stop=unwrap(await instance.inspect());
        while(stop.kind==='call'){
          const output=reply(stop.call);
          unwrap(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:output})}));
          stop=unwrap(await instance.run()).state;
        }
        if(stop.kind!=='done')throw Error(JSON.stringify(stop));result=stop.result;
      }finally{unwrap(await instance.close());if(loaded.capture)unwrap(await loaded.capture.release(instance.id));}
    }else{
      const root=program.initial(setup,lane.startsWith('card-controlled')?1_000_000:Number.MAX_SAFE_INTEGER);
      const storage=lane.startsWith('card-controlled')?new CardGraph(root):plainCardStorage(root,structuredClone),trace=new Records();
      try{
        const machine=new CardMachine(program,storage,lane==='card-controlled-recorded'?event=>trace.push(event):undefined);
        let stop=machine.advance();while(stop.kind==='call')stop=machine.advance(reply(stop.call));
        if(stop.kind!=='done')throw Error(JSON.stringify(stop));result=stop.result;
      }finally{storage.close?.();}
    }
    return{ms:performance.now()-begin,result,calls,decisions};
  }
  const oracle=basegame?unwrap(await createNativeLoader().load(reference.program)):null;
  for(const setup of setups){
    if(basegame){
      const expected=await interactiveGame(oracle,reference.contract,structuredClone(setup),players,choose,true);
      assert.deepEqual((await run(setup,true)).game,expected);
    }else{
      const calls:any[]=[];
      const result=await reference.program.run(structuredClone(setup),{async call(call:any){
        const output=currentReply(reference.contract,call,choose);
        calls.push({call:structuredClone(call),output:structuredClone(output)});return output;
      }});
      const actual=await run(setup,true);assert.deepEqual(actual.result,result);assert.deepEqual(actual.calls,calls);assert.equal(actual.decisions,calls.length);
    }
  }
  for(let i=0;i<8;i++)await run(setups[i%setups.length],false);
  const samples:number[]=[];for(let i=0;i<24;i++)samples.push((await run(setups[i%setups.length],false)).ms);
  const sorted=[...samples].sort((a,b)=>a-b);
  const report={rule:definition.id,lane,node:process.version,workload:'current-request-policy',includesPolicy:true,games:samples.length,
    medianMs:(sorted[11]!+sorted[12]!)/2,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],
    peakRssMB:process.resourceUsage().maxRSS/1024,heapUsedMB:process.memoryUsage().heapUsed/1e6,samples};
  console.log(JSON.stringify(report));return report;
}
