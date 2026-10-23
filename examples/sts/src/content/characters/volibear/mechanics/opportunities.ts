import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {enemies} from '../../../../rules/enemies.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';

/** Read the existing opportunity owner; do not infer actions from AI moves. */
export const volibearOpportunities=rules.defineRules({requires:[enemies,battles],build(){
  const acted=rules.defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[enemies.exports.forActor,enemies.exports.current,enemies.exports.acted,battles.exports.current],base:(r,use)=>{
    if(use.target===null)return false;
    const controller=r.query(enemies.exports.forActor,use.target);if(controller===null)return false;
    const enemy=r.query(enemies.exports.current,controller);
    return enemy.battle===use.battle&&enemy.opportunityTurn===r.query(battles.exports.current,use.battle).turn&&r.query(enemies.exports.acted,controller);
  }});
  const awaitingAttack=rules.defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[enemies.exports.forActor,enemies.exports.current,enemies.exports.intent,enemies.exports.acted,battles.exports.current],base:(r,use)=>{
    if(use.target===null)return false;
    const controller=r.query(enemies.exports.forActor,use.target);if(controller===null)return false;
    const enemy=r.query(enemies.exports.current,controller);
    return enemy.battle===use.battle&&enemy.opportunityTurn===r.query(battles.exports.current,use.battle).turn&&!r.query(enemies.exports.acted,controller)&&r.query(enemies.exports.intent,controller).attack;
  }});
  const actedText='目标属于本场战斗且已使用本轮敌人行动机会。';
  const awaitingAttackText='目标属于本场战斗且未使用本轮行动机会，当前意图包含攻击。';
  describeProgram(acted,actedText);describeProgram(awaitingAttack,awaitingAttackText);
  return {exports:{acted,awaitingAttack,actedText,awaitingAttackText}};
}});
