import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {addMass,compareMass,multiplyMass,numericMass,probabilityMass,probabilityCursor,nextProbabilityCoordinate,partitionRemainingCursors,sumRemainingCursors,unitMass,zeroMass,ExactProbabilityUnavailable,type ProbabilityCursor} from '../src/probability-cursor.ts';

test('all small cyclic remainder pairs partition disjointly and preserve every weighted coordinate',()=>{
  const spaces=[...[1,2,3,4,5,6].map(n=>probabilityCursor({kind:'uniform' as const,size:BigInt(n)}).space),probabilityCursor({kind:'rational',weights:[0,2,1,0,3].map(n=>probabilityMass(BigInt(n),6n))}).space];
  const p=probabilityMass(2n,7n),q=probabilityMass(5n,11n);
  for(const space of spaces){
    const n=space.kind==='uniform'?Number(space.size):space.weights.length,weights=Array.from({length:n},(_,i)=>space.kind==='uniform'?probabilityMass(1n,BigInt(n)):space.weights[i]!);
    const make=(offset:number,next:number):ProbabilityCursor=>({space,offset:BigInt(offset),next:BigInt(next),remaining:Array.from({length:n-next},(_,i)=>weights[(offset+next+i)%n]!).reduce(addMass,zeroMass())});
    for(let a=0;a<n;a++)for(let b=0;b<n;b++)for(let i=0;i<=n;i++)for(let j=0;j<=n;j++){
      const left=make(a,i),right=make(b,j),parts=partitionRemainingCursors(left,right),actual=new Map<number,ReturnType<typeof probabilityMass>>();
      let leftMass=zeroMass(),rightMass=zeroMass();
      for(const part of parts){
        let cursor:ProbabilityCursor=deserialize(serialize(part.cursor));
        if(part.left)leftMass=addMass(leftMass,cursor.remaining);if(part.right)rightMass=addMass(rightMass,cursor.remaining);
        const incoming=addMass(part.left?p:zeroMass(),part.right?q:zeroMass());
        for(;;){const row=nextProbabilityCoordinate(cursor);if(!row)break;const coordinate=Number(row.coordinate);assert.equal(actual.has(coordinate),false,'partition supports must be disjoint');actual.set(coordinate,multiplyMass(incoming,row.probability));cursor=row.cursor;}
      }
      assert.deepEqual(leftMass,left.remaining);assert.deepEqual(rightMass,right.remaining);
      const leftCoordinates=new Set(Array.from({length:n-i},(_,k)=>(a+i+k)%n)),rightCoordinates=new Set(Array.from({length:n-j},(_,k)=>(b+j+k)%n));
      for(let coordinate=0;coordinate<n;coordinate++)assert.deepEqual(actual.get(coordinate)??zeroMass(),multiplyMass(weights[coordinate]!,addMass(leftCoordinates.has(coordinate)?p:zeroMass(),rightCoordinates.has(coordinate)?q:zeroMass())));
    }
  }
});

test('huge remainder intersections use endpoints and retain tiny positive mass without enumerating the support',()=>{
  const size=1n<<64n,space={kind:'uniform' as const,size};
  const left={space,next:2n,remaining:probabilityMass(size-2n,size)},right={space,next:size-3n,offset:100n,remaining:probabilityMass(3n,size)};
  const parts=partitionRemainingCursors(left,right);assert.equal(parts.length,3);
  const shared=parts.filter(part=>part.left&&part.right);assert.equal(shared.length,1);assert.deepEqual(shared[0]!.cursor.remaining,right.remaining);
  assert.equal(nextProbabilityCoordinate(shared[0]!.cursor)!.coordinate,97n);
  assert.deepEqual(parts.filter(part=>part.left).reduce((mass,part)=>addMass(mass,part.cursor.remaining),zeroMass()),left.remaining);
});

test('summing multiple remainder intervals preserves each coordinate and gives disjoint support',()=>{
  for(const space of [probabilityCursor({kind:'uniform',size:7n}).space,probabilityCursor({kind:'rational',weights:[0,2,1,0,3].map(n=>probabilityMass(BigInt(n),6n))}).space]){
    const size=space.kind==='uniform'?Number(space.size):space.weights.length;
    for(let shift=0;shift<size;shift++){
      const pieces=Array.from({length:6},(_,i)=>{
        let cursor:ProbabilityCursor={space,next:0n,offset:BigInt((shift+i)%size),remaining:unitMass()};
        for(let j=0;j<i%size;j++){const choice=nextProbabilityCoordinate(cursor);if(!choice)break;cursor=choice.cursor;}
        return{cursor,mass:probabilityMass(BigInt(i+1),21n)};
      });
      const expected=new Map<bigint,ReturnType<typeof probabilityMass>>(),actual=new Map<bigint,ReturnType<typeof probabilityMass>>();
      for(const piece of pieces){let cursor=piece.cursor;for(;;){const row=nextProbabilityCoordinate(cursor);if(!row)break;expected.set(row.coordinate,addMass(expected.get(row.coordinate)??zeroMass(),multiplyMass(piece.mass,row.probability)));cursor=row.cursor;}}
      const combined=sumRemainingCursors(pieces);
      for(const piece of combined){let cursor=piece.cursor;for(;;){const row=nextProbabilityCoordinate(cursor);if(!row)break;assert.equal(actual.has(row.coordinate),false);actual.set(row.coordinate,multiplyMass(piece.mass,row.probability));cursor=row.cursor;}}
      assert.deepEqual(actual,expected);
      assert.deepEqual(combined.reduce((total,piece)=>addMass(total,multiplyMass(piece.mass,piece.cursor.remaining)),zeroMass()),pieces.reduce((total,piece)=>addMass(total,multiplyMass(piece.mass,piece.cursor.remaining)),zeroMass()));
      assert.deepEqual(sumRemainingCursors(combined),combined);
    }
  }
});
test('weighted interval sum handles huge supports symbolically',()=>{
  const size=1n<<64n,space={kind:'uniform' as const,size};
  const pieces=[0n,1n,2n,3n].map(next=>({mass:probabilityMass(1n,4n),cursor:{space,next,remaining:probabilityMass(size-next,size)}}));
  const combined=sumRemainingCursors(pieces);assert.equal(combined.length,4);
  assert.deepEqual(combined.reduce((sum,piece)=>addMass(sum,multiplyMass(piece.mass,piece.cursor.remaining)),zeroMass()),probabilityMass(2n*size-3n,2n*size));
});

test('a huge uniform space retains its full support and exact remaining mass',()=>{
  const size=1n<<64n;let cursor=probabilityCursor({kind:'uniform',size}),delivered=zeroMass();
  for(let i=0n;i<12n;i++){
    const next=nextProbabilityCoordinate(cursor)!;assert.equal(next.coordinate,i);
    assert.deepEqual(next.probability,probabilityMass(1n,size));
    delivered=addMass(delivered,next.probability);cursor=deserialize(serialize(next.cursor));
    assert.equal(compareMass(addMass(delivered,cursor.remaining),unitMass()),0);
  }
  assert.deepEqual(cursor.remaining,probabilityMass(size-12n,size));
  assert.deepEqual(cursor.space,{kind:'uniform',size});
});
test('weighted support preserves tiny positive branches and skips only zero mass',()=>{
  let cursor=probabilityCursor({kind:'weighted',weights:[0,Number.MIN_VALUE,1,0]}),mass=zeroMass();
  const coordinates:bigint[]=[];
  for(;;){const next=nextProbabilityCoordinate(cursor);if(!next)break;coordinates.push(next.coordinate);mass=addMass(mass,next.probability);cursor=next.cursor;}
  assert.deepEqual(coordinates,[1n,2n]);assert.deepEqual(mass,unitMass());
  assert.deepEqual(numericMass(Number.MIN_VALUE),probabilityMass(1n,1n<<1074n));
  assert.deepEqual(numericMass(.125),probabilityMass(1n,8n));
});
test('conditional path masses multiply exactly and cannot be rounded away',()=>{
  const mass=multiplyMass(probabilityMass(1n,3n),probabilityMass(1n,7n));
  assert.deepEqual(mass,probabilityMass(1n,21n));
  assert.deepEqual(Array.from({length:21},()=>mass).reduce(addMass,zeroMass()),unitMass());
});
test('rational producers retain their original ratios without binary conversion',()=>{
  const thirds=probabilityCursor({kind:'rational',weights:[probabilityMass(1n,3n),probabilityMass(2n,3n)]});
  const first=nextProbabilityCoordinate(thirds)!;assert.deepEqual(first.probability,probabilityMass(1n,3n));
  assert.deepEqual(first.cursor.remaining,probabilityMass(2n,3n));
  assert.deepEqual(nextProbabilityCoordinate(first.cursor)!.probability,probabilityMass(2n,3n));
});
test('an unavailable original law remains unavailable',()=>{
  assert.throws(()=>probabilityCursor({kind:'unavailable',reason:'Missing exact fixture law'}),ExactProbabilityUnavailable);
});

test('rotated enumeration preserves every original weighted coordinate and exact remaining mass',()=>{
  const weights=[zeroMass(),probabilityMass(1n,7n),zeroMass(),probabilityMass(2n,7n),probabilityMass(4n,7n)];
  for(let offset=0n;offset<5n;offset++){
    let cursor={...probabilityCursor({kind:'rational',weights}),offset},mass=zeroMass();const seen=new Set<bigint>();
    for(;;){
      const row=nextProbabilityCoordinate(cursor);if(!row)break;
      assert.equal(seen.has(row.coordinate),false);seen.add(row.coordinate);
      assert.deepEqual(row.probability,weights[Number(row.coordinate)]);mass=addMass(mass,row.probability);
      cursor=deserialize(serialize(row.cursor));assert.deepEqual(addMass(mass,cursor.remaining),unitMass());
    }
    assert.deepEqual([...seen].sort(),[1n,3n,4n]);assert.deepEqual(mass,unitMass());
  }
  const size=1n<<64n;let cursor={...probabilityCursor({kind:'uniform',size}),offset:size-2n};
  for(const expected of [size-2n,size-1n,0n]){const row=nextProbabilityCoordinate(cursor)!;assert.equal(row.coordinate,expected);cursor=deserialize(serialize(row.cursor));}
  assert.equal(cursor.next,3n);assert.deepEqual(cursor.remaining,probabilityMass(size-3n,size));
});
