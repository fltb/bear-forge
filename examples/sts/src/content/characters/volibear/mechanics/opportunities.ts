import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {enemies} from '../../../../rules/enemies.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';

/** Read the existing opportunity owner; do not infer actions from AI moves. */
export const volibearOpportunities=rules.defineRules({requires:[enemies,battles],build(){
  const acted=rules.defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[enemies.exports.forActor,enemies.exports.current,battles.exports.current],base:(r,use)=>{
    if(use.target===null)return false;
    const controller=r.query(enemies.exports.forActor,use.target);if(controller===null)return false;
    const enemy=r.query(enemies.exports.current,controller);
    return enemy.battle===use.battle&&enemy.opportunityTurn===r.query(battles.exports.current,use.battle).turn&&enemy.claimed;
  }});
  const awaitingAttack=rules.defineQuery({input:cardUseSchema,output:z.boolean(),dependencies:[enemies.exports.forActor,enemies.exports.current,enemies.exports.intent,battles.exports.current],base:(r,use)=>{
    if(use.target===null)return false;
    const controller=r.query(enemies.exports.forActor,use.target);if(controller===null)return false;
    const enemy=r.query(enemies.exports.current,controller);
    return enemy.battle===use.battle&&enemy.opportunityTurn===r.query(battles.exports.current,use.battle).turn&&!enemy.claimed&&r.query(enemies.exports.intent,controller).attack;
  }});
  return {exports:{acted,awaitingAttack}};
}});
