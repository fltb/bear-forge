import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {productionDriver} from './production-driver.ts';
import {oracleView} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {publishReference} from './reference/publication.ts';
import {assertSameState} from './reference/compare.ts';
import {revision} from './reference/build.ts';
import type {Trace} from './reference/play.ts';

// Fixtures are independently acquired from normal starts by reference/play.ts.
// Missing wins fail acceptance; this test never substitutes an injected battle.
const directory=new URL('./reference/fixtures/',import.meta.url);
const names=(await readdir(directory)).filter(name=>/^ironclad-a20-heart-\d+\.json$/.test(name));
const traces=await Promise.all(names.map(async name=>JSON.parse(await readFile(new URL(name,directory),'utf8')) as Trace));
test('fixture set contains at least three distinct independently won normal Ironclad A20 Heart seeds',()=>{
  assert.ok(new Set(traces.map(t=>t.seed)).size>=3,'Three distinct independently won seeds are required');
});
for(const trace of traces)test(`normal Ironclad A20 Heart seed=${trace.seed} compares native, controlled and C++ at every boundary`,async()=>{
    assert.equal(trace.reference,revision);assert.equal(trace.character,'IRONCLAD');assert.equal(trace.ascension,20);
    const ref=await ReferenceClient.create(),native=productionDriver(trace.seed),controlled=productionDriver(trace.seed,true);
    const bosses=new Set<number>();let act4Elite=false;
    try{let source=await ref.call({op:'start',seed:trace.seed});
      for(let index=0;index<=trace.actions.length;index++){
        const history=trace.actions.slice(0,index),expected=publishReference(source,history),label=`seed=${trace.seed} decision=${index} floor=${source.game.floor} screen=${source.game.screen} event=${source.game.eventName} encounter=${source.battle?.encounter}`;
        for(const driver of [native,controlled]){
          const frame=driver.frame(),privateState=oracleView(driver.machine.root.state,frame);
          assertSameState(expected,frame,label+' public');assertSameState(source.game,privateState.game,label+' game');assertSameState(source.battle,privateState.battle,label+' battle');
        }
        if(source.battle&&source.game.act===3&&source.game.room==='BOSS')bosses.add(source.battle.encounter);
        if(source.battle&&source.game.act===4&&source.game.room==='ELITE')act4Elite=true;
        if(index===trace.actions.length){assert.equal(source.heartDefeated,true);assert.equal(source.game.outcome,2);assert.deepEqual(source.game.keys,{red:true,green:true,blue:true});assert.equal(bosses.size,2);assert.equal(act4Elite,true);assert.equal(native.machine.root.stop?.kind,'done');assert.equal(controlled.machine.root.stop?.kind,'done');break;}
        const action=trace.actions[index]!;assert.equal(action.kind,source.battle?'battle':'game');
        assert.ok(source.actions.some(a=>a.bits===action.bits),label+' action must be legal');
        native.advance(action.bits);controlled.advance(action.bits);source=await ref.call({op:'advance',bits:action.bits});
      }
    }finally{native.close();controlled.close();await ref.close();}
});

for(let script=0;script<3;script++)test(`16 normal-start seed smoke traces compare full boundary relation; script=${script}`,async()=>{
  const ref=await ReferenceClient.create();
  try{for(const seed of [...Array.from({length:8},(_,i)=>i),...Array.from({length:8},(_,i)=>10000+i)]){
    const native=productionDriver(String(seed)),controlled=productionDriver(String(seed),true);
    try{let source=await ref.call({op:'start',seed:String(seed)});let decisions=0;
      for(;;){
        const label=`seed=${seed} script=${script} decision=${decisions} floor=${source.game.floor} screen=${source.game.screen} event=${source.game.eventName} encounter=${source.battle?.encounter}`,expected=publishReference(source,native.frame().history);
        for(const driver of [native,controlled]){const frame=driver.frame(),state=oracleView(driver.machine.root.state,frame);assertSameState(expected,frame,label);assertSameState(source.game,state.game,label+' game');assertSameState(source.battle,state.battle,label+' battle');}
        if(source.game.outcome!==1){assert.equal(native.machine.root.stop?.kind,'done');break;}
        assert.ok(source.actions.length>0,label+' must expose a legal move');assert.ok(decisions<10000,label+' did not terminate');
        const index=script===0?0:script===1?source.actions.length-1:(Math.imul(decisions+1,17)+seed)%source.actions.length;
        const bits=source.actions[index]!.bits;try{native.advance(bits);controlled.advance(bits);}catch(error){throw Error(label+' action='+JSON.stringify(source.actions[index]),{cause:error});}source=await ref.call({op:'advance',bits});decisions++;
      }
    }finally{native.close();controlled.close();}
  }}finally{await ref.close();}
});
