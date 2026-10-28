import {pileCards} from '../src/content/cards/statuses/definitions.ts';
import {createVolibearCatalog} from '../src/content/characters/volibear/catalog.ts';
import {readFileSync} from 'node:fs';
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
import {combatTactics} from '../src/adapters/combat-tactics.ts';
import {damageTermsSchema,type DamageTerms} from '../src/content/cards/shared/program-facts.ts';
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
const selections=createVolibearSelectionCards(choices,{discard:1,discardToTop:2,scry:3,retain:4,copy:5,recover:6,train:7,exhaust:8,beast:9,search:10});
const catalog=createVolibearCatalog(choices,{discard:1,discardToTop:2,scry:3,retain:4,copy:5,recover:6,train:7,exhaust:8,beast:9,search:10},engageChoiceWire.exports.adapter,[engageChoiceWire]);
const by=catalog.exports.byCode;
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
type Scenario={enemyOrigin?:Definition;charge?:number;drawPerTurn?:number;endTurns?:number;queuedBlockOnUse?:number;plays:{preview?:boolean;definition:Definition;endBefore?:boolean;upgraded?:boolean;target?:number;reuse?:number;copyOf?:number;generated?:boolean;shapeOf?:number;illegal?:boolean;discounts?:number;attackBonus?:number}[];reserve?:Definition[];drawTop?:Definition[];discardSetup?:Definition[];domainTurns?:number|null;observeShuffle?:boolean;extraDrawOn?:Definition;enemyPowers?:{definition:PowerDefinition;amount:number}[];exhaustObserver?:boolean;hp?:number;energy?:number;enemyHp?:readonly [number,number,number];block?:number;dexterity?:number;strength?:number;weak?:boolean;frail?:boolean;chemicalX?:boolean;heart?:boolean;immortal?:boolean;enemyAction?:{damage:number;hits:number;grant?:{definition:PowerDefinition;amount:number}};normalEnemyTargets?:number[]};
const actor=rules.defineEntity(resources.exports.actor,{side:0}),enemy=rules.defineEntity(resources.exports.actor,{side:1});
const registryDefinition=rules.defineEntity(powers.exports.registryKind,undefined),stream=rules.defineEntity(random.exports.stream,undefined),battleDefinition=rules.defineEntity(battles.exports.kind,undefined);
const resultSchema=z.object({previews:z.array(damageTermsSchema),domain:z.object({active:z.boolean(),untilTurn:z.number().nullable()}),hp:z.number(),block:z.number(),energy:z.number(),enemies:z.array(z.number()),hand:z.number(),strikes:z.number(),handIds:z.array(z.string()),charge:z.number(),exhaust:z.array(z.string()),masterGrowth:z.array(z.number()),effects:z.array(z.string())});

/** Fixtures construct explicit combat positions; they are not balance simulations
 * or a replacement for the production rules/queue. Both loaders run those rules.
 */
function fixture(s:Scenario){
  const fixtureModule=rules.defineRules({requires:[combatTactics,pileCards,catalog,storm,stormCharge,volibearPresentation,volibearTraining,turns,beyondBosses,engageProbeModule,xCostRelics,ironBasic,domainCards,volibearDomain,defensePowers,basic,common,uncommon,rare,growth,xCards,lethal,engage,optionalEngage,enemyRules,exhaustProbe,volibearHearts,basicPowers,volibearNextPlayDiscount,volibearCopying,volibearNextAttack,selections],build(){
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
    const previews=b.local<DamageTerms[]>();
    const player=b.local<number>(),scope=b.local<number>(),registry=b.local<number>(),rng=b.local<number>(),battle=b.local<number>(),made=b.local<number>();
    const opponents=b.local<number[]>(),masters=b.local<number[]>(),selected=b.local<number>(),played=b.local<number[]>(),controllers=b.local<number[]>(),turnController=b.local<number>();
    const grant=(definition:PowerDefinition,amount:number)=>rules.call(powers.exports.apply,{registry,actor:player,definition,amount,source:player,debuff:false,scope});
    return rules.sequence(
      b.assign(previews,[]),
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
      ...s.plays.filter(p=>p.reuse===undefined&&p.copyOf===undefined&&!p.generated&&p.shapeOf===undefined).map(p=>rules.sequence(
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
      ...(s.endTurns||s.plays.some(p=>p.endBefore)?[b.assign(turnController,rules.spawnEntity({definition:rules.defineEntity(turns.exports.kind,undefined),owner:player,scope,setup:{battle,enemies:controllers,drawPerTurn:s.drawPerTurn??0,energyPerTurn:30}}))]:[]),
      rules.call(battles.exports.start,battle),
      ...(s.charge?[rules.call(stormCharge.exports.gain,{battle,owner:player,amount:s.charge})]:[]),
      rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.get(rules.query(battles.exports.current,v.get(battle))).piles),count:s.plays.filter(p=>p.reuse===undefined&&p.copyOf===undefined&&!p.generated&&p.shapeOf===undefined).length+(s.reserve?.length??0)}),
      ...[{definitions:s.drawTop??[],zone:'draw' as const},{definitions:s.discardSetup??[],zone:'discard' as const}].flatMap(({definitions,zone})=>definitions.map(definition=>rules.sequence(
        b.assign(selected,b.read(v=>{const piles=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles);const found=v.query(zones.exports.members,piles.hand).find(id=>v.query(cardInstances.exports.matchesDefinition,{entity:id,definition}));if(found===undefined)throw Error('Missing fixture pile setup card');return found;})),
        rules.call(zones.exports.move,{entity:selected,from:b.read(v=>v.query(zones.exports.location,v.get(selected))),to:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles)[zone]),index:b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles)[zone]).length)}),
      ))),
      ...(s.enemyOrigin?[rules.forEach(b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.get(battle)).piles);return[p.hand,p.draw,p.discard].flatMap(zone=>v.query(zones.exports.members,zone)).filter(id=>v.query(cardInstances.exports.matchesDefinition,{entity:id,definition:s.enemyOrigin!}));}),entity=>rules.call(cardInstances.exports.setOriginActor,{entity,actor:b.read(v=>v.get(opponents)[0]!)}))]:[]),
      ...(extraDraw?[rules.install({ability:extraDraw,source:player,owner:player,environment:{},lifetime:scope})]:[]),
      ...(s.observeShuffle?[rules.install({ability:exhaustProbe.exports.shuffle,source:player,owner:player,environment:{},lifetime:scope})]:[]),
      ...(s.enemyPowers??[]).map(power=>rules.call(powers.exports.apply,{registry,actor:b.read(v=>v.get(opponents)[0]!),source:player,definition:power.definition,amount:power.amount,debuff:false,scope})),
      ...(s.domainTurns===undefined?[]:[rules.call(volibearDomain.exports.open,{battle,turns:s.domainTurns})]),
      b.assign(played,[]),
      ...s.plays.map(p=>rules.sequence(
        ...(p.endBefore?[rules.call(turns.exports.endTurn,turnController),rules.call(turns.exports.settle,turnController)]:[]),
        b.assign(selected,b.read(v=>{
          if(p.reuse!==undefined||p.copyOf!==undefined||p.shapeOf!==undefined){
            const previous=v.get(played)[(p.reuse??p.copyOf??p.shapeOf)!];
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
        ...(p.preview?[b.assign(previews,b.read(v=>[...v.get(previews),v.query(combatTactics.exports.card,{battle:v.get(battle),card:v.get(selected),target:v.get(opponents)[p.target??0]!}).map(t=>({...t,target:t.target===null?null:v.get(opponents).indexOf(t.target)}))]))]:[]),
        ...(p.illegal?[rules.when(rules.query(battles.exports.canQueue,{battle,card:selected,target:b.read(v=>v.get(opponents)[p.target??0]!)}),b.return(b.read(()=>{throw Error('Expected illegal card');})))]:[rules.call(battles.exports.queueFromHand,{battle,card:selected,target:b.read(v=>v.get(opponents)[p.target??0]!)} )]),
        rules.call(battles.exports.settle,battle),
      )),
      ...(s.normalEnemyTargets??[]).map(index=>rules.sequence(rules.call(enemyRules.exports.takeTurn,b.read(v=>v.get(controllers)[index]!)),rules.call(battles.exports.settle,battle))),
      ...Array.from({length:s.endTurns??0},()=>rules.sequence(rules.call(turns.exports.endTurn,turnController),rules.call(turns.exports.settle,turnController))),
      b.return(b.read(v=>{
        const playerState=v.get(rules.query(resources.exports.current,v.get(player)));
        const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.get(battle))).piles));
        const charge=v.query(stormCharge.exports.current,v.get(battle));
        return {previews:v.get(previews),domain:v.query(volibearPresentation.exports.domain,v.get(battle)),strikes:charge.strikes,handIds:v.query(zones.exports.members,piles.hand).map(id=>v.query(cardInstances.exports.combatView,id).id),charge:charge.amount,exhaust:v.query(zones.exports.members,piles.exhaust).map(id=>v.query(cardInstances.exports.metadata,id).name),masterGrowth:v.get(masters).map(id=>v.query(volibearTraining.exports.permanentBonus,id)),effects:v.query(volibearPresentation.exports.effects,{battle:v.get(battle),enemies:v.get(opponents)}).map(e=>e.name+':'+e.level),hp:playerState.hp,block:playerState.block,energy:playerState.energy,enemies:v.get(opponents).map(id=>v.get(rules.query(resources.exports.current,id)).hp),hand:v.get(rules.query(zones.exports.members,piles.hand)).length};
      })),
    );
  });
  return{exports:{entry}};
  }});
  const entry=fixtureModule.exports.entry;
  return linkRules({id:'sts/volibear-content',schemas:{setup:z.undefined(),result:resultSchema,ports:{decision:{input:choiceRequestSchema,output:choiceReplySchema}}},initialize:()=>({}),entry,definitions:[entry],modules:[fixtureModule]});
}
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

type Case={enemyTotal?:number;previews?:DamageTerms[];name:string;scenario:Scenario;block?:number;enemies?:number[];energy?:number;hp?:number;answers?:string[][];hand?:number;handIds?:string[];charge?:number;strikes?:number;exhaust?:string[];restore?:boolean;domain?:{active:boolean;untilTurn:number|null}};
const cases:Case[]=[
 {name:'狂雷与四次随机攻击逐段联动，预览不猜随机目标',scenario:{plays:[{definition:by.U02},{definition:by.R08,preview:true}]},enemyTotal:2886,strikes:9,previews:[[]]},
 {name:'狂雷双爪逐段并与领域区分，公开投影不改变结算',scenario:{charge:2,domainTurns:1,plays:[{definition:by.U02},{definition:by.C02,preview:true}]},enemies:[966,976,976],strikes:4,previews:[[{label:'普通攻击',target:0,amount:5,hits:2},{label:'领域附雷（全体，每次出牌1次）',target:null,amount:6,hits:1},{label:'狂雷渐起（全体，每段1次）',target:null,amount:5,hits:2}]]},
 {name:'升级狂雷与全体多段每段只触发一次',scenario:{plays:[{definition:by.U02,upgraded:true},{definition:by.C22}]},enemies:[969,969,969],strikes:5},
 {name:'狂雷重演按普通攻击段数触发，领域共享一次',scenario:{domainTurns:1,plays:[{definition:by.U02},{definition:by.U11},{definition:by.C02}]},enemies:[958,978,978],strikes:6},
 {name:'狂雷X攻击零段不触发',scenario:{energy:1,plays:[{definition:by.U02},{definition:by.U31}]},enemies:[994,994,994],strikes:1},
 {name:'狂雷X攻击按支付后的2段触发',scenario:{energy:3,plays:[{definition:by.U02},{definition:by.U31}]},enemies:[972,982,982],strikes:5},
 {name:'狂雷普通攻击致死一敌仍传导到其他敌人',scenario:{enemyHp:[7,1000,1000],plays:[{definition:by.U02},{definition:by.C02}]},enemies:[0,991,991],strikes:2},
 {name:'多份狂雷各按每段触发',scenario:{plays:[{definition:by.U02},{definition:by.U02,upgraded:true},{definition:by.C02}]},enemies:[961,971,971],strikes:6},

 {name:'雷池在牌堆耗尽后仍可结算回合末雷伤',scenario:{endTurns:1,plays:[{definition:by.R18}]},enemies:[990,990,990]},
 {name:'反雷在最后一张牌消耗后仍可响应敌方阶段',scenario:{endTurns:1,enemyAction:{damage:1,hits:1},plays:[{definition:by.C14}]},enemies:[997,997,997]},
 {name:'正常起手抽牌仍受领域净化，之后到期',scenario:{domainTurns:1,endTurns:1,drawPerTurn:1,reserve:[by.B02,pileCards.exports.Burn],drawTop:[by.B02,pileCards.exports.Burn],plays:[]},hp:80,handIds:['VOLIBEAR_B02'],exhaust:['Burn'],domain:{active:false,untilTurn:2}},
 {name:'R28起手兽化后的抽牌读取已到期领域',restore:true,scenario:{domainTurns:1,endTurns:1,drawPerTurn:1,reserve:[pileCards.exports.Burn,by.B01],drawTop:[pileCards.exports.Burn,by.B01],plays:[{definition:by.R28}]},answers:[[],['打击']],handIds:['VOLIBEAR_T01','BURN'],exhaust:[],domain:{active:false,untilTurn:2}},
 {name:'R28起手兽化后的抽牌读取仍生效领域',scenario:{domainTurns:2,endTurns:1,drawPerTurn:1,reserve:[pileCards.exports.Burn,by.B01],drawTop:[pileCards.exports.Burn,by.B01],plays:[{definition:by.R28}]},answers:[[],['打击']],handIds:['VOLIBEAR_T01'],exhaust:['Burn'],domain:{active:true,untilTurn:3}},
 {name:'已在手牌的敌源Burn逐次受领域门控',scenario:{domainTurns:1,endTurns:1,reserve:[pileCards.exports.Burn],enemyOrigin:pileCards.exports.Burn,plays:[]},hp:80},
 {name:'领域外敌源Burn仍执行原伤害',scenario:{endTurns:1,reserve:[pileCards.exports.Burn],enemyOrigin:pileCards.exports.Burn,plays:[]},hp:78},
 {name:'U15消耗效果保留被消耗牌自身和外部响应',restore:true,scenario:{reserve:[exhaustProbe.exports.curse],exhaustObserver:true,plays:[{definition:by.U15}]},energy:37,block:4,exhaust:['自响应诅咒']},
 {name:'C19保留持续跨多个回合',scenario:{endTurns:2,reserve:[by.B01],plays:[{definition:by.C19}]},handIds:['VOLIBEAR_B01']},
 {name:'U03受击后剩8甲，起手扣6留下2甲',scenario:{reserve:[by.B02],block:12,endTurns:1,enemyAction:{damage:4,hits:1},plays:[{definition:by.U03}]},hp:80,block:2},
 {name:'U03升级受击后剩8甲，起手扣3留下5甲',scenario:{reserve:[by.B02],block:8,endTurns:1,enemyAction:{damage:4,hits:1},plays:[{definition:by.U03,upgraded:true}]},hp:80,block:5},
 {name:'U12本轮增幅覆盖随后敌方反雷',scenario:{reserve:[by.B02],strength:3,endTurns:1,enemyAction:{damage:1,hits:1},plays:[{definition:by.U12},{definition:by.C14}]},enemies:[994,994,994]},
 {name:'R06也强化迎战雷法的原生雷伤',scenario:{enemyAction:{damage:0,hits:1},plays:[{definition:by.R06},{definition:by.U28}]},enemies:[993,993,993]},
 {name:'领域内玩家施加的虚弱继续影响普通攻击',scenario:{domainTurns:1,enemyAction:{damage:10,hits:1},plays:[{definition:by.C04}]},hp:73},

 {name:'雷势每段加值且不消费',scenario:{charge:2,plays:[{definition:by.B03},{definition:by.C22}]},enemies:[969,977,977],charge:2,strikes:3},
 {name:'稳住阵脚1费先给5甲开领域再抽2张',scenario:{energy:3,reserve:[by.B01,by.B02],drawTop:[by.B01,by.B02],plays:[{definition:by.C21}]},energy:2,block:5,hand:2,domain:{active:true,untilTurn:2}},
 {name:'稳住阵脚升级仍1费给8甲并抽2张',scenario:{energy:3,reserve:[by.B01,by.B02],drawTop:[by.B01,by.B02],plays:[{definition:by.C21,upgraded:true}]},energy:2,block:8,hand:2,domain:{active:true,untilTurn:2}},
 {name:'领域双爪只附雷一次',scenario:{domainTurns:1,plays:[{definition:by.C02}]},enemies:[986,996,996],strikes:1},
 {name:'领域重演共享一次附雷',scenario:{domainTurns:1,plays:[{definition:by.U11},{definition:by.C02}]},enemies:[976,996,996],strikes:1},
 {name:'领域在卡内开启后同张攻击立即附雷',scenario:{plays:[{definition:by.C05}]},enemies:[990,996,996],strikes:1},
 {name:'迎战自动执行且同敌不重复行动',scenario:{enemyAction:{damage:10,hits:1},normalEnemyTargets:[0],plays:[{definition:by.B04},{definition:by.C11}]},hp:78,block:8,enemies:[994,1000,1000]},
 {name:'擂首先施加虚弱再迎战',scenario:{enemyAction:{damage:10,hits:1},plays:[{definition:by.C04}]},hp:73,enemies:[991,1000,1000]},
 {name:'以牙还牙按实际吸收返伤',scenario:{enemyAction:{damage:10,hits:1},plays:[{definition:by.C10}]},hp:78,block:0,enemies:[986,1000,1000]},
 {name:'雷霆反扑按实际吸收加雷势',scenario:{charge:2,enemyAction:{damage:10,hits:2},plays:[{definition:by.U28}]},hp:72,block:0,enemies:[982,982,982]},
 {name:'霹天雳地先雷击后迎战',scenario:{enemyHp:[3,1000,1000],enemyAction:{damage:20,hits:1},plays:[{definition:by.U35}]},hp:80,block:8,enemies:[0,997,997]},
 {name:'坚甲吸收不消耗格挡',scenario:{enemyAction:{damage:8,hits:2},plays:[{definition:by.R02},{definition:by.C10}]},hp:80,block:18,enemies:[978,1000,1000]},
 {name:'战痕不要求吸收且每回合每实例只一次',scenario:{enemyAction:{damage:0,hits:1},plays:[{definition:by.U04},{definition:by.B04},{definition:by.B04,target:1}]},block:22,charge:1,enemies:[994,993,1000]},
 {name:'U26第二张牌效前力量与雷势',scenario:{plays:[{definition:by.U26},{definition:by.B01},{definition:by.B03}]},enemies:[979,996,996],charge:1},
 {name:'U26升级每实例获得2雷势',scenario:{plays:[{definition:by.U26,upgraded:true},{definition:by.B01},{definition:by.B03}]},enemies:[977,995,995],charge:2},
 {name:'两份U26独立触发',scenario:{plays:[{definition:by.U26},{definition:by.U26,upgraded:true},{definition:by.B01},{definition:by.B03}]},enemies:[973,994,994],charge:3},
 {name:'新部署U21已达阈值立即触发',scenario:{plays:[{definition:by.C22},{definition:by.U21},{definition:by.U21,upgraded:true}]},energy:29,strikes:2},
 {name:'同名接地多张分别返能',scenario:{plays:[{definition:by.C24},{definition:by.C26},{definition:by.C26,copyOf:1}]},energy:33},
 {name:'雷路的此前不含自身这次雷伤',scenario:{plays:[{definition:by.C24},{definition:by.U40},{definition:by.U40}]},energy:29,enemies:[978,994,994],strikes:3},
 {name:'升级接地多张分别返3能量',scenario:{plays:[{definition:by.C24},{definition:by.C26,upgraded:true},{definition:by.C26,upgraded:true}]},energy:35},
 {name:'接地无此前雷伤仍不返能',scenario:{plays:[{definition:by.C26},{definition:by.C26}]},energy:30},
 {name:'雷路同一张再次打出继续返能',scenario:{plays:[{definition:by.C24},{definition:by.U40},{definition:by.U40},{definition:by.U40,reuse:2}]},energy:30,strikes:4},
 {name:'两份余威在第2和第4次雷伤各自返能而第5次不返',scenario:{plays:[{definition:by.U21},{definition:by.U21,upgraded:true},{definition:by.C22},{definition:by.R23}]},energy:29,strikes:5},
 {name:'余威中途部署返能后仍在下个偶数雷伤返能',scenario:{plays:[{definition:by.R23},{definition:by.U21},{definition:by.C24}]},energy:28,strikes:4},
 {name:'余威奇数雷伤不跨回合累积',scenario:{drawPerTurn:5,plays:[{definition:by.U21},{definition:by.C24},{definition:by.C24,endBefore:true}]},energy:29,strikes:1},
 {name:'雷甲每段给3甲而非每个敌人触发',scenario:{plays:[{definition:by.U34},{definition:by.C22}]},block:10,strikes:2},
 {name:'雷甲升级每段给4甲而非每个敌人触发',scenario:{plays:[{definition:by.U34,upgraded:true},{definition:by.C22}]},block:15,strikes:2},
 {name:'崩山本身可减至零',scenario:{plays:[{definition:by.C01},{definition:by.C01},{definition:by.C01},{definition:by.U07}]},energy:30,enemies:[954,1000,1000]},
 {name:'势不可挡读取上一张实际牌',scenario:{plays:[{definition:by.B01},{definition:by.B02},{definition:by.U20}]},energy:27},
 {name:'势不可挡升级返3能量',scenario:{plays:[{definition:by.B01},{definition:by.U20,upgraded:true}]},energy:31},
 {name:'暴怒撕咬跨同目标读标记',scenario:{plays:[{definition:by.U08},{definition:by.U08,reuse:0}]},block:12,enemies:[974,1000,1000]},
 {name:'重演咬痕读取出牌前',scenario:{plays:[{definition:by.U11},{definition:by.U08}]},block:12,enemies:[980,1000,1000]},
 {name:'不同敌人的咬痕相互独立',scenario:{plays:[{definition:by.U08},{definition:by.U08,reuse:0,target:1}]},block:12,enemies:[990,990,1000]},
 {name:'饮血只按雷伤生命损失恢复',scenario:{hp:40,enemyHp:[23,1000,1000],plays:[{definition:by.U24}]},hp:42,enemies:[0,1000,1000]},
 {name:'R17先获得全部雷势再逐段',scenario:{energy:3,plays:[{definition:by.R17}]},energy:0,charge:3,strikes:3,enemies:[973,1000,1000]},
 {name:'升级R17零能量仍获得1雷势并雷击一次',scenario:{energy:0,plays:[{definition:by.R17,upgraded:true}]},energy:0,charge:1,strikes:1,enemies:[993,1000,1000]},
 {name:'X攻击重演沿用支付X且领域只一次',scenario:{energy:3,domainTurns:1,plays:[{definition:by.U11,upgraded:true},{definition:by.U31}]},energy:0,strikes:7,enemies:[948,978,978]},
 {name:'R06强化所有攻击与雷法及后续牌',scenario:{plays:[{definition:by.R06},{definition:by.B03},{definition:by.C24}]},block:10,enemies:[971,985,985]},
 {name:'U10等待跨回合保留',scenario:{drawPerTurn:5,plays:[{definition:by.U10},{definition:by.B03,endBefore:true}]},enemies:[983,994,994]},
 {name:'R16仅攻击提供格挡才得敏捷',scenario:{plays:[{definition:by.R16},{definition:by.B02},{definition:by.B02}]},block:10},
 {name:'R31先开领域拆甲再攻击原生雷',scenario:{plays:[{definition:by.R31}]},block:8,enemies:[970,990,990],strikes:2},
 {name:'不灭狂雷不在起手获得资源',scenario:{heart:true,plays:[]},charge:0},
 {name:'不灭狂雷首次完成迎战抽1',scenario:{heart:true,enemyAction:{damage:0,hits:1},reserve:[by.B02],drawTop:[by.B02],plays:[{definition:by.B04},{definition:by.C11,target:1}]},hand:1,charge:0},
 {name:'万古不灭替换后首次迎战抽2',scenario:{immortal:true,enemyAction:{damage:0,hits:1},reserve:[by.B02,by.B02],drawTop:[by.B02,by.B02],plays:[{definition:by.B04}]},hand:2},
 {name:'C13先消耗后抽牌且恢复选牌现场',restore:true,scenario:{reserve:[by.B01,by.B02],drawTop:[by.B02],plays:[{definition:by.C13}]},answers:[['打击']],hand:1,exhaust:['打击']},
 {name:'U15无另一手牌仍打出并抽2张',scenario:{reserve:[by.B01,by.B02],drawTop:[by.B01,by.B02],plays:[{definition:by.U15}]},hand:2,energy:30},
 {name:'U15升级无材料仍抽3张',scenario:{reserve:[by.B01,by.B02,by.C01],drawTop:[by.B01,by.B02,by.C01],plays:[{definition:by.U15,upgraded:true}]},hand:3,energy:30},
 {name:'U15空手空牌堆仍可打出',scenario:{plays:[{definition:by.U15}]},hand:0,energy:30},
 {name:'C13无材料仍抽3张',scenario:{reserve:[by.B01,by.B02,by.C01],drawTop:[by.B01,by.B02,by.C01],plays:[{definition:by.C13}]},hand:3,energy:29},
 {name:'检索真正选择攻击并占手牌位',restore:true,scenario:{reserve:[by.B01,by.C02],drawTop:[by.B01,by.C02],plays:[{definition:by.C07}]},answers:[['双爪']],handIds:['VOLIBEAR_C02']},
 {name:'雷法检索不包含雷伤攻击',scenario:{reserve:[by.B03,by.C24],drawTop:[by.B03,by.C24],plays:[{definition:by.U39}]},answers:[['霹雳']],handIds:['VOLIBEAR_C24'],block:4},
 {name:'回收允许雷法',scenario:{reserve:[by.C24],discardSetup:[by.C24],plays:[{definition:by.C15}]},handIds:['VOLIBEAR_C24']},
 {name:'R29手牌攻击与非攻击全体兽化',scenario:{reserve:[by.B01,by.B02],plays:[{definition:by.R29}]},handIds:['VOLIBEAR_T01','VOLIBEAR_T02'],energy:27},
 {name:'选择兽化保持选牌恢复',restore:true,scenario:{reserve:[by.B01,by.C02],plays:[{definition:by.U41}]},answers:[['双爪']],handIds:['VOLIBEAR_B01','VOLIBEAR_T01']},
 {name:'兽化升级材料保留升级并用新数值',scenario:{plays:[{definition:by.R29},{definition:by.B01,upgraded:true}]},enemies:[978,1000,1000],energy:27,exhaust:['不再为人','裂骨之爪']},
 {name:'兽形重演完整结算一次附雷',scenario:{domainTurns:1,plays:[{definition:by.R29},{definition:by.B01}]},enemies:[982,996,996],strikes:1,energy:27},
 {name:'R28可放弃且不消费首次兽化机会',scenario:{reserve:[by.B01],plays:[{definition:by.R28}]},answers:[[]],handIds:['VOLIBEAR_B01'],charge:0},
 {name:'R28批量兽化抽到的新牌不进入R29集合',scenario:{reserve:[by.B01,by.B02],drawTop:[by.B02],plays:[{definition:by.R28},{definition:by.R29}]},answers:[[]],handIds:['VOLIBEAR_T01','VOLIBEAR_B02']},
 {name:'R28首次兽形牌效前雷势',scenario:{plays:[{definition:by.R28},{definition:by.B02}]},answers:[['防御']],charge:1,block:9,enemies:[997,997,997]},
 {name:'R30首次躯形返能与爪形格挡',scenario:{plays:[{definition:by.R30},{definition:by.B02}]},answers:[['防御']],energy:29,block:9,enemies:[998,998,998]},
 {name:'R30同回合每张躯形都返能',scenario:{plays:[{definition:by.R30},{definition:by.B02},{definition:by.U42},{definition:by.B02}]},answers:[['防御'],['防御']],energy:29,block:21,strikes:2},
 {name:'R30爪形格挡仍仅每回合首次',scenario:{plays:[{definition:by.R30},{definition:by.B01},{definition:by.U41},{definition:by.B01}]},answers:[['打击'],['打击']],energy:27,block:6},
 {name:'R27允许零张选择',scenario:{reserve:[by.B01],plays:[{definition:by.R27}]},answers:[[]],handIds:['VOLIBEAR_B01']},
 {name:'R25允许零张技能选择',scenario:{reserve:[by.B02],drawTop:[by.B02],plays:[{definition:by.R25}]},answers:[[]],hand:0,domain:{active:true,untilTurn:3}},
];

async function runCase(c:Case){
 const directory=c.restore?await mkdtemp(join(tmpdir(),'sts-s2-')):undefined;
 const loaded=unwrap(await createCardLoader({recordCore:false,controlled:true,...(directory?{snapshots:fileSnapshotStore(directory)}:{})}).load(fixture(c.scenario)));
 let instance=unwrap(await loaded.core.start(undefined));
 try{
  let stop=unwrap(await instance.inspect()),answerIndex=0;
  while(stop.kind==='call'){
   if(c.restore){const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture?.release(instance.id);instance=unwrap(await loaded.persistence!.restore(snapshot));await loaded.persistence!.release(snapshot);}
   assert.equal(stop.call.port,'decision');
   const request=choiceRequestSchema.parse(stop.call.input),names=c.answers?.[answerIndex++];
   const indices=names?names.map(name=>{const index=request.cards.indexOf(name);assert.ok(index>=0,`Missing ${name} in ${request.cards}`);return index;}):Array.from({length:request.minimum},(_,i)=>i);
   unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{indices}})}));unwrap(await instance.run());stop=unwrap(await instance.inspect());
  }
  assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected completion');
  for(const key of ['hp','block','enemies','energy','hand','charge','strikes','domain','previews'] as const)if(c[key]!==undefined)assert.deepEqual(stop.result[key],c[key],key);
  if(c.handIds)assert.deepEqual(stop.result.handIds.sort(),[...c.handIds].sort());
  if(c.exhaust)assert.deepEqual(stop.result.exhaust.sort(),[...c.exhaust].sort());
  if(c.enemyTotal!==undefined)assert.equal(stop.result.enemies.reduce((n,hp)=>n+hp,0),c.enemyTotal);
  assert.ok(stop.result.masterGrowth.every(n=>n===0),'Combat growth must not reach permanent deck');
  return stop.result;
 }finally{await instance.close();await loaded.capture?.release(instance.id);if(directory)await rm(directory,{recursive:true,force:true});}
}
for(const c of cases)test(c.name,async()=>{await runCase(c);});

// Each face executes the actual catalog definition, including powers and choices.
for(const [code,definition] of Object.entries(by))for(const upgraded of [false,true])test(`S2 executes ${code}${upgraded?'+':''}`,async()=>{
 const result=await runCase({name:code,scenario:{energy:8,enemyAction:{damage:0,hits:1},reserve:[by.B01,by.B02],plays:[{definition,upgraded}]}});
 assert.equal(result.hp,80);
});

test('89张／178牌面与83张奖励池对齐，机器记录与元数据一致',()=>{
 const documented=JSON.parse(readFileSync(new URL('../../../docs/volibear/cards_s2.json',import.meta.url),'utf8'));
 const all=Object.values(volibearCardDescriptions);
 assert.equal(all.length,89);assert.equal(documented.cards.length,89);
 assert.deepEqual([0,1,2,3,4].map(r=>all.filter(c=>c.metadata.rarity===r).length),[24,36,23,4,2]);
 assert.equal(catalog.exports.pools.all.length,83);
 assert.ok(!catalog.exports.cardPools.random.some(id=>id.startsWith('VOLIBEAR_T')));
 for(const d of documented.cards){const actual=all.find(x=>x.code===d.code)!;assert.equal(actual.metadata.name,d.name);assert.equal(actual.metadata.type,['攻击','技能','能力'].indexOf(d.type));assert.deepEqual(actual.metadata.variants.map(v=>v.cost),d.cost);assert.deepEqual(actual.metadata.variants.map(v=>v.exhaust),[d.base,d.upgraded].map((t:string)=>t.includes('消耗。')));assert.ok(actual.metadata.variants.every(v=>!v.innate));}
});
