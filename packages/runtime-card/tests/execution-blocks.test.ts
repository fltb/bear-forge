import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {card,CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
import type {CardScope,CardTrace} from '@bear-forge/card-engine';
import {CardGraph} from '../src/graph.ts';
import {temporaryLocalBlock} from '../../card-engine/src/card-execution-hints.ts';

test('each logical budget cutoff keeps the independently specified trace and committed prefix',()=>{
  const program=new CardProgram({id:'block-budget-prefix',schemas:{setup:z.null(),result:z.number(),ports:{}},initialize:()=>({n:0}),entry:'main',effects:[
    {id:'main',steps:[card.operation<{n:number}>(s=>{s.state.n=1;}),card.invoke('nested'),card.return<{n:number}>(s=>s.state.n)]},
    {id:'nested',steps:[card.branch<{n:number}>(()=>true,[card.operation(s=>{s.state.n=2;}),card.return(()=>3)])]},
  ]});
  const expected:CardTrace[]=[
    {effect:'main',block:0,index:0,kind:'operation',depth:1},
    {effect:'main',block:0,index:1,kind:'invoke',depth:1},
    {effect:'nested',block:1,index:0,kind:'branch',depth:2},
    {effect:'nested',block:2,index:0,kind:'operation',depth:3},
    {effect:'nested',block:2,index:1,kind:'return',depth:3},
    {effect:'main',block:0,index:2,kind:'return',depth:1},
  ];
  for(const controlled of [false,true])for(let budget=0;budget<=6;budget++){
    const root=program.initial(null,budget),storage=controlled?new CardGraph(root):plainCardStorage(root),actual:CardTrace[]=[];
    const machine=new CardMachine(program,storage,event=>actual.push(event)),stop=machine.advance();
    assert.deepEqual(actual,expected.slice(0,budget));
    assert.equal(machine.root.state.n,budget===0?0:budget<4?1:2);
    assert.equal(stop.kind,budget===6?'done':'fault');storage.close?.();
  }
});

test('proven empty dispatch keeps all logical instructions and budget failure positions',()=>{
  const steps=temporaryLocalBlock<{}>([card.repeat(()=>true,[card.operation(()=>-1,'position'),card.branch(s=>s.locals.position<0,[card.return()])])],()=>true);
  const program=new CardProgram({id:'empty-dispatch-prefix',schemas:{setup:z.null(),result:z.number(),ports:{}},initialize:()=>({}),entry:'main',effects:[{id:'main',steps:[card.invoke('dispatch'),card.return(()=>7)]},{id:'dispatch',steps}]});
  const kinds=['invoke','repeat','operation','branch','return','return'],depths=[1,2,3,3,4,1];
  for(const controlled of [false,true])for(let budget=0;budget<=6;budget++){
    const root=program.initial(null,budget),storage=controlled?new CardGraph(root):plainCardStorage(root),trace:CardTrace[]=[];
    const stop=new CardMachine(program,storage,event=>trace.push(event)).advance();
    assert.deepEqual(trace.map(t=>t.kind),kinds.slice(0,budget));assert.deepEqual(trace.map(t=>t.depth),depths.slice(0,budget));
    assert.equal(stop.kind,budget===6?'done':'fault');storage.close?.();
  }
});

test('temporary execution cursors preserve ephemeral scope identity and managed local aliases',()=>{
  const retained:CardScope<{n:number;alias:unknown}>[]=[];
  const program=new CardProgram({id:'block-scope-identity',schemas:{setup:z.null(),result:z.any(),ports:{}},initialize:()=>({n:1,alias:null as unknown}),entry:'main',effects:[{id:'main',steps:[
    card.operation<{n:number;alias:unknown}>(s=>{retained.push(s);s.locals.x=1;s.state.alias=s.locals;s.state={n:99,alias:null};s.input=7;}),
    card.operation<{n:number;alias:unknown}>(s=>{retained.push(s);assert.equal(s.state.n,1);assert.equal(s.input,null);s.locals.x=2;}),
    card.return<{n:number;alias:unknown}>(s=>({local:s.locals,alias:s.state.alias})),
  ]}]});
  for(const controlled of [false,true]){
    const root=program.initial(null),storage=controlled?new CardGraph(root):plainCardStorage(root),stop=new CardMachine(program,storage).advance();
    assert.equal(stop.kind,'done');if(stop.kind==='done'){assert.equal(stop.result.local,stop.result.alias);assert.equal(stop.result.local.x,2);}
    assert.notEqual(retained.at(-1),retained.at(-2));storage.close?.();
  }
});
