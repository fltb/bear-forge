import {volibearStormCards as storm} from '../src/content/characters/volibear/cards/storm.ts';
import {stormCharge} from '../src/content/characters/volibear/mechanics/storm-charge.ts';
import {volibearTraining} from '../src/content/characters/volibear/mechanics/training.ts';
import {volibearPresentation} from '../src/content/characters/volibear/presentation.ts';
import {turns} from '../src/rules/turns.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileSnapshotStore} from '@bear-forge/runtime-card';
import {beyondBosses} from '../src/content/enemies/beyond/bosses.ts';
import {xCostRelics} from '../src/content/relics/common/x-cost.ts';
import {basicCards as ironBasic} from '../src/content/characters/ironclad/cards/basic.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {ruleModules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {resources} from '../src/rules/resources.ts';
import {powers} from '../src/rules/powers.ts';
import {battles} from '../src/rules/battles.ts';
import {enemies as enemyRules} from '../src/rules/enemies.ts';
import {enemyIntentSchema} from '../src/rules/enemies.schemas.ts';
import {enemyAttack,enemyPower,enemyProgram} from '../src/content/enemies/shared/programs.ts';
import {volibearEngageCards as engage,volibearDomainCards as domainCards} from '../src/content/characters/volibear/index.ts';
import {createVolibearOptionalEngageCards} from '../src/content/characters/volibear/index.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {random} from '../src/rules/random.ts';
import {relics} from '../src/rules/relics.ts';
import {actionQueue,combatScope} from '../src/rules/combat-actions.ts';
import {basicPowers} from '../src/content/powers/attributes.ts';
import type {PowerDefinition} from '../src/rules/powers.types.ts';
import type {CardConfig,CardSetup} from '../src/rules/card-instances.types.ts';
import {volibearBasicCards as basic,volibearCommonCards as common,volibearUncommonCards as uncommon,volibearRareCards as rare,volibearHearts,volibearPlayCounts} from '../src/content/characters/volibear/index.ts';
import {volibearGrowthCards as growth,volibearXCards as xCards,volibearLethalCards as lethal} from '../src/content/characters/volibear/index.ts';
import {volibearCopying} from '../src/content/characters/volibear/mechanics/copying.ts';
import {volibearNextAttack} from '../src/content/characters/volibear/mechanics/next-attack.ts';
import {volibearNextPlayDiscount} from '../src/content/characters/volibear/mechanics/next-play-discount.ts';
import {createVolibearSelectionCards} from '../src/content/characters/volibear/index.ts';
import {createCardChoices} from '../src/rules/card-choices.ts';
import type {CardChoicePlayer} from '../src/rules/card-choices.types.ts';
import {volibearEngagePreparation} from '../src/content/characters/volibear/mechanics/engage-preparation.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {card} from '../src/content/characters/volibear/cards/programs.ts';
import {volibearDomain} from '../src/content/characters/volibear/mechanics/domain.ts';
import {defensePowers} from '../src/content/powers/defense.ts';
import {registerCardAbilities} from '../src/content/cards/shared/lifecycle.ts';

const choiceRequestSchema=z.object({screen:z.number(),kind:z.enum(['one','many','order']),cards:z.array(z.string()),minimum:z.number(),maximum:z.number()});
const choiceReplySchema=z.object({indices:z.array(z.number().int().nonnegative())});
const choiceWire=rules.defineRules({requires:[cardInstances],build(){
  const publication=rules.defineQuery({input:z.custom<rules.ChoiceRequest<number,CardChoicePlayer>>(),output:choiceRequestSchema,dependencies:[cardInstances.exports.metadata],base:(r,i)=>({
    screen:i.player.screen,kind:i.kind,cards:i.candidates.map(id=>r.query(cardInstances.exports.metadata,id).name),minimum:i.min,maximum:i.max,
  })});
  return {exports:{adapter:ruleModules.choicePort({port:'decision',request:publication,reply:choiceReplySchema,decode:(_request,reply)=>({kind:'selected' as const,indices:reply.indices})})}};
}});
const choices=createCardChoices(choiceWire.exports.adapter,[choiceWire]);
const engageChoiceWire=rules.defineRules({requires:[],build(){
  const publication=rules.defineQuery({input:z.custom<rules.ChoiceRequest<boolean,import('../src/rules/card-instances.types.ts').CardUse>>(),output:choiceRequestSchema,
    base:(_r,i)=>({screen:8,kind:i.kind,cards:i.candidates.map(yes=>yes?'迎战':'放弃'),minimum:i.min,maximum:i.max})});
  return {exports:{adapter:ruleModules.choicePort({port:'decision',request:publication,reply:choiceReplySchema,decode:(_request,reply)=>({kind:'selected' as const,indices:reply.indices})})}};
}});
const optionalEngage=createVolibearOptionalEngageCards(engageChoiceWire.exports.adapter,[engageChoiceWire]);
// These are fixture presentation labels, not production dispatch identifiers.
const selections=createVolibearSelectionCards(choices,{discard:1,discardToTop:2,scry:3,retain:4,copy:5,recover:6,train:7,exhaust:8});
// A declaration-only fixture checks the coupon contract; it does not implement
// B04 or claim to exercise an enemy action/optional-engage choice.
const engageProbeModule=rules.defineRules({requires:[common,volibearEngagePreparation],build(){
const engageProbe=card({
  ...volibearCardDescriptions.B04,id:'fixture/engage-declaration',
  metadata:{...volibearCardDescriptions.B04.metadata,name:'迎战声明探针',variants:[
    {...volibearCardDescriptions.B04.metadata.variants[0],cost:2},
    {...volibearCardDescriptions.B04.metadata.variants[1],cost:2},
  ]},
},rules.defineEffect<import('../src/rules/card-instances.types.ts').CardUse,void>(b=>b.return(undefined)),{
  created:registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),
});
return{exports:{engageProbe}};
}});
const engageProbe=engageProbeModule.exports.engageProbe;
const exhaustProbe=rules.defineRules({requires:[cardPiles,resources,cardInstances],build(){
  const self=rules.on(cardPiles.exports.exhausted,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<{piles:number;card:number}>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source}),
    effect:rules.defineEffect<rules.ReactionContext<{piles:number;card:number}>,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:7})),
  });
  const external=rules.on(cardPiles.exports.exhausted,{
    effect:rules.defineEffect<rules.ReactionContext<{piles:number;card:number}>,void>(b=>rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:4})),
  });
  const curse=card({...volibearCardDescriptions.B02,id:'fixture/curse-self-exhaust',metadata:{...volibearCardDescriptions.B02.metadata,name:'自响应诅咒',type:3}},
    rules.defineEffect<import('../src/rules/card-instances.types.ts').CardUse,void>(b=>b.return(undefined)),{created:registerCardAbilities(self)});
  const skill=card({...volibearCardDescriptions.B02,id:'fixture/skill-self-exhaust',metadata:{...volibearCardDescriptions.B02.metadata,name:'自响应技能'}},
    rules.defineEffect<import('../src/rules/card-instances.types.ts').CardUse,void>(b=>b.return(undefined)),{created:registerCardAbilities(self)});
  const shuffle=rules.on(cardPiles.exports.shuffling,{effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:1}))});
  return {exports:{curse,skill,external,shuffle}};
}});

type Definition=rules.EntityDefinition<CardConfig,CardSetup>;
type Scenario={charge?:number;endTurns?:number;queuedBlockOnUse?:number;plays:{definition:Definition;endBefore?:boolean;upgraded?:boolean;target?:number;reuse?:number;copyOf?:number;generated?:boolean;illegal?:boolean;discounts?:number;attackBonus?:number}[];reserve?:Definition[];drawTop?:Definition[];discardSetup?:Definition[];domainTurns?:number|null;observeShuffle?:boolean;extraDrawOn?:Definition;enemyPowers?:{definition:PowerDefinition;amount:number}[];exhaustObserver?:boolean;hp?:number;energy?:number;enemyHp?:readonly [number,number,number];block?:number;dexterity?:number;strength?:number;weak?:boolean;frail?:boolean;chemicalX?:boolean;heart?:boolean;immortal?:boolean;enemyAction?:{damage:number;hits:number;grant?:{definition:PowerDefinition;amount:number}};normalEnemyTargets?:number[]};
const actor=rules.defineEntity(resources.exports.actor,{side:0}),enemy=rules.defineEntity(resources.exports.actor,{side:1});
const registryDefinition=rules.defineEntity(powers.exports.registryKind,undefined),stream=rules.defineEntity(random.exports.stream,undefined),battleDefinition=rules.defineEntity(battles.exports.kind,undefined);
const resultSchema=z.object({domain:z.object({active:z.boolean(),untilTurn:z.number().nullable()}),hp:z.number(),block:z.number(),energy:z.number(),enemies:z.array(z.number()),hand:z.number(),charge:z.number(),spent:z.number(),turnSpent:z.number(),exhaust:z.array(z.string()),masterGrowth:z.array(z.number()),effects:z.array(z.string())});

/** Fixtures construct explicit combat positions; they are not balance simulations
 * or a replacement for the production rules/queue. Both loaders run those rules.
 */
function fixture(s:Scenario){
  const fixtureModule=rules.defineRules({requires:[storm,stormCharge,volibearPresentation,volibearTraining,turns,beyondBosses,engageProbeModule,xCostRelics,ironBasic,domainCards,volibearDomain,defensePowers,basic,common,uncommon,rare,growth,xCards,lethal,engage,optionalEngage,enemyRules,exhaustProbe,volibearHearts,basicPowers,volibearNextPlayDiscount,volibearCopying,volibearNextAttack,selections],build(){
  const extraDraw=s.extraDrawOn===undefined?null:rules.on(cardPiles.exports.drawn,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<{piles:number;card:number}>>(),output:z.boolean(),dependencies:[cardInstances.exports.matchesDefinition],base:(r,c)=>r.query(cardInstances.exports.matchesDefinition,{entity:c.event.card,definition:s.extraDrawOn!})}),
    effect:rules.defineEffect<rules.ReactionContext<{piles:number;card:number}>,void>(b=>rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.input.event.piles),count:1})),
  });
  const queuedUseBlock=s.queuedBlockOnUse===undefined?null:rules.on(battles.exports.used,{
    effect:rules.defineEffect<rules.ReactionContext<import('../src/rules/card-instances.types.ts').CardUse>,void>(b=>rules.enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:s.queuedBlockOnUse!},
      {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),eligible:'captured'})),
  });
  const opponentDefinition=rules.defineEntity(enemyRules.exports.kind,{
    intent:rules.defineQuery({input:z.number(),output:enemyIntentSchema,base:()=>({attack:true,damage:s.enemyAction?.damage??0,attackDamage:s.enemyAction?.damage??0,hits:s.enemyAction?.hits??1})}),
    choose:rules.defineEffect<import('../src/rules/enemies.types.ts').EnemyRoll,number>(b=>b.return(0)),
    act:enemyProgram(...(s.enemyAction?.grant?[enemyPower(s.enemyAction.grant.definition,s.enemyAction.grant.amount)]:[]),enemyAttack(s.enemyAction?.damage??0,s.enemyAction?.hits??1)),
  });
  const entry=rules.defineEffect<void,z.infer<typeof resultSchema>>(b=>{
    const player=b.local<number>(),scope=b.local<number>(),registry=b.local<number>(),rng=b.local<number>(),battle=b.local<number>(),made=b.local<number>();
    const opponents=b.local<number[]>(),masters=b.local<number[]>(),selected=b.local<number>(),played=b.local<number[]>(),controllers=b.local<number[]>(),turnController=b.local<number>();
    const grant=(definition:PowerDefinition,amount:number)=>rules.call(powers.exports.apply,{registry,actor:player,definition,amount,source:player,debuff:false,scope});
    return rules.sequence(
      b.assign(scope,ruleModules.openScope(combatScope,0)),
      b.assign(player,rules.spawnEntity({definition:actor,owner:null,scope:0,setup:{hp:s.hp??80,maxHp:80,energy:s.energy??30,block:s.block??0,gold:0}})),
      ...(s.exhaustObserver?[rules.install({ability:exhaustProbe.exports.external,source:player,owner:player,environment:{},lifetime:scope})]:[]),
      ...(queuedUseBlock?[rules.install({ability:queuedUseBlock,source:player,owner:player,environment:{},lifetime:scope})]:[]),
      rules.call(volibearPlayCounts.exports.trackBattles,{actor:player,scope:0}),
      b.assign(opponents,[]),rules.forEach([0,1,2],at=>rules.sequence(
        b.assign(made,rules.spawnEntity({definition:enemy,owner:null,scope,setup:{hp:b.read(v=>s.enemyHp?.[v.get(at)]??1000),maxHp:1000,energy:0,block:0,gold:0}})),b.assign(opponents,b.read(v=>[...v.get(opponents),v.get(made)])),
      )),
      b.assign(registry,rules.spawnEntity({definition:registryDefinition,owner:player,scope})),
      b.assign(rng,rules.spawnEntity({definition:stream,owner:null,scope,setup:130n})),
      b.assign(masters,[]),
      ...s.plays.filter(p=>p.reuse===undefined&&p.copyOf===undefined&&!p.generated).map(p=>rules.sequence(
        b.assign(made,rules.spawnEntity({definition:p.definition,owner:player,scope:0,setup:{mode:0,master:null,uniqueId:-1,specialData:0,upgraded:p.upgraded??false}})),
        b.assign(masters,b.read(v=>[...v.get(masters),v.get(made)])),
      )),
      ...(s.reserve??[]).map(definition=>rules.sequence(
        b.assign(made,rules.spawnEntity({definition,owner:player,scope:0,setup:{mode:0,master:null,uniqueId:-1,specialData:0,upgraded:false}})),
        b.assign(masters,b.read(v=>[...v.get(masters),v.get(made)])),
      )),
      b.assign(battle,rules.spawnEntity({definition:battleDefinition,owner:player,scope,setup:{actor:player,registry,enemies:opponents,masters,bottled:[],shuffleRng:rng,cardRng:rng,drawPerTurn:5}})),
      b.assign(controllers,[]),
      ...(s.enemyAction||s.endTurns||s.plays.some(p=>p.endBefore)?[rules.forEach(opponents,opponent=>rules.sequence(
        b.assign(made,rules.spawnEntity({definition:opponentDefinition,owner:opponent,scope,setup:{actor:opponent,battle,aiRng:rng,ascension:20}})),
        b.assign(controllers,b.read(v=>[...v.get(controllers),v.get(made)])),
      ))]:[]),
      ...(s.strength?[grant(basicPowers.exports.Strength,s.strength)]:[]),
      ...(s.dexterity?[grant(basicPowers.exports.Dexterity,s.dexterity)]:[]),
      ...(s.weak?[grant(basicPowers.exports.PlayerWeak,1)]:[]),
      ...(s.frail?[grant(basicPowers.exports.Frail,1)]:[]),
      ...(s.chemicalX?[rules.call(relics.exports.obtain,{actor:player,definition:xCostRelics.exports.ChemicalX,scope:0})]:[]),
      ...(s.heart||s.immortal?[rules.call(relics.exports.obtain,{actor:player,definition:volibearHearts.exports.HuntersHeart,scope:0})]:[]),
      ...(s.immortal?[rules.call(relics.exports.obtain,{actor:player,definition:volibearHearts.exports.ImmortalHeart,scope:0})]:[]),
      ...(s.endTurns||s.plays.some(p=>p.endBefore)?[b.assign(turnController,rules.spawnEntity({definition:rules.defineEntity(turns.exports.kind,undefined),owner:player,scope,setup:{battle,enemies:controllers,drawPerTurn:0,energyPerTurn:30}}))]:[]),
      rules.call(battles.exports.start,battle),
      ...(s.charge?[rules.call(stormCharge.exports.gain,{battle,owner:player,amount:s.charge})]:[]),
      rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.get(rules.query(battles.exports.current,v.get(battle))).piles),count:s.plays.filter(p=>p.reuse===undefined&&p.copyOf===undefined&&!p.generated).length+(s.reserve?.length??0)}),
      ...[{definitions:s.drawTop??[],zone:'draw' as const},{definitions:s.discardSetup??[],zone:'discard' as const}].flatMap(({definitions,zone})=>definitions.map(definition=>rules.sequence(
        b.assign(selected,b.read(v=>{const piles=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles);const found=v.query(zones.exports.members,piles.hand).find(id=>v.query(cardInstances.exports.matchesDefinition,{entity:id,definition}));if(found===undefined)throw Error('Missing fixture pile setup card');return found;})),
        rules.call(zones.exports.move,{entity:selected,from:b.read(v=>v.query(zones.exports.location,v.get(selected))),to:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles)[zone]),index:b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles)[zone]).length)}),
      ))),
      ...(extraDraw?[rules.install({ability:extraDraw,source:player,owner:player,environment:{},lifetime:scope})]:[]),
      ...(s.observeShuffle?[rules.install({ability:exhaustProbe.exports.shuffle,source:player,owner:player,environment:{},lifetime:scope})]:[]),
      ...(s.enemyPowers??[]).map(power=>rules.call(powers.exports.apply,{registry,actor:b.read(v=>v.get(opponents)[0]!),source:player,definition:power.definition,amount:power.amount,debuff:false,scope})),
      ...(s.domainTurns===undefined?[]:[rules.call(volibearDomain.exports.open,{battle,turns:s.domainTurns})]),
      b.assign(played,[]),
      ...s.plays.map(p=>rules.sequence(
        ...(p.endBefore?[rules.call(turns.exports.endTurn,turnController),rules.call(turns.exports.settle,turnController)]:[]),
        b.assign(selected,b.read(v=>{
          if(p.reuse!==undefined||p.copyOf!==undefined){
            const previous=v.get(played)[(p.reuse??p.copyOf)!];
            if(previous===undefined)throw Error('Fixture reuse must reference an earlier play');return previous;
          }
          const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
          const found=v.get(rules.query(zones.exports.members,piles.hand)).find(id=>v.get(rules.query(cardInstances.exports.matchesDefinition,{entity:id,definition:p.definition}))&&v.query(cardInstances.exports.current,id).upgraded===(p.upgraded??false));
          if(found===undefined)throw Error('Required fixture card is missing');return found;
        })),
        ...(p.copyOf===undefined?[]:[b.assign(selected,rules.call(volibearCopying.exports.copyToHand,{battle,source:selected}))]),
        // Explicit fixture retrieval preserves the identity of a combat card.
        // The next play still goes through normal legality, payment and queue.
        ...(p.reuse===undefined?[]:[rules.when(b.read(v=>{
          const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
          return v.get(rules.query(zones.exports.location,v.get(selected)))!==piles.hand;
        }),rules.call(cardPiles.exports.moveToHand,{
          piles:b.read(v=>v.get(rules.query(battles.exports.current,v.get(battle))).piles),card:selected,
        }))]),
        b.assign(played,b.read(v=>[...v.get(played),v.get(selected)])),
        ...(p.attackBonus===undefined?[]:[rules.call(volibearNextAttack.exports.prepare,{battle,card:selected,amount:p.attackBonus})]),
        ...Array.from({length:p.discounts??0},()=>rules.call(volibearNextPlayDiscount.exports.grant,{battle,card:selected})),
        ...(p.illegal?[rules.when(rules.query(battles.exports.canQueue,{battle,card:selected,target:b.read(v=>v.get(opponents)[p.target??0]!)}),b.return(b.read(()=>{throw Error('Expected illegal card');})))]:[rules.call(battles.exports.queueFromHand,{battle,card:selected,target:b.read(v=>v.get(opponents)[p.target??0]!)} )]),
        rules.call(battles.exports.settle,battle),
      )),
      ...(s.normalEnemyTargets??[]).map(index=>rules.sequence(rules.call(enemyRules.exports.takeTurn,b.read(v=>v.get(controllers)[index]!)),rules.call(battles.exports.settle,battle))),
      ...Array.from({length:s.endTurns??0},()=>rules.sequence(rules.call(turns.exports.endTurn,turnController),rules.call(turns.exports.settle,turnController))),
      b.return(b.read(v=>{
        const playerState=v.get(rules.query(resources.exports.current,v.get(player)));
        const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
        const charge=v.query(stormCharge.exports.current,v.get(battle));
        return {domain:v.query(volibearPresentation.exports.domain,v.get(battle)),charge:charge.amount,spent:charge.spent,turnSpent:charge.turnSpent,exhaust:v.query(zones.exports.members,piles.exhaust).map(id=>v.query(cardInstances.exports.metadata,id).name),masterGrowth:v.get(masters).map(id=>v.query(volibearTraining.exports.permanentBonus,id)),effects:v.query(volibearPresentation.exports.effects,{battle:v.get(battle),enemies:v.get(opponents)}).map(e=>e.name+':'+e.level),hp:playerState.hp,block:playerState.block,energy:playerState.energy,enemies:v.get(opponents).map(id=>v.get(rules.query(resources.exports.current,id)).hp),hand:v.get(rules.query(zones.exports.members,piles.hand)).length};
      })),
    );
  });
  return{exports:{entry}};
  }});
  const entry=fixtureModule.exports.entry;
  return linkRules({id:'sts/volibear-content',schemas:{setup:z.undefined(),result:resultSchema,ports:{decision:{input:choiceRequestSchema,output:choiceReplySchema}}},initialize:()=>({}),entry,definitions:[entry],modules:[fixtureModule]});
}
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

const cases:{name:string;scenario:Scenario;block:number;enemies:number[];energy?:number;hp?:number;answers?:string[][];hand?:number;charge?:number;spent?:number;turnSpent?:number;exhaust?:string[];restore?:boolean;effects?:string[];domain?:{active:boolean;untilTurn:number|null}}[]=[

  ...[false,true].flatMap(upgraded=>[
    {name:`轰雷重击加强单体保留群雷升级=${upgraded}`,scenario:{charge:1,plays:[{definition:common.exports.ThunderSmash,upgraded}]},block:0,enemies:upgraded?[964,990,990]:[972,992,992],energy:28,spent:1},
    {name:`先声夺人放弃迎战仍提供基础伤害升级=${upgraded}`,scenario:{enemyAction:{damage:10,hits:1},plays:[{definition:optionalEngage.exports.FirstToStrike,upgraded}]},answers:[['放弃']],block:0,enemies:[upgraded?984:988,1000,1000]},
    {name:`雷霆爪击提高基础伤害仍供给资源升级=${upgraded}`,scenario:{plays:[{definition:common.exports.LightningClaw,upgraded}]},block:0,enemies:[upgraded?986:990,1000,1000],charge:2},
    {name:`乘势追击无需敌人行动即可抽牌升级=${upgraded}`,scenario:{reserve:[basic.exports.Defend],drawTop:[basic.exports.Defend],plays:[{definition:common.exports.Pursuit,upgraded}]},block:0,enemies:[upgraded?986:990,1000,1000],hand:1},
    {name:`暴烈撕咬三段分别吃力量升级=${upgraded}`,scenario:{strength:2,plays:[{definition:uncommon.exports.SavageBite,upgraded}]},block:0,enemies:[upgraded?961:970,1000,1000]},
    {name:`以牙还牙保留吸收量并增强即时攻防升级=${upgraded}`,scenario:{enemyAction:{damage:10,hits:1},plays:[{definition:engage.exports.EyeForEye,upgraded}]},block:upgraded?10:5,enemies:[upgraded?978:982,1000,1000]},
    {name:`正面迎敌可以只防御升级=${upgraded}`,scenario:{enemyAction:{damage:10,hits:1},plays:[{definition:optionalEngage.exports.FaceTheEnemy,upgraded}]},answers:[['放弃']],block:upgraded?14:11,enemies:[1000,1000,1000]},
    {name:`厚重皮毛统一结算力量敏捷与脆弱升级=${upgraded}`,scenario:{strength:3,dexterity:2,frail:true,plays:[{definition:common.exports.ThickFur,upgraded}]},block:upgraded?13:11,enemies:[1000,1000,1000]},
    {name:`迎风咆哮直接减伤且保留格挡升级=${upgraded}`,scenario:{enemyAction:{damage:8,hits:1},normalEnemyTargets:[0],plays:[{definition:uncommon.exports.WindRoar,upgraded}]},block:upgraded?6:3,enemies:[1000,1000,1000]},
    {name:`雷霆反扑只产生一批群雷升级=${upgraded}`,scenario:{charge:1,enemyAction:{damage:10,hits:1},plays:[{definition:engage.exports.ThunderCounter,upgraded}]},block:upgraded?10:5,enemies:upgraded?[981,981,981]:[983,983,983],charge:0,spent:1},
    {name:`显圣群体虚弱没有直接格挡升级=${upgraded}`,scenario:{enemyAction:{damage:8,hits:1},normalEnemyTargets:[0,1,2],plays:[{definition:domainCards.exports.ManifestDivinity,upgraded}]},hp:62,block:0,enemies:[1000,1000,1000],energy:28},
    {name:`风暴前夕当回合抽牌展开而不预支能量升级=${upgraded}`,scenario:{reserve:[basic.exports.Defend,basic.exports.Defend,basic.exports.Defend],drawTop:[basic.exports.Defend,basic.exports.Defend,basic.exports.Defend],plays:[{definition:uncommon.exports.Prepared,upgraded}]},block:0,enemies:[1000,1000,1000],energy:29,hand:upgraded?3:2,domain:{active:true,untilTurn:2}},
    {name:`稳住阵脚提供格挡领域与抽牌升级=${upgraded}`,scenario:{reserve:[basic.exports.Defend],drawTop:[basic.exports.Defend],plays:[{definition:common.exports.HoldGround,upgraded}]},block:upgraded?11:8,enemies:[1000,1000,1000],hand:1},
  ]),
  {name:'护身在选择保存恢复后保留每份反击',restore:true,scenario:{charge:2,enemyAction:{damage:4,hits:2},plays:[{definition:common.exports.ThunderGuard},{definition:common.exports.ThunderGuard,upgraded:true},{definition:optionalEngage.exports.FaceTheEnemy}]},answers:[['迎战']],block:3,enemies:[978,1000,1000],charge:0,spent:2},
  ...[false,true].flatMap(upgraded=>[
    {name:`护身普通多段完全格挡仍逐段反击升级=${upgraded}`,scenario:{block:20,enemyAction:{damage:4,hits:3},normalEnemyTargets:[0],plays:[{definition:common.exports.ThunderGuard,upgraded}]},hp:80,block:8,enemies:[upgraded?985:991,1000,1000],exhaust:upgraded?[]:['雷霆护身']},
    {name:`护身迎战多段与蓄雷雷甲升级=${upgraded}`,scenario:{charge:3,enemyAction:{damage:4,hits:3},normalEnemyTargets:[0],plays:[{definition:storm.exports.ThunderArmor},{definition:common.exports.ThunderGuard,upgraded},{definition:engage.exports.StandAndFight}]},hp:80,block:4,enemies:[upgraded?976:982,1000,1000],charge:0,spent:3},
    {name:`护身反击击杀停止余下多段升级=${upgraded}`,scenario:{enemyHp:[3,1000,1000] as const,enemyAction:{damage:4,hits:3},normalEnemyTargets:[0],plays:[{definition:common.exports.ThunderGuard,upgraded}]},hp:76,block:0,enemies:[0,1000,1000]},
    {name:`风暴不散零费首次展开升级=${upgraded}`,scenario:{reserve:[basic.exports.Strike],plays:[{definition:domainCards.exports.LingeringStorm,upgraded}]},block:0,enemies:[1000,1000,1000],energy:30,domain:{active:true,untilTurn:upgraded?3:2}},
    {name:`奔雷支付联动雷甲升级=${upgraded}`,scenario:{charge:2,plays:[{definition:storm.exports.ThunderArmor},{definition:storm.exports.GatherCharge,upgraded}]},block:6,enemies:[1000,1000,1000],charge:0,spent:2,energy:upgraded?32:31},
  ]),
  {name:'护身反击击杀最后敌人安全结束迎战',scenario:{enemyHp:[3,0,0],enemyAction:{damage:4,hits:3},plays:[{definition:common.exports.ThunderGuard},{definition:engage.exports.EyeForEye}]},hp:80,block:11,enemies:[0,0,0]},
  {name:'护身不在玩家致死攻击后反击挽救死亡',scenario:{hp:3,enemyHp:[3,1000,1000],enemyAction:{damage:4,hits:3},normalEnemyTargets:[0],plays:[{definition:common.exports.ThunderGuard}]},hp:0,block:0,enemies:[3,1000,1000]},
  {name:'护身反击不算打出攻击且不重复触发神躯',scenario:{enemyAction:{damage:1,hits:3},normalEnemyTargets:[0],plays:[{definition:rare.exports.BattleBody},{definition:common.exports.ThunderGuard}]},hp:77,block:0,enemies:[991,1000,1000],effects:['愈战神躯:1','雷霆护身:3']},
  {name:'护身独立叠放每份各消耗蓄雷且不打其他敌人',scenario:{charge:2,block:10,enemyAction:{damage:4,hits:1},normalEnemyTargets:[0],plays:[{definition:common.exports.ThunderGuard},{definition:common.exports.ThunderGuard,upgraded:true}]},hp:80,block:6,enemies:[986,1000,1000],charge:0,spent:2,domain:{active:true,untilTurn:3}},
  {name:'护身反击击杀后以牙还牙跳过死目标',scenario:{enemyHp:[3,1000,1000],enemyAction:{damage:4,hits:3},plays:[{definition:common.exports.ThunderGuard},{definition:engage.exports.EyeForEye}]},hp:80,block:11,enemies:[0,1000,1000]},
  {name:'护身与余威逐批雷击获得格挡',scenario:{enemyAction:{damage:2,hits:3},normalEnemyTargets:[0],plays:[{definition:uncommon.exports.ThunderAftershock},{definition:common.exports.ThunderGuard}]},hp:78,block:2,enemies:[991,1000,1000]},
  {name:'护身跨玩家回合失效而领域累加保留',scenario:{reserve:[basic.exports.Strike],endTurns:2,enemyAction:{damage:1,hits:1},plays:[{definition:common.exports.ThunderGuard},{definition:domainCards.exports.LingeringStorm,upgraded:true}]},hp:74,block:0,enemies:[997,997,997],domain:{active:true,untilTurn:4}},
  {name:'普通展开连续叠加并在第二个玩家开始前结束',scenario:{endTurns:2,plays:[{definition:common.exports.HoldGround},{definition:common.exports.HoldGround}]},block:0,enemies:[1000,1000,1000],domain:{active:false,untilTurn:3}},
  {name:'普通展开次回合继续增加剩余时间',scenario:{plays:[{definition:common.exports.HoldGround},{definition:common.exports.HoldGround,reuse:0,endBefore:true}]},block:8,enemies:[1000,1000,1000],domain:{active:true,untilTurn:3}},
  {name:'永久领域不被普通展开或延长降级',scenario:{domainTurns:null,plays:[{definition:common.exports.HoldGround},{definition:domainCards.exports.LingeringStorm,upgraded:true}]},block:8,enemies:[1000,1000,1000],domain:{active:true,untilTurn:null}},
  ...[0,1].map(charge=>({name:`奔雷不足资源不可打出charge=${charge}`,scenario:{charge,plays:[{definition:storm.exports.GatherCharge,illegal:true}]},block:0,enemies:[1000,1000,1000],energy:30,charge,spent:0,exhaust:[]})),
  ...[false,true].map(upgraded=>({name:`解放本能支付一费并抽至目标手牌，升级=${upgraded}`,scenario:{reserve:Array.from({length:9},()=>basic.exports.Defend),drawTop:Array.from({length:9},()=>basic.exports.Defend),plays:[{definition:rare.exports.UnleashInstinct,upgraded}]},energy:29,hand:upgraded?9:7,block:0,enemies:[1000,1000,1000]})),
  {name:'暴风再临重复完整多段效果且只支付一次攻击费用',scenario:{plays:[{definition:uncommon.exports.StormReturns},{definition:common.exports.TwinClaws}]},energy:28,block:0,enemies:[980,1000,1000]},
  {name:'重复攻击按雷击批次耗蓄雷，不触发旧遗物效果',scenario:{heart:true,plays:[{definition:uncommon.exports.StormReturns},{definition:basic.exports.ThunderClaw},{definition:basic.exports.Strike}]},energy:27,block:0,enemies:[973,993,993]},
  {name:'重复攻击本身不再使紧咬成长',scenario:{plays:[{definition:uncommon.exports.StormReturns},{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,reuse:1}]},energy:27,block:0,enemies:[976,1000,1000]},
  {name:'重复X费攻击沿用已付X且不再次支付',scenario:{energy:4,plays:[{definition:uncommon.exports.StormReturns},{definition:xCards.exports.ThunderTrample}]},energy:0,block:0,enemies:[952,982,982]},
  {name:'原生群体攻击不消耗下一张指定单体重复',scenario:{plays:[{definition:uncommon.exports.StormReturns},{definition:common.exports.ThunderSweep},{definition:basic.exports.Strike}]},energy:27,block:0,enemies:[979,991,991]},
  {name:'愈战神躯在重复完整结束后只奖励一次',scenario:{plays:[{definition:rare.exports.BattleBody},{definition:uncommon.exports.StormReturns},{definition:basic.exports.ThunderClaw},{definition:basic.exports.Strike}]},energy:26,block:0,enemies:[975,996,996]},
  {name:'风暴即我扩展铁甲攻击但只获得一次自身格挡',scenario:{plays:[{definition:rare.exports.StormIsMe},{definition:ironBasic.exports.IronWave}]},energy:27,block:5,enemies:[995,995,995]},
  {name:'风暴即我扩展铁甲单体易伤并按敌人计算后续伤害',scenario:{plays:[{definition:rare.exports.StormIsMe},{definition:ironBasic.exports.Bash},{definition:ironBasic.exports.StrikeRed}]},energy:25,block:0,enemies:[983,983,983]},
  {name:'愈战神躯读取铁甲牌面挡并排除额外响应',scenario:{plays:[{definition:rare.exports.BattleBody},{definition:ironBasic.exports.IronWave},{definition:ironBasic.exports.DefendRed}]},energy:27,block:11,enemies:[995,1000,1000]},
  {name:'风暴即我扩展霆爪攻击且群雷只给一次',scenario:{plays:[{definition:rare.exports.StormIsMe},{definition:basic.exports.ThunderClaw}]},energy:27,block:0,enemies:[991,991,991]},
  {name:'风暴即我不复制原生群攻与群雷',scenario:{plays:[{definition:rare.exports.StormIsMe},{definition:common.exports.ThunderSweep}]},energy:27,block:0,enemies:[991,991,991]},
  {name:'风暴即我传导只从保留的主目标发出',scenario:{plays:[{definition:rare.exports.StormIsMe},{definition:uncommon.exports.StormConduction},{definition:basic.exports.Strike}]},energy:26,block:0,enemies:[988,982,982]},
  {name:'风暴即我下以牙还牙分别读取迎战收据',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:rare.exports.StormIsMe},{definition:engage.exports.EyeForEye}]},hp:47,energy:26,block:0,enemies:[977,992,992]},
  {name:'风暴即我下雷霆反扑仅结算一次原生群雷',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:rare.exports.StormIsMe},{definition:engage.exports.ThunderCounter}]},hp:47,energy:26,block:0,enemies:[981,981,981]},
  {name:'风暴即我主目标死亡后其余目标仍承受后续段',scenario:{enemyHp:[3,1000,1000],plays:[{definition:rare.exports.StormIsMe},{definition:common.exports.TwinClaws}]},energy:27,block:0,enemies:[0,990,990]},
  {name:'传导入场群雷后由单体攻击主目标传导',scenario:{plays:[{definition:uncommon.exports.StormConduction},{definition:basic.exports.Strike}]},energy:28,block:0,enemies:[988,988,988]},
  {name:'传导包含主目标的过量伤害',scenario:{enemyHp:[8,1000,1000],plays:[{definition:uncommon.exports.StormConduction},{definition:basic.exports.Strike}]},energy:28,block:0,enemies:[0,988,988]},
  {name:'传导逐段触发且不从雷伤递归',scenario:{plays:[{definition:uncommon.exports.StormConduction},{definition:common.exports.TwinClaws}]},energy:28,block:0,enemies:[984,984,984]},
  {name:'传导不把原生群体攻击作为指定单体命中',scenario:{plays:[{definition:uncommon.exports.StormConduction},{definition:common.exports.ThunderSweep}]},energy:28,block:0,enemies:[985,985,985]},
  {name:'愈战神躯只奖励霆爪力量，防御单独奖励敏捷',scenario:{plays:[{definition:rare.exports.BattleBody},{definition:basic.exports.ThunderClaw},{definition:basic.exports.Defend},{definition:basic.exports.Strike}]},energy:26,block:5,enemies:[984,998,998]},
  {name:'愈战神躯不从新遗物获得牌面格挡奖励',scenario:{heart:true,plays:[{definition:rare.exports.BattleBody},{definition:common.exports.Approach},{definition:basic.exports.Strike},{definition:basic.exports.Defend}]},energy:27,block:5,enemies:[987,1000,1000]},
  {name:'显圣施加虚弱并立即压制既有伤害限制',scenario:{enemyPowers:[{definition:defensePowers.exports.EnemyIntangible,amount:1}],plays:[{definition:domainCards.exports.ManifestDivinity},{definition:basic.exports.Strike}]},energy:27,block:0,enemies:[994,1000,1000]},
  {name:'只准交锋先展开领域再完整迎战',scenario:{enemyAction:{damage:8,hits:2,grant:{definition:defensePowers.exports.EnemyIntangible,amount:1}},plays:[{definition:domainCards.exports.OnlyCombat},{definition:basic.exports.Strike}]},hp:64,energy:28,block:0,enemies:[994,1000,1000]},
  {name:'领域允许敌人当前行动新获力量并增幅攻击',scenario:{enemyAction:{damage:8,hits:2,grant:{definition:basicPowers.exports.Strength,amount:3}},plays:[{definition:domainCards.exports.OnlyCombat}]},hp:58,energy:29,block:0,enemies:[1000,1000,1000]},
  {name:'重返蛮荒的无领域和已有领域分支互斥',scenario:{hp:60,plays:[{definition:domainCards.exports.ReturnToWild},{definition:domainCards.exports.ReturnToWild},{definition:basic.exports.Strike}]},hp:64,energy:25,block:0,enemies:[990,1000,1000]},
  {name:'升级重返蛮荒在已有领域仍给力量并治疗',scenario:{hp:60,domainTurns:1,plays:[{definition:domainCards.exports.ReturnToWild,upgraded:true},{definition:basic.exports.Strike}]},hp:66,energy:27,block:0,enemies:[991,1000,1000]},
  {name:'领域压制敌人既有无实体的伤害限制',scenario:{domainTurns:1,enemyPowers:[{definition:defensePowers.exports.EnemyIntangible,amount:1}],plays:[{definition:basic.exports.Strike}]},block:0,enemies:[994,1000,1000]},
  {name:'没有领域时敌人无实体仍正常限制伤害',scenario:{enemyPowers:[{definition:defensePowers.exports.EnemyIntangible,amount:1}],plays:[{definition:basic.exports.Strike}]},block:0,enemies:[999,1000,1000]},
  {name:'领域压制敌人神器而保留玩家施加的易伤',scenario:{domainTurns:1,enemyPowers:[{definition:basicPowers.exports.EnemyArtifact,amount:1}],plays:[{definition:common.exports.TearWound},{definition:basic.exports.Strike}]},block:0,enemies:[983,1000,1000]},
  {name:'领域保留敌人力量对完整攻击的增益',scenario:{domainTurns:1,enemyPowers:[{definition:basicPowers.exports.Strength,amount:3}],enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.StandAndFight}]},hp:65,block:0,enemies:[1000,1000,1000]},
  {name:'领域净化实际抽到坏牌且保留外部消耗响应',scenario:{domainTurns:1,exhaustObserver:true,reserve:[basic.exports.Defend,exhaustProbe.exports.curse],drawTop:[basic.exports.Defend,exhaustProbe.exports.curse],plays:[{definition:selections.exports.AncientInstinct}]},answers:[[]],energy:30,hand:1,block:4,enemies:[1000,1000,1000]},
  {name:'领域不净化展开前已有的手牌',scenario:{domainTurns:1,exhaustObserver:true,reserve:[exhaustProbe.exports.curse],plays:[{definition:basic.exports.Defend}]},energy:29,hand:1,block:5,enemies:[1000,1000,1000]},
  {name:'领域补抽与父批次只兑现一次预排洗牌',scenario:{domainTurns:1,exhaustObserver:true,observeShuffle:true,reserve:[exhaustProbe.exports.curse,basic.exports.Defend,basic.exports.Defend],drawTop:[exhaustProbe.exports.curse],discardSetup:[basic.exports.Defend,basic.exports.Defend],plays:[{definition:selections.exports.AncientInstinct}]},answers:[[]],energy:31,hand:1,block:4,enemies:[1000,1000,1000]},
  {name:'猎物未倒入场抽牌不减费',scenario:{reserve:[uncommon.exports.SavageBite],drawTop:[uncommon.exports.SavageBite],plays:[{definition:uncommon.exports.PreyStillStands},{definition:uncommon.exports.SavageBite,generated:true}]},energy:27,block:0,enemies:[976,1000,1000]},
  {name:'猎物未倒第二次同目标攻击触发抽牌减费',scenario:{reserve:[uncommon.exports.SavageBite,basic.exports.Defend],drawTop:[uncommon.exports.SavageBite,basic.exports.Defend],plays:[{definition:uncommon.exports.PreyStillStands},{definition:basic.exports.Strike},{definition:common.exports.TwinClaws},{definition:uncommon.exports.SavageBite,generated:true}]},energy:26,block:0,enemies:[960,1000,1000]},
  {name:'猎物未倒的外部嵌套补抽不继承减费',scenario:{extraDrawOn:uncommon.exports.SavageBite,reserve:[uncommon.exports.MountainCollapse,uncommon.exports.SavageBite,basic.exports.Defend],drawTop:[uncommon.exports.MountainCollapse,uncommon.exports.SavageBite,basic.exports.Defend],plays:[{definition:uncommon.exports.PreyStillStands},{definition:basic.exports.Strike},{definition:common.exports.TwinClaws},{definition:uncommon.exports.SavageBite,generated:true},{definition:uncommon.exports.MountainCollapse,generated:true}]},energy:25,block:0,enemies:[932,1000,1000]},
  {name:'扯碎束缚禁止坏牌自身消耗响应但保留外部响应',scenario:{exhaustObserver:true,reserve:[exhaustProbe.exports.curse],plays:[{definition:selections.exports.TearBonds}]},answers:[['自响应诅咒']],energy:30,block:4,enemies:[1000,1000,1000]},
  {name:'暴风换气消耗坏牌时禁止其自身响应',scenario:{exhaustObserver:true,reserve:[exhaustProbe.exports.curse],plays:[{definition:selections.exports.StormBreathing}]},energy:30,block:4,enemies:[1000,1000,1000]},
  {name:'暴风换气消耗正常牌时保留其自身响应',scenario:{exhaustObserver:true,reserve:[exhaustProbe.exports.skill],plays:[{definition:selections.exports.StormBreathing}]},energy:37,block:4,enemies:[1000,1000,1000]},
  {name:'正面迎敌允许放弃且保留格挡',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:optionalEngage.exports.FaceTheEnemy}]},answers:[['放弃']],block:11,enemies:[1000,1000,1000]},
  {name:'正面迎敌确认后完整执行敌人行动',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:optionalEngage.exports.FaceTheEnemy}]},answers:[['迎战']],hp:75,block:0,enemies:[1000,1000,1000]},
  {name:'先声夺人先攻击再询问是否迎战',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:optionalEngage.exports.FirstToStrike}]},answers:[['迎战']],hp:64,block:0,enemies:[988,1000,1000]},
  {name:'先声夺人击杀主目标后不询问已不存在的迎战',scenario:{enemyHp:[10,1000,1000],enemyAction:{damage:8,hits:2},plays:[{definition:optionalEngage.exports.FirstToStrike}]},block:0,enemies:[0,1000,1000]},
  {name:'迎战完成边界不提前执行调用者后续格挡任务',scenario:{queuedBlockOnUse:100,enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.StandAndFight}]},hp:71,block:100,enemies:[1000,1000,1000]},
  {name:'挺身迎战完整执行两段且正常阶段不再行动',scenario:{enemyAction:{damage:8,hits:2},normalEnemyTargets:[0],plays:[{definition:engage.exports.StandAndFight}]},hp:71,block:0,enemies:[1000,1000,1000]},
  {name:'以牙还牙等两段结束后按吸收总量反击',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.EyeForEye}]},hp:79,block:0,enemies:[977,1000,1000]},
  {name:'铸躯先恢复实际支出再返回迎战反击',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.ThunderForged},{definition:engage.exports.EyeForEye}]},block:21,enemies:[976,1000,1000]},
  {name:'铸躯不在多段中途恢复以挽救本应死亡的玩家',scenario:{hp:3,enemyAction:{damage:20,hits:2},plays:[{definition:engage.exports.ThunderForged},{definition:engage.exports.EyeForEye}]},hp:0,block:0,enemies:[1000,1000,1000]},
  {name:'铸躯恢复之后战无止境才增加吸收量',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.ThunderForged},{definition:engage.exports.EndlessBattle},{definition:engage.exports.StandAndFight}]},block:39,enemies:[1000,1000,1000]},
  {name:'不动神躯两段均吸收而铸躯没有支出可恢复',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:rare.exports.ImmovableBody},{definition:engage.exports.ThunderForged},{definition:engage.exports.StandAndFight}]},block:19,enemies:[1000,1000,1000]},
  {name:'不动神躯超出当前挡值的每段仍各自扣血',scenario:{enemyAction:{damage:16,hits:2},plays:[{definition:rare.exports.ImmovableBody},{definition:engage.exports.StandAndFight}]},hp:74,block:13,enemies:[1000,1000,1000]},
  {name:'迎战死亡后不执行反击收益',scenario:{hp:3,enemyAction:{damage:10,hits:2},plays:[{definition:engage.exports.EyeForEye}]},hp:0,block:0,enemies:[1000,1000,1000]},
  {name:'雷霆反扑按完整迎战的吸收量结算一次群雷',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.ThunderCounter}]},hp:79,block:0,enemies:[981,981,981]},
  {name:'众敌皆来依次执行三名敌人后汇总实际吸收量',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:engage.exports.AllEnemiesCome}]},hp:52,block:0,enemies:[980,980,980]},
  {name:'雷伤不吃力量与虚弱，霆爪群雷包含主目标',scenario:{strength:3,weak:true,plays:[{definition:basic.exports.ThunderClaw}]},block:0,enemies:[991,998,998]},
  {name:'霆爪先攻击后群雷，升级数值独立',scenario:{plays:[{definition:basic.exports.ThunderClaw,upgraded:true}]},block:0,enemies:[987,997,997]},
  {name:'厚重皮毛合并正力量、敏捷后统一吃脆弱',scenario:{strength:5,dexterity:2,frail:true,plays:[{definition:common.exports.ThickFur}]},block:12,enemies:[1000,1000,1000]},
  {name:'厚重皮毛不把负力量扣入基础格挡',scenario:{strength:-5,plays:[{definition:common.exports.ThickFur}]},block:10,enemies:[1000,1000,1000]},
  {name:'雷震为两批雷击，三名敌人不把余威变为六次',scenario:{plays:[{definition:uncommon.exports.ThunderAftershock},{definition:common.exports.ThunderShock}]},block:4,enemies:[986,986,986]},
  {name:'万古不灭替换初始遗物，开战仅给2蓄雷且不随攻击触发',scenario:{immortal:true,reserve:[basic.exports.Defend],drawTop:[basic.exports.Defend],plays:[{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,hand:0,enemies:[988,1000,1000]},
  ...[false,true].map(domain=>({name:`好奇按能力牌增加力量，领域=${domain}`,scenario:{...(domain?{domainTurns:1}:{}),enemyPowers:[{definition:beyondBosses.exports.Curiosity,amount:2}],enemyAction:{damage:8,hits:2},plays:[{definition:uncommon.exports.GatheringThunder},{definition:engage.exports.StandAndFight}]},hp:67,block:0,enemies:[1000,1000,1000]})),
  {name:'不灭狂雷首批群雷只扣1点且不提供旧格挡',scenario:{heart:true,dexterity:3,plays:[{definition:basic.exports.ThunderClaw},{definition:common.exports.ThunderSweep}]},block:0,enemies:[979,986,986]},
  {name:'不灭狂雷不因更换攻击目标触发额外伤害',scenario:{heart:true,plays:[{definition:basic.exports.Strike,target:0},{definition:basic.exports.Strike,target:1}]},block:0,enemies:[994,994,1000]},
  {name:'双爪的两个命中不是第二张攻击',scenario:{heart:true,plays:[{definition:common.exports.TwinClaws}]},block:0,enemies:[990,1000,1000]},
  {name:'全身之力三倍挡不再次吃敏捷脆弱',scenario:{block:12,dexterity:5,frail:true,plays:[{definition:rare.exports.WholeBodyStrength}]},block:36,enemies:[1000,1000,1000]},
  {name:'负力量保持不变且原始力量不提供负雷伤',scenario:{strength:-3,plays:[{definition:uncommon.exports.PrimalStrength},{definition:basic.exports.Strike}]},block:0,enemies:[997,1000,1000]},
  {name:'蓄力的临时力量参与每段攻击',scenario:{plays:[{definition:common.exports.Charge},{definition:common.exports.TwinClaws}]},block:0,enemies:[982,1000,1000]},
  {name:'升级蓄力和力量归身保留当前力量数值',scenario:{plays:[{definition:common.exports.Charge,upgraded:true},{definition:uncommon.exports.StrengthReclaimed},{definition:basic.exports.Strike}]},block:0,enemies:[986,1000,1000]},
  {name:'稳住阵脚无行动收据时只给基础格挡',scenario:{dexterity:2,frail:true,plays:[{definition:common.exports.HoldGround}]},block:7,enemies:[1000,1000,1000]},
  {name:'愈战愈烈第二张攻击结束后成长，第三张获得加成',scenario:{plays:[{definition:uncommon.exports.GrowingFury},{definition:basic.exports.Strike},{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,enemies:[978,1000,1000]},
  {name:'升级愈战愈烈入场仍为1力量，触发改为2',scenario:{plays:[{definition:uncommon.exports.GrowingFury,upgraded:true},{definition:basic.exports.Strike},{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,enemies:[977,1000,1000]},
  {name:'第二张攻击之后部署愈战愈烈不补发本回合触发',scenario:{plays:[{definition:basic.exports.Strike},{definition:basic.exports.Strike},{definition:uncommon.exports.GrowingFury},{definition:basic.exports.Strike}]},block:0,enemies:[981,1000,1000]},
  {name:'势不可挡不把一次双爪当成两张攻击',scenario:{plays:[{definition:common.exports.TwinClaws},{definition:uncommon.exports.Unstoppable}]},block:0,energy:28,enemies:[980,1000,1000]},
  {name:'势不可挡在此前两张攻击后返还2能量，无需猎心',scenario:{plays:[{definition:common.exports.TwinClaws},{definition:basic.exports.Strike},{definition:uncommon.exports.Unstoppable}]},block:0,energy:29,enemies:[974,1000,1000]},
  {name:'两张淬躯爪击不共享单张牌的格挡成长',scenario:{plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw}]},block:12,enemies:[984,1000,1000]},
  {name:'升级淬躯爪击先给当前基础格挡，再成长',scenario:{dexterity:2,frail:true,plays:[{definition:growth.exports.TemperingClaw,upgraded:true}]},block:7,enemies:[989,1000,1000]},
  {name:'同一张淬躯爪击再次打出使用已增长的基础格挡',scenario:{plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw,reuse:0}]},block:14,enemies:[984,1000,1000]},
  {name:'淬躯成长先并入基础格挡，再统一应用敏捷脆弱',scenario:{dexterity:2,frail:true,plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw,reuse:0}]},block:13,enemies:[984,1000,1000]},
  {name:'重复授予同类下次减费只减少1费',scenario:{plays:[{definition:uncommon.exports.SavageBite,discounts:2}]},block:0,energy:29,enemies:[976,1000,1000]},
  {name:'下次减费覆盖实际付款，回收再次打出恢复原费用',scenario:{plays:[{definition:uncommon.exports.SavageBite,discounts:1},{definition:uncommon.exports.SavageBite,reuse:0}]},block:0,energy:27,enemies:[952,1000,1000]},
  {name:'化学物X让3费万钧连踏结算5轮而只付3费',scenario:{chemicalX:true,energy:3,plays:[{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[960,985,985]},
  {name:'化学物X在零能量时仍提供两轮万钧连踏',scenario:{chemicalX:true,energy:0,plays:[{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[984,994,994]},
  {name:'化学物X升级万钧连踏重复沿用付款各获两轮加成',scenario:{chemicalX:true,energy:4,plays:[{definition:uncommon.exports.StormReturns},{definition:xCards.exports.ThunderTrample,upgraded:true}]},block:0,energy:0,enemies:[900,970,970]},
  {name:'万钧连踏支付3能量结算3轮，群雷包含主目标',scenario:{energy:3,plays:[{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[976,991,991]},
  {name:'万钧连踏主目标死亡后余下群雷继续',scenario:{energy:3,enemyHp:[10,1000,1000],plays:[{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[0,991,991]},
  {name:'零能量万钧连踏不产生空雷击结算',scenario:{energy:1,plays:[{definition:uncommon.exports.ThunderAftershock},{definition:xCards.exports.ThunderTrample}]},block:0,energy:0,enemies:[1000,1000,1000]},
  {name:'饮血而战直接击杀治疗4，未击杀不治疗',scenario:{hp:60,enemyHp:[20,1000,1000],plays:[{definition:lethal.exports.BloodBattle},{definition:lethal.exports.BloodBattle,target:1}]},hp:64,block:0,enemies:[0,979,1000]},
  {name:'升级饮血而战击杀治疗6',scenario:{hp:60,enemyHp:[25,1000,1000],plays:[{definition:lethal.exports.BloodBattle,upgraded:true}]},hp:66,block:0,enemies:[0,1000,1000]},
  {name:'饮血而战击杀最后存活敌人先治疗再结束战斗',scenario:{hp:60,enemyHp:[20,0,0],plays:[{definition:lethal.exports.BloodBattle}]},hp:64,block:0,enemies:[0,0,0]},
  {name:'紧咬不放重复打出不自行成长',scenario:{plays:[{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[984,1000,1000]},
  {name:'升级紧咬不放无迎战时保持10伤害',scenario:{plays:[{definition:growth.exports.NeverLetGo,upgraded:true},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[980,1000,1000]},
  {name:'复制紧咬不凭打出产生额外成长',scenario:{plays:[{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,copyOf:0},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[976,1000,1000]},
  {name:'复制淬躯继承格挡成长，复制品后续成长不反写源牌',scenario:{plays:[{definition:growth.exports.TemperingClaw},{definition:growth.exports.TemperingClaw,copyOf:0},{definition:growth.exports.TemperingClaw,reuse:0}]},block:22,enemies:[976,1000,1000]},
  {name:'天人合一的永久加伤作用于双爪每段，力量另行相加',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:common.exports.TwinClaws}]},block:10,enemies:[978,1000,1000]},
  {name:'天人合一不训练挟山的动态伤害，力量仍正常加成',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:uncommon.exports.MountainLift}]},block:10,enemies:[987,1000,1000]},
  {name:'天人合一永久增量与紧咬自身成长分别累加',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:growth.exports.NeverLetGo},{definition:growth.exports.NeverLetGo,reuse:1}]},block:10,enemies:[972,1000,1000]},
  {name:'雷霆铭身在首张双爪结算前增加每段伤害，第二张不再触发',scenario:{plays:[{definition:rare.exports.ThunderInscription},{definition:common.exports.TwinClaws},{definition:common.exports.TwinClaws}]},block:0,enemies:[972,1000,1000]},
  {name:'雷霆铭身永久增量保留，但同回合再次打出不重复增加',scenario:{plays:[{definition:rare.exports.ThunderInscription},{definition:common.exports.TwinClaws},{definition:common.exports.TwinClaws,reuse:1}]},block:0,enemies:[964,1000,1000]},
  {name:'首张固定攻击已打出后部署铭身，本回合不补发',scenario:{plays:[{definition:basic.exports.Strike},{definition:rare.exports.ThunderInscription},{definition:basic.exports.Strike}]},block:0,enemies:[988,1000,1000]},
  {name:'动态伤害攻击不占用雷霆铭身的首张固定攻击机会',scenario:{block:12,plays:[{definition:uncommon.exports.MountainLift},{definition:rare.exports.ThunderInscription},{definition:basic.exports.Strike}]},block:12,enemies:[978,1000,1000]},
  {name:'追猎准备加成覆盖双爪两段，下一次重新打出不再加成',scenario:{plays:[{definition:common.exports.TwinClaws,attackBonus:3},{definition:common.exports.TwinClaws,reuse:0}]},block:0,enemies:[974,1000,1000]},
  {name:'追猎准备一次性加伤不混入紧咬永久成长',scenario:{plays:[{definition:growth.exports.NeverLetGo,attackBonus:3},{definition:growth.exports.NeverLetGo,reuse:0}]},block:0,enemies:[981,1000,1000]},
  {name:'崩山付款不把自身计入此前攻击，首张仍为3费',scenario:{plays:[{definition:uncommon.exports.MountainCollapse}]},block:0,energy:27,enemies:[972,1000,1000]},
  {name:'双爪多段只给崩山减少1费',scenario:{plays:[{definition:common.exports.TwinClaws},{definition:uncommon.exports.MountainCollapse}]},block:0,energy:27,enemies:[962,1000,1000]},
  {name:'攻击其他目标不减少崩山费用',scenario:{plays:[{definition:basic.exports.Strike,target:0},{definition:uncommon.exports.MountainCollapse,target:1}]},block:0,energy:26,enemies:[994,972,1000]},
  {name:'崩山自身减费最低1',scenario:{plays:[{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:uncommon.exports.MountainCollapse}]},block:0,energy:29,enemies:[954,1000,1000]},
  {name:'崩山达到自身下限后外部减费仍可降至0',scenario:{plays:[{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:common.exports.Approach},{definition:uncommon.exports.MountainCollapse,discounts:1}]},block:0,energy:30,enemies:[954,1000,1000]},
  {name:'不休之猎从后续单体攻击开始减费，当前牌不自减',scenario:{plays:[{definition:rare.exports.EndlessHunt},{definition:basic.exports.Strike},{definition:basic.exports.Strike}]},block:0,energy:28,enemies:[988,1000,1000]},
  {name:'不休之猎的减费按目标分别累计',scenario:{plays:[{definition:rare.exports.EndlessHunt},{definition:basic.exports.Strike,target:0},{definition:basic.exports.Strike,target:1}]},block:0,energy:27,enemies:[994,994,1000]},
  {name:'不休之猎不追溯部署前的攻击',scenario:{plays:[{definition:basic.exports.Strike},{definition:rare.exports.EndlessHunt},{definition:basic.exports.Strike}]},block:0,energy:27,enemies:[988,1000,1000]},
  {name:'双爪多段只为不休之猎贡献一次后续减费',scenario:{plays:[{definition:rare.exports.EndlessHunt},{definition:common.exports.TwinClaws},{definition:uncommon.exports.SavageBite}]},block:0,energy:27,enemies:[966,1000,1000]},
  {name:'磨砺爪牙自动强化下一张打出的攻击',scenario:{plays:[{definition:selections.exports.HoneClaws},{definition:common.exports.TwinClaws},{definition:basic.exports.Strike}]},block:0,enemies:[978,1000,1000]},
  {name:'古神技艺只翻倍永久增量，不翻倍力量或印刷伤害',scenario:{plays:[{definition:rare.exports.HeavenAndMan},{definition:selections.exports.AncientCraft},{definition:common.exports.TwinClaws},{definition:basic.exports.Strike}]},answers:[['双爪']],block:10,enemies:[948,1000,1000]},
  {name:'群体回收经过多选为每张牌提供一次减费',scenario:{plays:[{definition:basic.exports.Strike},{definition:common.exports.TwinClaws},{definition:selections.exports.BattleNotOver},{definition:basic.exports.Strike,reuse:0},{definition:common.exports.TwinClaws,reuse:1}]},answers:[['打击','双爪']],block:0,energy:27,enemies:[968,1000,1000]},
  {name:'重整爪牙从弃牌攻击中选择并给予一次减费',scenario:{plays:[{definition:basic.exports.Strike},{definition:common.exports.TwinClaws},{definition:selections.exports.RegroupClaws},{definition:common.exports.TwinClaws,reuse:1}]},answers:[['双爪']],block:0,energy:27,enemies:[974,1000,1000]},
  {name:'将战斗留下实际生成独立攻击并可正常打出',scenario:{plays:[{definition:selections.exports.LeaveBattleBehind},{definition:common.exports.TwinClaws},{definition:basic.exports.Strike},{definition:common.exports.TwinClaws,generated:true}]},answers:[['双爪']],block:0,hand:0,enemies:[974,1000,1000]},
  {name:'迎战准备重复部署不叠加，声明牌之后消耗减费',scenario:{plays:[{definition:uncommon.exports.EngagePreparation},{definition:uncommon.exports.EngagePreparation},{definition:engageProbe},{definition:engageProbe}]},block:10,energy:27,enemies:[1000,1000,1000]},
  {name:'没有迎战声明的防御牌不消耗迎战准备',scenario:{plays:[{definition:uncommon.exports.EngagePreparation},{definition:basic.exports.Defend},{definition:engageProbe}]},block:10,energy:28,enemies:[1000,1000,1000]},
  {name:'升级迎战准备可再次打出但减费仍不叠加',scenario:{plays:[{definition:uncommon.exports.EngagePreparation,upgraded:true},{definition:uncommon.exports.EngagePreparation,reuse:0},{definition:engageProbe}]},block:16,energy:29,enemies:[1000,1000,1000]},
  ...[false,true].flatMap(upgraded=>[
    {name:`积云升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.GatheringClouds,upgraded}]},block:upgraded?12:9,enemies:[1000,1000,1000],charge:7,spent:0},
    {name:`霹雳群雷只耗一次升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.Thunderbolt,upgraded}]},block:0,enemies:upgraded?[988,988,988]:[991,991,991],charge:3,spent:1},
    {name:`雷引消耗升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.LightningSeed,upgraded}]},block:0,enemies:[1000,1000,1000],charge:upgraded?7:6,exhaust:['雷引']},
    {name:`迎雷真实迎战只触发一次升级=${upgraded}`,scenario:{charge:4,enemyAction:{damage:0,hits:1},normalEnemyTargets:[0],plays:[{definition:storm.exports.WelcomeThunder,upgraded},{definition:engage.exports.StandAndFight},{definition:engage.exports.StandAndFight}]},block:14,enemies:[1000,1000,1000],charge:upgraded?9:8},
    {name:`余烬监听正常消耗升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.Embers,upgraded},{definition:storm.exports.LightningSeed}]},block:0,enemies:[1000,1000,1000],charge:upgraded?8:7,exhaust:['雷引']},
    {name:`雷甲按点结算且群雷只消费一次升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.ThunderArmor,upgraded},{definition:storm.exports.Thunderbolt}]},block:upgraded?4:3,enemies:[991,991,991],charge:3,spent:1},
    {name:`雷鸣应战顺序升级=${upgraded}`,scenario:{charge:4,enemyAction:{damage:10,hits:1},plays:[{definition:storm.exports.ThunderChallenge,upgraded}]},hp:upgraded?80:78,block:upgraded?1:0,enemies:upgraded?[992,992,992]:[994,994,994],charge:3,spent:1},
    {name:`奔雷升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.GatherCharge,upgraded}]},block:0,enemies:[1000,1000,1000],charge:2,spent:2,energy:upgraded?33:32,exhaust:['奔雷']},
    {name:`风暴汇聚按存活敌人升级=${upgraded}`,scenario:{charge:4,enemyHp:[0,1000,1000] as const,plays:[{definition:storm.exports.ConvergingStorm,upgraded}]},block:0,enemies:upgraded?[0,989,989]:[0,992,992],charge:5,spent:1},
    {name:`雷势奔袭无消费时正常支付三费升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.StormRush,upgraded}]},block:0,enemies:upgraded?[967,991,991]:[975,993,993],charge:3,energy:27},
    {name:`天雷决耗尽为一批且无额外加三升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.ThunderJudgment,upgraded}]},block:0,enemies:upgraded?[966,984,984]:[974,988,988],charge:0,spent:4},
    {name:`雷池消耗升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.ThunderPool,upgraded}]},block:0,enemies:[1000,1000,1000],charge:upgraded?15:12,exhaust:['雷池']},
    {name:`不息风暴打出立即给资源升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.UnendingStorm,upgraded}]},block:0,enemies:[1000,1000,1000],charge:upgraded?9:7},
    {name:`雷贯长空每段吃力量升级=${upgraded}`,scenario:{charge:4,strength:2,plays:[{definition:storm.exports.ThunderLance,upgraded}]},block:0,enemies:upgraded?[972,1000,1000]:[976,1000,1000],charge:0,spent:4},
    {name:`雷霆化身消耗升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.ThunderAvatar,upgraded}]},block:upgraded?20:16,enemies:[1000,1000,1000],charge:0,spent:4,exhaust:['雷霆化身']},
    {name:`雷痕猎杀无回收候选不扣资源升级=${upgraded}`,scenario:{charge:4,plays:[{definition:selections.exports.ThunderHunt,upgraded}]},block:0,enemies:upgraded?[976,1000,1000]:[982,1000,1000],charge:4},
    {name:`裂天读此前累计消费升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.RendSky,upgraded}]},block:0,enemies:upgraded?[973,997,997]:[979,997,997],charge:3,spent:1},
    {name:`雷涌能量与消耗升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.ThunderSurge,upgraded}]},block:0,enemies:[1000,1000,1000],charge:0,spent:4,energy:33,exhaust:['雷涌']},
    {name:`风暴重临零消费不凭空生成升级=${upgraded}`,scenario:{charge:4,plays:[{definition:storm.exports.StormReborn,upgraded}]},block:0,enemies:[1000,1000,1000],charge:4,exhaust:['风暴重临']},
    {name:`紧咬真实迎战成长升级=${upgraded}`,scenario:{enemyAction:{damage:0,hits:1},plays:[{definition:engage.exports.StandAndFight},{definition:growth.exports.NeverLetGo,upgraded},{definition:growth.exports.NeverLetGo,reuse:1}]},block:7,enemies:upgraded?[964,1000,1000]:[974,1000,1000]},
    {name:`屹立跨回合损耗升级=${upgraded}`,scenario:{reserve:[basic.exports.Strike],block:30,endTurns:1,plays:[{definition:uncommon.exports.Standing,upgraded}]},block:upgraded?34:26,enemies:[1000,1000,1000]},
  ]),
  {name:'新遗物首回合给一点且跨两回合保留',scenario:{heart:true,reserve:[basic.exports.Strike],endTurns:2,plays:[]},block:0,enemies:[1000,1000,1000],charge:3,spent:0,turnSpent:0},
  {name:'升级遗物首回合给两点且替换而非叠加',scenario:{immortal:true,reserve:[basic.exports.Strike],endTurns:2,plays:[]},block:0,enemies:[1000,1000,1000],charge:6,spent:0},
  {name:'跨回合清零消费计数但保留资源和战斗累计',scenario:{charge:4,endTurns:1,plays:[{definition:storm.exports.Thunderbolt}]},block:0,enemies:[991,991,991],charge:3,spent:1,turnSpent:0},
  {name:'多批雷击各扣一点，雷甲和余威分别响应',scenario:{charge:2,plays:[{definition:storm.exports.ThunderArmor},{definition:uncommon.exports.ThunderAftershock},{definition:common.exports.ThunderShock}]},block:10,enemies:[980,980,980],charge:0,spent:2},
  {name:'全量消费只触发一次抽牌但雷甲按实际点数',scenario:{reserve:Array.from({length:5},()=>basic.exports.Defend),drawTop:Array.from({length:5},()=>basic.exports.Defend),plays:[{definition:storm.exports.UnendingStorm},{definition:storm.exports.ThunderArmor},{definition:storm.exports.ThunderJudgment}]},block:9,hand:1,enemies:[977,991,991],charge:0,spent:3},
  {name:'零消费不触发抽牌且空雷贯不攻击',scenario:{plays:[{definition:storm.exports.ThunderLance}]},block:0,enemies:[1000,1000,1000],charge:0,spent:0},
  {name:'雷势奔袭按已消费减至零，风暴重临返还实际消费',scenario:{charge:4,plays:[{definition:storm.exports.ThunderSurge},{definition:storm.exports.StormReborn},{definition:storm.exports.StormRush}]},block:0,enemies:[975,993,993],energy:32,charge:3,spent:5},
  {name:'雷痕猎杀可以放弃回收而保留三点',scenario:{charge:3,plays:[{definition:uncommon.exports.Unstoppable},{definition:selections.exports.ThunderHunt}]},answers:[[]],block:0,enemies:[972,1000,1000],charge:3,spent:0,exhaust:['势不可挡']},
  {name:'雷痕回收只扣三点，恢复选择边界后不重复攻击或消费',restore:true,scenario:{charge:4,plays:[{definition:selections.exports.HoneClaws},{definition:uncommon.exports.Unstoppable},{definition:selections.exports.ThunderHunt},{definition:uncommon.exports.Unstoppable,reuse:1}]},answers:[['势不可挡']],block:0,enemies:[956,1000,1000],charge:1,spent:3},
  {name:'呼吸正常消耗保留牌自身与外部响应',scenario:{exhaustObserver:true,reserve:[exhaustProbe.exports.curse],plays:[{definition:selections.exports.Breathing}]},block:4,energy:36,enemies:[1000,1000,1000],exhaust:['自响应诅咒']},
  {name:'磨砺不被技能消耗，永久提升霆爪攻击和雷伤并由复制继承',scenario:{plays:[{definition:selections.exports.HoneClaws},{definition:basic.exports.Defend},{definition:basic.exports.ThunderClaw},{definition:basic.exports.ThunderClaw,copyOf:2}]},block:5,enemies:[970,990,990]},
  {name:'磨砺可提升动态格挡伤害',scenario:{block:12,plays:[{definition:selections.exports.HoneClaws},{definition:uncommon.exports.MountainLift}]},block:12,enemies:[985,1000,1000]},
  {name:'磨砺可提升非角色攻击且在虚弱前加值',scenario:{weak:true,plays:[{definition:selections.exports.HoneClaws},{definition:ironBasic.exports.StrikeRed}]},block:0,enemies:[994,1000,1000]},
  {name:'原始力量快照正力量只增强雷伤',scenario:{strength:4,plays:[{definition:uncommon.exports.PrimalStrength},{definition:uncommon.exports.StrengthReclaimed},{definition:basic.exports.ThunderClaw}]},block:0,enemies:[981,994,994],exhaust:['原始力量']},
  {name:'原始力量回合结束失效',scenario:{strength:4,plays:[{definition:basic.exports.ThunderClaw},{definition:uncommon.exports.PrimalStrength},{definition:basic.exports.ThunderClaw,reuse:0,endBefore:true}]},block:0,enemies:[974,996,996]},
  {name:'普通不动神躯提供即时格挡',scenario:{dexterity:3,plays:[{definition:rare.exports.ImmovableBody},{definition:rare.exports.BattleBody}]},block:9,enemies:[1000,1000,1000]},
  {name:'升级不动神躯与神躯打出立即给格挡',scenario:{plays:[{definition:rare.exports.ImmovableBody,upgraded:true},{definition:rare.exports.BattleBody,upgraded:true}]},block:20,enemies:[1000,1000,1000]},
  {name:'屹立叠放取较低损耗而非相加',scenario:{reserve:[basic.exports.Strike],block:30,endTurns:1,plays:[{definition:uncommon.exports.Standing},{definition:uncommon.exports.Standing,upgraded:true}]},block:42,enemies:[1000,1000,1000]},
  {name:'战中整备即使无弃牌攻击也获得蓄雷',scenario:{plays:[{definition:selections.exports.BattlePreparation}]},block:10,enemies:[1000,1000,1000],charge:2},
  {name:'紧咬从弃牌堆继续成长，复制继承而不写回永久牌组',scenario:{enemyAction:{damage:0,hits:1},plays:[{definition:growth.exports.NeverLetGo},{definition:engage.exports.StandAndFight},{definition:growth.exports.NeverLetGo,copyOf:0},{definition:growth.exports.NeverLetGo,reuse:0}]},block:7,enemies:[966,1000,1000]},
  {name:'紧咬在抽牌堆中也成长',scenario:{enemyAction:{damage:0,hits:1},reserve:[growth.exports.NeverLetGo],drawTop:[growth.exports.NeverLetGo],plays:[{definition:engage.exports.StandAndFight},{definition:storm.exports.LightningSeed},{definition:growth.exports.NeverLetGo,generated:true}]},block:7,enemies:[987,1000,1000],charge:2},

  {name:'升级磨砺抽二且全伤害永久加五',scenario:{reserve:[basic.exports.Defend,basic.exports.Defend],drawTop:[basic.exports.Defend,basic.exports.Defend],plays:[{definition:selections.exports.HoneClaws,upgraded:true},{definition:basic.exports.ThunderClaw}]},block:0,hand:2,enemies:[981,993,993]},
  {name:'升级原始力量仍消耗并抽二',scenario:{strength:3,reserve:[basic.exports.Defend,basic.exports.Defend],drawTop:[basic.exports.Defend,basic.exports.Defend],plays:[{definition:uncommon.exports.PrimalStrength,upgraded:true},{definition:storm.exports.Thunderbolt}]},block:0,hand:2,enemies:[991,991,991],exhaust:['原始力量']},
  {name:'升级不休之猎打出抽一',scenario:{reserve:[basic.exports.Defend],drawTop:[basic.exports.Defend],plays:[{definition:rare.exports.EndlessHunt,upgraded:true}]},block:0,hand:1,energy:29,enemies:[1000,1000,1000]},
  {name:'升级风暴即我仍支付两费并抽二',scenario:{reserve:[basic.exports.Defend,basic.exports.Defend],drawTop:[basic.exports.Defend,basic.exports.Defend],plays:[{definition:rare.exports.StormIsMe,upgraded:true}]},block:0,hand:2,energy:28,enemies:[1000,1000,1000]},

];
for(const c of cases)for(const controlled of [true])test(`${c.name}; controlled=${controlled}`,async()=>{
  const directory=c.restore?await mkdtemp(join(tmpdir(),'sts-storm-')):undefined;
  const loaded=unwrap(await createCardLoader({recordCore:false,controlled,...(directory?{snapshots:fileSnapshotStore(directory)}:{})}).load(fixture(c.scenario)));
  let instance=unwrap(await loaded.core.start(undefined));
  try{
    let stop=unwrap(await instance.inspect()),answerIndex=0;
    while(stop.kind==='call'){
      if(c.restore){const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture?.release(instance.id);instance=unwrap(await loaded.persistence!.restore(snapshot));await loaded.persistence!.release(snapshot);}
      assert.equal(stop.call.port,'decision');
      const request=choiceRequestSchema.parse(stop.call.input),names=c.answers?.[answerIndex++];
      assert.ok(names,'Unexpected card selection');
      const indices=names.map(name=>{const index=request.cards.indexOf(name);assert.ok(index>=0,`Missing candidate ${name}`);return index;});
      unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{indices}})}));
      unwrap(await instance.run());stop=unwrap(await instance.inspect());
    }
    assert.equal(answerIndex,c.answers?.length??0);
    assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected completed combat fixture');
    assert.equal(stop.result.hp,c.hp??80);assert.equal(stop.result.block,c.block);assert.deepEqual(stop.result.enemies,c.enemies);
    if(c.domain!==undefined)assert.deepEqual(stop.result.domain,c.domain);
    if(c.energy!==undefined)assert.equal(stop.result.energy,c.energy);
    if(c.hand!==undefined)assert.equal(stop.result.hand,c.hand);
    if(c.charge!==undefined)assert.equal(stop.result.charge,c.charge,'charge');
    if(c.spent!==undefined)assert.equal(stop.result.spent,c.spent,'spent');
    if(c.turnSpent!==undefined)assert.equal(stop.result.turnSpent,c.turnSpent,'turnSpent');
    if(c.exhaust)assert.deepEqual(stop.result.exhaust.sort(),[...c.exhaust].sort());
    assert.ok(stop.result.masterGrowth.every(n=>n===0),'Combat growth must not reach permanent deck');
    if(stop.result.charge||stop.result.spent)assert.ok(stop.result.effects.includes('蓄雷:'+stop.result.charge));
  }finally{await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);if(directory)await rm(directory,{recursive:true,force:true});}
});

test('定稿牌池、费用与消耗元数据完整',()=>{
  const all=Object.values(volibearCardDescriptions);
  assert.equal(all.length,92);
  assert.deepEqual([0,1,2,3].map(r=>all.filter(c=>c.metadata.rarity===r).length),[25,38,25,4]);
  const powers=all.filter(c=>c.metadata.type===2);
  assert.equal(powers.length,19);
  assert.deepEqual([1,2].map(cost=>powers.filter(c=>c.metadata.variants[0].cost===cost).length),[15,4]);
  for(const code of ['U12','U20','C25','R18','R21','R24','R25'] as const)assert.ok(volibearCardDescriptions[code].metadata.variants.every(v=>v.exhaust));
  assert.equal(volibearCardDescriptions.C13.metadata.variants[0].exhaust,false);
  assert.equal(volibearCardDescriptions.R01.metadata.variants[1].innate,true);
});
