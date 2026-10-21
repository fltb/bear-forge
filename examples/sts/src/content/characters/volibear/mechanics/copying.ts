import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import type {CardState} from '../../../../rules/card-instances.types.ts';

export type CombatCopy={battle:number;source:number;copy:number};
/** Content extensions copy their permanent battle growth through this event.
 * It runs while the copy is detached, before entering-hand responses inspect it.
 */
export const volibearCopying=rules.defineRules({requires:[battles,cardInstances,cardPiles],build(m){
  const copied=m.own(rules.defineEvent({payload:z.object({battle:z.int32(),source:z.int32(),copy:z.int32()}),dispatch:'immediate'}));
  const transfer=m.atom({input:z.object({battle:z.int32(),source:z.int32(),copy:z.int32()}),output:z.undefined(),reads:[],writes:[],emits:[copied],run(_r,payload){
    return {writes:[],events:[{event:copied,payload}],result:undefined};
  }});
  const copyToHand=rules.defineEffect<{battle:number;source:number},number>(b=>{
    const piles=b.local<number>(),identity=b.local<number>(),source=b.local<CardState>(),copy=b.local<number>();
    return rules.sequence(
      b.assign(piles,b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles)),
      b.assign(source,rules.query(cardInstances.exports.current,b.read(v=>v.input.source))),
      b.assign(identity,rules.call(cardPiles.exports.allocateIdentity,piles)),
      b.assign(copy,rules.spawnEntity({
        kind:cardInstances.exports.kind,definition:rules.definitionOf(cardInstances.exports.kind,b.read(v=>v.input.source)),
        owner:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actor),
        scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
        setup:{mode:1,master:null,uniqueId:identity,specialData:b.read(v=>v.get(source).specialData),upgraded:b.read(v=>v.get(source).upgraded)},
      })),
      rules.call(cardInstances.exports.setMutable,{entity:copy,value:b.read(v=>{
        const s=v.get(source);
        return {specialData:s.specialData,cost:s.cost,costForTurn:s.cost,upgraded:s.upgraded,freeToPlayOnce:false,retain:false};
      })}),
      rules.call(cardPiles.exports.register,{piles,card:copy}),
      rules.call(transfer,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.source),copy}),
      rules.call(cardPiles.exports.moveToHand,{piles,card:copy}),
      b.return(copy),
    );
  });
  return {exports:{copyToHand,copied:copied.public}};
}});
