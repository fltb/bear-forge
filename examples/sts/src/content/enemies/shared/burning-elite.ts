import {rules} from '@bear-forge/card-engine';
import {adventures} from "../../../rules/adventures.ts";
import {battles} from "../../../rules/battles.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {combatEnemyPowers} from "./combat-powers.ts";
import {finalPowers} from "../ending/powers.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query}=rules;
/** A room rule composes ordinary resource and power effects before relic startup. */
export const emeraldElites=defineRules({requires:[adventures,battles,resources,powers,basicPowers,combatEnemyPowers,finalPowers],build(){
  const apply=defineEffect<{run:number;battle:number},void>(b=>{
    const act=b.local<number>(),buff=b.local<number>();
    const power=(definition:import('../../../rules/powers.types.ts').PowerDefinition,actor:rules.Value<number>,amount:rules.Input<number>)=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition,amount,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)});
    return sequence(
      when(b.read(v=>{const s=v.query(adventures.exports.location,v.input.run);return s.x!==s.map.burningEliteX||s.y!==s.map.burningEliteY;}),b.return(undefined)),
      b.assign(act,b.read(v=>v.query(adventures.exports.position,v.input.run).act)),b.assign(buff,b.read(v=>v.query(adventures.exports.plan,v.input.run).map.burningEliteBuff)),
      forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies),actor=>sequence(
        when(b.read(v=>v.get(buff)===0),power(basicPowers.exports.Strength,actor,act)),
        when(b.read(v=>v.get(buff)===1),call(resources.exports.raiseMaxHp,{entity:actor,amount:b.read(v=>Math.round(Math.fround(Math.fround(v.query(resources.exports.vitality,v.get(actor)).maxHp)*Math.fround(.25))))})),
        when(b.read(v=>v.get(buff)===2),power(combatEnemyPowers.exports.Metallicize,actor,b.read(v=>v.get(act)*2+2))),
        when(b.read(v=>v.get(buff)===3),power(finalPowers.exports.Regen,actor,b.read(v=>v.get(act)*2+1))),
      )),
    );
  });return{exports:{apply}};
}});
