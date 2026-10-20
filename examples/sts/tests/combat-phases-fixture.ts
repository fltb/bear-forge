import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {combatContentRules} from './combat-content-fixture.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {turns} from '../src/rules/turns.ts';
import {resources} from '../src/rules/resources.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import type {TurnActor} from '../src/rules/turns.types.ts';
const setupSchema=programSchemas.setup.extend({encounter:z.int32(),slot:z.int32().min(0).max(4),hp:z.int32().positive()});
export type PhaseCase=z.infer<typeof setupSchema>;
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,call,query,spawnEntity,install,on,updateLocalComponent}=rules;
const fixture=defineRules({requires:[combatContentRules,combatSessions,turns,resources],build(m){
  const done=defineComponent({schema:z.boolean(),initial:()=>false});
  const wound=on(turns.exports.idle,{
    condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor,PhaseCase>>(),output:z.boolean(),reads:[done],base:(r,c)=>!r.component(c.source,done)}),
    effect:defineEffect<rules.ReactionContext<TurnActor,PhaseCase>,void>(b=>sequence(
      updateLocalComponent(b.read(v=>v.input.source),done,true),
      call(resources.exports.setHealth,b.read(v=>{
        const session=v.get(query(combatSessions.exports.forBattle,v.input.event.battle));if(session===null)throw Error('Phase fixture needs combat');
        const actor=v.get(query(combatSessions.exports.current,session)).roster[v.input.environment.slot]?.actor;if(actor==null)throw Error('Phase fixture needs an occupied slot');
        const state=v.get(query(resources.exports.current,actor));return{entity:actor,hp:Math.min(state.maxHp,v.input.environment.hp),maxHp:state.maxHp};
      })),
    )),
  });
  const kind=m.kind({config:z.undefined(),setup:setupSchema,components:[],initialize:defineEffect<rules.EntityLifecycle<PhaseCase>,void>(b=>install({ability:wound,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:b.read(v=>v.input.setup),lifetime:0}))});
  const anchor=defineEntity(kind,undefined,{components:[done]});
  const entry=defineEffect<PhaseCase,Frame>(b=>{
    const result=b.local<Frame>();
    return sequence(
      spawnEntity({definition:anchor,owner:null,scope:0,setup:b.input}),
      b.assign(result,call(combatContentRules.exports.entry,{seed:b.read(v=>v.input.seed),encounter:b.read(v=>v.input.encounter),relics:[],potion:null,durable:true,elite:false})),
      b.return(result),
    );
  });
  return{exports:{entry}};
}});
export const phaseDefinition=linkRules<{},PhaseCase,Ports,Frame>({id:'sts/combat-phase-cases',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
