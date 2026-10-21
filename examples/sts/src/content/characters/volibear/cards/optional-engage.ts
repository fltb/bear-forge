import {z} from 'zod';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {enemies} from '../../../../rules/enemies.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,compose,queued} from './programs.ts';

/** The host supplies presentation; the branch is a boolean, never a text ID. */
export function createVolibearOptionalEngageCards<W,R>(adapter:rules.ChoiceAdapter<boolean,CardUse,W,R>,requires:readonly rules.RuleModule<unknown>[]){
  return rules.defineRules({requires:[volibearCardPrograms,volibearEngage,volibearEngagePreparation,enemies,...requires],build(m){
    const requesting=m.own(rules.defineEvent({payload:cardUseSchema,dispatch:'immediate'}));
    const selected=m.own(rules.defineEvent({payload:z.object({use:cardUseSchema,value:z.boolean()}),dispatch:'immediate'}));
    const announceRequest=m.atom({input:cardUseSchema,output:z.undefined(),reads:[],writes:[],emits:[requesting],run(_r,payload){return{writes:[],events:[{event:requesting,payload}],result:undefined};}});
    const announceSelection=m.atom({input:z.object({use:cardUseSchema,value:z.boolean()}),output:z.undefined(),reads:[],writes:[],emits:[selected],run(_r,payload){return{writes:[],events:[{event:selected,payload}],result:undefined};}});
    const optional=rules.defineEffect<CardUse,void>(b=>{
      const answer=b.local<rules.ChoiceResult<boolean>>(),targets=b.local<readonly number[]>();
      return rules.sequence(
        rules.when(b.read(v=>v.query(battles.exports.status,v.input.battle).outcome!==0),b.return(undefined)),
        b.assign(targets,b.read(v=>v.query(volibearCardPrograms.exports.singleTargets,v.input).filter(target=>{
          const id=v.query(enemies.exports.forActor,target);return id!==null&&v.query(enemies.exports.live,id)&&!v.query(enemies.exports.current,id).claimed;
        }))),
        rules.when(b.read(v=>v.get(targets).length===0),b.return(undefined)),
        rules.call(announceRequest,b.input),
        b.assign(answer,rules.chooseOne({adapter,player:b.input,candidates:[true,false],allowSkip:false,empty:'skip',singleton:'request'})),
        rules.when(b.read(v=>v.get(answer).kind==='selected'),rules.call(announceSelection,{use:b.input,value:b.read(v=>{const result=v.get(answer);return result.kind==='selected'&&result.value;})})),
        rules.when(b.read(v=>{const result=v.get(answer);return result.kind==='selected'&&result.value;}),
          rules.forEach(targets,target=>rules.call(volibearEngage.exports.execute,{use:b.input,target}))),
      );
    });
    const declaration={created:registerCardAbilities(volibearEngagePreparation.exports.declaresEngage)};
    return {exports:{requesting:requesting.public,selected:selected.public,
      FirstToStrike:card(cards.C04,compose(attack([10,14]),queued(optional)),declaration),
      FaceTheEnemy:card(cards.C11,compose(block([9,12]),queued(optional)),declaration),
    }};
  }});
}
