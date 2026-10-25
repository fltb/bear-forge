import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {CycleSearch,type CycleState} from '../src/search/cycles.ts';
import {addMass,probabilityMass,unitMass,zeroMass} from '../../card-engine/src/probability-mass.ts';

const to=(belief:number)=>[{belief,mass:unitMass()}];
const graph:CycleState[]=[{belief:0,actions:[{key:'around',outcomes:to(1)},{key:'exit',outcomes:to(2)}]},
  {belief:1,actions:[{key:'back',outcomes:to(0)},{key:'exit',outcomes:to(3)}]}];

for(const cold of [false,true])test(`cycle policy enumeration preserves exact exit laws and moments with ${cold?'cold':'live'} elimination`,()=>{
  let search=new CycleSearch(graph),steps=0;
  while(search.step()){
    assert.ok(++steps<200);
    if(cold){const saved=deserialize(serialize(search.save()));search=CycleSearch.restore(graph,saved);assert.deepEqual(search.save(),saved);}
  }
  assert.equal(search.total,4n);assert.equal(search.evaluated,4);assert.equal(search.complete,true);
  const kernels=search.kernels();
  assert.deepEqual(kernels[0],{actions:['around','back'],exits:[[{belief:null,mass:unitMass(),steps:zeroMass()}],[{belief:null,mass:unitMass(),steps:zeroMass()}]]});
  assert.deepEqual(kernels[1],{actions:['exit','back'],exits:[[{belief:2,mass:unitMass(),steps:unitMass()}],[{belief:2,mass:unitMass(),steps:probabilityMass(2n)}]]});
  assert.deepEqual(kernels[2],{actions:['around','exit'],exits:[[{belief:3,mass:unitMass(),steps:probabilityMass(2n)}],[{belief:3,mass:unitMass(),steps:unitMass()}]]});
  assert.deepEqual(kernels[3],{actions:['exit','exit'],exits:[[{belief:2,mass:unitMass(),steps:unitMass()}],[{belief:3,mass:unitMass(),steps:unitMass()}]]});
});

test('a two-state stochastic cycle sums all repeat counts without a numerical cutoff',()=>{
  const denominator=1n<<80n,exit=probabilityMass(1n,denominator);
  const source:CycleState[]=[{belief:10,actions:[{key:'go',outcomes:to(20)}]},
    {belief:20,actions:[{key:'roll',outcomes:[{belief:10,mass:probabilityMass(denominator-1n,denominator)},{belief:30,mass:exit}]}]}];
  let search=new CycleSearch(source),steps=0;
  while(search.step()){assert.ok(++steps<100);search=CycleSearch.restore(source,deserialize(serialize(search.save())));}
  assert.deepEqual(search.kernels()[0]!.exits,[[{belief:30,mass:unitMass(),steps:probabilityMass(2n*denominator)}],
    [{belief:30,mass:unitMass(),steps:probabilityMass(2n*denominator-1n)}]]);
});

test('probability entering a closed recurrent class remains an explicit nontermination outcome',()=>{
  const half=probabilityMass(1n,2n),source:CycleState[]=[{belief:0,actions:[{key:'split',outcomes:[{belief:1,mass:half},{belief:2,mass:half}]}]},
    {belief:1,actions:[{key:'stay',outcomes:to(1)}]}];
  const search=new CycleSearch(source);while(search.step()){}
  const rows=search.kernels()[0]!.exits;
  assert.deepEqual(rows[0]!.find(row=>row.belief===2),{belief:2,mass:half,steps:half});
  assert.deepEqual(rows[0]!.find(row=>row.belief===null),{belief:null,mass:half,steps:zeroMass()});
  assert.deepEqual(rows[1],[{belief:null,mass:unitMass(),steps:zeroMass()}]);
  for(const row of rows)assert.deepEqual(row.reduce((sum,value)=>addMass(sum,value.mass),zeroMass()),unitMass());
});
