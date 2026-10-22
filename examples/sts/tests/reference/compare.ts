import assert from 'node:assert/strict';

export type Difference={path:string;expected:unknown;actual:unknown};
/** JSON state relation: preserve every field, array position, primitive and identity field. */
export function firstDifference(expected:unknown,actual:unknown,path='state'):Difference|null {
  if(Object.is(expected,actual))return null;
  if(expected===null || actual===null || typeof expected!=='object' || typeof actual!=='object')return {path,expected,actual};
  if(Array.isArray(expected)!==Array.isArray(actual))return {path,expected,actual};
  if(Array.isArray(expected) && Array.isArray(actual)) {
    if(expected.length!==actual.length)return {path:path+'.length',expected:expected.length,actual:actual.length};
    for(let i=0;i<expected.length;i++){const d=firstDifference(expected[i],actual[i],`${path}[${i}]`);if(d)return d;}
    return null;
  }
  const e=expected as Record<string,unknown>,a=actual as Record<string,unknown>;
  for(const key of Object.keys(e)) {
    if(!Object.hasOwn(a,key))return {path:path+'.'+key,expected:e[key],actual:undefined};
    const d=firstDifference(e[key],a[key],path+'.'+key);if(d)return d;
  }
  for(const key of Object.keys(a))if(!Object.hasOwn(e,key))return {path:path+'.'+key,expected:undefined,actual:a[key]};
  return null;
}
export function assertSameState(expected:unknown,actual:unknown,context:string) {
  const difference=firstDifference(expected,actual);
  assert.equal(difference,null,`${context}: ${JSON.stringify(difference)}`);
}

/** Explicit opt-in; a source directory by itself never enables C++ execution. */
export function cppComparisonEnabled(){
  const value=process.env.STS_COMPARE_CPP;
  if(value!==undefined&&value!=='0'&&value!=='1')throw Error('STS_COMPARE_CPP must be 0 or 1');
  return value==='1';
}

/** One live BaseGame Context, optionally paired with C++. No tape or replay. */
export async function compareRun(seed:string,{differential=false,compareCpp=false,maxDecisions=20_000}:{differential?:boolean;compareCpp?:boolean;maxDecisions?:number}={}) {
  const [{createCardLoader,memorySnapshotStore},{createGameBinder},{cardDefinition},{contract,observe},{ReferenceClient},{publishReference}]=await Promise.all([
    import('@bear-forge/runtime-card'),import('@bear-forge/game-host'),import('../../src/card.ts'),import('../../src/contract.ts'),import('./client.ts'),import('./publication.ts'),
  ]);
  if(differential)(await import('./client.ts')).requireDifftest();
  const unwrap=<T,E>(r:import('@bear-forge/contracts/instance').Outcome<T,E>):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const store=memorySnapshotStore();
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,stepBudget:100_000_000,snapshots:store}).load(cardDefinition));
  const instance=unwrap(await loaded.core.start({character:'ironclad',seed}));
  const bind=()=>createGameBinder().bind({instance,contract,persistence:loaded.persistence!});
  let game:Extract<Awaited<ReturnType<typeof bind>>,{ok:true}>['value']|undefined;
  let reference:InstanceType<typeof ReferenceClient>|undefined;
  let pending:{bits:number}|null=null;
  try {
    game=unwrap(await bind());
    const active=game;
    unwrap(await active.bind({player:'0',onRequest:async()=>{
      if(pending===null)return{kind:'pause'};
      const value=pending;pending=null;return{kind:'reply',value};
    },onEvent:async()=>({kind:'reply',value:null})}));
    let source:import('./client.ts').ReferenceState|null=null,decisions=0;
    if(compareCpp||differential){
      reference=await ReferenceClient.create();
      source=await reference.call({op:'start',seed,resultOnly:!differential});
    }
    unwrap(await active.run());
    for(;;){
      const status=unwrap(await active.inspect());
      if(status.kind==='fault')throw Error(`seed=${seed} decision=${decisions}: ${JSON.stringify(status.error)}`);
      if(differential){
        assert.ok(source);
        // Inspect the current Context only in explicit diagnostics. Release each
        // snapshot immediately; never restore or execute its history.
        const snapshot=unwrap(await active.save!());
        try{
          const bytes=await store.get(snapshot.snapshotId);assert.ok(bytes);
          const {deserialize}=await import('node:v8');
          const data=deserialize(bytes),stop=data.state;
          assert.ok(stop.kind==='done'||stop.kind==='call'&&stop.call.port==='decision');
          const frame:import('../../src/game.schemas.ts').Frame=stop.kind==='done'?stop.result:stop.call.input;
          const {oracleView}=await import('../state-inspection.ts');
          const state=oracleView(data.root.state,frame),label=`seed=${seed} decision=${decisions} floor=${frame.game.floor} screen=${frame.game.screen} relics=${JSON.stringify(frame.game.relics)}`;
          assert.equal(frame.history.length,decisions,label+' history length');
          assertSameState(publishReference(source,frame.history),frame,label+' public frame');
          assertSameState(source.game,state.game,label+' private game');
          assertSameState(source.battle,state.battle,label+' private battle');
        }finally{unwrap(await loaded.persistence!.release(snapshot));}
      }
      if(status.kind==='ended'){
        const actual=unwrap(await active.observe({player:'0'}));
        assert.ok(decisions>0,`seed=${seed}: a clean run must actually advance`);
        assert.equal(actual.battle,null,`seed=${seed}: combat must have settled`);
        assert.ok(actual.game.outcome===0||actual.game.outcome===2,`seed=${seed}: terminal rule outcome required`);
        assert.equal(status.result.outcome==='death',actual.game.hp===0,`seed=${seed}: death must match HP`);
        if(status.result.heartDefeated){assert.equal(status.result.outcome,'victory');assert.equal(status.result.act,4);}
        if(reference){
          if(!differential)source=await reference.call({op:'inspect'});
          assert.ok(source);
          assert.notEqual(source.game.outcome,1,`seed=${seed}: C++ must also be terminal`);
          const expected={outcome:source.game.outcome===0?'death':'victory',heartDefeated:source.heartDefeated,act:source.game.act,floor:source.game.floor,hp:source.game.hp};
          assertSameState(expected,status.result,`seed=${seed} final result`);
          assertSameState(observe(publishReference(source,[])).game,actual.game,`seed=${seed} final game`);
          assert.equal(source.battle,null,`seed=${seed} final battle`);
          assert.equal(source.decisions,decisions,`seed=${seed} final decision count`);
        }
        return {seed,decisions,result:status.result};
      }
      assert.equal(status.kind,'request',`seed=${seed}: expected input or terminal result`);
      if(status.kind!=='request')throw Error('Missing STS decision');
      assert.ok(decisions<maxDecisions,`seed=${seed}: decision limit reached without a terminal result`);
      const request=status.requests[0];assert.ok(request);
      const options=unwrap(await active.describe({requestId:request.id,type:'action'}));
      assert.equal(options.kind,'exact');if(options.kind!=='exact'||!options.values.length)throw Error('Missing legal STS actions');
      // Deterministic online fixture choices, derived only from currently offered
      // actions. This is engineering validation, not the human/agent card review.
      const offset=Number(BigInt(seed)%BigInt(options.values.length));
      const action=options.values[(decisions*17+offset)%options.values.length]!;
      pending=action;
      const advanced=unwrap(await active.run());assert.equal(advanced.accepted?.kind,'action');assert.equal(pending,null);
      if(reference){
        if(differential)source=await reference.call({op:'advance',bits:action.bits});
        else await reference.call<null>({op:'advance',bits:action.bits,resultOnly:true});
      }
      decisions++;
    }
  }finally{
    try{if(game)await game.close();else await instance.close();}
    finally{try{await loaded.capture?.release(instance.id);}finally{await reference?.close();}}
  }
}
