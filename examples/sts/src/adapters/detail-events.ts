import {permanentDecks} from '../rules/permanent-decks.ts';
import {z} from 'zod';
import {ruleModules} from '@bear-forge/card-engine';
import {rules} from '../rules/execution.ts';
import {adventures} from '../rules/adventures.ts';
import {resources} from '../rules/resources.ts';
import {damage} from '../rules/damage.ts';
import {cardPiles} from '../rules/card-piles.ts';
import {cardInstances} from '../rules/card-instances.ts';
import {battles} from '../rules/battles.ts';
import {enemies} from '../rules/enemies.ts';
import {powers} from '../rules/powers.ts';
import {turns} from '../rules/turns.ts';
import {combatSessions} from '../rules/combat-sessions.ts';
import {zones} from '../rules/zones.ts';
import {frozenEyePublication} from './combat-views.ts';
import type {StsEvent} from '../game.schemas.ts';

/** Explicit record consumer. Hooks publish committed domain facts through the
 * existing event port. No host-side state diff or access to hidden game state. */
export const detailEvents=rules.defineRules({requires:[permanentDecks,adventures,resources,damage,cardPiles,cardInstances,battles,enemies,powers,turns,combatSessions,zones],build(){
  const publish=ruleModules.portEffect<StsEvent[],null>('event');
  const abilities:rules.Ability<{}>[]=[];
  function listen<T>(event:rules.RuleEvent<T>,type:string,project:(v:rules.ReadView<rules.ReactionContext<T>>)=>Record<string,string|number|boolean|null>|Record<string,string|number|boolean|null>[]){
    abilities.push(rules.on(event,{effect:rules.defineEffect<rules.ReactionContext<T>,void>(b=>rules.call(publish,b.read(v=>{const data=project(v);return(Array.isArray(data)?data:[data]).map(data=>{
      // Correlate already-public event participants with the current public board.
      // This is presentation metadata from the original entities, never a simulation.
      const published={...data},session=v.query(combatSessions.exports.forRun,v.input.owner);
      const player=v.query(adventures.exports.bindings,v.input.owner).actor;
      const current=session===null?null:v.query(combatSessions.exports.current,session);
      const roster=current?.roster??[];if(current)published.displayBattle=current.battle;
      for(const field of ['entity','actor','enemy','source','target','blockTarget']){
        const id=data[field];if(typeof id!=='number')continue;
        if(id===player)published[field+'Role']='player';
        else {const index=roster.findIndex(entry=>entry.actor===id||entry.controller===id);if(index>=0){published[field+'Role']='enemy';published[field+'Index']=index;}}
      }
      return{kind:'detail' as const,type,data:published};
    });})))}));
  }
  listen(permanentDecks.exports.obtained,'cards-obtained',v=>({deck:v.input.event.deck,entity:v.input.event.card,...v.query(cardInstances.exports.permanentView,v.input.event.card)}));
  listen(permanentDecks.exports.removed,'card-removed',v=>({deck:v.input.event.deck,entity:v.input.event.card,...v.query(cardInstances.exports.permanentView,v.input.event.card)}));
  listen(cardInstances.exports.changed,'card-change',v=>{
    const event=v.input.event;
    if(event.after.mode===1){
      const session=v.query(combatSessions.exports.forRun,v.input.owner);
      if(session===null)return[];
      const piles=v.query(battles.exports.status,v.query(combatSessions.exports.current,session).battle).piles;
      if(v.query(zones.exports.location,event.entity)===v.query(cardPiles.exports.bindings,piles).draw&&!frozenEyePublication.visible(v,v.input.owner))return[];
    }
    return{entity:event.entity,beforeUpgraded:event.before.upgraded,afterUpgraded:event.after.upgraded,beforeCost:event.before.cost,afterCost:event.after.cost,beforeData:event.before.specialData,afterData:event.after.specialData};
  });
  listen(resources.exports.changed,'resource-change',v=>({...v.input.event}));
  listen(damage.exports.resolved,'damage',v=>({...v.input.event}));
  listen(resources.exports.healed,'heal',v=>({...v.input.event}));
  listen(resources.exports.hpLost,'hp-loss',v=>{const e=v.input.event;return{entity:e.entity,amount:e.amount,before:e.before,after:e.after,maxHp:e.maxHp,selfDamage:e.selfDamage};});
  listen(resources.exports.blockGained,'block-gain',v=>({...v.input.event}));
  listen(resources.exports.energyGained,'energy-gain',v=>({...v.input.event}));
  listen(resources.exports.goldGained,'gold-gain',v=>({...v.input.event}));
  const card=(v:rules.ReadView<rules.ReactionContext<{piles:number;card:number}>>)=>{const e=v.input.event,c=v.query(cardInstances.exports.combatView,e.card),m=v.query(cardInstances.exports.metadata,e.card);return{entity:e.card,piles:e.piles,id:c.id,uniqueId:c.uniqueId,upgraded:c.upgraded,name:m.name};};
  listen(cardPiles.exports.drawn,'draw',card);
  listen(cardPiles.exports.exhausted,'exhaust',card);
  listen(cardPiles.exports.discarded,'discard',v=>({...card(v),endTurn:v.input.event.endTurn}));
  listen(battles.exports.using,'card-play',v=>{const e=v.input.event,c=v.query(cardInstances.exports.combatView,e.card);return{battle:e.battle,actor:e.owner,card:e.card,id:c.id,uniqueId:c.uniqueId,target:e.target,energyOnUse:e.energyOnUse};});
  listen(battles.exports.started,'battle-start',v=>({battle:v.input.event}));
  listen(battles.exports.exiting,'battle-end',v=>({...v.input.event}));
  listen(enemies.exports.staged,'enemy-action',v=>({...v.input.event,name:v.query(enemies.exports.metadata,v.get(rules.definitionOf(enemies.exports.kind,v.input.event.enemy))).name}));
  listen(enemies.exports.completed,'enemy-action-complete',v=>{const e=v.input.event;return{performed:e.performed,absorbed:e.absorbed,blockSpent:e.blockSpent,enemy:e.action?.enemy??null,battle:e.action?.battle??null,move:e.action?.move??null};});
  listen(powers.exports.attached,'status-attached',v=>({entity:v.input.event.entity,actor:v.input.event.state.actor,status:v.query(powers.exports.presentation,v.input.event.entity)?.key??-1,level:v.input.event.state.level,active:v.input.event.state.active}));
  listen(powers.exports.changed,'status-change',v=>({entity:v.input.event.entity,actor:v.input.event.after.actor,status:v.query(powers.exports.presentation,v.input.event.entity)?.key??-1,before:v.input.event.before.level,after:v.input.event.after.level,active:v.input.event.after.active}));
  listen(turns.exports.playerStartRelics,'player-turn-start',v=>({...v.input.event}));
  listen(turns.exports.playerEndRelics,'player-turn-end',v=>({...v.input.event}));
  // Original public participants are announced at a stable decision boundary.
  // Never enumerate the hidden draw pile unless the existing Frozen Eye publication permits it.
  const publishBoard=rules.defineEffect<number,void>(b=>rules.call(publish,b.read(v=>{
    const player=v.query(adventures.exports.bindings,v.input).actor,session=v.query(combatSessions.exports.forRun,v.input);
    const rows:StsEvent[]=[{kind:'detail',type:'entity-view',data:{entity:player,entityRole:'player'}}];
    if(session===null)return rows;
    const current=v.query(combatSessions.exports.current,session),battle=current.battle,piles=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,battle).piles);
    for(const [index,enemy] of current.roster.entries())if(enemy.actor!==null&&enemy.controller!==null){
      rows.push({kind:'detail',type:'entity-view',data:{entity:enemy.actor,entityRole:'enemy',entityIndex:index,displayBattle:battle}});
      rows.push({kind:'detail',type:'entity-view',data:{entity:enemy.controller,entityRole:'enemy',entityIndex:index,displayBattle:battle}});
    }
    for(const zone of [piles.hand,piles.discard,piles.exhaust,...(frozenEyePublication.visible(v,v.input)?[piles.draw]:[])])for(const entity of v.query(zones.exports.members,zone)){
      const card=v.query(cardInstances.exports.combatView,entity);rows.push({kind:'detail',type:'entity-view',data:{entity,uniqueId:card.uniqueId,id:card.id,displayBattle:battle}});
    }
    return rows;
  })));
  const publishSelection=rules.defineEffect<{battle:number;cards:readonly number[]},void>(b=>rules.call(publish,b.read(v=>v.input.cards.map(entity=>{
    const card=v.query(cardInstances.exports.combatView,entity);
    return{kind:'detail' as const,type:'entity-view',data:{entity,uniqueId:card.uniqueId,id:card.id,displayBattle:v.input.battle}};
  }))));
  const initialize=rules.defineEffect<number,void>(b=>rules.sequence(rules.call(adventures.exports.enableDetails,b.input),...abilities.map(ability=>rules.install({ability,source:b.input,owner:b.input,environment:{},lifetime:b.read(v=>v.query(adventures.exports.bindings,v.input).scope)}))));
  return{exports:{initialize,publishBoard,publishSelection}};
}});
