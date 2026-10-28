import {stormCharge} from './storm-charge.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {volibearTraining} from './training.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {entityId} from '../../../../rules/resources.schemas.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

export type CountedAttack={use:CardUse;ordinal:number;targetOrdinal:number};
const setup=z.object({battle:entityId,owner:entityId});
const stateSchema=setup.extend({turn:z.int32(),lastPlay:z.int32().nullable(),previousAttack:z.boolean(),snapshot:z.object({play:z.int32(),attacks:z.number(),previousAttack:z.boolean(),lightning:z.number()}).nullable(),lastTarget:entityId.nullable(),attacks:z.number().int().nonnegative(),fixed:z.number().int().nonnegative(),targets:z.array(z.object({actor:entityId,count:z.number().int().nonnegative()}))});

/** Counts actual card plays, independently of effect repetitions and hit count.
 * This ordinary battle-scoped content entity is saved/forked in the same Context.
 */
export const volibearPlayCounts=rules.defineRules({requires:[stormCharge,battles,cardInstances,volibearTraining],build(m){
  const state=m.own(rules.defineComponent({schema:stateSchema.nullable(),initial:()=>null}));
  const counted=m.own(rules.defineEvent({payload:z.object({use:cardUseSchema,ordinal:z.number().int().positive(),targetOrdinal:z.number().int().nonnegative()}),dispatch:'immediate'}));
  describeProgram(counted.public,'实际攻击牌计数后');
  const find=rules.defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,battle)=>{
    const ids=r.entities(state).filter(id=>r.component(id,state)?.battle===battle);
    if(ids.length>1)throw Error('Duplicate Volibear battle counter');return ids[0]??null;
  }});
  const count=rules.defineQuery({input:z.object({battle:entityId,turn:z.int32(),target:entityId.nullable()}),output:z.number().int().nonnegative(),reads:[state],dependencies:[find],base:(r,i)=>{
    const id=r.query(find,i.battle),s=id===null?null:r.component(id,state);
    if(!s||s.turn!==i.turn)return 0;return i.target===null?s.attacks:s.targets.find(t=>t.actor===i.target)?.count??0;
  }});
  const beforeTarget=rules.defineQuery({input:cardUseSchema,output:z.number().int().nonnegative(),reads:[state],dependencies:[find,battles.exports.current],base:(r,use)=>{
    if(use.target===null)return 0;const id=r.query(find,use.battle),s=id===null?null:r.component(id,state);
    if(!s||s.turn!==r.query(battles.exports.current,use.battle).turn)return 0;
    return Math.max(0,(s.targets.find(t=>t.actor===use.target)?.count??0)-Number(s.lastPlay===use.play&&s.lastTarget===use.target));
  }});
  const fixedCount=rules.defineQuery({input:z.object({battle:entityId,turn:z.int32()}),output:z.number().int().nonnegative(),reads:[state],dependencies:[find],base:(r,i)=>{
    const id=r.query(find,i.battle),s=id===null?null:r.component(id,state);return s&&s.turn===i.turn?s.fixed:0;
  }});
  const initialize=m.atom({input:setup.extend({entity:entityId}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){
    return {writes:[{entity:i.entity,component:state,value:{battle:i.battle,owner:i.owner,turn:0,lastPlay:null,previousAttack:false,snapshot:null,lastTarget:null,attacks:0,fixed:0,targets:[]}}],events:[],result:undefined};
  }});
  const record=m.atom({input:z.object({entity:entityId,use:cardUseSchema,turn:z.int32(),single:z.boolean(),fixed:z.boolean(),attack:z.boolean(),lightning:z.number()}),output:z.undefined(),reads:[state],writes:[state],emits:[counted],run(r,i){
    const before=r.component(i.entity,state);if(before===null||before.battle!==i.use.battle||before.owner!==i.use.owner)throw Error('Attack counter ownership mismatch');
    const same=before.turn===i.turn,targets=same?before.targets.map(t=>({...t})):[];
    let targetOrdinal=0;
    if(i.attack&&i.single&&i.use.target!==null){
      const row=targets.find(t=>t.actor===i.use.target);
      if(row){row.count++;targetOrdinal=row.count;}else{targets.push({actor:i.use.target,count:1});targetOrdinal=1;}
    }
    const ordinal=(same?before.attacks:0)+Number(i.attack);
    return {writes:[{entity:i.entity,component:state,value:{...before,turn:i.turn,lastPlay:i.use.play,previousAttack:i.attack,snapshot:{play:i.use.play,attacks:same?before.attacks:0,previousAttack:before.previousAttack,lightning:i.lightning},lastTarget:i.single?i.use.target:null,attacks:ordinal,fixed:(same?before.fixed:0)+Number(i.fixed),targets}}],events:i.attack?[{event:counted,payload:{use:i.use,ordinal,targetOrdinal}}]:[],result:undefined};
  }});
  const observe=rules.on(battles.exports.using,{
    order:battles.exports.stages.power,
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],dependencies:[cardInstances.exports.metadata],base:(r,c)=>{
      const s=r.component(c.source,state);
      return s!==null&&s.battle===c.event.battle&&c.event.owner===c.owner&&c.event.triggerOnUse&&!c.event.purgeOnUse;
    }}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.call(record,{
      entity:b.read(v=>v.input.source),use:b.read(v=>v.input.event),turn:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.battle)).turn),
      attack:b.read(v=>v.query(cardInstances.exports.metadata,v.input.event.card).type===0),
      lightning:b.read(v=>v.query(stormCharge.exports.current,v.input.event.battle).strikes),
      fixed:b.read(v=>v.get(rules.query(volibearTraining.exports.eligible,v.input.event.card))),
      single:b.read(v=>v.get(rules.query(cardInstances.exports.metadata,v.input.event.card)).variants[v.input.event.state.upgraded?1:0].target),
    })),
  });
  const kind=m.kind({config:z.undefined(),setup,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.sequence(
    rules.call(initialize,{entity:b.read(v=>v.input.entity),battle:b.read(v=>v.input.setup.battle),owner:b.read(v=>v.input.setup.owner)}),
    rules.install({ability:observe,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.owner),environment:{},lifetime:b.read(v=>v.input.scope)}),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const ensure=rules.defineEffect<z.infer<typeof setup>,number>(b=>{
    const existing=b.local<number|null>(),made=b.local<number>();
    return rules.sequence(b.assign(existing,rules.query(find,b.read(v=>v.input.battle))),
      rules.when(b.read(v=>v.get(existing)!==null),b.return(b.read(v=>v.get(existing)!))),
      rules.when(b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actor!==v.input.owner),b.return(b.read(()=>{throw Error('Battle counter requires the player actor');}))),
      b.assign(made,rules.spawnEntity({definition,owner:b.read(v=>v.input.owner),setup:b.input,scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)})),b.return(made),
    );
  });
  const startCounting=rules.on(battles.exports.started,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[battles.exports.current],base:(r,c)=>r.query(battles.exports.current,c.event).actor===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.call(ensure,{battle:b.read(v=>v.input.event),owner:b.read(v=>v.input.owner)})),
  });
  // Character startup mounts this independently of the starter relic. Losing
  // or exchanging that relic must not erase the character's play history.
  const trackBattles=rules.defineEffect<{actor:number;scope:number},void>(b=>rules.install({
    ability:startCounting,source:b.read(v=>v.input.actor),owner:b.read(v=>v.input.actor),environment:{},lifetime:b.read(v=>v.input.scope),
  }));
  const before=rules.defineQuery({input:cardUseSchema,output:z.object({attacks:z.number(),previousAttack:z.boolean(),lightning:z.number()}),reads:[state],dependencies:[find,battles.exports.status,stormCharge.exports.current],base:(r,use)=>{
    const id=r.query(find,use.battle),s=id===null?null:r.component(id,state);
    if(s?.snapshot?.play===use.play)return s.snapshot;
    return {attacks:s?.turn===r.query(battles.exports.status,use.battle).turn?s.attacks:0,previousAttack:s?.previousAttack??false,lightning:r.query(stormCharge.exports.current,use.battle).strikes};
  }});
  const text='仅记录自身实际打出的非清除攻击牌；每次打出计一次，效果重复和攻击段数不额外计数。指定单体目标计数按牌面目标声明，固定攻击资格由执行构造器声明。';
  describeProgram(trackBattles,text);
  return {exports:{before,ensure,count,beforeTarget,fixedCount,counted:counted.public,startCounting,trackBattles,text}};
}});
