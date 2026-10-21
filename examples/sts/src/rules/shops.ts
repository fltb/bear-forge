import {z} from 'zod';
import {rules} from './execution.ts';
import {adventures} from './adventures.ts';
import {entityId} from './resources.schemas.ts';
import {previewSchema,relicDefinitionSchema} from './adventures.schemas.ts';
import {shopSetupSchema,shopStateSchema,shopPurchaseSchema,type ShopSetup} from './shops.schemas.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,query,call}=rules;
/** Shop inventory owns offers/prices; payments and gains remain separate resource/deck operations. */
export const shops=defineRules({requires:[adventures],build(m){
  const state=m.own(defineComponent({schema:shopStateSchema.nullable(),initial:()=>null}));
  const spent=m.own(rules.defineEvent({payload:z.object({run:entityId,amount:z.int32()}),dispatch:'immediate'}));
  const current=defineQuery({input:entityId,output:shopStateSchema,reads:[state],base:(r,shop)=>{const s=r.component(shop,state);if(s===null)throw Error('Uninitialized shop');return s;}});
  const forRun=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,run)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.run===run);if(ids.length>1)throw Error('Duplicate open shop');return ids[0]??null;}});
  const validate=defineQuery({input:shopSetupSchema,output:shopSetupSchema,dependencies:[adventures.exports.bindings,forRun],base:(r,i)=>{r.query(adventures.exports.bindings,i.run);if(r.query(forRun,i.run)!==null)throw Error('Shop is already open');return i;}});
  const begin=m.atom({input:shopSetupSchema.extend({entity:entityId}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){const {entity,...value}=i;return{writes:[{entity,component:state,value:{...value,pending:null}}],events:[],result:undefined};}});
  const kind=m.kind({config:z.undefined(),setup:shopSetupSchema,components:[state],initialize:defineEffect<rules.EntityLifecycle<ShopSetup>,void>(b=>call(begin,b.read(v=>({...v.query(validate,v.input.setup),entity:v.input.entity}))))});
  function change<I extends {shop:number}>(input:rules.Schema<I>,apply:(s:rules.Borrowed<z.infer<typeof shopStateSchema>>,i:rules.Borrowed<I>)=>rules.Borrowed<z.infer<typeof shopStateSchema>>){return m.atom({input,output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.shop,state);if(s===null)throw Error('Missing shop');return{writes:[{entity:i.shop,component:state,value:apply(s,i)}],events:[],result:undefined};}});}
  const setCard=change(z.object({shop:entityId,index:z.int32().min(0).max(6),card:previewSchema,price:z.int32()}),(s,i)=>({...s,cards:s.cards.map((c,j)=>j===i.index?i.card:c),prices:s.prices.map((p,j)=>j===i.index?i.price:p)}));
  const setRelic=change(z.object({shop:entityId,index:z.int32().min(0).max(2),relic:relicDefinitionSchema,price:z.int32()}),(s,i)=>({...s,relics:s.relics.map((r,j)=>j===i.index?i.relic:r),prices:s.prices.map((p,j)=>j===7+i.index?i.price:p)}));
  const setPotion=change(z.object({shop:entityId,index:z.int32().min(0).max(2),potion:z.int32(),price:z.int32()}),(s,i)=>({...s,potions:s.potions.map((p,j)=>j===i.index?i.potion:p),prices:s.prices.map((p,j)=>j===10+i.index?i.price:p)}));
  const setPrices=change(z.object({shop:entityId,prices:z.array(z.int32()).length(13),removeCost:z.int32()}),(s,i)=>({...s,prices:i.prices,removeCost:i.removeCost}));
  const setCards=change(z.object({shop:entityId,cards:z.array(previewSchema).length(7)}),(s,i)=>({...s,cards:i.cards}));
  const pending=change(z.object({shop:entityId,purchase:shopPurchaseSchema.nullable()}),(s,i)=>({...s,pending:i.purchase}));
  const announceSpent=m.atom({input:z.object({run:entityId,amount:z.int32()}),output:z.undefined(),reads:[],writes:[],emits:[spent],run(_r,payload){return{writes:[],events:[{event:spent,payload}],result:undefined};}});
  return{exports:{kind,current,forRun,setCard,setRelic,setPotion,setPrices,setCards,pending,announceSpent,spent:spent.public}};
}});
