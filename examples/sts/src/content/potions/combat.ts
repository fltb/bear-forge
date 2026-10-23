import {potionRelics,sacredBark} from './relics.ts';
import {potionPrograms} from './programs.ts';
import {potionVitality} from './vitality.ts';
import {areaDamage} from '../shared/area-damage.ts';
import {shackledPower} from '../powers/shackled.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {consumables,type ConsumableDefinition,type ConsumableConfig,consumableUseSchema} from '../../rules/consumables.ts';
import {adventures} from '../../rules/adventures.ts';
import {combatSessions} from '../../rules/combat-sessions.ts';
import {battles} from '../../rules/battles.ts';
import {potions} from '../../rules/potions.ts';
import {basicPowers} from '../powers/attributes.ts';
import {defensePowers} from '../powers/defense.ts';
import {ironcladPowers} from '../characters/ironclad/powers/definitions.ts';
import {combatPowers} from '../characters/ironclad/powers/combat.ts';
import {potionPowers} from './powers.ts';
import {adventureDraws} from '../rewards/draws.ts';
import {potionId as id} from '../../identifiers.ts';
import type {createCombatSelectionUtils} from '../cards/shared/selection-utils.ts';
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,call}=rules;
export function createCombatPotions(selections:ReturnType<typeof createCombatSelectionUtils>){return defineRules({requires:[potionRelics,potionVitality,areaDamage,consumables,combatSessions,selections,basicPowers,defensePowers,ironcladPowers,combatPowers,potionPowers,shackledPower,adventureDraws],build(){
  const yes=defineQuery({input:consumableUseSchema,output:z.boolean(),base:()=>true}),no=defineQuery({input:consumableUseSchema,output:z.boolean(),base:()=>false});
  const definitions=Object.entries(potionPrograms).map(([name,program])=>({id:id[name as keyof typeof potionPrograms],definition:defineEntity(consumables.exports.kind,{targeted:program.targeted,allowed:program.active?yes:no,use:program.build(selections)})}));
  const policy={kind:consumables.exports.kind,select:(c:rules.Borrowed<ConsumableConfig>)=>c.allowed};
  const actions=defineQuery({input:z.number(),output:z.array(z.number()),kinds:[consumables.exports.kind],selections:[policy],dependencies:[combatSessions.exports.current,adventures.exports.current,adventures.exports.hasRelic,potions.exports.current,battles.exports.current,battles.exports.targetable,adventures.exports.bindings,battles.exports.status],base(r,session){const s=r.query(combatSessions.exports.current,session),a=r.query(adventures.exports.bindings,s.run),inventory=r.query(potions.exports.current,a.potions),board=r.query(battles.exports.status,s.battle),out:number[]=[];for(let slot=0;slot<inventory.capacity;slot++){const value=inventory.slots[slot]!;if(value===id.EMPTY_POTION_SLOT||value===id.INVALID)continue;const entry=definitions.find(e=>e.id===value);if(!entry)throw Error('Potion content is not implemented: '+value);const targeted=r.definitionConfiguration(entry.definition,consumables.exports.kind).targeted;for(const target of targeted?board.enemies:[null])if((target===null||r.query(battles.exports.targetable,target))&&r.selectedDefinition(policy,entry.definition,{battle:s.battle,actor:board.actor,target,multiplier:sacredBark.multiplier(r.query(adventures.exports.hasRelic,{run:s.run,id:'SACRED_BARK'}))}))out.push(((1<<29)|((target===null?0:s.roster.findIndex(e=>e.actor===target))<<16)|slot)>>>0);out.push(((1<<29)|(6<<16)|slot)>>>0);}return out;}});
  const drink=defineEffect<{session:number;slot:number;target:number},void>(b=>{const catalog=b.local<{id:number;definition:ConsumableDefinition}[]>(),removed=b.local<number>(),entity=b.local<number>();return sequence(b.assign(catalog,definitions),b.assign(removed,call(potions.exports.remove,{inventory:b.read(v=>v.query(adventures.exports.bindings,v.query(combatSessions.exports.current,v.input.session).run).potions),index:b.read(v=>v.input.slot)})),when(b.read(v=>v.input.target>5),b.return(undefined)),call(potionRelics.exports.used,b.read(v=>v.query(combatSessions.exports.current,v.input.session).run)),b.assign(entity,rules.spawnEntity({kind:consumables.exports.kind,definition:b.read(v=>{const entry=v.get(catalog).find(e=>e.id===v.get(removed));if(!entry)throw Error('Missing potion program');return entry.definition;}),owner:b.read(v=>v.query(battles.exports.status,v.query(combatSessions.exports.current,v.input.session).battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.query(combatSessions.exports.current,v.input.session).battle).scope),setup:b.read(v=>{const s=v.query(combatSessions.exports.current,v.input.session),board=v.query(battles.exports.status,s.battle);return{battle:s.battle,actor:board.actor,target:s.roster[v.input.target]?.actor??null,multiplier:sacredBark.multiplier(v.query(adventures.exports.hasRelic,{run:s.run,id:'SACRED_BARK'}))};})})),rules.despawnEntity({entity,reason:{consumed:true}}));});
  return{exports:{definitions,actions,drink}};
}});}
