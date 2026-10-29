import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {z} from 'zod';
import {CardMachine,CardProgram,linkRules,rules} from '@bear-forge/card-engine';
import {portEffect} from '../../card-engine/src/rules-internal.ts';
import type {ReadView,Local} from '../../card-engine/src/rules.types.ts';
import {CardGraph} from '../src/graph.ts';

test('held rule read views stay bound to their call across fork, cold restore and another Context',()=>{
  const views:ReadView<number>[]=[],choose=portEffect<number,number>('choose');
  let slot:Local<number>;
  const module=rules.defineRules({requires:[],build(m){
    const component=m.own(rules.defineComponent({schema:z.number(),initial:()=>0}));
    const current=rules.defineQuery({input:z.undefined(),output:z.number(),reads:[component],base:r=>r.component(0,component)});
    const write=m.atom({input:z.number(),output:z.undefined(),reads:[],writes:[component],emits:[],run(_r,value){
      return{writes:[{entity:0,component,value}],events:[],result:undefined};
    }});
    return{exports:{current,write}};
  }});
  const entry=rules.defineEffect<number,number>(b=>{
    const total=b.local<number>(),answer=b.local<number>();slot=total;
    return rules.sequence(b.assign(total,b.input),
      b.assign(answer,rules.call(choose,b.read(v=>{views.push(v);return v.get(total);}))),
      b.assign(total,b.read(v=>{views.push(v);return v.get(total)+v.get(answer);})),
      rules.call(module.exports.write,total),
      b.return(b.read(v=>{views.push(v);return v.query(module.exports.current,undefined);})),
    );
  });
  const definition=linkRules({id:'held-rule-contexts',schemas:{setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}},
    initialize:()=>({}),entry,definitions:[entry,choose],modules:[module],initialEntities:[0]});
  const program=new CardProgram(definition),storage=new CardGraph(program.initial(10)),otherStorage=new CardGraph(program.initial(20));
  const parent=new CardMachine(program,storage),other=new CardMachine(program,otherStorage);
  assert.deepEqual(parent.advance(),{kind:'call',call:{port:'choose',input:10}});
  assert.deepEqual(other.advance(),{kind:'call',call:{port:'choose',input:20}});
  const parentView=views[0]!,otherView=views[1]!;
  const siblingStorage=storage.fork(),saved=deserialize(serialize(storage.snapshot()));
  const restoredStorage=new CardGraph<typeof storage.root>(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
  const sibling=new CardMachine(program,siblingStorage),restored=new CardMachine(program,restoredStorage);
  program.validate(restored.root);
  const retained:{view:ReadView<number>;input:number;result:number}[]=[];
  try{
    for(const [machine,reply,input,result]of[[parent,1,10,11],[sibling,2,10,12],[restored,3,10,13],[other,4,20,24]]as const){
      const before=views.length;
      assert.deepEqual(machine.advance(reply),{kind:'done',result});
      const view=views.at(-1)!;
      assert.equal(views.length-before,2);assert.equal(views[before],view);
      retained.push({view,input,result});
    }
    assert.equal(retained[0]!.view,parentView);assert.equal(retained[3]!.view,otherView);
    assert.equal(new Set(retained.map(row=>row.view)).size,4);
    for(const {view,input,result}of retained){
      assert.equal(Object.isFrozen(view),true);assert.equal(view.input,input);
      assert.equal(view.get(slot!),result);assert.equal(view.query(module.exports.current,undefined),result);
    }
  }finally{storage.close();siblingStorage.close();restoredStorage.close();otherStorage.close();}
});
