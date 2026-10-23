import {z} from 'zod';
import {typedValue} from '../../../rules/value.schemas.ts';
import {rules} from '../../../rules/execution.ts';
import {adventures} from '../../../rules/adventures.ts';
import {relics} from '../../../rules/relics.ts';
import {nodeAt} from '../../../map.ts';
import {registerRelicAbilities} from '../hooks.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,modify,call,query,when,sequence,updateLocalComponent}=rules;
/** Map choices remain ordinary adventure choices; a flight only changes their legal domain. */
export const mapRelics=defineRules({requires:[adventures,relics],build(){
  function limitedFlight(charges:number){
  const flights=defineComponent({schema:z.int32(),initial:()=>charges});
  const data=modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[flights],transform:(r,c)=>r.component(c.source,flights)});
  const WingBoots=defineEntity(relics.exports.kind,{id:'WING_BOOTS',install:registerRelicAbilities(data),interact:defineEffect<{entity:number;actor:number},void>(b=>updateLocalComponent(b.read(v=>v.input.entity),flights,n=>n>1?n-1:-2))},{components:[flights]});
  const boots=defineQuery({input:z.number(),output:z.number().nullable(),dependencies:[adventures.exports.bindings,relics.exports.find],base:(r,run)=>r.query(relics.exports.find,{actor:r.query(adventures.exports.bindings,run).actor,definition:WingBoots})});
  const connected=defineQuery({input:z.number(),output:z.array(z.number()),dependencies:[adventures.exports.location],base:(r,run)=>{const s=r.query(adventures.exports.location,run);if(s.y===14)return[0];if(s.y===-1)return s.map.nodes.filter(n=>n.y===0&&n.edges.length>0).map(n=>n.x);return [...nodeAt(s.map,s.x,s.y).edges];}});
  const nextLayer={
    query:defineQuery({input:z.number(),output:z.array(z.number()),dependencies:[adventures.exports.location],base:(r,run)=>{const s=r.query(adventures.exports.location,run);return s.map.nodes.filter(n=>n.y===s.y+1&&n.room!=='NONE'&&n.room!=='INVALID').map(n=>n.x);}}),
    text:'下一层任意有效节点',
  };
  const options=defineQuery({input:z.number(),output:z.array(z.number()),dependencies:[adventures.exports.location,boots,relics.exports.data,connected,nextLayer.query],base:(r,run)=>{const s=r.query(adventures.exports.location,run),entity=r.query(boots,run);if(s.y<0||s.y>=14||entity===null||r.query(relics.exports.data,entity)<=0)return r.query(connected,run);return r.query(nextLayer.query,run);}});
  const move=defineEffect<{run:number;x:number},void>(b=>sequence(
    when(b.read(v=>!v.query(options,v.input.run).includes(v.input.x)),b.return(b.read(()=>{throw Error('Illegal map destination');}))),
    when(b.read(v=>!v.query(connected,v.input.run).includes(v.input.x)),call(relics.exports.interact,b.read(v=>{const entity=v.query(boots,v.input.run);if(entity===null)throw Error('Flight requires Wing Boots');return entity;}))),
  ));
  return{WingBoots,options,move,text:`可以移动到${nextLayer.text}，包括未连线节点，共${charges}次；沿连线移动不消耗次数。起点与Boss入口仍遵循原连线。`};
  }
  const flight=limitedFlight(3);
  return{exports:{WingBoots:flight.WingBoots,options:flight.options,move:flight.move,texts:Object.freeze({WING_BOOTS:flight.text})}};
}});
