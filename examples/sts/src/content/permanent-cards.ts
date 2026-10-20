import {PS,MS} from '../combat-identifiers.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardInstances} from '../rules/card-instances.ts';
import {permanentDecks} from '../rules/permanent-decks.ts';
import {resources,HpLossOrigin} from '../rules/resources.ts';
import {attributes} from '../rules/attributes.ts';
import {battles} from '../rules/battles.ts';
import {powers} from '../rules/powers.ts';
import {turns} from '../rules/turns.ts';
import {cards} from '../cards.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import {cardEvaluationSchema} from '../rules/card-instances.schemas.ts';
import {standardUpgrade,repeatedUpgrade,upgradeOnce} from './card-utils.ts';
import {counterPolicies,attachAbilities} from './power-utils.ts';
import type {CardUse,CardSetup} from '../rules/card-instances.types.ts';
import type {DeckCard} from '../rules/permanent-decks.types.ts';
import type {ResourceAmount} from '../rules/resources.types.ts';
const {defineRules,defineEntity,defineQuery,defineEffect,sequence,call,query,on,enqueue,restrict}=rules;
export const permanentCards=defineRules({requires:[permanentDecks,battles,turns,powers],build(){
  const noop=defineEffect<CardUse,void>(b=>b.return(undefined));
  const fixed=defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>false});
  const self=defineQuery({input:z.custom<rules.ReactionContext<DeckCard>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source});
  const parasite=on(permanentDecks.exports.removing,{condition:self,effect:defineEffect<rules.ReactionContext<DeckCard>,void>(b=>call(resources.exports.loseMaxHp,{entity:b.read(v=>v.input.owner),amount:3}))});
  const ownsBlock=defineQuery({input:z.custom<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.entity===c.owner&&r.query(powers.exports.enabled,c.source)});
  const BarricadePower=defineEntity(powers.exports.kind,{presentation:{key:PS.BARRICADE,flag:true},...counterPolicies({bits:16,flag:true}),attach:attachAbilities(restrict(turns.exports.beforeBlockReset,{when:ownsBlock,reason:{retained:true}}))});
  const barricade=defineEffect<CardUse,void>(b=>enqueue(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.input.owner),definition:BarricadePower,amount:1,source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  const searing=defineEffect<CardUse,void>(b=>enqueue(battles.exports.hit,b.read(v=>{if(v.input.target===null)throw Error('Searing Blow needs a target');const n=v.input.state.specialData,base=Math.trunc(n*(n+7)/2)+12;return{battle:v.input.battle,source:v.input.owner,target:v.input.target,amount:v.get(query(attributes.exports.attackAmount,{source:v.input.owner,target:v.input.target,card:v.input.card,base})),attack:true,selfDamage:false};}),
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  const regret=defineEffect<CardUse,void>(b=>enqueue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.regretCardCount),selfDamage:true,origin:HpLossOrigin.Direct}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),b.input,
    {queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),eligible:'captured'}));
  const curse=(id:'NECRONOMICURSE'|'CURSE_OF_THE_BELL')=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use:noop,canTransform:fixed,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  return{exports:{SearingBlow:defineEntity(cardInstances.exports.kind,{id:'SEARING_BLOW',metadata:cards.SEARING_BLOW,use:searing,canUpgrade:defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>true}),upgrade:repeatedUpgrade(cards.SEARING_BLOW),upgradeCount:defineQuery({input:cardEvaluationSchema,output:z.int32(),base:(_r,c)=>c.state.specialData})}),
    Parasite:defineEntity(cardInstances.exports.kind,{id:'PARASITE',metadata:cards.PARASITE,use:noop,canUpgrade:upgradeOnce(cards.PARASITE),upgrade:standardUpgrade(cards.PARASITE),created:defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>rules.when(b.read(v=>v.input.setup.mode===0),rules.install({ability:parasite,source:b.read(v=>v.input.entity),owner:b.read(v=>{if(v.input.owner===null)throw Error('A permanent Parasite needs an owner');return v.input.owner;}),environment:{},lifetime:b.read(v=>v.input.scope)})))}),
    Regret:defineEntity(cardInstances.exports.kind,{id:'REGRET',metadata:cards.REGRET,use:noop,endTurn:regret,canUpgrade:upgradeOnce(cards.REGRET),upgrade:standardUpgrade(cards.REGRET)}),
    Barricade:defineEntity(cardInstances.exports.kind,{id:'BARRICADE',metadata:cards.BARRICADE,use:barricade,canUpgrade:upgradeOnce(cards.BARRICADE),upgrade:standardUpgrade(cards.BARRICADE)}),Necronomicurse:curse('NECRONOMICURSE'),CurseOfTheBell:curse('CURSE_OF_THE_BELL'),BarricadePower}};
}});
