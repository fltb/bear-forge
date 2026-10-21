import { typedValue } from '../../../rules/value.schemas.ts';
import {MS} from "../../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {powers} from "../../../rules/powers.ts";
import {battles} from "../../../rules/battles.ts";
import {turns} from "../../../rules/turns.ts";
import {resources} from "../../../rules/resources.ts";
import {damage} from "../../../rules/damage.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {counterPolicies,attachAbilities} from "../../powers/utils.ts";
import {actionQueue,combatScope} from "../../../rules/combat-actions.ts";
import type {HpDamageRequest} from "../../../rules/damage.types.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,call,query,enqueue,on}=rules;
export const enemyPowers=defineRules({requires:[powers,battles,basicPowers,turns],build(){
  const curl=on(damage.exports.blocked,{condition:defineQuery({input:typedValue<rules.ReactionContext<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.request.target===c.owner&&c.event.request.attack&&c.event.facts.unblocked>0&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<HpDamageRequest>,void>(b=>sequence(
    enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:query(powers.exports.level,b.read(v=>v.input.source))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.request.battle).actionScope),eligible:'captured'}),call(powers.exports.deactivate,b.read(v=>v.input.source)),
  ))});
  const CurlUp=defineEntity(powers.exports.kind,{presentation:{key:MS.CURL_UP,flag:false,slot:0},...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(curl)});
  const deathBattle=defineQuery({input:z.number(),output:z.number(),dependencies:[powers.exports.current,battles.exports.forRegistry],base:(r,power)=>{const id=r.query(battles.exports.forRegistry,r.query(powers.exports.current,power).registry);if(id===null)throw Error('Enemy power has no battle');return id;}});
  const spore=on(resources.exports.wouldDie,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),dependencies:[powers.exports.enabled,deathBattle,battles.exports.targets],base:(r,c)=>c.event.entity===c.owner&&r.query(powers.exports.enabled,c.source)&&r.query(battles.exports.targets,r.query(deathBattle,c.source)).length>0}),effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(v=>v.query(battles.exports.status,v.query(deathBattle,v.input.source)).actor),definition:basicPowers.exports.PlayerVulnerable,amount:2,source:b.read(v=>{const controller=v.query(turns.exports.forBattle,v.query(deathBattle,v.input.source));return controller!==null&&v.query(turns.exports.current,controller).phase>=3?v.input.owner:null;}),debuff:true,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope)},{queue:actionQueue,position:'front',source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.query(deathBattle,v.input.source)).actionScope),eligible:'captured'}))});
  const SporeCloud=defineEntity(powers.exports.kind,{presentation:{key:MS.SPORE_CLOUD,flag:false,slot:0},...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(spore)});
  return{exports:{CurlUp,SporeCloud}};
}});
