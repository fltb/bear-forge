import {enemyOperations} from '../shared/operations.ts';
import {enemySuicide} from '../shared/cards.ts';
import type {EnemyAction} from '../../../rules/enemies.types.ts';
import {describedEnemyAbility,enemyPowerAbilities,defineDescribedEnemyPower,strengthAbility,contribution,drawback,settlement} from '../shared/abilities.ts';
import {afterCardUse,firstEnemyCardUse,blockedHit,ownUnblockedHit,queuedRetaliation,hitBattle,owner,hitAttacker,level,enemyRoundEnd,ownTurn,addCounter,setCounter,incomingPlayerAttackPerLayer,gainStrength,playerEndPowers,turnBattle,noSource,applyPower,hitSource,unblockedAmount,sequencePrograms,wouldDie,ownDeathWithTargets,ownerEnemy,enterRebirth} from '../shared/status-programs.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {shackledPower} from "../../powers/shackled.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {powers} from "../../../rules/powers.ts";
import {battles} from "../../../rules/battles.ts";
import {enemies} from "../../../rules/enemies.ts";
import {turns} from "../../../rules/turns.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {damage} from "../../../rules/damage.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {counterPolicies} from "../../powers/utils.ts";
import {ownsTurn} from "../../powers/turn-hooks.ts";
import {MS,PS,moveId as mm} from "../../../combat-identifiers.ts";
import {actionQueue,combatScope} from "../../../rules/combat-actions.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {HpDamageRequest} from "../../../rules/damage.types.ts";
const {defineRules,defineEffect,defineQuery,defineEntity,sequence,when,forEach,call,query,on,modify,enqueue}=rules;

export const beyondPowers=defineRules({requires:[enemyOperations,powers,battles,enemies,turns,resources,attributes,damage,basicPowers,shackledPower],build(){
  const slowPerCard=1,slowScale=.1;
  const strengthEnd=enemyRoundEnd({condition:ownTurn(),order:{phase:turns.exports.stages.content,priority:100},effect:gainStrength(level<TurnActor>())});
  const StrengthUp=defineDescribedEnemyPower("力量增长",{presentation:{key:MS.GENERIC_STRENGTH_UP,flag:false,slot:0},...counterPolicies({bits:32})},{},enemyPowerAbilities(strengthAbility(strengthEnd)));
  const thorns=blockedHit({condition:ownUnblockedHit({attackOnly:true,requireSource:true}),effect:queuedRetaliation({battle:hitBattle(),source:owner<HpDamageRequest>(),target:hitAttacker(),amount:level<HpDamageRequest>()},{position:'front',attack:false,selfDamage:false})});
  const Thorns=defineDescribedEnemyPower("荆棘",{presentation:{key:MS.THORNS,flag:false,slot:0},...counterPolicies({bits:8})},{},enemyPowerAbilities(contribution(thorns)));
  const constrict=playerEndPowers({condition:ownTurn(),order:{phase:turns.exports.stages.content,priority:200},effect:queuedRetaliation({battle:turnBattle(),source:noSource<TurnActor>(),target:owner<TurnActor>(),amount:level<TurnActor>()},{attack:false,selfDamage:false})});
  const Constricted=defineDescribedEnemyPower("缠绕",{presentation:{key:PS.CONSTRICTED,flag:false},...counterPolicies({bits:16,harmful:true})},{},enemyPowerAbilities(contribution(constrict)));
  const slowCount=afterCardUse({condition:firstEnemyCardUse(true),effect:addCounter<CardUse>(slowPerCard)});
  const slowReset=enemyRoundEnd({condition:ownTurn(),order:{phase:turns.exports.stages.content,priority:50},effect:setCounter<TurnActor>(0)});
  const Slow=defineDescribedEnemyPower("缓慢",{presentation:{key:MS.SLOW,flag:false,slot:0},...counterPolicies({bits:32,harmful:true})},{},enemyPowerAbilities(contribution(slowCount),settlement(slowReset),contribution(incomingPlayerAttackPerLayer(slowScale,40))));
  const shift=blockedHit({condition:ownUnblockedHit({attackOnly:false,requireSource:false}),effect:sequencePrograms(
    applyPower(basicPowers.exports.programs.Strength,{target:owner<HpDamageRequest>(),source:hitSource(),amount:unblockedAmount(true)},true),
    applyPower(shackledPower.exports.programs.Shackled,{target:owner<HpDamageRequest>(),source:noSource<HpDamageRequest>(),amount:unblockedAmount()},false),
  )});
  const Shifting=defineDescribedEnemyPower("变换",{presentation:{key:MS.SHIFTING,flag:true},...counterPolicies({bits:32,flag:true})},{},enemyPowerAbilities(drawback(shift)));
  // The counter has no passive listener: its owner invokes this continuation
  // after enqueueing the attack. Keep suicide queued before noop/consumption.
  const fadingStep=1;
  const FadingState=defineDescribedEnemyPower("消逝",{presentation:{key:MS.FADING,flag:false,slot:0},...counterPolicies({bits:32})},{});
  const Fading=Object.freeze({...FadingState,text:`每次攻击行动后层数减少${fadingStep}；行动时剩余${fadingStep}层则在该次攻击后消失，不触发死亡反应。`,afterAttack:defineEffect<EnemyAction,void>(b=>{
    const fading=b.local<number>();
    return sequence(
      b.assign(fading,b.read(v=>{const p=v.query(powers.exports.find,{registry:v.query(battles.exports.status,v.input.battle).registry,actor:v.input.actor,definition:FadingState.definition});if(p===null)throw Error('Transient needs Fading');return p;})),
      when(b.read(v=>v.query(powers.exports.level,v.get(fading))===fadingStep),call(enemySuicide(false),b.input)),
      call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)),
      call(enemyOperations.exports.consumePower,{entity:fading,amount:fadingStep}),
    );
  })});
  const regrow=wouldDie({condition:ownDeathWithTargets(),effect:enterRebirth(ownerEnemy<{entity:number}>('Rebirth needs an enemy'),{move:mm.DARKLING_REGROW,moveName:'再生',clear:'all',remove:[],clearBlock:true,clearCards:false})});
  const Regrow=defineDescribedEnemyPower("再生",{presentation:{key:MS.REGROW,flag:true},...counterPolicies({bits:32,flag:true})},{},enemyPowerAbilities(contribution(regrow)));
  return{exports:{StrengthUp:StrengthUp.definition,Thorns:Thorns.definition,Constricted:Constricted.definition,Slow:Slow.definition,Shifting:Shifting.definition,Fading:Fading.definition,Regrow:Regrow.definition,programs:{StrengthUp,Thorns,Constricted,Slow,Shifting,Fading,Regrow},statusTexts:{GENERIC_STRENGTH_UP:StrengthUp.text,THORNS:Thorns.text,CONSTRICTED:Constricted.text,SLOW:Slow.text,SHIFTING:Shifting.text,FADING:Fading.text,REGROW:Regrow.text}}};
}});
