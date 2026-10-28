import assert from 'node:assert/strict';
import type {CardStop} from '@bear-forge/card-engine';
import type {PortShape} from '@bear-forge/contracts/core';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {addMass,unitMass,zeroMass} from '@bear-forge/card-engine/probability-mass';

/** Verify the complete law while releasing each inspected Context. Keeping
 * hundreds of completed worlds alive is unnecessary when a test only needs
 * their public results. The unvisited law stays in the original frontier. */
export function visitAll<S,Setup,P extends {[K in keyof P]:PortShape},R>(
  current:ProbabilityCurrent<S,Setup,P,R>,reply:unknown,
  visit:(row:NonNullable<ReturnType<ProbabilityExpansion<S,Setup,P,R,null>['take']>>)=>void,
  options:{stopAtBoundary?:string;continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:null)=>{reply:unknown;data:null}|undefined}={},
){
  const expansion=ProbabilityExpansion.from(current,reply,null,options);let mass=zeroMass(),count=0;
  try{
    for(;;){
      const row=expansion.take();
      if(row){try{visit(row);mass=addMass(mass,row.mass);count++;}finally{row.current.close();}continue;}
      if(expansion.complete)break;
      expansion.step();const state=expansion.masses();
      assert.deepEqual(addMass(addMass(state.pending,state.ready),state.transferred),unitMass());
    }
    assert.deepEqual(mass,unitMass());return count;
  }finally{expansion.close();}
}

/** Exhaust only the finite fixture law requested by a test. This drives the
 * production exact frontier; it has no sampling, population limit or fallback.
 * Large-law tests inspect and save ProbabilityExpansion directly instead. */
export function expandAll<S,Setup,P extends {[K in keyof P]:PortShape},R>(
  current:ProbabilityCurrent<S,Setup,P,R>,reply:unknown,
  options:{stopAtBoundary?:string;continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:null)=>{reply:unknown;data:null}|undefined}={},
){
  const expansion=ProbabilityExpansion.from(current,reply,null,options);
  const outcomes:NonNullable<ReturnType<typeof expansion.take>>[]=[];
  try{
    while(!expansion.complete){
      expansion.step();const mass=expansion.masses();
      assert.deepEqual(addMass(addMass(mass.pending,mass.ready),mass.transferred),unitMass());
      for(let row=expansion.take();row;row=expansion.take())outcomes.push(row);
    }
    for(let row=expansion.take();row;row=expansion.take())outcomes.push(row);
    assert.deepEqual(outcomes.reduce((sum,row)=>addMass(sum,row.mass),zeroMass()),unitMass());
    return{outcomes};
  }catch(error){for(const row of outcomes)row.current.close();throw error;}
  finally{expansion.close();}
}
