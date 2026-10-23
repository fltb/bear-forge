import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {rules} from '../src/rules/execution.ts';
import {typedValue} from '../src/rules/value.schemas.ts';
import {combatContentRules} from './combat-content-fixture.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {adventures} from '../src/rules/adventures.ts';
import {battles} from '../src/rules/battles.ts';
import {turns} from '../src/rules/turns.ts';
import {enemies} from '../src/rules/enemies.ts';
import {powers} from '../src/rules/powers.ts';
import {damage} from '../src/rules/damage.ts';
import {resources} from '../src/rules/resources.ts';
import {hitResultSchema} from '../src/rules/damage.schemas.ts';
import type {HitResult} from '../src/rules/damage.types.ts';
import type {TurnActor} from '../src/rules/turns.types.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
import {beyondEnemies} from '../src/content/enemies/beyond/enemies.ts';
import {cityEnemies} from '../src/content/enemies/city/enemies.ts';
import {combatEnemyPowers} from '../src/content/enemies/shared/combat-powers.ts';
import {cityPowers} from '../src/content/enemies/city/powers.ts';
import {beyondPowers} from '../src/content/enemies/beyond/powers.ts';
import {finalPowers} from '../src/content/enemies/ending/powers.ts';
import {enemyDeployment} from '../src/content/enemies/shared/deployment.ts';
import {moveId} from '../src/combat-identifiers.ts';
import {encounterId} from '../src/identifiers.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';

const setupSchema=programSchemas.setup.extend({scenario:z.enum(['blast','attack','multi','idle','lagavulin']),modified:z.boolean(),midHitStrength:z.boolean(),wakeDamage:z.number(),wakeAttack:z.boolean()});
type Setup=z.infer<typeof setupSchema>;
const {defineRules,defineQuery,defineEffect,defineComponent,defineEntity,sequence,call,when,on,install,updateLocalComponent}=rules;
// Position setup and observation only: production declarations, action executor,
// damage pipeline, combat queue and public adapter remain the systems under test.
const fixture=defineRules({requires:[combatContentRules,beyondEnemies,cityEnemies,enemyDeployment,basicPowers,combatEnemyPowers],build(m){
  const ready=defineComponent({schema:z.boolean(),initial:()=>false});
  const hits=defineComponent({schema:z.array(hitResultSchema),initial:()=>[]});
  const ownHits=defineQuery({input:z.number(),output:z.array(hitResultSchema),reads:[hits],base:(r,id)=>r.component(id,hits)});
  const observed=defineQuery({input:z.undefined(),output:z.array(hitResultSchema),reads:[hits],base:r=>r.entities(hits).flatMap(id=>r.component(id,hits))});
  const track=on(damage.exports.resolved,{
    condition:defineQuery({input:typedValue<rules.ReactionContext<HitResult,Setup>>(),output:z.boolean(),dependencies:[resources.exports.side],base:(r,c)=>c.environment.scenario==='lagavulin'||c.event.source!==null&&r.query(resources.exports.side,c.event.source)===1}),
    effect:defineEffect<rules.ReactionContext<HitResult,Setup>,void>(b=>sequence(
      updateLocalComponent(b.read(v=>v.input.source),hits,b.read(v=>[...v.query(ownHits,v.input.source),v.input.event])),
      // A later hit must retain the amount captured before the queue began.
      when(b.read(v=>v.input.environment.midHitStrength&&v.input.event.source!==null),call(powers.exports.apply,{
        registry:b.read(v=>v.query(battles.exports.status,v.input.event.battle).registry),actor:b.read(v=>v.input.event.source!),definition:basicPowers.exports.Strength,amount:10,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),
      })),
    )),
  });
  const enter=on(turns.exports.idle,{
    condition:defineQuery({input:typedValue<rules.ReactionContext<TurnActor,Setup>>(),output:z.boolean(),reads:[ready],base:(r,c)=>!r.component(c.source,ready)}),
    effect:defineEffect<rules.ReactionContext<TurnActor,Setup>,void>(b=>{
      const actor=b.local<number>(),controller=b.local<number>();
      const board=(v:rules.ReadView<rules.ReactionContext<TurnActor,Setup>>)=>v.query(battles.exports.status,v.input.event.battle);
      return sequence(
        updateLocalComponent(b.read(v=>v.input.source),ready,true),
        call(adventures.exports.enableDetails,b.read(v=>v.query(combatSessions.exports.current,v.query(combatSessions.exports.forBattle,v.input.event.battle)!).run)),
        ...([
          ['multi',cityEnemies.exports.Byrd,moveId.BYRD_PECK],
          ['idle',beyondEnemies.exports.Repulsor,moveId.REPULSOR_REPULSE],
          ['blast',beyondEnemies.exports.Exploder,moveId.EXPLODER_EXPLODE],
          ['attack',beyondEnemies.exports.Exploder,moveId.EXPLODER_SLAM],
        ] as const).map(([scenario,definition,move])=>when(b.read(v=>v.input.environment.scenario===scenario),call(enemyDeployment.exports.deploy,{battle:b.read(v=>v.input.event.battle),slot:0,definition,hp:null,currentMove:move}))),
        b.assign(actor,b.read(v=>v.query(combatSessions.exports.current,v.query(combatSessions.exports.forBattle,v.input.event.battle)!).roster[0]!.actor!)),
        b.assign(controller,b.read(v=>v.query(enemies.exports.forActor,v.get(actor))!)),
        // Skip this round, allowing the normal turn controller to open the next
        // opportunity without executing the selected move before its preview.
        when(b.read(v=>v.input.environment.scenario!=='lagavulin'),call(enemies.exports.claim,controller)),
        // Use the real encounter's opening block/Metallicize and the production
        // damage pipeline. Do not fake wake-up by setting ASLEEP or the intent.
        when(b.read(v=>v.input.environment.scenario==='lagavulin'&&v.input.environment.wakeDamage>0),call(battles.exports.hit,{
          battle:b.read(v=>v.input.event.battle),source:b.read(v=>board(v).actor),target:actor,
          amount:b.read(v=>v.input.environment.wakeDamage),attack:b.read(v=>v.input.environment.wakeAttack),selfDamage:false,
        })),
        when(b.read(v=>v.input.environment.modified),sequence(
          ...[basicPowers.exports.Strength,basicPowers.exports.EnemyWeak].map((definition,index)=>call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor,definition,amount:index===0?3:9,source:null,debuff:index!==0,scope:b.read(v=>board(v).scope)})),
          call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor:b.read(v=>board(v).actor),definition:basicPowers.exports.PlayerVulnerable,amount:9,source:null,debuff:true,scope:b.read(v=>board(v).scope)}),
        )),
      );
    }),
  });
  const kind=m.kind({config:z.undefined(),setup:setupSchema,components:[],initialize:defineEffect<rules.EntityLifecycle<Setup>,void>(b=>sequence(...[enter,track].map(ability=>install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:b.read(v=>v.input.setup),lifetime:0}))))});
  const anchor=defineEntity(kind,undefined,{components:[ready,hits]});
  const entry=defineEffect<Setup,Frame>(b=>{const result=b.local<Frame>();return sequence(
    rules.spawnEntity({definition:anchor,owner:null,scope:0,setup:b.input}),
    b.assign(result,call(combatContentRules.exports.entry,{seed:b.read(v=>v.input.seed),encounter:b.read(v=>v.input.scenario==='lagavulin'?encounterId.LAGAVULIN:encounterId.TWO_LOUSE),relics:[],potion:null,durable:true,elite:false})),b.return(result),
  );});
  return{exports:{entry,observed}};
}});
const definition=linkRules<{},Setup,Ports,Frame>({id:'sts/enemy-intent-source',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
const program=new CardProgram(definition),END=(4<<29)>>>0;
function driver(scenario:Setup['scenario'],modified:boolean,midHitStrength=false,wakeDamage=0,wakeAttack=true){
  const storage=privateCardGraph(program.initial({seed:'130',scenario,modified,midHitStrength,wakeDamage,wakeAttack},100_000_000)),machine=new CardMachine(program,storage);let stop=machine.advance();
  function frame():Frame{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;}
  const query=<I,O>(q:Parameters<typeof inspectRuleQuery<I,O>>[2],input:I)=>inspectRuleQuery(definition,machine.root.state,q,input);
  function act(bits:number){assert.ok(frame().actions.some(a=>a.bits===bits));stop=machine.advance({bits});return frame();}
  return{frame,query,act,close:()=>storage.close()};
}

for(const scenario of ['blast','attack','multi','idle'] as const)for(const modified of [false,true]){
  test(`intent resolves the same category and amount as execution: ${scenario}, modifiers=${modified}`,()=>{
    const d=driver(scenario,modified);try{
      // The deployed enemy is correctly ineligible this round. The first END
      // opens the next ordinary opportunity, where preview and execution agree.
      d.act(END);
      const run=d.query(adventures.exports.instances,undefined)[0]!,session=d.query(combatSessions.exports.current,d.query(combatSessions.exports.forRun,run)!);
      const actor=session.roster[0]!.actor!,controller=session.roster[0]!.controller!;
      const intent=d.query(enemies.exports.intent,controller),visible=d.frame().battle!.intents!.find(i=>i.index===0)!;
      const base=scenario==='blast'?30:scenario==='attack'?11:scenario==='multi'?1:0;
      const amount=scenario==='idle'?0:scenario==='blast'?30:modified?Math.trunc((base+3)*0.75*1.5):base;
      assert.equal(intent.attack,scenario==='attack'||scenario==='multi');
      assert.equal(intent.damage,base);assert.equal(intent.attackDamage,amount);
      assert.equal(intent.hits,scenario==='idle'?0:scenario==='multi'?6:1);
      assert.equal(visible.attack,intent.attack);assert.equal(visible.baseDamage,base);assert.equal(visible.attackDamage,amount);assert.equal(visible.hits,intent.hits);
      const before=d.query(fixture.exports.observed,undefined).length;
      d.act(END);
      const hits=d.query(fixture.exports.observed,undefined).slice(before).filter(h=>h.source===actor);
      assert.equal(hits.length,intent.hits);assert.ok(hits.every(h=>h.requested===amount&&h.attack===intent.attack));
    }finally{d.close();}
  });
}

for(const attack of [true,false])test(`Lagavulin wakes from real unblocked ${attack?'attack':'non-attack'} damage without attacking during its queued sleep action`,()=>{
  const d=driver('lagavulin',false,false,9,attack);try{
    d.frame();
    const run=d.query(adventures.exports.instances,undefined)[0]!,session=d.query(combatSessions.exports.current,d.query(combatSessions.exports.forRun,run)!);
    const actor=session.roster[0]!.actor!,controller=session.roster[0]!.controller!,board=d.query(battles.exports.status,session.battle);
    const asleep=d.query(powers.exports.find,{registry:board.registry,actor,definition:combatEnemyPowers.exports.Asleep})!;
    const metallicize=d.query(powers.exports.find,{registry:board.registry,actor,definition:combatEnemyPowers.exports.Metallicize})!;
    const waking=d.query(fixture.exports.observed,undefined).find(hit=>hit.target===actor)!;
    assert.equal(waking.requested,9);assert.equal(waking.blocked,8);assert.equal(waking.lost,1);assert.equal(waking.attack,attack);
    assert.equal(d.query(powers.exports.enabled,asleep),false);
    assert.equal(d.query(powers.exports.level,metallicize),0);
    assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.LAGAVULIN_SLEEP);
    assert.deepEqual(d.query(enemies.exports.intent,controller),{attack:false,damage:0,hits:0,attackDamage:0});
    const before=d.query(resources.exports.vitality,board.actor).hp;
    d.act(END);
    assert.equal(d.query(resources.exports.vitality,board.actor).hp,before);
    assert.equal(d.query(fixture.exports.observed,undefined).filter(hit=>hit.source===actor).length,0);
    assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.LAGAVULIN_ATTACK);
    const visible=d.frame().battle!.intents!.find(intent=>intent.index===0)!;
    assert.equal(visible.attackDamage,20);
    d.act(END);
    const attacks=d.query(fixture.exports.observed,undefined).filter(hit=>hit.source===actor);
    assert.equal(attacks.length,1);assert.equal(attacks[0]!.requested,20);assert.equal(attacks[0]!.lost,20);
    assert.equal(d.query(resources.exports.vitality,board.actor).hp,before-20);
  }finally{d.close();}
});

test('fully blocked damage does not wake Lagavulin or remove its Metallicize',()=>{
  const d=driver('lagavulin',false,false,8);try{
    d.frame();
    const run=d.query(adventures.exports.instances,undefined)[0]!,session=d.query(combatSessions.exports.current,d.query(combatSessions.exports.forRun,run)!);
    const actor=session.roster[0]!.actor!,controller=session.roster[0]!.controller!,board=d.query(battles.exports.status,session.battle);
    const asleep=d.query(powers.exports.find,{registry:board.registry,actor,definition:combatEnemyPowers.exports.Asleep})!;
    const metal=d.query(powers.exports.find,{registry:board.registry,actor,definition:combatEnemyPowers.exports.Metallicize})!;
    const hit=d.query(fixture.exports.observed,undefined).find(value=>value.target===actor)!;
    assert.equal(hit.blocked,8);assert.equal(hit.lost,0);
    assert.equal(d.query(powers.exports.enabled,asleep),true);assert.equal(d.query(powers.exports.level,metal),8);
    d.act(END);
    assert.equal(d.query(enemies.exports.current,controller).history[0],moveId.LAGAVULIN_SLEEP);
    assert.equal(d.query(fixture.exports.observed,undefined).filter(value=>value.source===actor).length,0);
  }finally{d.close();}
});

test('enemy power exports and glossary are projections of the installed compositions',()=>{
  assert.equal(cityPowers.exports.Hex,cityPowers.exports.programs.Hex.definition);
  assert.equal(beyondPowers.exports.Slow,beyondPowers.exports.programs.Slow.definition);
  assert.equal(finalPowers.exports.Invincible,finalPowers.exports.programs.Invincible.definition);
  assert.equal(cityPowers.exports.statusTexts.HEX,cityPowers.exports.programs.Hex.text);
  assert.equal(beyondPowers.exports.statusTexts.FADING,beyondPowers.exports.programs.Fading.text);
  assert.equal(finalPowers.exports.statusTexts.SURROUNDED,finalPowers.exports.programs.Surrounded.text);
  assert.match(cityPowers.exports.statusTexts.HEX,/晕眩.*随机洗入抽牌堆/);
  assert.match(cityPowers.exports.statusTexts.PAINFUL_STABS,/实际失去正数生命/);
  assert.match(cityPowers.exports.statusTexts.PAINFUL_STABS,/伤口/);assert.match(cityPowers.exports.statusTexts.PAINFUL_STABS,/弃牌堆/);
  assert.match(beyondPowers.exports.statusTexts.SLOW,/10%/);
  assert.match(finalPowers.exports.statusTexts.SURROUNDED,/乘以1\.5/);
  assert.match(beyondPowers.exports.statusTexts.FADING,/剩余1层.*攻击后消失/);
});

test('multi-hit damage is sampled once before enqueueing, despite Strength gained between hits',()=>{
  const d=driver('multi',true,true);try{
    d.act(END);
    const run=d.query(adventures.exports.instances,undefined)[0]!,session=d.query(combatSessions.exports.current,d.query(combatSessions.exports.forRun,run)!);
    const actor=session.roster[0]!.actor!,before=d.query(fixture.exports.observed,undefined).length;
    const visible=d.frame().battle!.intents!.find(i=>i.index===0)!;
    d.act(END);
    const hits=d.query(fixture.exports.observed,undefined).slice(before).filter(h=>h.source===actor);
    assert.equal(hits.length,6);assert.ok(hits.every(h=>h.requested===visible.attackDamage));
  }finally{d.close();}
});
