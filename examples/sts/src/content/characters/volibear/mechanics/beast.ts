import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import type {CardSetup} from '../../../../rules/card-instances.types.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose} from '../cards/programs.ts';
import {volibearCardDescriptions} from '../cards/metadata.ts';
export type BeastChange={battle:number;owner:number;card:number;shape:1|2};
export const volibearBeast=rules.defineRules({requires:[battles,cardInstances,cardPiles,volibearCardPrograms],build(m){
  const schema=z.object({battle:z.int32(),owner:z.int32(),card:z.int32(),proxy:z.int32(),shape:z.union([z.literal(1),z.literal(2)])});
  const state=m.own(rules.defineComponent({schema:schema.nullable(),initial:()=>null}));
  const writeState=m.atom({input:z.object({entity:z.int32(),value:schema}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const changed=m.own(rules.defineEvent({payload:schema.omit({proxy:true}),dispatch:'immediate'}));
  const shape=rules.defineQuery({input:z.int32(),output:z.int32(),reads:[state],dependencies:[cardInstances.exports.matchesDefinition],base:(r,card)=>{
    const entry=r.entities(state).map(id=>r.component(id,state)).find(s=>s?.card===card);
    if(entry)return entry.shape;
    if(r.query(cardInstances.exports.matchesDefinition,{entity:card,definition:Claw}))return 1;
    return r.query(cardInstances.exports.matchesDefinition,{entity:card,definition:Body})?2:0;
  }});
  const redirect=rules.modify(cardInstances.exports.behaviorEntity,{condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),reads:[state],base:(r,c)=>r.component(c.source,state)?.card===c.input}),reads:[state],transform:(r,c)=>r.component(c.source,state)!.proxy});
  const kind=m.kind({config:z.undefined(),setup:schema,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof schema>>,void>(b=>rules.sequence(
    rules.call(writeState,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),
    rules.install({ability:redirect,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.owner),environment:{},lifetime:b.read(v=>v.input.scope)}),
  ))});
  const form=rules.defineEntity(kind,undefined);
  const Claw=card(volibearCardDescriptions.T01,attack([7,11],2));
  const Body=card(volibearCardDescriptions.T02,compose(block([9,12]),thunder([2,3])));
  const announce=m.atom({input:schema.omit({proxy:true}),output:z.undefined(),reads:[],writes:[],emits:[changed],run(_r,payload){return{writes:[],events:[{event:changed,payload}],result:undefined};}});
  const convert=rules.defineEffect<{battle:number;card:number},number>(b=>{const next=b.local<1|2>(),proxy=b.local<number>(),setup=b.local<CardSetup>();return rules.sequence(
    rules.when(b.read(v=>v.query(shape,v.input.card)!==0),b.return(rules.query(shape,b.read(v=>v.input.card)))),
    b.assign(next,b.read(v=>v.query(cardInstances.exports.metadata,v.input.card).type===0?1 as const:2 as const)),
    b.assign(setup,b.read(v=>({mode:1 as const,master:null,uniqueId:-1,specialData:0,upgraded:v.query(cardInstances.exports.current,v.input.card).upgraded}))),
    rules.when(b.read(v=>v.get(next)===1),b.assign(proxy,rules.spawnEntity({definition:Claw,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup})),b.assign(proxy,rules.spawnEntity({definition:Body,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup}))),
    rules.call(cardInstances.exports.setMutable,{entity:b.read(v=>v.input.card),value:b.read(v=>{const old=v.query(cardInstances.exports.current,v.input.card);return{specialData:old.specialData,upgraded:old.upgraded,freeToPlayOnce:old.freeToPlayOnce,retain:old.retain,cost:1,costForTurn:Math.max(0,1-Math.max(0,old.cost-old.costForTurn))};})}),
    rules.call(cardInstances.exports.suppressEffects,{entity:b.read(v=>v.input.card),suppressed:true}),
    rules.spawnEntity({definition:form,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:b.read(v=>({battle:v.input.battle,owner:v.query(battles.exports.status,v.input.battle).actor,card:v.input.card,proxy:v.get(proxy),shape:v.get(next)}))}),
    rules.call(announce,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),card:b.read(v=>v.input.card),shape:next}),
    b.return(next),
  );});
  return{exports:{shape,convert,changed:changed.public,Claw,Body,text:'兽化沿用原牌实体、升级、临时减费和保留；攻击变爪形，其余变躯形。已有兽形保持。打出形态后消耗，永久牌组不变。'}};
}});
