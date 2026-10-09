import assert from 'node:assert/strict';
import { plays, key } from '../../games/doudizhu/src/patterns.ts';
import { oracle } from '../../tests/doudizhu/oracle.ts';
import { doudizhu, pack, unpack } from '../../games/doudizhu/src/index.ts';
import { Contracts, ProgramToolkitApi, StageWitnessSchema } from '../../packages/contracts/src/index.ts';

// Audit-only peer for the PUBLIC toolkit. No production runtime or alternate game loop.
const findings=[];
const ok = response => { assert.equal(response.status,'ok'); return response.data; };
async function run({first='0', reverse=false, doubles=[false,false], redouble=false, timeout=false, seed=10}={}) {
  let rng=seed, previous=null, pending=null, turns=0, requests=0, randomCalls=0;
  const frames=[], replies=[], incremental=[];
  const toolkit={
    async record(){throw new Error('unexpected toolkit.record');},
    async randomInt(req){
      const {input}=ProgramToolkitApi.randomInt.request.parse(req);randomCalls++;
      rng=(Math.imul(rng,1664525)+1013904223)>>>0;
      return {status:'ok',data:input.min+rng%(input.maxExclusive-input.min)};
    },
    async request(req){
      assert.equal(req.input.channel,doudizhu.channel);
      const f=unpack('frame',req.input.payload);frames.push(f);incremental.push(...f.boundary.records);
      if(previous)StageWitnessSchema.parse({before:previous.boundary.stage,after:f.boundary});
      previous=f;assert.ok(++requests<600);
      assert.deepEqual(ok(await doudizhu.hooks.facts({protocol:'0.2',input:{frame:f}})),f.boundary.records);
      if(replies.length)assert.equal((await doudizhu.hooks.validate({protocol:'0.2',input:{frame:f,input:replies.at(-1)}})).status,'error');
      const b=f.boundary,s=unpack('state',f.state);
      let slot=b.stage.slots[reverse?b.stage.slots.length-1:0], input;
      // Submit the other farmer's already prepared input after the first submission.
      if(pending){input=pending;pending=null;slot=b.stage.slots.find(x=>x.slotId===input.slotId);assert.ok(slot);}
      else if(timeout && s.phase!=='bidding'){
        input={kind:'host',boundaryKey:b.stage.boundaryKey,inputType:'timeout',gameTime:slot.deadline.atGameTime,payload:pack('timeout',{slotId:slot.slotId})};
      } else {
        let action;
        if(s.phase==='bidding')action={kind:'bid',value:3};
        else if(s.phase==='doubling'){
          const farmers=['0','1','2'].filter(a=>a!==first);
          action={kind:'double',value:doubles[farmers.indexOf(slot.actor)]};
          const other=b.stage.slots.find(x=>x.actor!==slot.actor);
          if(other)pending={kind:'action',stageId:b.stage.stageId,slotId:other.slotId,actor:other.actor,receivedAtGameTime:s.now,action:pack('action',{kind:'double',value:doubles[farmers.indexOf(other.actor)]})};
        } else if(s.phase==='redoubling')action={kind:'redouble',value:redouble};
        else {
          turns++;
          const response=ok(await doudizhu.hooks.actions({protocol:'0.2',input:{frame:f,actor:slot.actor,stageId:b.stage.stageId,slotId:slot.slotId,query:{kind:'extreme',side:'last'}}}));
          action=unpack('action',response.action);
        }
        input={kind:'action',stageId:b.stage.stageId,slotId:slot.slotId,actor:slot.actor,receivedAtGameTime:s.now,action:pack('action',action)};
      }
      // Player observers receive projections; supervisor alone has private frame.
      for(const actor of ['0','1','2']){
        const view=ok(await doudizhu.hooks.view({protocol:'0.2',input:{frame:f,actor}}));
        assert.deepEqual(view.events,s.events.filter(e=>e.audience==='public'||e.audience===actor).map(e=>pack('visibleEvent',e.event)));
        assert.deepEqual(unpack('observation',view.observation).hand,s.hands[actor]);
      }
      ok(await doudizhu.hooks.validate({protocol:'0.2',input:{frame:f,input}}));replies.push(input);
      return {status:'ok',data:pack('input',input)};
    },
  };
  const result=unpack('frame',await doudizhu.program(pack('start',{setup:pack('setup',{profile:'competitive-2016-bear-1',firstBidder:first}),initialGameTime:0}),toolkit));
  StageWitnessSchema.parse({before:previous.boundary.stage,after:result.boundary});
  incremental.push(...result.boundary.records);
  const s=unpack('state',result.state);
  assert.equal(result.boundary.kind,'terminal');assert.equal(Object.values(s.result.scores).reduce((a,b)=>a+b,0),0);
  assert.deepEqual(incremental,s.events.map(e=>pack('event',e)));
  for(const actor of ['0','1','2'])assert.deepEqual(ok(await doudizhu.hooks.reward({protocol:'0.2',input:{frame:result,actor}})),{value:s.result.scores[actor],terminal:true});
  return {result,frames,replies,randomCalls,turns};
}
let games=0;
for(const first of ['0','1','2'])for(const a of [false,true])for(const b of [false,true])for(const redouble of [false,true]){
  const left=await run({first,doubles:[a,b],redouble});
  const right=await run({first,doubles:[a,b],redouble,reverse:true});
  assert.deepEqual(left.result.boundary.result,right.result.boundary.result);
  games+=2;
}
findings.push({check:'48 full games: 3 landlords x 4 double choices x 2 redouble choices x 2 submission orders',status:'pass',games,note:'When neither farmer doubles, redouble phase is correctly skipped. Pending peer action constructed before first submission remains valid.'});
for(const first of ['0','1','2'])await run({first,timeout:true});
findings.push({check:'3 full games: bid3 then only public host timeout inputs',status:'pass'});
const concurrent=await Promise.all([run({seed:21}),run({seed:22,first:'1'}),run({seed:23,first:'2'})]);
const sequential=[await run({seed:21}),await run({seed:22,first:'1'}),await run({seed:23,first:'2'})];
assert.deepEqual(concurrent,sequential);
findings.push({check:'3 interleaved games equal 3 sequential games',status:'pass',note:'Tests async program instance isolation only, not Session/Runner'});
const f=structuredClone(concurrent[0].result), forged=unpack('result',f.boundary.result);
forged.scores['0']+=1; f.boundary.result=pack('result',forged);
const inconsistent=await doudizhu.hooks.reward({protocol:'0.2',input:{frame:f,actor:'0'}});
assert.equal(inconsistent.status,'ok');
assert.notEqual(inconsistent.data.value,forged.scores['0']);
findings.push({check:'terminal frame contains conflicting result and state.result',status:'confirmed-gap',actual:'reward succeeds using state.result while boundary.result disagrees',scope:'Trusted-frame integrity; not a demonstrated player exploit'});
let subsets=0;
for(const hand of [
  [3,3,3,4,4,4,5,5,5,6,6,6,8,8,9,9,10,10,11,11],
  [3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,15,15,16,17],
  [3,4,5,6,7,8,9,10,11,12,13,14,15,15,15,16,17],
]){
  const groups=[...new Set(hand)].map(rank=>[rank,hand.filter(v=>v===rank).length]);
  const expected=new Set();
  function visit(i,cards){
    if(i===groups.length){if(cards.length){subsets++;for(const p of oracle(cards))expected.add(`${cards.join(',')}|${key(p)}`);}return;}
    const [rank,n]=groups[i];for(let count=0;count<=n;count++)visit(i+1,[...cards,...Array(count).fill(rank)]);
  }
  visit(0,[]);
  const actual=new Set(plays(hand,null).map(p=>`${p.cards.join(',')}|${key(p.pattern)}`));
  assert.deepEqual([...actual].sort(),[...expected].sort());
}
findings.push({check:'3 additional 17/20-card hands against independent oracle, exhaustive rank submultisets',status:'pass',subsets});
findings.push({check:'formal API inventory',operations:Object.fromEntries(Object.entries(Contracts).map(([name,ops])=>[name,Object.keys(ops)]))});
console.log(JSON.stringify({games:57,findings},null,2));
