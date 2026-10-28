import {combatTactics} from './combat-tactics.ts';
import {moveId} from '../combat-identifiers.ts';
import {volibearPresentation} from '../content/characters/volibear/presentation.ts';
import {combatPrivate} from "../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '../rules/execution.ts';
import {FrameSchema,BattleViewSchema} from "../game.schemas.ts";
import {combatSessions} from "../rules/combat-sessions.ts";
import {adventures} from "../rules/adventures.ts";
import {battles} from "../rules/battles.ts";
import {turns} from "../rules/turns.ts";
import {enemies} from "../rules/enemies.ts";
import {cardPiles} from "../rules/card-piles.ts";
import {cardInstances} from "../rules/card-instances.ts";
import {zones} from "../rules/zones.ts";
import {resources} from "../rules/resources.ts";
import {attributes} from "../rules/attributes.ts";
import {powers} from "../rules/powers.ts";
import {potions} from "../rules/potions.ts";
import {random} from "../rules/random.ts";
import {combatStorageViews} from "./combat-storage-views.ts";
import {cardScreenNames} from "./selection-presentations.ts";
import {enemyUtilities,publicMonsterName} from "../content/enemies/shared/programs.ts";
import {MS} from "../combat-identifiers.ts";

const {defineRules,defineQuery}=rules;
/** Publication itself owns both eligibility and the visible-information description. */
export const frozenEyePublication=Object.freeze({
  text:'持有时，可查看抽牌堆真实顺序。',
  visible(r:Pick<rules.QueryRead,'query'>,run:number){return r.query(adventures.exports.hasRelic,{run,id:'FROZEN_EYE'});},
  publish<T>(r:rules.QueryRead,run:number,draw:()=>T){return this.visible(r,run)?{draw:draw()}:{};},
});
export const combatViews=defineRules({requires:[combatTactics,volibearPresentation,enemyUtilities,combatSessions,adventures,combatStorageViews,combatPrivate],build(){
  const tags=Array.from({length:8},(_,value)=>defineQuery({input:z.undefined(),output:z.int32(),base:()=>value}));
  const counterTags={kind:cardInstances.exports.kind,select:(config:rules.Borrowed<import('../rules/card-instances.types.ts').CardConfig>)=>tags[Number(config.id==='NORMALITY')|Number(config.id==='PAIN')<<1|Number(config.id==='BLOOD_FOR_BLOOD'||config.id==='MASTERFUL_STAB')<<2]!};
  const status=defineQuery({input:z.object({registry:z.number(),actor:z.number(),side:z.union([z.literal(0),z.literal(1)])}),output:z.object({unique0:z.number(),unique1:z.number(),bits0:z.string(),bits1:z.number(),justApplied:z.number(),statuses:z.array(z.tuple([z.number(),z.number()])),values:z.record(z.string(),z.number())}),dependencies:[powers.exports.entries,powers.exports.current,powers.exports.presentation],base(r,i){
    let bits=0n,justApplied=0,unique0=0,unique1=0;const statuses:[number,number][]=[],values:Record<string,number>={};
    for(const entry of r.query(powers.exports.entries,i.registry)){
      const p=r.query(powers.exports.current,entry.entity);if(p.actor!==i.actor||p.phase!==1)continue;
      const tag=r.query(powers.exports.presentation,entry.entity);if(!tag||tag.side!==undefined&&tag.side!==i.side)continue;
      values[tag.key]=p.level;if(tag.slot===0)unique0=p.level;if(tag.slot===1)unique1=p.level;if(p.active)bits|=1n<<BigInt(tag.key);
      if(i.side===0){if(!tag.flag)statuses.push([tag.key,p.level]);if(p.justApplied)justApplied|=1<<tag.key;}
      else if(p.justApplied){if(tag.key===MS.VULNERABLE)bits|=1n<<63n;if(tag.key===MS.WEAK)bits|=1n<<62n;if(tag.key===MS.RITUAL)bits|=1n<<61n;}
    }
    statuses.sort((a,b)=>a[0]-b[0]);return{unique0,unique1,bits0:i.side===0?BigInt.asUintN(64,bits).toString():bits.toString(),bits1:i.side===0?Number(bits>>64n):0,justApplied:justApplied>>>0,statuses,values};
  }});
  const selectionSchema=z.object({screen:z.number(),cards:z.array(z.number()),indices:z.array(z.number()).optional(),skipIndex:z.number().optional(),pickCount:z.number().optional(),canPickZero:z.boolean().optional(),canPickAnyNumber:z.boolean().optional()}).nullable();
  const battle=defineQuery({input:z.object({run:z.number(),selection:selectionSchema,actions:z.array(z.number()).optional()}),output:FrameSchema.shape.battle,
    dependencies:[combatTactics.exports.card,enemies.exports.acted,volibearPresentation.exports.nextAttackBonus,volibearPresentation.exports.nextPlayDiscount,volibearPresentation.exports.pendingRepeats,volibearPresentation.exports.pendingEngageDiscounts,battles.exports.previewPayment,volibearPresentation.exports.domain,volibearPresentation.exports.effects,volibearPresentation.exports.permanentBonus,cardInstances.exports.variant,adventures.exports.detailsEnabled,combatSessions.exports.forRun,combatSessions.exports.current,battles.exports.current,turns.exports.current,turns.exports.rechargeAmount,turns.exports.drawCount,cardPiles.exports.current,cardInstances.exports.combatView,zones.exports.members,resources.exports.current,attributes.exports.strength,attributes.exports.dexterity,attributes.exports.artifact,attributes.exports.focus,enemies.exports.current,enemies.exports.eligible,enemies.exports.intent,enemies.exports.presentation,adventures.exports.hasRelic,adventures.exports.current,status,adventures.exports.location,battles.exports.status],base(r,i){
      const id=r.query(combatSessions.exports.forRun,i.run);if(id===null)return null;
      const s=r.query(combatSessions.exports.current,id),b=r.query(battles.exports.status,s.battle),p=r.query(resources.exports.current,b.actor),piles=r.query(cardPiles.exports.current,b.piles),ps=r.query(status,{registry:b.registry,actor:b.actor,side:0});
      const pile=(zone:number)=>r.query(zones.exports.members,zone).map(card=>r.query(cardInstances.exports.combatView,card));
      const monsters=s.roster.map((meta,index)=>{
        if(meta.actor===null||meta.controller===null){
          const run=r.query(adventures.exports.location,i.run),burning=run.x===run.map.burningEliteX&&run.y===run.map.burningEliteY;
          const strength=meta.initialized===false?0:Number(r.query(adventures.exports.hasRelic,{run:i.run,id:'PHILOSOPHERS_STONE'}))+(burning&&run.map.burningEliteBuff===0?run.act:0);
          let bits=0n;if(meta.initialized!==false&&burning&&run.map.burningEliteBuff>=2)bits|=1n<<BigInt([MS.METALLICIZE,MS.REGEN][run.map.burningEliteBuff-2]!);
          return{index:-1,name:publicMonsterName(meta),hp:0,maxHp:0,block:0,moves:[0,0],damage:0,hits:0,strength,weak:0,vulnerable:0,artifact:0,poison:0,statusBits:bits.toString(),uniquePower0:0,uniquePower1:0};
        }
        const e=r.query(enemies.exports.current,meta.controller),hp=r.query(resources.exports.current,meta.actor),st=r.query(status,{registry:b.registry,actor:meta.actor,side:1}),intent=r.query(enemies.exports.intent,meta.controller),extra=r.query(enemies.exports.presentation,meta.controller);
        return{index,name:publicMonsterName(meta),hp:hp.hp,maxHp:hp.maxHp,block:hp.block,moves:e.history,damage:intent.damage,hits:intent.hits,strength:r.query(attributes.exports.strength,meta.actor),weak:st.values[MS.WEAK]??0,vulnerable:st.values[MS.VULNERABLE]??0,artifact:st.values[MS.ARTIFACT]??0,poison:st.values[MS.POISON]??0,statusBits:st.bits0,uniquePower0:typeof extra.uniquePower0==='number'?extra.uniquePower0:st.unique0,uniquePower1:typeof extra.uniquePower1==='number'?extra.uniquePower1:st.unique1};
      });
      return{turn:b.turn-1,player:{hp:p.hp,maxHp:p.maxHp,energy:p.energy,energyPerTurn:r.query(turns.exports.rechargeAmount,s.controller),block:p.block,strength:r.query(attributes.exports.strength,b.actor),dexterity:r.query(attributes.exports.dexterity,b.actor),artifact:r.query(attributes.exports.artifact,b.actor),focus:r.query(attributes.exports.focus,b.actor),statusBits0:ps.bits0,statusBits1:ps.bits1,statuses:ps.statuses,justApplied:ps.justApplied,cardsPlayed:b.cardsPlayed,attacksPlayed:b.attacksPlayed,skillsPlayed:b.skillsPlayed,gold:p.gold,cardDrawPerTurn:r.query(turns.exports.drawCount,s.controller),cardsDiscarded:piles.discarded,lastTargetedMonster:b.lastTargeted===null?1:s.roster.findIndex(entry=>entry.actor===b.lastTargeted),lastAttackUnblockedDamage:s.lastAttackUnblockedDamage,timesDamaged:s.timesDamaged},
        monsters,...(r.query(adventures.exports.detailsEnabled,i.run)?{damagePreview:Object.fromEntries((i.selection?[]:i.actions??[]).filter(bits=>bits>>>29===0).map(bits=>[String(bits),r.query(combatTactics.exports.card,{battle:s.battle,card:r.query(zones.exports.members,piles.hand)[bits&65535]!,target:r.query(cardInstances.exports.variant,r.query(zones.exports.members,piles.hand)[bits&65535]!).target?s.roster[(bits>>>16)&8191]?.actor??null:null}).map(term=>({...term,target:term.target===null?null:s.roster.findIndex(e=>e.actor===term.target)}))])),costs:Object.fromEntries((i.selection?[]:i.actions??[]).filter(bits=>bits>>>29===0).map(bits=>[String(bits),r.query(battles.exports.previewPayment,{battle:s.battle,card:r.query(zones.exports.members,piles.hand)[bits&65535]!,target:r.query(cardInstances.exports.variant,r.query(zones.exports.members,piles.hand)[bits&65535]!).target?s.roster[(bits>>>16)&8191]?.actor??null:null})])),intents:s.roster.flatMap((entry,index)=>{if(entry.actor===null||entry.controller===null||!r.query(enemies.exports.eligible,entry.controller)||r.query(enemies.exports.current,entry.controller).escaped)return[];const enemy=r.query(enemies.exports.current,entry.controller),intent=r.query(enemies.exports.intent,entry.controller);return[{index,name:Object.entries(moveId).find(([,id])=>id===enemy.history[0])?.[0]??'INVALID',attack:intent.attack,baseDamage:intent.damage,attackDamage:intent.attackDamage,hits:intent.hits,acted:r.query(enemies.exports.acted,entry.controller)}];}),pendingRepeats:r.query(volibearPresentation.exports.pendingRepeats,s.battle),pendingEngageDiscounts:r.query(volibearPresentation.exports.pendingEngageDiscounts,s.battle),effects:r.query(volibearPresentation.exports.effects,{battle:s.battle,enemies:s.roster.map(entry=>entry.actor)}),domain:r.query(volibearPresentation.exports.domain,s.battle),cardGrowth:r.query(zones.exports.members,piles.hand).map(card=>({uniqueId:r.query(cardInstances.exports.combatView,card).uniqueId,permanentAttackBonus:r.query(volibearPresentation.exports.permanentBonus,card),nextAttackBonus:r.query(volibearPresentation.exports.nextAttackBonus,card),nextPlayDiscount:r.query(volibearPresentation.exports.nextPlayDiscount,{battle:s.battle,card})}))}:{}),hand:pile(piles.hand),drawCount:r.query(zones.exports.members,piles.draw).length,discard:pile(piles.discard),exhaust:pile(piles.exhaust),
        ...frozenEyePublication.publish(r,i.run,()=>pile(piles.draw)),
        ...(i.selection?{select:{task:cardScreenNames[i.selection.screen]??String(i.selection.screen),...s.selectionMetadata,...(r.query(adventures.exports.detailsEnabled,i.run)?{pickCount:i.selection.pickCount??s.selectionMetadata.pickCount,canPickZero:i.selection.canPickZero??s.selectionMetadata.canPickZero,canPickAnyNumber:i.selection.canPickAnyNumber??s.selectionMetadata.canPickAnyNumber,candidates:i.selection.cards.map((card,at)=>({index:i.selection!.indices?.[at]??at,card:r.query(cardInstances.exports.combatView,card)})),...(i.selection.skipIndex!==undefined?{skipIndex:i.selection.skipIndex}:{})}:{})}}:{}),
      };
    }});
  const privateBattle=defineQuery({input:z.object({run:z.number(),selection:selectionSchema,actionQueueSize:z.int32().nonnegative()}),output:BattleViewSchema.nullable(),
    selections:[counterTags],dependencies:[battle,combatSessions.exports.forRun,combatSessions.exports.current,battles.exports.current,turns.exports.current,cardPiles.exports.current,cardInstances.exports.combatView,cardInstances.exports.metadata,zones.exports.members,enemies.exports.current,enemies.exports.presentation,adventures.exports.current,potions.exports.current,random.exports.current,combatStorageViews.exports.slots,combatPrivate.exports.player,adventures.exports.bindings],base(r,input){
      const id=r.query(combatSessions.exports.forRun,input.run);if(id===null)return null;
      const s=r.query(combatSessions.exports.current,id),board=r.query(battles.exports.current,s.battle),turn=r.query(turns.exports.current,s.controller),piles=r.query(cardPiles.exports.current,board.piles),view=r.query(battle,{run:input.run,selection:input.selection})!;
      const inventory=r.query(potions.exports.current,r.query(adventures.exports.bindings,input.run).potions);
      const cardList=(zone:number)=>r.query(zones.exports.members,zone).map(card=>r.query(cardInstances.exports.combatView,card));
      const empty=(cost:number)=>({id:'INVALID',uniqueId:-1,specialData:0,cost,costForTurn:cost,upgraded:false,freeToPlayOnce:false,retain:false});
      const stasis=[empty(1),empty(1)];for(const slot of r.query(combatStorageViews.exports.slots,board.registry)){const cards=cardList(slot.zone);if(slot.index<stasis.length&&cards.length>0)stasis[slot.index]=cards[0]!;}
      const members=(zone:number)=>r.query(zones.exports.members,zone),count=(zone:number,key:'normality'|'pain'|'blood')=>members(zone).filter(card=>(r.selected(counterTags,card,undefined)&({normality:1,pain:2,blood:4}[key]))!==0).length;
      const counters={handNormalityCount:count(piles.hand,'normality'),handPainCount:count(piles.hand,'pain'),strikeCount:piles.registered.filter(card=>r.query(cardInstances.exports.metadata,card).strike).length,handBloodCardCount:count(piles.hand,'blood'),drawPileBloodCardCount:count(piles.draw,'blood'),discardPileBloodCardCount:count(piles.discard,'blood')};
      const current=board.current;
      const currentCard=current?{id:current.vanished?'INVALID':r.query(cardInstances.exports.combatView,current.card).id,uniqueId:current.state.uniqueId,specialData:current.state.specialData,cost:current.state.cost,costForTurn:current.state.costForTurn,upgraded:current.state.upgraded,freeToPlayOnce:current.state.freeToPlayOnce,retain:current.state.retain}:empty(0);
      const monsters=s.roster.map((meta,index)=>{const publicMonster=view.monsters[index]!;if(meta.actor===null||meta.controller===null)return{...publicMonster,id:meta.id,miscInfo:0,halfDead:false,escaping:false,escapeNext:false};const e=r.query(enemies.exports.current,meta.controller),extra=r.query(enemies.exports.presentation,meta.controller);return{...publicMonster,id:meta.id,miscInfo:typeof extra.miscInfo==='number'?extra.miscInfo:meta.miscInfo,halfDead:e.halfDead,escaping:e.escaped,escapeNext:extra.escapeNext===true};});
      const slotOf=(actor:number|null)=>actor===null?0:Math.max(0,s.roster.findIndex(entry=>entry.actor===actor));
      return{encounter:s.encounter,turn:board.turn-1,input:input.selection?2:1,outcome:board.outcome,monsterTurnIndex:turn.phase!==3&&board.turn===1?6:turn.cursor,
        seed:s.seed.toString(),floor:s.floor,ascension:s.ascension,endTurnQueued:board.endTurnQueued,turnHasEnded:turn.phase===2||turn.phase===3,skipMonsterTurn:turn.skipEnemies,
        future:{haveUsedDiscoveryAction:s.haveUsedDiscoveryAction,undefinedBehaviorEvoked:s.undefinedBehaviorEvoked,player:r.query(combatPrivate.exports.player,board.actor)},player:view.player,monsters,cards:{hand:cardList(piles.hand),draw:cardList(piles.draw),discard:cardList(piles.discard),exhaust:cardList(piles.exhaust),stasis,nextUniqueId:piles.nextUniqueId,counters},actionQueueSize:input.actionQueueSize,cardQueueSize:board.queue.length,
        rng:Object.fromEntries(Object.entries(s.streams).map(([key,stream])=>[key,r.query(random.exports.current,stream)])),potions:inventory.slots.slice(0,inventory.capacity),allPotions:inventory.slots,potionCount:inventory.count,potionCapacity:inventory.capacity,
        current:current?{card:currentCard,target:slotOf(current.target),energyOnUse:current.energyOnUse,isEndTurn:false,triggerOnUse:current.triggerOnUse,ignoreEnergyTotal:current.ignoreEnergyTotal,freeToPlay:current.freeToPlay,randomTarget:current.randomTarget,autoplay:current.autoplay,regretCardCount:current.regretCardCount,purgeOnUse:current.purgeOnUse,exhaustOnUse:current.exhaustOnUse}:{card:currentCard,target:0,energyOnUse:0,isEndTurn:board.currentIsEndTurn,triggerOnUse:true,ignoreEnergyTotal:false,freeToPlay:false,randomTarget:false,autoplay:false,regretCardCount:0,purgeOnUse:false,exhaustOnUse:false},
        ...(view.select?{select:view.select}:{}),
      };
    }});
  return{exports:{battle,status,privateBattle}};
}});
