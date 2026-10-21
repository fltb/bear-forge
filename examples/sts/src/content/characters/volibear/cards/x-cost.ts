import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,thunder,compose} from './programs.ts';

export const volibearXCards=rules.defineRules({requires:[volibearCardPrograms,resources,battles],build(){
  // Relic/content modifiers target this typed query. Payment stays the captured
  // X value; bonus iterations do not spend extra energy.
  const iterations=rules.defineQuery({input:cardUseSchema,output:z.number().int().nonnegative(),base:(_r,use)=>use.energyOnUse});
  const wave=compose(attack([5,7]),thunder(3));
  const trample=rules.defineEffect<CardUse,void>(b=>{
    const paid=b.local<number>(),use=b.local<CardUse>(),count=b.local<number>();
    return rules.sequence(
      b.assign(paid,b.read(v=>v.input.ignoreEnergyTotal?v.input.energyOnUse:Math.min(v.input.energyOnUse,v.get(rules.query(resources.exports.current,v.input.owner)).energy))),
      rules.call(battles.exports.setEnergyOnUse,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play),value:paid}),
      b.assign(use,b.read(v=>({...v.input,energyOnUse:v.get(paid)}))),
      b.assign(count,rules.query(iterations,use)),
      rules.when(b.read(v=>!v.input.autoplay&&!v.input.purgeOnUse&&!v.input.freeToPlay&&!v.input.state.freeToPlayOnce&&!v.get(rules.query(battles.exports.waivedPayment,v.input))),
        rules.call(resources.exports.useEnergy,{entity:b.read(v=>v.input.owner),amount:paid})),
      rules.forEach(b.read(v=>Array.from({length:v.get(count)},(_,i)=>i)),()=>rules.call(wave,use)),
    );
  });
  return {exports:{iterations,ThunderTrample:card(cards.U31,trample)}};
}});
