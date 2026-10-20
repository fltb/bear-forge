import {rules} from '@bear-forge/card-engine';
import {enemies} from '../rules/enemies.ts';
import {basicPowers} from './basic-powers.ts';
import {enemyUtilities,enemyDefinition,enemyAttack,enemyBlock,enemyPower,enemyProgram} from './enemy-utils.ts';
import {moveId as mm,monsterId as mid} from '../combat-identifiers.ts';
import type {EnemyAction,EnemyRoll} from '../rules/enemies.types.ts';
const {defineRules,defineEffect,call,query}=rules;
export const maskedBandits=defineRules({requires:[enemyUtilities,enemies,basicPowers],build(){
  const s=(v:rules.ReadView<EnemyAction>)=>v.get(query(enemies.exports.current,v.input.enemy));
  const next=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const Bear=enemyDefinition({id:mid.BEAR,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.BEAR_BEAR_HUG)),moves:[{move:mm.BEAR_BEAR_HUG,execute:enemyProgram(enemyPower(basicPowers.exports.Dexterity,v=>s(v).ascension>=17?-4:-2,true,true),next(mm.BEAR_LUNGE))},{move:mm.BEAR_LUNGE,damage:s=>s.ascension>=2?10:9,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?10:9),enemyBlock(9),next(mm.BEAR_MAUL))},{move:mm.BEAR_MAUL,damage:s=>s.ascension>=2?20:18,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?20:18),next(mm.BEAR_LUNGE))}]});
  const Pointy=enemyDefinition({id:mid.POINTY,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.POINTY_ATTACK)),moves:[{move:mm.POINTY_ATTACK,damage:s=>s.ascension>=2?6:5,hits:2,execute:enemyAttack(v=>s(v).ascension>=2?6:5,2)}]});
  const Romeo=enemyDefinition({id:mid.ROMEO,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.ROMEO_MOCK)),moves:[{move:mm.ROMEO_MOCK,execute:next(mm.ROMEO_AGONIZING_SLASH)},{move:mm.ROMEO_AGONIZING_SLASH,damage:s=>s.ascension>=2?12:10,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?12:10),enemyPower(basicPowers.exports.PlayerWeak,v=>s(v).ascension>=17?3:2,true,true,true),next(mm.ROMEO_CROSS_SLASH))},{move:mm.ROMEO_CROSS_SLASH,damage:s=>s.ascension>=2?17:15,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?17:15),next(mm.ROMEO_AGONIZING_SLASH))}]});
  return{exports:{Bear,Pointy,Romeo}};
}});
