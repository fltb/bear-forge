import type { CompiledGame } from '@bear-forge/contracts';
type Narrow={setup:1;state:null;event:null;result:1;interactions:{}};
type Wide={setup:number;state:null;event:null;result:number;interactions:{}};
declare const narrow:CompiledGame<Narrow,{}>;
export const widened:CompiledGame<Wide,{}>=narrow;
