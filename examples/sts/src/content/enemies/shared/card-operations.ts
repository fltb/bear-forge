import {rules} from '../../../rules/execution.ts';
import {combatOperations,defineOperation,OperationKind} from '../../../rules/combat-operations.ts';
import {zones} from '../../../rules/zones.ts';
import {cardPiles} from '../../../rules/card-piles.ts';
import {permanentDecks} from '../../../rules/permanent-decks.ts';
import type {CardConfig,CardSetup,CardMutable} from '../../../rules/card-instances.types.ts';
import type {DeckObtain} from '../../../rules/permanent-decks.types.ts';

export const enemyCardOperations=rules.defineRules({requires:[combatOperations,zones,cardPiles,permanentDecks],build(){
  const storage=rules.defineEntity(zones.exports.kind,{capacity:1});
  const store=defineOperation<{owner:number;scope:number;piles:number;card:number},number|null>(OperationKind.StoreCard,null,b=>{const zone=b.local<number>();return rules.sequence(
    b.assign(zone,rules.spawnEntity({definition:storage,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.input.scope)})),
    rules.call(cardPiles.exports.attachZone,{piles:b.read(v=>v.input.piles),zone}),
    rules.call(zones.exports.move,{entity:b.read(v=>v.input.card),from:rules.query(zones.exports.location,b.read(v=>v.input.card)),to:zone,index:0}),
    rules.call(cardPiles.exports.unregister,{piles:b.read(v=>v.input.piles),card:b.read(v=>v.input.card)}),b.return(zone),
  );});
  const release=defineOperation<{piles:number;zone:number},number|null>(OperationKind.Settlement,null,b=>{const card=b.local<number>();return rules.sequence(
    rules.when(b.read(v=>v.query(zones.exports.members,v.input.zone).length===0),b.return(null)),
    b.assign(card,b.read(v=>v.query(zones.exports.members,v.input.zone)[0]!)),
    rules.call(zones.exports.move,{entity:card,from:b.read(v=>v.input.zone),to:null,index:0}),
    rules.call(cardPiles.exports.register,{piles:b.read(v=>v.input.piles),card}),
    rules.call(cardPiles.exports.moveToHand,{piles:b.read(v=>v.input.piles),card}),b.return(card),
  );});
  const obtain=defineOperation<DeckObtain,number[]>(OperationKind.ObtainCard,[],b=>{const cards=b.local<number[]>();return rules.sequence(b.assign(cards,rules.call(permanentDecks.exports.obtain,b.input)),b.return(cards));});
  const create=defineOperation<{piles:number;definition:rules.EntityDefinition<CardConfig,CardSetup>;upgraded:boolean;specialData:number;destination:0|1|2|3;shuffle:boolean;mutable:CardMutable|null},number|null>(OperationKind.CreateCard,null,b=>{const card=b.local<number>();return rules.sequence(b.assign(card,rules.call(cardPiles.exports.create,b.input)),b.return(card));});
  return{exports:{store,release,obtain,create}};
}});
