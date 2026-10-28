import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules,ruleModules} from '@bear-forge/card-engine';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {ProbabilityCurrent} from '@bear-forge/runtime-card/probability';
import {ProbabilityExpansion} from '@bear-forge/runtime-card/probability-expansion';
import {addMass,multiplyMass,probabilityMass,unitMass,zeroMass,type ProbabilityMass} from '@bear-forge/card-engine/probability-mass';
import {rules} from '../src/rules/execution.ts';
import {random} from '../src/rules/random.ts';

const {defineEffect,defineEntity,sequence,spawnEntity,call}=rules;
const pause=ruleModules.portEffect<null,null>('pause');
const resultSchema=z.object({integer:z.number(),float:z.number(),chance:z.boolean()});
const entry=defineEffect<void,z.infer<typeof resultSchema>>(b=>{
  const stream=b.local<number>(),integer=b.local<number>(),float=b.local<number>(),chance=b.local<boolean>();
  return sequence(b.assign(stream,spawnEntity({definition:defineEntity(random.exports.stream,undefined),owner:null,scope:0,setup:130n})),
    call(pause,null),b.assign(integer,call(random.exports.mappedInt,{stream,values:[2,2,7]})),
    b.assign(float,call(random.exports.mappedFloat,{stream,image:[{end:1,value:4},{end:2**24,value:9}]})),
    b.assign(chance,call(random.exports.chance,{stream,chance:.25})),b.return({integer,float,chance}));
});
const definition=linkRules({id:'sts/exact-random-mass',schemas:{setup:z.undefined(),result:resultSchema,ports:{pause:{input:z.null(),output:z.null()}}},
  initialize:()=>({}),entry,definitions:[entry,pause],modules:[random]});

test('original mapped draws conserve exact thirds, float24 counts and their joint conditional mass through restore',()=>{
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));
  assert.equal(machine.advance().kind,'call');
  const current=new ProbabilityCurrent(machine);let expansion=ProbabilityExpansion.from(current,null,null);
  const outcomes=new Map<string,ProbabilityMass>();
  try{
    while(!expansion.complete){
      expansion.step();
      for(;;){
        const row=expansion.take();if(!row)break;
        try{const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected result');
          const {integer,float,chance}=stop.result,key=[integer,float,chance].join(':');assert.ok(!outcomes.has(key));outcomes.set(key,row.mass);
        }finally{row.current.close();}
      }
      const saved=deserialize(serialize(expansion.save()));expansion.close();expansion=ProbabilityExpansion.restore(program,saved);
    }
    assert.equal(outcomes.size,8);let total=zeroMass();
    for(const integer of [2,7])for(const float of [4,9])for(const chance of [false,true]){
      const expected=multiplyMass(multiplyMass(probabilityMass(integer===2?2n:1n,3n),probabilityMass(float===4?1n:(1n<<24n)-1n,1n<<24n)),probabilityMass(chance?1n:3n,4n));
      const actual=outcomes.get([integer,float,chance].join(':'));assert.deepEqual(actual,expected);total=addMass(total,actual!);
    }
    assert.deepEqual(total,unitMass());assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{expansion.close();current.close();}
});

for(const partial of [false,true])test(`discarded original integer results integrate the complete remaining law without replay; partial=${partial}`,()=>{
  const discard=defineEffect<number,void>(b=>call(random.exports.int,{stream:b.read(v=>v.input),start:0,end:partial?3:1000000000}));
  const root=defineEffect<void,{value:number;counter:number}>(b=>{
    const stream=b.local<number>(),value=b.local<number>(),view=rules.query(random.exports.current,stream);
    return sequence(b.assign(stream,spawnEntity({definition:defineEntity(random.exports.stream,undefined),owner:null,scope:0,setup:130n})),
      call(pause,null),call(discard,stream),
      b.assign(value,call(random.exports.int,{stream,start:5,end:6})),
      b.return({value,counter:b.read(v=>v.get(view).counter)}));
  });
  const definition=linkRules({id:'sts/discarded-integer',schemas:{setup:z.undefined(),result:z.object({value:z.number(),counter:z.number()}),ports:{pause:{input:z.null(),output:z.null()}}},
    initialize:()=>({}),entry:root,definitions:[root,discard,pause],modules:[random]});
  const program=new CardProgram(definition),machine=new CardMachine(program,privateCardGraph(program.initial(undefined)));
  assert.equal(machine.advance().kind,'call');const current=new ProbabilityCurrent(machine);
  let expansion=ProbabilityExpansion.from(current,null,null),steps=0,switched=!partial;
  const equivalent=CardMachine.prototype.probabilityCoordinatesEquivalent,initial=CardProgram.prototype.initial,totals=new Map<number,ProbabilityMass>();
  try{
    CardProgram.prototype.initial=()=>{throw Error('The retained current must not initialize again');};
    if(partial)CardMachine.prototype.probabilityCoordinatesEquivalent=()=>false;
    while(!expansion.complete){
      assert.ok(++steps<200,'complete integration must not enumerate the billion unused integers');expansion.step();
      for(let row=expansion.take();row;row=expansion.take())try{
        const stop=row.current.inspect();assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected done');
        assert.equal(stop.result.counter,2);totals.set(stop.result.value,addMass(totals.get(stop.result.value)??zeroMass(),row.mass));
        if(!switched){
          assert.deepEqual(row.mass,probabilityMass(1n,8n));
          const frontier=expansion.save();
          assert.ok(frontier.pending.some(node=>node.phase==='chance'&&node.cursor.space.kind==='uniform'&&node.cursor.space.size===4n&&node.cursor.next>0n&&node.cursor.next<4n));
          CardMachine.prototype.probabilityCoordinatesEquivalent=equivalent;switched=true;
        }
      }finally{row.current.close();}
      const before=expansion.masses(),saved=deserialize(serialize(expansion.savePacked()));expansion.close();expansion=ProbabilityExpansion.restore(program,saved);
      assert.deepEqual(expansion.masses(),before);
    }
    assert.equal(switched,true);assert.deepEqual([...totals].sort((a,b)=>a[0]-b[0]),[[5,probabilityMass(1n,2n)],[6,probabilityMass(1n,2n)]]);
    assert.deepEqual(expansion.masses().transferred,unitMass());
  }finally{CardMachine.prototype.probabilityCoordinatesEquivalent=equivalent;CardProgram.prototype.initial=initial;expansion.close();current.close();}
});
