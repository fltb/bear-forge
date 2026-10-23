import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {rules} from '../src/rules/execution.ts';
import {describeProgram,programText} from '../src/rules/program-descriptions.ts';
import {selectionSequence,selectionBranch,selectedEach} from '../src/program/permanent-selections.ts';
import {adventureProgram,adventureContent} from '../src/program/adventure.ts';
import {adventureStart} from '../src/program/start.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {adventures} from '../src/rules/adventures.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {resources} from '../src/rules/resources.ts';
import {programSchemas,type Ports} from '../src/game.schemas.ts';
import type {AdventureSelection,AdventureSelected} from '../src/rules/adventures.types.ts';
import type {CardId} from '../src/identifiers.ts';

const selections=adventureContent.acquisition.exports.selections;
const programs=selections.exports.programs;
test('permanent selection modes project their actual sequence, iteration and conditional children',()=>{
  for(const mode of Object.values(programs)){
    const text=programText(mode.effect);assert.ok(text);
    assert.equal(mode.text(2),`选择2张牌；${text}`);
    assert.equal(selections.exports.describe(mode.type,2),mode.text(2));
  }
  assert.match(programs.transform.text(2),/逆序.*移除.*正序.*变化随机流.*抽取变化结果.*获得1张结果牌.*重置为card/);
  assert.match(programs.transformUpgraded.text(2),/逆序.*移除.*misc随机流.*自动升级.*获得1张结果牌/);
  assert.doesNotMatch(programs.transformUpgraded.text(2),/重置/);
  assert.match(programs.bonfire.text(2),/正序.*诅咒.*SPIRIT_POOP.*稀有.*增加10最大生命.*当前最大生命.*初始.*罕见.*回复10生命.*回复5生命.*移除选中索引当前对应/);
  assert.match(programs.bottle.text(2),/仅.*第一张/);
});

test('unknown children and opaque conditions stay incomplete without invoking their callbacks',()=>{
  type Input={run:number;selected:AdventureSelection;picked:AdventureSelected};
  let calls=0;
  const known=describeProgram(rules.defineEffect<Input,void>(()=>rules.sequence()),'known');
  const unknown=rules.defineEffect<Input,void>(()=>rules.sequence());
  const condition={read:()=>{calls++;return true;},text:'condition'};
  assert.equal(programText(selectionSequence(known,unknown)),undefined);
  assert.equal(programText(selectionBranch(condition,known,unknown)),undefined);
  assert.equal(programText(selectionBranch({read:condition.read},known)),undefined);
  assert.equal(programText(selectedEach(unknown)),undefined);
  assert.match(programText(selectedEach(selectionSequence(known,known),true))!,/逆序.*known.*known/);
  assert.match(programText(selectionBranch(condition,known))!,/condition.*known/);
  assert.equal(calls,0);
});

const setup=programSchemas.setup.extend({mode:z.number(),cards:z.array(z.object({id:z.custom<CardId>(),upgraded:z.boolean(),misc:z.number()})),picked:z.array(z.number())});
const result=z.object({cards:z.array(z.object({id:z.string(),upgraded:z.boolean(),misc:z.number()})),bottles:z.array(z.number()),hp:z.number(),maxHp:z.number(),resetToCard:z.boolean(),poop:z.boolean()});
type Setup=z.infer<typeof setup>;type Result=z.infer<typeof result>;
const {defineEffect,sequence,call,query,forEach,when,definitionOf}=rules;
const fixture=rules.defineRules({requires:[adventureProgram],build(){
  const entry=defineEffect<Setup,Result>(b=>{
    const run=b.local<number>(),selected=b.local<AdventureSelection>();
    const state=(v:rules.ReadView<Setup>)=>v.query(adventures.exports.bindings,v.get(run));
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
      call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:15,maxHp:75}),
      forEach(b.read(v=>v.query(permanentDecks.exports.current,state(v).deck).cards),card=>call(permanentDecks.exports.remove,{deck:b.read(v=>state(v).deck),card})),
      forEach(b.read(v=>v.input.cards),card=>call(permanentDecks.exports.obtain,{deck:b.read(v=>state(v).deck),definition:query(adventures.exports.card,{run,id:b.read(v=>v.get(card).id)}),count:1,upgraded:b.read(v=>v.get(card).upgraded),specialData:b.read(v=>v.get(card).misc),upgrade:false})),
      b.assign(selected,b.read(v=>{
        const cards=v.query(permanentDecks.exports.current,state(v).deck).cards;
        const picked=v.input.picked.map(deckIndex=>{const entity=cards[deckIndex]!,card=v.query(cardInstances.exports.current,entity);return{deckIndex,card:{definition:v.get(definitionOf(cardInstances.exports.kind,entity)),upgraded:card.upgraded,misc:card.specialData}};});
        return{type:v.input.mode,count:picked.length,cards:picked,selected:picked,transformStream:state(v).streams.misc};
      })),
      call(adventures.exports.beginSelection,{run,selection:selected}),
      ...Object.values(programs).map(program=>when(b.read(v=>v.input.mode===program.type),call(program.effect,{run,selected}))),
      b.return(b.read(v=>{const s=state(v),deck=v.query(permanentDecks.exports.current,s.deck),hp=v.query(resources.exports.vitality,s.actor);return{cards:deck.cards.map(card=>v.query(cardInstances.exports.permanentView,card)),bottles:[...deck.bottles],hp:hp.hp,maxHp:hp.maxHp,resetToCard:v.query(adventures.exports.selection,v.get(run)).selection.transformStream===s.streams.card,poop:v.query(adventures.exports.hasRelic,{run:v.get(run),id:'SPIRIT_POOP'})};})),
    );
  });return{exports:{entry}};
}});
const definition=linkRules<{},Setup,Ports,Result>({id:'sts/permanent-selection-source',schemas:{...programSchemas,setup,result},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
const program=new CardProgram(definition);
function run(mode:number,ids:CardId[],picked:number[],upgraded=false,misc=0):Result{
  const storage=privateCardGraph(program.initial({seed:'130',mode,cards:ids.map(id=>({id,upgraded,misc})),picked},100_000_000));
  try{const machine=new CardMachine(program,storage);let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Unexpected selection IO');return stop.result;}finally{storage.close();}
}

test('remove reverses selected indices while bonfire removes each current index in forward order',()=>{
  const cards:CardId[]=['STRIKE_RED','BARRICADE','DEFEND_RED','BASH'];
  assert.deepEqual(run(4,cards,[0,1]).cards.map(card=>card.id),['DEFEND_RED','BASH']);
  const bonfire=run(8,cards,[0,1]);
  assert.deepEqual(bonfire.cards.map(card=>card.id),['BARRICADE','BASH']);
  assert.equal(bonfire.maxHp,85);assert.equal(bonfire.hp,85);
});
test('bonfire executes curse, rare, uncommon, common and starter child branches',()=>{
  const curse=run(8,['REGRET'],[0]);assert.equal(curse.poop,true);assert.equal(curse.hp,15);assert.deepEqual(curse.cards,[]);
  const rare=run(8,['BARRICADE'],[0]);assert.equal(rare.maxHp,85);assert.equal(rare.hp,85);
  assert.equal(run(8,['INFLAME'],[0]).hp,25);
  assert.equal(run(8,['SHRUG_IT_OFF'],[0]).hp,20);
  assert.equal(run(8,['STRIKE_RED'],[0]).hp,15);
});
test('transform removes first, obtains the sampled results and only type one resets the stream',()=>{
  const plain=run(1,['BASH','DEFEND_RED'],[0,1]);assert.equal(plain.cards.length,2);assert.equal(plain.resetToCard,true);assert.ok(plain.cards.every(card=>!card.upgraded));
  const upgraded=run(2,['BASH','DEFEND_RED'],[0,1]);assert.equal(upgraded.cards.length,2);assert.equal(upgraded.resetToCard,false);assert.ok(upgraded.cards.every(card=>card.upgraded));
});
test('copy and obtain preserve preview data; upgrade and bottle use the selected targets',()=>{
  for(const mode of [5,6]){const copied=run(mode,['BASH'],[0],true,7);assert.equal(copied.cards.length,2);assert.deepEqual(copied.cards[1],copied.cards[0]);assert.equal(copied.cards[1]!.misc,7);assert.equal(copied.cards[1]!.upgraded,true);}
  assert.deepEqual(run(3,['BASH','STRIKE_RED'],[1]).cards.map(card=>card.upgraded),[false,true]);
  assert.deepEqual(run(7,['BASH','STRIKE_RED'],[0,1]).bottles,[0,-1,-1]);
});
