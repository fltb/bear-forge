import type {rules} from '@bear-forge/card-engine';
import type {CardConfig,CardSetup} from './card-instances.types.ts';
export type PermanentCardDefinition=rules.EntityDefinition<CardConfig,CardSetup>;
export type PermanentDeckSetup={actor:number};
export type PermanentDeckState=PermanentDeckSetup&{scope:number;cards:number[];bottles:[number,number,number];counts:[number,number,number,number];upgradeable:number;transformable:number;nextBatch:number;pending:{id:number;remaining:number}[]};
export type DeckObtain={deck:number;definition:PermanentCardDefinition;upgraded:boolean;specialData:number;count:number;upgrade:boolean};
export type DeckBatch={deck:number;actor:number;batch:number;card:number;count:number};
export type DeckCard={deck:number;actor:number;card:number;index:number};
