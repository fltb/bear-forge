import {enemyTurnPowers} from '../shared/ritual.ts';
import {rules} from '../../../rules/execution.ts';
import {battles} from '../../../rules/battles.ts';
import {actionQueue} from '../../../rules/combat-actions.ts';
import {enemies} from '../../../rules/enemies.ts';
import {moveId,monsterId} from '../../../combat-identifiers.ts';
import {enemyUtilities,enemyDefinition,attackMove,enemyAttack,enemyPower,enemyProgram,rollEnemyAfter} from '../shared/programs.ts';
import type {EnemyRoll,EnemyAction} from '../../../rules/enemies.types.ts';

export const cultist=rules.defineRules({requires:[enemyUtilities,enemies,enemyTurnPowers],build(){
  const choose=rules.defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0?moveId.CULTIST_INCANTATION:moveId.CULTIST_DARK_STRIKE)));
  const next=rules.defineEffect<EnemyAction,void>(b=>rules.sequence(
    rules.call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:moveId.CULTIST_DARK_STRIKE}),
    rules.call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)),
  ));
  const noop=rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(enemies.exports.noopRoll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  const Cultist=enemyDefinition({id:monsterId.CULTIST,choose,moves:[
    {move:moveId.CULTIST_INCANTATION,execute:enemyProgram(enemyPower(enemyTurnPowers.exports.EnemyRitual,v=>{const a=v.query(enemies.exports.current,v.input.enemy).ascension;return a>=17?5:a>=2?4:3;}),next)},
    attackMove(moveId.CULTIST_DARK_STRIKE,enemyAttack(6),attack=>enemyProgram(attack,noop)),
  ]});
  return{exports:{Cultist}};
}});
