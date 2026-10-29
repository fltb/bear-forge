import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Session} from 'node:inspector/promises';
import {parseArgs} from 'node:util';
import {CardMachine,CardProgram} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import type {Frame,Setup,Ports} from '../src/game.schemas.ts';

// Every sample creates a fresh Context and derives its choices from the live
// legal actions. No saved action tape, historical run or alternative rules.
const {values}=parseArgs({options:{
  workload:{type:'string',default:'combat'},lane:{type:'string',default:'core'},
  character:{type:'string',default:'both'},seed:{type:'string',default:'130'},
  encounter:{type:'string',default:'CULTIST_AND_CHOSEN'},
  samples:{type:'string',default:'5'},warmup:{type:'string',default:'3'},
  'detailed-events':{type:'boolean',default:false},verify:{type:'boolean',default:false},
  profile:{type:'string'},
}});
const integer=(value:string,name:string)=>{const number=Number(value);assert.ok(Number.isSafeInteger(number)&&number>=0,name);return number;};
const samples=integer(values.samples,'samples'),warmup=integer(values.warmup,'warmup');
assert.ok(samples>0);assert.ok(['combat','run'].includes(values.workload));assert.ok(['core','basegame'].includes(values.lane));
assert.ok(['ironclad','volibear','both'].includes(values.character));
assert.ok(values.lane==='core'||values.workload==='run','BaseGame benchmark uses the complete production entry');
const characters:('ironclad'|'volibear')[]=values.character==='both'?['ironclad','volibear']:[values.character as 'ironclad'|'volibear'];
assert.ok(!values.profile||characters.length===1,'Profile one character per process so later warmups are excluded');
const budget=100_000_000;
const loadStart=performance.now();
const definition=values.workload==='run'?(await import('../src/card.ts')).cardDefinition:
  (await import('./combat-content-fixture.ts')).combatContentDefinition;
const {encounterId}=await import('../src/identifiers.ts');
const encounter=encounterId[values.encounter as keyof typeof encounterId];
assert.notEqual(encounter,undefined,'Unknown encounter');
// The two fixtures have different setup schemas; setup() supplies the selected
// schema's fields. Both execute exactly the same production Ports and Frame.
const program=values.lane==='core'?new CardProgram<{},any,Ports,Frame>(definition):null;
const setup=(character:'ironclad'|'volibear')=>({seed:values.seed,character,detailedEvents:values['detailed-events'],
  ...(values.workload==='combat'?{encounter,relics:[],potion:null,durable:true,elite:false}:{})});
const choose=(actions:readonly {bits:number}[],decision:number)=>{
  assert.ok(actions.length,'Current Context must offer legal actions');
  if(values.workload==='combat')return actions.find(action=>(action.bits>>>29)===0)??actions.at(-1)!;
  return actions[(decision*17+Number(BigInt(values.seed)%BigInt(actions.length)))%actions.length]!;
};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Result={initMs:number;executeMs:number;executeCpuMs:number;executeInvoluntarySwitches:number;closeMs:number;actionMs:number[];steps:number|null;initSteps:number|null;executeSteps:number|null;decisions:number;events:number;checksum:number;finalHash:string;transcriptHash:string|null;terminal:unknown};

function core(character:'ironclad'|'volibear',verify:boolean):Result{
  const started=performance.now(),storage=privateCardGraph(program!.initial(setup(character),budget));
  const machine=new CardMachine(program!,storage),transcript=verify?createHash('sha256'):null;
  let stop=machine.advance();
  const initialized=performance.now(),remainingAtStart=machine.root.budget,initSteps=budget-remainingAtStart,actionMs:number[]=[];
  const cpuStart=process.cpuUsage(),switchesStart=process.resourceUsage().involuntaryContextSwitches;
  let decisions=0,events=0,checksum=0;
  try{
    for(;;){
      transcript?.update(JSON.stringify(stop));
      if(stop.kind==='done')break;
      if(stop.kind==='fault')throw Error(JSON.stringify(stop.error));
      if(stop.call.port==='event'){events+=stop.call.input.length;stop=machine.advance(null);continue;}
      assert.equal(stop.call.port,'decision');
      assert.ok(decisions<10_000,'Decision limit is a failure, never a terminal result');
      const action=choose(stop.call.input.actions,decisions++);checksum=(Math.imul(checksum,31)+action.bits)|0;
      const before=performance.now();stop=machine.advance(action);actionMs.push(performance.now()-before);
    }
    const finished=performance.now(),frame=stop.result as Frame,steps=budget-machine.root.budget,executeSteps=remainingAtStart-machine.root.budget;
    const cpu=process.cpuUsage(cpuStart),executeCpuMs=(cpu.user+cpu.system)/1000,executeInvoluntarySwitches=process.resourceUsage().involuntaryContextSwitches-switchesStart;
    assert.ok(decisions>0);assert.equal(frame.battle,null,'Combat must finish through the original cleanup');
    if(values.workload==='run')assert.ok(frame.game.outcome===0||frame.game.outcome===2);
    const finalHash=hash(frame),transcriptHash=transcript?.digest('hex')??null;
    const closeStart=performance.now();storage.close();
    return{initMs:initialized-started,executeMs:finished-initialized,executeCpuMs,executeInvoluntarySwitches,closeMs:performance.now()-closeStart,actionMs,steps,initSteps,executeSteps,decisions,events,checksum,finalHash,transcriptHash,
      terminal:{outcome:frame.game.outcome,floor:frame.game.floor,hp:frame.game.hp}};
  }catch(error){storage.close();throw error;}
}

const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
async function hostRunner(){
  const [{createCardLoader},{createGameBinder},{contract}]=await Promise.all([
    import('@bear-forge/runtime-card'),import('@bear-forge/game-host'),import('../src/contract.ts'),
  ]);
  const {cardDefinition}=await import('../src/card.ts');
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,stepBudget:budget}).load(cardDefinition));
  return async(character:'ironclad'|'volibear',verify:boolean):Promise<Result>=>{
    const started=performance.now(),instance=unwrap(await loaded.core.start(setup(character) as Setup));
    const game=unwrap(await createGameBinder().bind({instance,contract}));
    const transcript=verify?createHash('sha256'):null;
    let decisions=0,events=0,checksum=0;
    const actionMs:number[]=[];
    unwrap(await game.bind({player:'0',onRequest:async request=>{
      assert.equal(request.options.kind,'exact');if(request.options.kind!=='exact')throw Error('Expected exact legal choices');
      transcript?.update(JSON.stringify({observation:request.observation,options:request.options}));
      const action=choose(request.options.values,decisions++);checksum=(Math.imul(checksum,31)+action.bits)|0;
      return{kind:'reply',value:action};
    },onEvent:async event=>{events++;transcript?.update(JSON.stringify(event.event));return{kind:'reply',value:null};}}));
    const initialized=performance.now();
    const cpuStart=process.cpuUsage(),switchesStart=process.resourceUsage().involuntaryContextSwitches;
    try{
      let state=unwrap(await game.inspect());
      while(state.kind!=='ended'){
        if(state.kind==='fault')throw Error(JSON.stringify(state.error));
        assert.ok(decisions<10_000,'Decision limit reached');
        const before=performance.now(),result=unwrap(await game.run());actionMs.push(performance.now()-before);
        assert.equal(result.pause,null);state=result.state;
      }
      const finished=performance.now();
      const cpu=process.cpuUsage(cpuStart),executeCpuMs=(cpu.user+cpu.system)/1000,executeInvoluntarySwitches=process.resourceUsage().involuntaryContextSwitches-switchesStart;
      const observation=unwrap(await game.observe({player:'0'}));
      assert.equal(observation.battle,null);assert.ok(decisions>0);
      const finalHash=hash({result:state.result,observation}),transcriptHash=transcript?.digest('hex')??null;
      const closeStart=performance.now();unwrap(await game.close());
      return{initMs:initialized-started,executeMs:finished-initialized,executeCpuMs,executeInvoluntarySwitches,closeMs:performance.now()-closeStart,actionMs,steps:null,initSteps:null,executeSteps:null,decisions,events,checksum,finalHash,transcriptHash,terminal:state.result};
    }catch(error){await game.close();throw error;}
  };
}
const run=values.lane==='core'?core:await hostRunner();
const assemblyMs=performance.now()-loadStart;
const quantile=(numbers:number[],fraction:number)=>{
  const sorted=[...numbers].sort((a,b)=>a-b);
  if(!sorted.length)return 0;
  if(fraction===.5){const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]!:(sorted[middle-1]!+sorted[middle]!)/2;}
  return sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1))]!;
};
let profiler:Session|undefined;
for(const character of characters){
  for(let i=0;i<warmup;i++)await run(character,false);
  if(values.profile&&!profiler){profiler=new Session();profiler.connect();await profiler.post('Profiler.enable');await profiler.post('Profiler.start');process.stderr.write(JSON.stringify({profilePhase:'start',character,timeMs:performance.now()})+'\n');}
  const results:Result[]=[];
  for(let i=0;i<samples;i++)results.push(await run(character,values.verify));
  const first=results[0]!;
  for(const result of results)for(const key of ['steps','initSteps','executeSteps','decisions','events','checksum','finalHash','transcriptHash'] as const)assert.equal(result[key],first[key],`Independent sample differs: ${key}`);
  console.log(JSON.stringify({node:process.version,v8:process.versions.v8,workload:values.workload,lane:values.lane,character,seed:values.seed,
    encounter:values.workload==='combat'?values.encounter:null,detailedEvents:values['detailed-events'],warmup,samples,assemblyMs,
    // Verification includes complete-publication hashing and is never a timing score.
    timingValid:!values.verify&&!values.profile,profilingEnabled:!!values.profile,includesPolicy:true,
    profileScope:values.profile?'post-warmup samples including Context initialization, execution, final hashing, close and reporting; excludes Program assembly and warmup':null,
    initializationScope:'fresh Context through first IO',executionScope:'current-action policy, rule execution and event delivery; excludes final hashing and close',
    medianInitMs:quantile(results.map(r=>r.initMs),.5),medianExecuteMs:quantile(results.map(r=>r.executeMs),.5),
    medianExecuteCpuMs:quantile(results.map(r=>r.executeCpuMs),.5),cpuScope:'process user + system, including GC worker CPU',
    medianCloseMs:quantile(results.map(r=>r.closeMs),.5),actionP95Ms:quantile(results.flatMap(r=>r.actionMs),.95),actionMaxMs:Math.max(...results.flatMap(r=>r.actionMs)),
    steps:first.steps,stepScope:'initialization + execution',initSteps:first.initSteps,executeSteps:first.executeSteps,
    decisions:first.decisions,events:first.events,checksum:first.checksum,finalHash:first.finalHash,transcriptHash:first.transcriptHash,terminal:first.terminal,
    executeSamplesMs:results.map(r=>r.executeMs),executeCpuSamplesMs:results.map(r=>r.executeCpuMs),executeInvoluntarySwitches:results.map(r=>r.executeInvoluntarySwitches),
    peakRssMiB:process.resourceUsage().maxRSS/1024,heapUsedMiB:process.memoryUsage().heapUsed/1048576}));
}
if(profiler){process.stderr.write(JSON.stringify({profilePhase:'end',timeMs:performance.now()})+'\n');const {profile}=await profiler.post('Profiler.stop');profiler.disconnect();await writeFile(values.profile!,JSON.stringify(profile));}
