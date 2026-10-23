import {CardMachine,CardProgram} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {cardDefinition} from '../src/card.ts';
import type {Frame} from '../src/game.schemas.ts';
const program=new CardProgram(cardDefinition);
/** Drives the real production entry; observations remain the actual decision payload. */
export function productionDriver(seed:string,character:'ironclad'|'volibear'='ironclad',detailedEvents=false){
  const root=program.initial({seed,character,detailedEvents},100_000_000),storage=privateCardGraph(root),machine=new CardMachine(program,storage);
  let stop=machine.advance();
  function frame():Frame{
    while(stop.kind==='call'&&stop.call.port==='event'){stop=machine.advance(null);}
    if(stop.kind==='done')return stop.result;
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));return stop.call.input;
  }
  return{machine,frame,advance(bits:number){frame();stop=machine.advance({bits});return frame();},close(){storage.close?.();}};
}
