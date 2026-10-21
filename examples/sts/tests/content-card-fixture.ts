import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {adventureProgram,adventureContent} from "../src/program/adventure.ts";
import {adventureStart} from "../src/program/start.ts";
import {combatProgram} from "../src/program/combat.ts";
import {stsPorts} from "../src/adapters/ports.ts";
import {adventures} from '../src/rules/adventures.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {battles} from '../src/rules/battles.ts';
import {turns} from '../src/rules/turns.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {resources} from '../src/rules/resources.ts';
import {powers} from '../src/rules/powers.ts';
import {enemies} from '../src/rules/enemies.ts';
import {basicPowers} from "../src/content/powers/attributes.ts";
import {moveId} from '../src/combat-identifiers.ts';
import {zones} from '../src/rules/zones.ts';
import {cards} from '../src/cards.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import {encounterId,type CardId} from '../src/identifiers.ts';
import type {TurnActor} from '../src/rules/turns.types.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query,on,install,spawnEntity,readComponent,updateLocalComponent}=rules;
const setupSchema=programSchemas.setup.extend({id:z.custom<keyof typeof cards>(),upgraded:z.boolean(),enemyHp:z.int32().positive(),support:z.array(z.custom<keyof typeof cards>()),strength:z.int32().default(0),vulnerable:z.int32().default(0),attackIntent:z.boolean().default(false)});
export type ContentCase=z.infer<typeof setupSchema>;
const fixture=defineRules({requires:[adventureProgram],build(m){
  const done=defineComponent({schema:z.boolean(),initial:()=>false});
  type Environment=ContentCase&{run:number};
  const enter=on(turns.exports.idle,{condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor,Environment>>(),output:z.boolean(),reads:[done],base:(r,c)=>c.event.actor===c.owner&&!r.component(c.source,done)}),effect:defineEffect<rules.ReactionContext<TurnActor,Environment>,void>(b=>{
    const piles=b.local<number>(),subject=b.local<number>(),from=b.local<number|null>();
    const board=(v:rules.ReadView<rules.ReactionContext<TurnActor,Environment>>)=>v.get(query(battles.exports.current,v.input.event.battle));
    const p=(v:rules.ReadView<rules.ReactionContext<TurnActor,Environment>>)=>v.get(query(cardPiles.exports.current,v.get(piles)));
    const create=(id:rules.Input<CardId>,destination:0|1,upgraded:rules.Input<boolean>)=>call(cardPiles.exports.create,{piles,definition:query(adventures.exports.card,{run:b.read(v=>v.input.environment.run),id}),upgraded,specialData:0,destination,shuffle:false,mutable:null});
    return sequence(updateLocalComponent(b.read(v=>v.input.source),done,true),b.assign(piles,b.read(v=>board(v).piles)),
      forEach(b.read(v=>[...v.get(query(zones.exports.members,p(v).hand))]),card=>when(b.read(v=>cards[v.input.environment.id].type===4||v.get(query(cardInstances.exports.current,v.get(card))).uniqueId!==11),call(cardPiles.exports.exhaust,{piles,card}))),
      when(b.read(v=>cards[v.input.environment.id].type===4),b.assign(subject,create(b.read(v=>v.input.environment.id),1,b.read(v=>v.input.environment.upgraded))),sequence(
        b.assign(subject,b.read(v=>{const found=[p(v).hand,p(v).draw,p(v).discard,p(v).exhaust].flatMap(zone=>v.get(query(zones.exports.members,zone))).find(card=>v.get(query(cardInstances.exports.current,card)).uniqueId===11);if(found===undefined)throw Error('Fixture subject is missing');return found;})),
        b.assign(from,query(zones.exports.location,subject)),when(b.read(v=>v.get(from)!==p(v).hand),sequence(call(zones.exports.move,{entity:subject,from,to:null,index:0}),call(cardPiles.exports.moveToHand,{piles,card:subject}))),
      )),forEach(b.read(v=>v.input.environment.support),id=>create(id,1,false)),create('DAZED',0,false),
      call(resources.exports.setHealth,{entity:b.read(v=>board(v).enemies[0]!),hp:b.read(v=>v.input.environment.enemyHp),maxHp:b.read(v=>v.input.environment.enemyHp)}),
      call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:10}),call(resources.exports.rechargeEnergy,{entity:b.read(v=>v.input.owner),amount:20}),call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount:3,selfDamage:true}),
      when(b.read(v=>v.input.environment.strength!==0),call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:b.read(v=>v.input.environment.strength),source:null,debuff:false,scope:b.read(v=>board(v).scope)})),
      when(b.read(v=>v.input.environment.vulnerable!==0),call(powers.exports.apply,{registry:b.read(v=>board(v).registry),actor:b.read(v=>board(v).enemies[0]!),definition:basicPowers.exports.EnemyVulnerable,amount:b.read(v=>v.input.environment.vulnerable),source:null,debuff:true,scope:b.read(v=>board(v).scope)})),
      when(b.read(v=>v.input.environment.attackIntent),call(enemies.exports.replaceMove,{enemy:b.read(v=>{const id=v.get(query(enemies.exports.forActor,board(v).enemies[0]!));if(id===null)throw Error('Fixture enemy is missing');return id;}),move:moveId.CULTIST_DARK_STRIKE})),
    );
  })});
  const kind=m.kind({config:z.undefined(),setup:setupSchema.extend({run:z.number()}),components:[],initialize:defineEffect<rules.EntityLifecycle<Environment>,void>(b=>install({ability:enter,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.owner!),environment:b.read(v=>v.input.setup),lifetime:b.read(v=>v.input.scope)}))});
  const anchor=defineEntity(kind,undefined,{components:[done]});
  const entry=defineEffect<ContentCase,Frame>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
    when(b.read(v=>cards[v.input.id].type!==4),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).deck),definition:query(adventures.exports.card,{run,id:b.read(v=>v.input.id)}),upgraded:b.read(v=>v.input.upgraded),specialData:0,count:1,upgrade:false})),
    call(adventures.exports.setRoom,{run,room:'MONSTER',event:0}),call(stsPorts.exports.initialize,run),spawnEntity({definition:anchor,owner:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).actor),scope:0,setup:b.read(v=>({...v.input,run:v.get(run)}))}),
    call(combatProgram.exports.run,{run,encounter:encounterId.CULTIST}),b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
  );});
  return{exports:{entry}};
}});
/** Fixture construction uses the production catalog, combat root and owner operations. */
export const contentCardDefinition=linkRules<{},ContentCase,Ports,Frame>({id:'sts/content-card-cases',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
