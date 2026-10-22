import {z} from 'zod';
import {linkRules} from '@bear-forge/card-engine';
import {rules} from '../src/rules/execution.ts';
import {combatContentRules} from './combat-content-fixture.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {turns} from '../src/rules/turns.ts';
import {enemies} from '../src/rules/enemies.ts';
import {resources} from '../src/rules/resources.ts';
import {moveId} from '../src/combat-identifiers.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import type {TurnActor} from '../src/rules/turns.types.ts';
import {encounterId,type RelicId} from '../src/identifiers.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,call,query,spawnEntity,install,on,updateLocalComponent}=rules;
export function implantFixture(owned:readonly RelicId[],spent:number){
  const fixture=defineRules({requires:[combatContentRules,combatSessions,turns,resources,enemies],build(m){
    const done=defineComponent({schema:z.boolean(),initial:()=>false});
    const direct=on(turns.exports.idle,{condition:defineQuery({input:z.custom<rules.ReactionContext<TurnActor>>(),output:z.boolean(),reads:[done],base:(r,c)=>!r.component(c.source,done)}),effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>sequence(
      updateLocalComponent(b.read(v=>v.input.source),done,true),
      call(resources.exports.setHealth,{entity:b.read(v=>v.input.event.actor),hp:100,maxHp:10000}),
      call(resources.exports.setHealth,b.read(v=>{const session=v.query(combatSessions.exports.forBattle,v.input.event.battle);if(session===null)throw Error('Missing combat');const actor=v.query(combatSessions.exports.current,session).roster[0]!.actor!;return{entity:actor,hp:1,maxHp:v.query(resources.exports.vitality,actor).maxHp};})),
      call(enemies.exports.replaceMove,b.read(v=>{const session=v.query(combatSessions.exports.forBattle,v.input.event.battle);if(session===null)throw Error('Missing combat');return{enemy:v.query(combatSessions.exports.current,session).roster[0]!.controller!,move:moveId.WRITHING_MASS_IMPLANT};})),
    ))});
    const kind=m.kind({config:z.undefined(),components:[],initialize:defineEffect<rules.EntityLifecycle,void>(b=>install({ability:direct,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.entity),environment:{},lifetime:0}))});
    const anchor=defineEntity(kind,undefined,{components:[done]});
    const entry=defineEffect<z.infer<typeof programSchemas.setup>,Frame>(b=>{const result=b.local<Frame>();return sequence(spawnEntity({definition:anchor,owner:null,scope:0}),b.assign(result,call(combatContentRules.exports.entry,{seed:b.read(v=>v.input.seed),encounter:encounterId.WRITHING_MASS,relics:[...owned],potion:null,durable:true,elite:false,spentOmamori:spent})),b.return(result));});return{exports:{entry}};
  }});
  return linkRules<{},z.infer<typeof programSchemas.setup>,Ports,Frame>({id:'sts/implant-relic-case',schemas:programSchemas,initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
}
