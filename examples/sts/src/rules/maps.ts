import {z} from 'zod';
import {rules} from './execution.ts';
import {beginMapConstruction,advanceMapConstruction,mapDraw,mapRandomState,drawMapRandom} from '../map.ts';
import type {MapConstruction,MapDraw,SpireMap} from '../map.types.ts';
import type {RandomState} from '../rng.ts';
import {typedValue} from './value.schemas.ts';
import {withProbability} from '../../../../packages/card-engine/src/rules-probability.ts';

type Work={construction:MapConstruction;random:RandomState};
type DrawInput={random:RandomState;request:MapDraw};
type DrawResult={random:RandomState;value:number};

/** Original construction data lives in the current Card frame. Only its
 * random draw atom differs between real and probability execution. */
export const maps=rules.defineRules({requires:[],build(m){
  const input=z.object({seed:z.bigint(),ascension:z.int32(),act:z.int32(),burning:z.boolean()});
  const proposal=<T>(result:T)=>({writes:[],events:[],result});
  const begin=m.atom({input,output:typedValue<Work>(),reads:[],writes:[],emits:[],run:(_r,i)=>proposal({
    construction:beginMapConstruction(i.ascension,i.act,i.burning),random:mapRandomState(i.seed,i.act),
  })});
  const draw=withProbability(m.atom({input:typedValue<DrawInput>(),output:typedValue<DrawResult>(),reads:[],writes:[],emits:[],run(_r,i){
    const random={...i.random},value=drawMapRandom(random,i.request);return proposal({random,value});
  }}),{
    space:i=>({kind:'uniform',size:BigInt(i.request.end-i.request.start+1)}),
    run:(_r,i,coordinate)=>proposal({random:{...i.random,counter:i.random.counter+Number(i.request.counted)},value:i.request.start+Number(coordinate)}),
  });
  const advance=m.atom({input:typedValue<{construction:MapConstruction;draw:DrawResult}>(),output:typedValue<Work>(),reads:[],writes:[],emits:[],run:(_r,i)=>proposal({
    construction:advanceMapConstruction(i.construction,i.draw.value),random:{...i.draw.random},
  })});
  const generate=rules.defineEffect<z.infer<typeof input>,SpireMap>(b=>{
    const work=b.local<Work>(),selected=b.local<DrawResult>();
    return rules.sequence(
      b.assign(work,rules.call(begin,b.input)),
      rules.whileDo(b.read(v=>v.get(work).construction.phase!=='done'),rules.sequence(
        b.assign(selected,rules.call(draw,b.read(v=>({random:v.get(work).random,request:mapDraw(v.get(work).construction)!})))),
        b.assign(work,rules.call(advance,{construction:b.read(v=>v.get(work).construction),draw:selected})),
      )),
      b.return(b.read(v=>v.get(work).construction.map)),
    );
  });
  return{exports:{generate}};
}});
