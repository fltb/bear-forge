import {probabilityMass,numericMass,zeroMass,unitMass} from '../../../../packages/card-engine/src/probability-mass.ts';
import type {ExactPosition,TerminalBound} from '../../../../packages/policies/src/search/session.types.ts';
import {potionId} from '../identifiers.ts';
import type {Observation} from '../game.schemas.ts';
import {compressedPublicKey,type PublicDecision} from './information.ts';
import {combatValue,combatPriority,combatExclusions,combatTiePreferences} from './layered.ts';

/** Lexicographic expected terminal rewards: survival, HP, permanent max HP,
 * gold, then retained potion fraction. Gold's signed original 16-bit range is
 * shifted by 32768; no artificial weight trades life for resources.
 * HP upper bounds remain infinite: a TS/schema declaration alone does not
 * prove that all original growth paths are dynamically bounded by int32. */
export const combatUpper:TerminalBound=[unitMass(),null,null,probabilityMass(65535n),unitMass()];
export function exactCombatPosition(decision:PublicDecision,initial:Observation,eventOffset:number):ExactPosition{
  const observation={...decision.observation,history:[]},finished=!observation.battle||observation.game.outcome!==1;
  let terminal:ExactPosition['terminal']=null;
  if(finished){
    const hp=observation.battle?.player.hp??observation.game.hp;
    if(observation.game.outcome===0||hp<=0)terminal=Array.from({length:combatUpper.length},zeroMass);
    else{
      const potions=observation.game.potions,retained=potions.filter(id=>id!==potionId.INVALID&&id!==potionId.EMPTY_POTION_SLOT).length;
      terminal=[unitMass(),numericMass(hp),numericMass(observation.game.maxHp),numericMass(observation.game.gold+32768),
        potions.length?probabilityMass(BigInt(retained),BigInt(potions.length)):zeroMass()];
    }
  }
  const elapsedTurns=finished?
    Math.max(decision.events.slice(eventOffset).filter(event=>event.kind==='detail'&&event.type==='player-turn-start').length,
      decision.observation.history.slice(initial.history.length).filter(action=>action.kind==='battle'&&action.bits>>>29===4).length):undefined;
  return{information:compressedPublicKey({...decision,observation,events:decision.events.slice(eventOffset)}),
    actions:terminal?[]:decision.actions.map(action=>({key:String(action.bits),action:{...action}})),
    localExclusions:terminal?[]:combatExclusions(decision),
    localTiePreferences:terminal?{}:combatTiePreferences(decision),
    terminal,priority:combatPriority(decision.observation,initial,elapsedTurns),utility:(combatValue(decision.observation,initial,elapsedTurns)+1)/2};
}
