import {PS} from "../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardPiles} from "../../rules/card-piles.ts";
import {cardInstances} from "../../rules/card-instances.ts";
import {powers} from "../../rules/powers.ts";
import {turns} from "../../rules/turns.ts";
import {ownsTurn} from "./turn-hooks.ts";
import {random} from "../../rules/random.ts";
import type {PileCard} from "../../rules/card-piles.types.ts";
import {counterPolicies,attachAbilities} from "./utils.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,modify,on,sequence,call,query,when,enqueue}=rules;

export const drawPowers=defineRules({requires:[cardPiles,powers,turns],build(){
  const ownsPile=defineQuery({input:z.custom<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[cardPiles.exports.current,powers.exports.enabled],base:(r,c)=>r.query(cardPiles.exports.current,c.input).actor===c.owner&&r.query(powers.exports.enabled,c.source)});
  const ownsCard=defineQuery({input:z.custom<rules.ReactionContext<PileCard>>(),output:z.boolean(),dependencies:[cardPiles.exports.current,powers.exports.enabled],base:(r,c)=>r.query(cardPiles.exports.current,c.event.piles).actor===c.owner&&r.query(powers.exports.enabled,c.source)});
  const NoDraw=defineEntity(powers.exports.kind,{presentation:{key:PS.NO_DRAW,flag:false},...counterPolicies({bits:16,harmful:true,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(modify(cardPiles.exports.canDraw,{condition:ownsPile,transform:()=>false}),on(turns.exports.playerEndPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:16},effect:defineEffect(b=>call(powers.exports.remove,b.read(v=>v.input.source)))}))});
  const confused=on(cardPiles.exports.drawing,{condition:ownsCard,order:{phase:cardPiles.exports.stages.power,priority:0},effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>{
    const cost=b.local<number>();return sequence(
      when(b.read(v=>v.get(query(cardInstances.exports.current,v.input.event.card)).cost<0),b.return(undefined)),
      b.assign(cost,call(random.exports.int,{stream:b.read(v=>v.get(query(cardPiles.exports.current,v.input.event.piles)).cardRng),start:0,end:3})),
      when(b.read(v=>v.get(query(cardInstances.exports.current,v.input.event.card)).cost!==v.get(cost)),sequence(
        call(cardInstances.exports.setCostForCombat,{entity:b.read(v=>v.input.event.card),amount:cost}),call(cardInstances.exports.overrideTurnCost,{entity:b.read(v=>v.input.event.card),amount:cost}),
      )),call(cardInstances.exports.setFlags,{entity:b.read(v=>v.input.event.card),freeToPlayOnce:false,retain:b.read(v=>v.get(query(cardInstances.exports.current,v.input.event.card)).retain)}),
    );
  })});
  const Confused=defineEntity(powers.exports.kind,{presentation:{key:PS.CONFUSED,flag:true},...counterPolicies({bits:16,flag:true,harmful:true,zeroIsNoop:true}),attach:attachAbilities(confused)});
  return{exports:{NoDraw,
    Confused}};
}});
