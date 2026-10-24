import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {random} from '../src/rules/random.ts';
import {adventureProgram,adventureContent} from '../src/program/adventure.ts';
import {adventureStart} from '../src/program/start.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {programSchemas,FrameSchema,type Ports,type Frame} from '../src/game.schemas.ts';
import {observe} from '../src/contract.ts';
import {presentDecision} from '../src/presentation.ts';

const owner=adventureContent.neow.exports;
const setup=programSchemas.setup.extend({bonus:z.number().default(-1),drawback:z.number().default(1),menu:z.boolean().default(false),hp:z.number().default(75),maxHp:z.number().default(75),gold:z.number().default(123)});
type Case=z.infer<typeof setup>;
const resultSchema=z.object({frame:FrameSchema,cardCounter:z.number()});
type Result=z.infer<typeof resultSchema>;
const {defineEffect,sequence,call,query,when}=rules;
const fixture=rules.defineRules({requires:[adventureProgram],build(){
  const entry=defineEffect<Case,Result>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
    call(adventures.exports.enableDetails,run),call(stsPorts.exports.initialize,run),
    call(resources.exports.setHealth,{entity:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).actor),hp:b.read(v=>v.input.hp),maxHp:b.read(v=>v.input.maxHp)}),
    call(resources.exports.gainGold,b.read(v=>{const entity=v.query(adventures.exports.bindings,v.get(run)).actor;return{entity,amount:v.input.gold-v.query(resources.exports.wealth,entity).gold};})),
    when(b.read(v=>v.input.menu),call(owner.choose,run),sequence(
      ...owner.drawbacks.map(p=>when(b.read(v=>v.input.drawback===p.id),call(p.effect,{run,option:b.read(v=>({bonus:v.input.bonus,drawback:v.input.drawback}))}))),
      ...owner.bonuses.map(p=>when(b.read(v=>v.input.bonus===p.id),call(p.effect,{run,option:b.read(v=>({bonus:v.input.bonus,drawback:v.input.drawback}))}))),
    )),
    call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:false}),b.return({frame:query(stsPorts.exports.frame,{run,actions:[],selection:null}),cardCounter:b.read(v=>v.query(random.exports.current,v.query(adventures.exports.bindings,v.get(run)).streams.card).counter)}),
  );});return{exports:{entry}};
}});
const definition=linkRules<{},Case,Ports,Result>({id:'sts/neow-source-regression',schemas:{...programSchemas,setup,result:resultSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
const program=new CardProgram(definition);
function driver(patch:Partial<Case>={}){
  const storage=privateCardGraph(program.initial({seed:'130',bonus:-1,drawback:1,menu:false,hp:75,maxHp:75,gold:123,...patch},100_000_000));
  const machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result.frame;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(`Expected Neow decision: ${JSON.stringify(stop)}`);return stop.call.input;};
  return{frame,cardCounter(){frame();if(stop.kind!=='done')throw Error('Counter only available at fixture completion');return stop.result.cardCounter;},done(){frame();return stop.kind==='done';},advance(){const current=frame(),action=current.actions[0];assert.ok(action);stop=machine.advance(action);return frame();},close(){storage.close();}};
}
function result(patch:Partial<Case>={}){const d=driver(patch);try{const game=observe(d.frame()).game;assert.equal(d.done(),true);return{...game,cardCounter:d.cardCounter()};}finally{d.close();}}

test('Neow production menu publishes bonus text from the very same executable owners',()=>{
  assert.deepEqual(owner.bonuses.map(p=>p.id),Array.from({length:19},(_,i)=>i));
  assert.deepEqual(owner.drawbacks.map(p=>p.id),[0,1,2,3,4,5,6]);
  const d=driver({menu:true});try{const frame=d.frame(),observation=observe(frame),options=observation.game.neow;assert.ok(options);assert.equal(options.length,4);
    const labels=presentDecision(observation,frame.actions).actions.map(a=>a.label);
    options.forEach((option,index)=>{assert.equal(option.description,owner.describeBonus(option.bonus));assert.equal(observation.game.optionDetails?.[String(index)],option.description);assert.ok(labels[index]!.includes(option.description));assert.ok(labels[index]!.includes(owner.describeDrawback(option.drawback,observation.game)));});
  }finally{d.close();}
});

test('Neow drawback descriptions and actual health/gold effects preserve exact rounding',()=>{
  for(const [hp,maxHp,expectedHp,expectedMaxHp] of [[75,75,67,67],[29,72,29,64]] as const){
    const game=result({drawback:2,hp,maxHp});assert.equal(game.hp,expectedHp);assert.equal(game.maxHp,expectedMaxHp);assert.ok(owner.describeDrawback(2,{hp,maxHp,gold:123}).includes(`${maxHp}→${expectedMaxHp}`));
  }
  for(const [hp,expected] of [[75,49],[29,14],[10,7],[9,0]] as const){const game=result({drawback:5,hp});assert.equal(game.hp,expected);assert.ok(owner.describeDrawback(5,{hp,maxHp:75,gold:123}).includes(`${hp}→${expected}`));}
  assert.equal(result({drawback:3}).gold,0);
  assert.equal(owner.describeDrawback(3,{hp:75,maxHp:75,gold:123}),'失去全部123金币');
  assert.equal(result({drawback:6}).relics.some(r=>r.id==='BURNING_BLOOD'),false);
});

test('Neow reward amounts and order come from concrete bonus programs',()=>{
  assert.equal(result({bonus:10}).gold,223);assert.match(owner.describeBonus(10),/100/);
  assert.equal(result({bonus:15,drawback:3}).gold,250);assert.match(owner.describeBonus(15),/250/);
  const small=result({bonus:8});assert.equal(small.maxHp,82);assert.equal(small.hp,75);assert.match(owner.describeBonus(8),/10%/);
  const afterCost=result({bonus:17,drawback:2});assert.equal(afterCost.maxHp,80);assert.equal(afterCost.hp,67);assert.match(owner.describeBonus(17),/20%/);
  assert.equal(result({bonus:9}).relics.some(r=>r.id==='NEOWS_LAMENT'),true);
});

test('Neow preserves early card-offer curse, late remove curse, and unconditional preselection transform curse',()=>{
  const baseline=result();
  const offer=driver({bonus:0,drawback:4});try{const game=observe(offer.frame()).game;assert.equal(game.deck.length,baseline.deck.length+1);}finally{offer.close();}
  const remove=driver({bonus:2,drawback:4});try{const before=observe(remove.frame()).game;assert.equal(before.deck.length,baseline.deck.length);const after=observe(remove.advance()).game;assert.equal(remove.done(),true);assert.equal(after.deck.length,baseline.deck.length);assert.equal(remove.cardCounter(),baseline.cardCounter+1);}finally{remove.close();}
  for(const drawback of [1,4]){const transform=driver({bonus:16,drawback});try{const before=observe(transform.frame()).game;assert.equal(before.deck.length,baseline.deck.length+1);assert.equal(before.select?.remaining,2);assert.equal(before.select?.cards.some(c=>c.deckIndex>=baseline.deck.length),false,'curse is added after candidate snapshot');transform.advance();const after=observe(transform.advance()).game;assert.equal(transform.done(),true);assert.equal(after.deck.length,baseline.deck.length+1);assert.equal(transform.cardCounter(),baseline.cardCounter+1,'no second delayed curse');}finally{transform.close();}}
  assert.match(owner.describeBonus(16),/随机诅咒/);
});

test('Neow discarded card generation supplies no public probability evidence',()=>{
  const storage=privateCardGraph(program.initial({seed:'130',bonus:6,drawback:1,menu:false,hp:75,maxHp:75,gold:123},100_000_000));
  const machine=new CardMachine(program,storage),publications:unknown[]=[];
  try{
    let stop=machine.advance();publications.push(...machine.takeProbabilityPublications());
    while(stop.kind==='call'&&stop.call.port==='event'){stop=machine.advance(null);publications.push(...machine.takeProbabilityPublications());}
    assert.equal(stop.kind,'call');if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original potion rewards');
    const game=observe(stop.call.input).game;
    assert.equal(game.screen,'REWARDS');assert.equal(game.rewards!.cards.length,0);assert.equal(game.rewards!.potions.length,3);
    assert.deepEqual(publications,[],'the discarded original card reward is not observed evidence');
  }finally{storage.close();}
});
