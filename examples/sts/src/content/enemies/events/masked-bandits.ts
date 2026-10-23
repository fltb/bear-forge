import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyAttack,enemyBlock,enemyPower,enemyProgram} from "../shared/programs.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll} from "../../../rules/enemies.types.ts";
const {defineRules,defineEffect,call,query}=rules;
export const maskedBandits=defineRules({requires:[enemyUtilities,enemies,basicPowers],build(){
  const s=(v:Pick<rules.ReadView<EnemyAction>,'input'|'query'>)=>v.query(enemies.exports.current,v.input.enemy);
  const next=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const Bear=enemyDefinition({id:mid.BEAR,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.BEAR_BEAR_HUG)),moves:[{move:mm.BEAR_BEAR_HUG,execute:enemyProgram(enemyPower(basicPowers.exports.Dexterity,v=>s(v).ascension>=17?-4:-2,true,true),next(mm.BEAR_LUNGE))},attackMove(mm.BEAR_LUNGE,enemyAttack(v=>s(v).ascension>=2?10:9),attack=>enemyProgram(attack,enemyBlock(9),next(mm.BEAR_MAUL))),attackMove(mm.BEAR_MAUL,enemyAttack(v=>s(v).ascension>=2?20:18),attack=>enemyProgram(attack,next(mm.BEAR_LUNGE)))]});
  const Pointy=enemyDefinition({id:mid.POINTY,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.POINTY_ATTACK)),moves:[attackMove(mm.POINTY_ATTACK,enemyAttack(v=>s(v).ascension>=2?6:5,2),attack=>attack)]});
  const Romeo=enemyDefinition({id:mid.ROMEO,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.ROMEO_MOCK)),moves:[{move:mm.ROMEO_MOCK,execute:next(mm.ROMEO_AGONIZING_SLASH)},attackMove(mm.ROMEO_AGONIZING_SLASH,enemyAttack(v=>s(v).ascension>=2?12:10),attack=>enemyProgram(attack,enemyPower(basicPowers.exports.PlayerWeak,v=>s(v).ascension>=17?3:2,true,true,true),next(mm.ROMEO_CROSS_SLASH))),attackMove(mm.ROMEO_CROSS_SLASH,enemyAttack(v=>s(v).ascension>=2?17:15),attack=>enemyProgram(attack,next(mm.ROMEO_AGONIZING_SLASH)))]});
  return{exports:{Bear,Pointy,Romeo}};
}});
