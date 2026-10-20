import test from 'node:test';
import assert from 'node:assert/strict';
import {firstDifference} from './reference/compare.ts';
test('state relation rejects leaf changes, deletion, extras, order, identity, RNG and continuation corruption',()=>{
  const state={rng:{seed0:'123',seed1:'456',counter:7},cards:[{entity:3,cost:2},{entity:4,cost:1}],queue:[{source:3,remaining:2}],future:{bombs:[3,2,1],used:false},pending:{kind:'CARD_SELECT',indices:[2,5],remaining:1}};
  function paths(value:unknown,path:(string|number)[]=[]):(string|number)[][]{if(value===null||typeof value!=='object')return[path];return Object.entries(value).flatMap(([key,child])=>paths(child,[...path,Array.isArray(value)?Number(key):key]));}
  for(const path of paths(state)){
    const changed:any=structuredClone(state);let parent=changed;for(const key of path.slice(0,-1))parent=parent[key];const key=path.at(-1)!;
    parent[key]=typeof parent[key]==='number'?parent[key]+1:typeof parent[key]==='boolean'?!parent[key]:parent[key]+'x';assert.ok(firstDifference(state,changed),'mutation '+path.join('.'));
    delete parent[key];assert.ok(firstDifference(state,changed),'deletion '+path.join('.'));
  }
  assert.equal(firstDifference(state,structuredClone(state)),null);
  assert.ok(firstDifference(state,{...state,extra:1}));assert.ok(firstDifference(state,{...state,cards:[...state.cards].reverse()}));
});
