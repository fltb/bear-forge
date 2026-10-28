import {createVolibearBeastCards} from './cards/beast.ts';
import {volibearBeast} from './mechanics/beast.ts';
import {volibearStormCards as storm} from './cards/storm.ts';
import type {CharacterCardPools} from '../../../rules/adventures.types.ts';
import {combatColorlessPool} from '../../../pools.ts';
import {volibearBasicCards as basic} from './cards/basic.ts';
import {volibearCommonCards as common} from './cards/common.ts';
import {volibearUncommonCards as uncommon} from './cards/uncommon.ts';
import {volibearRareCards as rare} from './cards/rare.ts';
import {volibearEngageCards as engage} from './cards/engage.ts';
import {volibearDomainCards as domain} from './cards/domain.ts';
import {volibearGrowthCards as growth} from './cards/growth.ts';
import {volibearLethalCards as lethal} from './cards/lethal.ts';
import {volibearXCards as x_cost} from './cards/x-cost.ts';
import {rules} from '../../../rules/execution.ts';
import type {CardUse} from '../../../rules/card-instances.types.ts';
import type {CardChoiceExports} from '../../../rules/card-choices.types.ts';
import type {PermanentCardDefinition} from '../../../rules/permanent-decks.types.ts';
import {volibearCardDescriptions as descriptions} from './cards/metadata.ts';
import {createVolibearSelectionCards,type VolibearSelectionScreens} from './cards/selections.ts';
import {createVolibearOptionalEngageCards} from './cards/optional-engage.ts';

/** Static content registry. IDs are presentation/catalog labels; dispatch uses
 * definition references exclusively. The host provides real choice ports. */
export function createVolibearCatalog<W,R>(choices:rules.RuleModule<CardChoiceExports>,screens:VolibearSelectionScreens,engageAdapter:rules.ChoiceAdapter<boolean,CardUse,W,R>,requires:readonly rules.RuleModule<unknown>[]){
  const beast=createVolibearBeastCards(choices,{beast:screens.beast,search:screens.search}),selections=createVolibearSelectionCards(choices,screens),optional=createVolibearOptionalEngageCards(engageAdapter,requires);
  return rules.defineRules({requires:[beast,volibearBeast,storm,basic,common,uncommon,rare,engage,domain,growth,lethal,x_cost,selections,optional],build(){
    const byCode:Record<keyof typeof descriptions,PermanentCardDefinition>={
    C24:storm.exports.Thunderbolt,
    C25:storm.exports.LightningSeed,
    U32:storm.exports.WelcomeThunder,
    U34:storm.exports.ThunderArmor,
    U35:storm.exports.ThunderChallenge,
    U36:storm.exports.GatherCharge,
    U37:storm.exports.ConvergingStorm,
    U38:storm.exports.StormRush,
    R17:x_cost.exports.ThunderJudgment,
    R18:storm.exports.ThunderPool,
    R21:storm.exports.ThunderAvatar,
    R23:storm.exports.RendSky,
    R24:storm.exports.ThunderSurge,
    R25:beast.exports.StormReborn,
    C26:storm.exports.Grounding,
    U39:beast.exports.ThunderOmen,
    U40:storm.exports.ThunderRoad,
    U41:beast.exports.BreakSkin,
    U42:beast.exports.WildArmor,
    U43:beast.exports.FollowInstinct,
    R27:beast.exports.OldDays,
    R28:beast.exports.BearSpirit,
    R29:beast.exports.NoLongerHuman,
    R30:beast.exports.Wilderness,
    R31:beast.exports.SkyFalls,
    T01:volibearBeast.exports.Claw,
    T02:volibearBeast.exports.Body,
    B01:basic.exports.Strike,
    B02:basic.exports.Defend,
    B03:basic.exports.ThunderClaw,
    B04:engage.exports.StandAndFight,
    C01:common.exports.Approach,
    C02:common.exports.TwinClaws,
    C03:common.exports.ThunderSmash,
    C04:optional.exports.FirstToStrike,
    C05:common.exports.LightningClaw,
    C06:common.exports.PressForward,
    C07:beast.exports.FollowScent,
    C08:common.exports.TearWound,
    C09:common.exports.ThunderSweep,
    C10:engage.exports.EyeForEye,
    C11:optional.exports.FaceTheEnemy,
    C12:common.exports.ThickFur,
    C13:selections.exports.Breathing,
    C14:common.exports.ThunderGuard,
    C15:selections.exports.RegroupClaws,
    C17:common.exports.Charge,
    C18:domain.exports.ManifestDivinity,
    C19:selections.exports.HuntPreparation,
    C20:common.exports.Pursuit,
    C21:common.exports.HoldGround,
    C22:common.exports.ThunderShock,
    U02:uncommon.exports.StormConduction,
    U03:uncommon.exports.Standing,
    U04:engage.exports.BattleScars,
    U05:uncommon.exports.MountainLift,
    U06:uncommon.exports.SavageBite,
    U07:uncommon.exports.MountainCollapse,
    U08:growth.exports.NeverLetGo,
    U10:selections.exports.HoneClaws,
    U11:uncommon.exports.StormReturns,
    U12:uncommon.exports.PrimalStrength,
    U13:uncommon.exports.StrengthReclaimed,
    U14:uncommon.exports.EngagePreparation,
    U15:selections.exports.StormBreathing,
    U17:selections.exports.AncientInstinct,
    U19:domain.exports.LingeringStorm,
    U20:uncommon.exports.Unstoppable,
    U21:uncommon.exports.ThunderAftershock,
    U23:uncommon.exports.WindRoar,
    U24:lethal.exports.BloodBattle,
    U25:uncommon.exports.PreyStillStands,
    U26:uncommon.exports.GrowingFury,
    U27:growth.exports.TemperingClaw,
    U28:engage.exports.ThunderCounter,
    U29:uncommon.exports.GatheringThunder,
    U31:x_cost.exports.ThunderTrample,
    R01:domain.exports.MyLawAlone,
    R02:rare.exports.ImmovableBody,
    R05:rare.exports.WholeBodyStrength,
    R06:rare.exports.HeavenAndMan,
    R07:rare.exports.HeavenAndEarth,
    R08:rare.exports.ThunderousMight,
    R09:engage.exports.AllEnemiesCome,
    R10:selections.exports.BattleNotOver,
    R12:rare.exports.UnleashInstinct,
    R13:domain.exports.ReturnToWild,
    R14:rare.exports.EndlessHunt,
    R16:rare.exports.BattleBody,
    };
    const definitions=(Object.keys(descriptions) as (keyof typeof descriptions)[]).map(code=>({id:descriptions[code].id,definition:byCode[code]}));
    const byRarity=(rarity:number)=>definitions.filter(entry=>Object.values(descriptions).some(d=>d.id===entry.id&&d.metadata.rarity===rarity));
    const commonPool=byRarity(0),uncommonPool=byRarity(1),rarePool=byRarity(2);
    const reward=Object.values(descriptions).filter(d=>d.metadata.rarity<3);
    const cardPools:CharacterCardPools={color:6,rarity:[commonPool,uncommonPool,rarePool].map(pool=>pool.map(c=>c.id)),
      typeRarity:[0,1,2].map(type=>[0,1,2].map(rarity=>reward.filter(d=>d.metadata.type===type&&d.metadata.rarity===rarity).map(d=>d.id))),
      random:reward.map(d=>d.id),transform:reward.map(d=>d.id),
      combat:[...[0,1,2].map(type=>reward.filter(d=>d.metadata.type===type).map(d=>d.id)),reward.map(d=>d.id),[...combatColorlessPool]],
      startingBasics:[descriptions.B01.id,descriptions.B02.id],
    };
    return{exports:{definitions,byCode,cardPools,optionalChoices:{requesting:optional.exports.requesting,selected:optional.exports.selected},pools:{common:commonPool,uncommon:uncommonPool,rare:rarePool,all:[...commonPool,...uncommonPool,...rarePool]}}};
  }});
}
