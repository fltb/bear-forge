// Fresh process fixture: no recorded actions are ever executed to reconstruct a state.
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {CardProgram} from '@bear-forge/card-engine';
import {createSimulator,openSimulator} from '../src/simulator.ts';
import {openSimulatorStore} from '../src/simulator-store.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {encounterId} from '../src/identifiers.ts';
import {describeAction} from '../src/presentation.ts';
const [mode,path]=process.argv.slice(2);if(!mode||!path)throw Error('mode/path required');
const resume=mode.endsWith('resume'),store=await openSimulatorStore(path,resume?'resume':'new');
let session;
try{
  if(mode.startsWith('middle')){
    const snapshots=memorySnapshotStore(),loadedResult=await createCardLoader({controlled:true,recordCore:false,snapshots,instructionsPerSlice:100_000}).load(combatContentDefinition);
    if(!loadedResult.ok)throw Error(JSON.stringify(loadedResult.error));
    if(resume)CardProgram.prototype.initial=function(){throw Error('Restore must never initialize a game');};
    session=await openSimulator({store,resume,kernel:{loaded:loadedResult.value,snapshots,program:'original-combat-fixture/1',character:'ironclad'},setup:{seed:'574853884',detailedEvents:true,encounter:encounterId.CULTIST,relics:[],potion:null,durable:false,elite:false,bottledCard:'SECRET_TECHNIQUE'}});
    if(!resume){
      const {state}=await session.observe(),options=state.request!.options;if(options.kind!=='exact')throw Error('exact');
      const action=options.values.find(a=>{const p=describeAction(state.observation,(a as {bits:number}).bits);return p.kind==='play-card'&&(p.details.card as {id:string}).id==='SECRET_TECHNIQUE';});
      if(!action)throw Error('Missing bottled card');
      const response=await session.act({id:'secret-technique',sessionId:state.sessionId,revision:state.revision,action});if(!response.accepted||!response.saved)throw Error('not committed');
    }
  }else{
    if(resume)CardProgram.prototype.initial=function(){throw Error('Restore must never initialize a game');};
    session=await createSimulator({store,resume,setup:{character:'ironclad',seed:'574853884'}});
  }
  const before=await session.observe();
  if(resume){
    const options=before.state.request!.options;if(options.kind!=='exact')throw Error('exact');
    const response=await session.act({id:'after-resume',sessionId:before.state.sessionId,revision:before.revision,action:options.values[0]});if(!response.accepted)throw Error(response.reason);
    console.log(JSON.stringify({before,after:response.batch}));
  }else console.log(JSON.stringify({before}));
  await session.close();
}catch(error){await session?.close();await store.close();throw error;}
