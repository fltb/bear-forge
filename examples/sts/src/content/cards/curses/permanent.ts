import {concreteCard} from '../shared/programs.ts';
import {programMetadata,describeProgram,programText} from '../shared/program-facts.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {cardInstances} from "../../../rules/card-instances.ts";
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {resources,HpLossOrigin} from "../../../rules/resources.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {turns} from "../../../rules/turns.ts";
import {cards} from "../../../cards.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cardEvaluationSchema} from "../../../rules/card-instances.schemas.ts";
import {standardUpgrade,upgradeOnce} from "../shared/lifecycle.ts";
import type {CardUse,CardSetup} from "../../../rules/card-instances.types.ts";
import type {DeckCard} from "../../../rules/permanent-decks.types.ts";

const {defineRules,defineEntity,defineQuery,defineEffect,sequence,call,query,on,enqueue,restrict}=rules;
export const cursePermanentCards=defineRules({requires:[permanentDecks,battles,turns,powers],build(){
  const noop=describeProgram(defineEffect<CardUse,void>(b=>b.return(undefined)),'');
  const fixed=describeProgram(defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>false}),'不可变形。');
  const self=defineQuery({input:typedValue<rules.ReactionContext<DeckCard>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source});
  const parasiteLoss=3;
  const parasite=describeProgram(on(permanentDecks.exports.removing,{condition:self,effect:defineEffect<rules.ReactionContext<DeckCard>,void>(b=>call(resources.exports.loseMaxHp,{entity:b.read(v=>v.input.owner),amount:parasiteLoss}))}),`从永久牌组移除时，失去${parasiteLoss}最大生命。`);
  const regret=describeProgram(defineEffect<CardUse,void>(b=>enqueue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.regretCardCount),selfDamage:true,origin:HpLossOrigin.Direct}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),b.input,
    {queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'})),`回合结束时若本牌在手中，按本次结算记录的手牌张数失去生命。`);
  const curse=(id:'NECRONOMICURSE'|'CURSE_OF_THE_BELL')=>concreteCard(id,noop,{canTransform:fixed});
  const parasiteCreated=describeProgram(defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>rules.when(b.read(v=>v.input.setup.mode===0),rules.install({ability:parasite,source:b.read(v=>v.input.entity),owner:b.read(v=>{if(v.input.owner===null)throw Error('A permanent Parasite needs an owner');return v.input.owner;}),environment:{},lifetime:b.read(v=>v.input.scope)}))),programText(parasite)!);
  return{exports:{Parasite:concreteCard('PARASITE',noop,{created:parasiteCreated}),Regret:concreteCard('REGRET',noop,{endTurn:regret}),Necronomicurse:curse('NECRONOMICURSE'),CurseOfTheBell:curse('CURSE_OF_THE_BELL')}};
}});
