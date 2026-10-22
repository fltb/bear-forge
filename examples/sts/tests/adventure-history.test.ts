import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {ruleModules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {adventureHistory} from '../src/rules/adventure-history.ts';
import type {Outcome} from '@bear-forge/contracts/instance';

const unwrap=<T>(result:Outcome<T>):T=>{if(!result.ok)throw Error(result.error.message);return result.value;};
const entry=z.object({kind:z.enum(['game','battle']),bits:z.number().int().nonnegative()});
const report=z.object({all:z.object({history:z.array(entry),published:z.number()}),pending:z.array(entry),cursor:z.object({length:z.number(),published:z.number()})});

test('history crosses chunk boundaries, acknowledges only published entries, and forks an unread suffix',async()=>{
  const module=rules.defineRules({requires:[],build(m){
    const scope=rules.defineQuery({input:z.number(),output:z.object({scope:z.number()}),base:()=>({scope:0})});
    const history=adventureHistory(m,scope);
    const initialize=m.atom({input:z.number(),output:z.undefined(),reads:[],writes:[history.component],emits:[],run(_read,entity){return{writes:[{entity,component:history.component,value:history.initial()}],events:[],result:undefined};}});
    const kind=m.kind({config:z.undefined(),components:[history.component],initialize:rules.defineEffect<rules.EntityLifecycle<undefined>,void>(b=>rules.call(initialize,b.read(v=>v.input.entity)))});
    const definition=rules.defineEntity(kind,undefined),choose=ruleModules.portEffect<z.output<typeof report>,number>('choose');
    const run=rules.defineEffect<null,z.output<typeof report>>(b=>{
      const journal=b.local<number>(),reply=b.local<number>();
      // All/pending borrow the same immutable entries. This public report's
      // schema delivers separate writable trees, so materialize at the port.
      const value=b.read(v=>{
        const all=v.query(history.current,v.get(journal)),pending=v.query(history.pending,v.get(journal));
        return{all:{...all,history:all.history.map(entry=>({...entry}))},pending:pending.map(entry=>({...entry})),cursor:v.query(history.cursor,v.get(journal))};
      });
      return rules.sequence(
        b.assign(journal,rules.spawnEntity({definition,owner:null,scope:0})),
        rules.forEach(Array.from({length:129},(_,bits)=>bits),bits=>rules.call(history.record,{run:journal,kind:'game',bits})),
        rules.call(history.published,{run:journal,count:64}),b.assign(reply,rules.call(choose,value)),
        rules.call(history.record,{run:journal,kind:'battle',bits:reply}),
        rules.call(history.published,{run:journal,count:129}),b.return(value),
      );
    });
    return{exports:{run}};
  }});
  const definition=linkRules<{},null,{choose:{input:z.output<typeof report>;output:number}},z.output<typeof report>>({id:'chunked-history',schemas:{setup:z.null(),result:report,ports:{choose:{input:report,output:z.number().int().nonnegative()}}},initialize:()=>({}),entry:module.exports.run,definitions:[module.exports.run],modules:[module]});
  for(const controlled of [true]){
    const loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(definition)),parent=unwrap(await loaded.core.start(null));
    const first=unwrap(await parent.inspect());assert.equal(first.kind,'call',JSON.stringify(first));if(first.kind!=='call')throw Error('Expected history choice');
    assert.equal(first.call.input.all.history.length,129);assert.equal(first.call.input.pending.length,65);assert.deepEqual(first.call.input.cursor,{length:129,published:64});
    const variants=[parent];
    if(controlled){variants.push(unwrap(await parent.fork!()));const snapshot=unwrap(await loaded.persistence!.save(parent));variants.push(unwrap(await loaded.persistence!.restore(snapshot)));unwrap(await loaded.persistence!.release(snapshot));}
    for(let index=0;index<variants.length;index++){
      const instance=variants[index]!,bits=200+index;
      unwrap(await instance.bind({choose:async()=>({kind:'reply',value:bits})}));const last=unwrap(await instance.run()).state;
      assert.equal(last.kind,'done',JSON.stringify(last));if(last.kind!=='done')throw Error('Expected completed history');
      assert.equal(last.result.all.history.length,130);assert.deepEqual(last.result.pending,[{kind:'battle',bits}]);assert.deepEqual(last.result.cursor,{length:130,published:129});
      assert.equal(first.call.input.all.history.length,129);unwrap(await instance.close());await loaded.capture?.release(instance.id);
    }
  }
});
