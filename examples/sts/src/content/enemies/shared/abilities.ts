import {describeProgram,programText} from '../../cards/shared/program-facts.ts';
import {powerDescription} from '../../powers/utils.ts';
import {typedValue} from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {OperationKind} from '../../../rules/combat-operations.ts';
import {powers} from '../../../rules/powers.ts';
import {EffectKind} from '../../../rules/effect-policy.ts';
import type {PowerLifecycle,PowerConfig} from '../../../rules/powers.types.ts';

export type EnemyAbility={ability:rules.Ability;operation:OperationKind;polarity?:-1|0|1};
export const contribution=(ability:rules.Ability):EnemyAbility=>({ability,operation:OperationKind.Contribution});
export const drawback=(ability:rules.Ability):EnemyAbility=>({ability,operation:OperationKind.Contribution,polarity:-1});
export const settlement=(ability:rules.Ability):EnemyAbility=>({ability,operation:OperationKind.Settlement});
export const battleFact=(ability:rules.Ability):EnemyAbility=>({ability,operation:OperationKind.BattleFact});
export const blockAbility=(ability:rules.Ability):EnemyAbility=>({ability,operation:OperationKind.Contribution});
export const strengthAbility=(ability:rules.Ability):EnemyAbility=>({ability,operation:OperationKind.Contribution});
/** Every ability declares whether it contributes a suppressible benefit or
 * maintains lifecycle facts. No implicit Special default for enemy content. */
export function enemyAbilities(...entries:EnemyAbility[]):rules.Effect<PowerLifecycle,void>{
  return rules.defineEffect(b=>rules.sequence(...entries.map(({ability,operation,polarity})=>{
    const fact=operation===OperationKind.Settlement||operation===OperationKind.BattleFact;
    const effect=operation===OperationKind.Block?EffectKind.Block:operation===OperationKind.Strength?EffectKind.Strength:EffectKind.Special;
    const enabled=rules.defineQuery({input:abilityContext,output:booleanSchema,dependencies:[powers.exports.contributes],base:(r,c)=>r.query(powers.exports.contributes,{entity:c.source,effect,...(polarity===undefined?{}:{polarity})})});
    return rules.install({ability:fact?ability:rules.guardAbility(ability,enabled),source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)});
  })));
}
/** Presentation projects the same operation-tagged abilities that are installed. */
export function describedEnemyAbility(text:string,...abilities:EnemyAbility[]){
  if(abilities.length===1)describeProgram(abilities[0]!.ability,text);
  return abilities.length===1?enemyPowerAbilities(...abilities):{text:undefined,abilities};
}
export function enemyPowerAbilities(...abilities:EnemyAbility[]){
  const texts=abilities.map(({ability})=>programText(ability));
  return{text:texts.every(text=>text!==undefined)?texts.filter(Boolean).join(''):undefined,abilities};
}
export function defineDescribedEnemyPower(name:string,config:Omit<PowerConfig,'attach'>,options:{components?:readonly rules.Component<any>[];attach?:(abilities:rules.Effect<PowerLifecycle,void>)=>rules.Effect<PowerLifecycle,void>},...parts:ReturnType<typeof describedEnemyAbility>[]){
  const {text,complete}=powerDescription(parts,options.attach,config.merged,config.detach);
  const abilities=enemyAbilities(...parts.flatMap(part=>part.abilities));
  return Object.freeze({name,text,complete,definition:rules.defineEntity(powers.exports.kind,{...config,attach:options.attach?options.attach(abilities):abilities},options.components?{components:options.components}:{})});
}
const abilityContext=typedValue<{source:number;owner:number;environment:{}}>();
const booleanSchema=z.boolean();
