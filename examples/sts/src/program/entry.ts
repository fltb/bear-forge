import {rules} from '../rules/execution.ts';
import type {Setup,Frame} from '../game.schemas.ts';
import {adventureProgram} from './adventure.ts';
import {volibearAdventureProgram} from './volibear.ts';

/** Character selection happens only at composition entry, outside combat rules. */
export const stsProgram=rules.defineRules({requires:[adventureProgram,volibearAdventureProgram],build(){
  const run=rules.defineEffect<Setup,Frame>(b=>{const result=b.local<Frame>();return rules.sequence(
    rules.when(b.read(v=>v.input.character==='volibear'),
      b.assign(result,rules.call(volibearAdventureProgram.exports.run,b.input)),
      b.assign(result,rules.call(adventureProgram.exports.run,b.input))),
    b.return(result),
  );});
  return{exports:{run}};
}});
