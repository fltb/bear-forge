import {z} from 'zod';
import {rules} from './execution.ts';
import {adventureStateSchema} from './adventures.schemas.ts';
import {generateMap,generateMapWithRandom} from '../map.ts';
import type {SpireMap} from '../map.types.ts';
import {withProbability} from '../../../../packages/card-engine/src/rules-probability.ts';
import {sampleUniformCoordinate} from '../../../../packages/card-engine/src/probability.ts';

/** Original map generation, with independent entropy only at its random calls.
 * No game RNG or current-map data is used to select a future map sample. */
export const maps=rules.defineRules({requires:[],build(m){
  const input=z.object({seed:z.bigint(),ascension:z.int32(),act:z.int32(),burning:z.boolean()});
  const original=(i:rules.Borrowed<z.infer<typeof input>>)=>generateMap(i.seed,i.ascension,i.act,i.burning);
  const proposal=(result:SpireMap)=>({writes:[],events:[],result});
  const generate=withProbability(m.atom({input,output:adventureStateSchema.shape.map,reads:[],writes:[],emits:[],run:(_r,i)=>proposal(original(i))}),{
    space:i=>i.act===4?{kind:'uniform',size:1n}:{kind:'sampled'},
    run:(_r,i)=>proposal(original(i)),
    sample:(i,entropy)=>generateMapWithRandom(i.ascension,i.act,i.burning,{
      int:(start,end)=>start+Number(sampleUniformCoordinate(BigInt(end-start+1),entropy)),
      index:size=>Number(sampleUniformCoordinate(BigInt(size),entropy)),
    }),
    runSample:(_r,_i,value)=>proposal(value as SpireMap),
  });
  return{exports:{generate}};
}});
