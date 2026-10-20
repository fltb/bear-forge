import {rules} from '@bear-forge/card-engine';
/** A shared third-layer utility; all registration state is still inside the current Context. */
export function registerRelicAbilities(...abilities:rules.Ability[]):rules.Effect<rules.EntityLifecycle,void>{
  return rules.defineEffect(b=>rules.sequence(...abilities.map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
    if(v.input.owner===null)throw Error('A relic needs an owner');return v.input.owner;
  }),environment:{},lifetime:b.read(v=>v.input.scope)}))));
}
