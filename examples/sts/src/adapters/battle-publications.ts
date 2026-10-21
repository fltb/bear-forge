import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {PublicGameSchema,GameViewSchema} from "../game.schemas.ts";
import {battles} from "../rules/battles.ts";
import {adventures} from "../rules/adventures.ts";
const captureSchema=z.object({run:z.number(),battle:z.number(),game:GameViewSchema}).strict();
type Capture=z.infer<typeof captureSchema>;
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,call,query}=rules;
/** Immutable publication history only. No rule effect may use this as resource or inventory state. */
export const battlePublications=defineRules({requires:[battles,adventures],build(m){
  const state=m.own(defineComponent({schema:captureSchema.nullable(),initial:()=>null}));
  const forRun=defineQuery({input:z.number(),output:PublicGameSchema.nullable(),reads:[state],base:(r,run)=>{const records=r.entities(state).map(id=>r.component(id,state)).filter((s):s is Capture=>s!==null&&s.run===run);if(records.length>1)throw Error('Duplicate current battle publication');if(!records[0])return null;const game=records[0].game,{burningEliteBuff,...map}=game.map;const selection=game.select;if(selection){const {transformRng,...select}=selection;return PublicGameSchema.strip().parse({...game,map,select});}return PublicGameSchema.strip().parse({...game,map});}});
  const privateForRun=defineQuery({input:z.number(),output:GameViewSchema.nullable(),reads:[state],base:(r,run)=>{const records=r.entities(state).map(id=>r.component(id,state)).filter((s):s is Capture=>s!==null&&s.run===run);if(records.length>1)throw Error('Duplicate current battle publication');return records[0]?.game??null;}});
  const commit=m.atom({input:captureSchema.extend({entity:z.number()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){if(r.component(i.entity,state)!==null)throw Error('Battle entry publication is immutable');const {entity,...value}=i;return{writes:[{entity,component:state,value}],events:[],result:undefined};}});
  const validate=defineQuery({input:captureSchema,output:captureSchema,dependencies:[battles.exports.current,adventures.exports.current,forRun],base:(r,i)=>{const board=r.query(battles.exports.current,i.battle);if(board.started||board.actor!==r.query(adventures.exports.current,i.run).actor||r.query(forRun,i.run)!==null)throw Error('Invalid battle entry publication');return i;}});
  const kind=m.kind({config:z.undefined(),setup:captureSchema,components:[state],initialize:defineEffect<rules.EntityLifecycle<Capture>,void>(b=>call(commit,b.read(v=>({...v.get(query(validate,v.input.setup)),entity:v.input.entity}))))});
  const definition=defineEntity(kind,undefined);
  const capture=defineEffect<Capture,void>(b=>rules.spawnEntity({definition,owner:b.read(v=>v.input.run),scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),setup:b.input}));
  return{exports:{capture,forRun,privateForRun}};
}});
