import {rules} from '@bear-forge/card-engine';
import {random} from "../../../rules/random.ts";
import type {NeowOption} from "../../../neow.types.ts";
const {defineRules,defineEffect,sequence,call}=rules;
const choices=[[11,12,13,14,15,16],[11,12,13,14,16,17],[11,13,14,15,16,17]] as const;
export const neowOffers=defineRules({requires:[random],build(){
  const generate=defineEffect<number,NeowOption[]>(b=>{const first=b.local<number>(),second=b.local<number>(),drawback=b.local<number>(),bonus=b.local<number>();return sequence(
    b.assign(first,call(random.exports.int,{stream:b.input,start:0,end:5})),b.assign(second,call(random.exports.int,{stream:b.input,start:0,end:4})),b.assign(drawback,call(random.exports.int,{stream:b.input,start:0,end:3})),
    b.assign(bonus,call(random.exports.int,{stream:b.input,start:0,end:b.read(v=>v.get(drawback)===3?6:5)})),call(random.exports.int,{stream:b.input,start:0,end:0}),
    b.return(b.read(v=>[{bonus:v.get(first),drawback:1},{bonus:6+v.get(second),drawback:1},{bonus:v.get(drawback)===3?11+v.get(bonus):choices[v.get(drawback)]![v.get(bonus)]!,drawback:2+v.get(drawback)},{bonus:18,drawback:6}])),
  );});
  return{exports:{generate}};
}});
