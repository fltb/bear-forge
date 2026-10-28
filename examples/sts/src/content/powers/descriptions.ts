import {basicPowers} from './attributes.ts';
import {defensePowers} from './defense.ts';
import {drawPowers} from './draw.ts';
import {shackledPower} from './shackled.ts';
import {relicPowers} from './relics.ts';
import {potionPowers} from '../potions/powers.ts';
import {ironcladPowers} from '../characters/ironclad/powers/definitions.ts';
import {ironcladDrawPowers} from '../characters/ironclad/powers/draw.ts';
import {combatPowers} from '../characters/ironclad/powers/combat.ts';
import {turnPowers} from '../characters/ironclad/powers/turn.ts';
import {ironcladAdditionalPowers} from '../characters/ironclad/powers/combust.ts';
import {permanentCards} from '../characters/ironclad/cards/permanent.ts';
import {colorlessAdditionalPowers} from '../cards/colorless/power-effects.ts';
import {enemyPowers} from '../enemies/shared/powers.ts';
import {enemyDefensePowers} from '../enemies/shared/defense-powers.ts';
import {combatEnemyPowers} from '../enemies/shared/combat-powers.ts';
import {enemyTurnPowers} from '../enemies/shared/ritual.ts';
import {cityPowers} from '../enemies/city/powers.ts';
import {beyondPowers} from '../enemies/beyond/powers.ts';
import {finalPowers} from '../enemies/ending/powers.ts';
import {exordiumBosses} from '../enemies/exordium/bosses.ts';
import {exordiumHumanoids} from '../enemies/exordium/humanoids.ts';
import {bronzeOrb} from '../enemies/city/bronze-orb.ts';
import {beyondBosses} from '../enemies/beyond/bosses.ts';
import {writhingMass} from '../enemies/beyond/writhing-mass.ts';
import {stormCharge} from '../characters/volibear/mechanics/storm-charge.ts';
import {lightning} from '../characters/volibear/mechanics/lightning.ts';
import {volibearEngage} from '../characters/volibear/mechanics/engage.ts';
import {volibearDomain} from '../characters/volibear/mechanics/domain.ts';
import {volibearPreparation} from '../characters/volibear/mechanics/preparation.ts';

/** Public compatibility identities with no installed status owner, not a second rule catalog. */
const unassembled=Object.fromEntries(['DOUBLE_DAMAGE','FREE_ATTACK_POWER','DRAW_CARD_NEXT_TURN','ENERGIZED','OMEGA','BLOCK_RETURN','POISON'].map(key=>[key,'当前实现未装配该状态规则。']));
/** Every implemented entry projects the same fragments that install the actual abilities. */
export const statusTexts:Record<string,string>=Object.freeze({
  ...unassembled,
  ...basicPowers.exports.statusTexts,
  ...defensePowers.exports.statusTexts,
  ...drawPowers.exports.statusTexts,
  ...shackledPower.exports.statusTexts,
  ...relicPowers.exports.statusTexts,
  ...ironcladPowers.exports.statusTexts,
  ...ironcladDrawPowers.exports.statusTexts,
  ...combatPowers.exports.statusTexts,
  ...turnPowers.exports.statusTexts,
  ...ironcladAdditionalPowers.exports.statusTexts,
  ...colorlessAdditionalPowers.exports.statusTexts,
  ...potionPowers.exports.statusTexts,
  ...enemyPowers.exports.statusTexts,
  ...enemyDefensePowers.exports.statusTexts,
  ...combatEnemyPowers.exports.statusTexts,
  ...enemyTurnPowers.exports.statusTexts,
  ...cityPowers.exports.statusTexts,
  ...beyondPowers.exports.statusTexts,
  ...finalPowers.exports.statusTexts,
  ...exordiumBosses.exports.statusTexts,
  ...exordiumHumanoids.exports.statusTexts,
  ...bronzeOrb.exports.statusTexts,
  ...beyondBosses.exports.statusTexts,
  ...writhingMass.exports.statusTexts,
  // Shared public identities have different actual player/enemy lifecycles.
  BARRICADE:`玩家：${permanentCards.exports.barricadeProgram.text}敌人：${enemyDefensePowers.exports.programs.Barricade.text}`,
  METALLICIZE:`玩家：${combatPowers.exports.programs.Metallicize.text}敌人：${combatEnemyPowers.exports.programs.Metallicize.text}`,
  PLATED_ARMOR:`玩家：${potionPowers.exports.programs.PlatedArmor.text}敌人：${enemyDefensePowers.exports.programs.PlatedArmor.text}`,
  REGEN:`玩家：${potionPowers.exports.programs.Regeneration.text}敌人：${finalPowers.exports.programs.Regen.text}`,
  RITUAL:`玩家：${potionPowers.exports.programs.Ritual.text}敌人：${enemyTurnPowers.exports.programs.EnemyRitual.text}`,
  THORNS:`玩家：${potionPowers.exports.programs.Thorns.text}敌人：${beyondPowers.exports.programs.Thorns.text}`,
});
export const volibearMechanics=Object.freeze({
  雷势:stormCharge.exports.text+lightning.exports.chargeText,
  迎战:volibearEngage.exports.text,
  雷伤:lightning.exports.text,
  领域:volibearDomain.exports.text,
  兽化:'攻击变为裂骨之爪，其他牌变为风暴之躯；保留实体、升级、减费和保留，形态打出后消耗，战后恢复原牌。',
});
