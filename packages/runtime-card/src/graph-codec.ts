import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';

type Chunk=Readonly<{data:string}>;
export type PackedGraphData={bytes:Uint8Array}|{chunks:Chunk[]};
// Only immutable compressed data is interned. No Context, Program or external
// anchor enters this pool. Full strings, never hashes, establish equality.
const chunks=new Map<string,Set<WeakRef<Chunk>>>();
// A source object does not prove content: cold/exported chunks may be mutable.
// Reuse only the frozen copy whose full string still equals the current input.
// Weak keys keep neither discarded snapshots nor their owners alive.
const chunkCopies=new WeakMap<Chunk,Chunk>();
const cleanup=new FinalizationRegistry<{key:string;reference:WeakRef<Chunk>}>(({key,reference})=>{
  const bucket=chunks.get(key);bucket?.delete(reference);if(bucket?.size===0)chunks.delete(key);
});
function intern(data:string):Chunk{
  const key=createHash('sha256').update(data).digest('hex'),bucket=chunks.get(key)??new Set<WeakRef<Chunk>>();
  for(const reference of bucket){const known=reference.deref();if(!known)bucket.delete(reference);else if(known.data===data)return known;}
  const chunk=Object.freeze({data}),reference=new WeakRef(chunk);bucket.add(reference);chunks.set(key,bucket);cleanup.register(chunk,{key,reference});chunkCopies.set(chunk,chunk);return chunk;
}
function copyChunk(source:Chunk):Chunk{
  const data=source.data;
  const known=chunkCopies.get(source);
  if(known?.data===data)return known;
  const copy=intern(data);chunkCopies.set(source,copy);return copy;
}
const gear=Array.from({length:256},(_,i)=>{
  let value=i+1;value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);return(value^(value>>>16))>>>0;
});
/** Content-defined boundaries survive small edits in adjacent Contexts.
 * These sizes only choose an encoding; they never truncate state or work. */
export function encodeGraphData(raw:Uint8Array):PackedGraphData{
  if(raw.byteLength<=8192)return{bytes:Uint8Array.from(deflateRawSync(raw,{level:1}))};
  const parts:Chunk[]=[];let start=0,hash=0;
  for(let i=0;i<raw.byteLength;i++){
    hash=((hash<<1)+gear[raw[i]!]!)>>>0;
    if(i-start+1<1024||((hash&2047)!==0&&i-start+1<8192))continue;
    parts.push(intern(deflateRawSync(raw.subarray(start,i+1),{level:1}).toString('base64')));start=i+1;hash=0;
  }
  if(start<raw.byteLength)parts.push(intern(deflateRawSync(raw.subarray(start),{level:1}).toString('base64')));
  return{chunks:parts};
}
export function decodeGraphData(packed:PackedGraphData):Buffer{
  if('bytes' in packed)return inflateRawSync(packed.bytes);
  return Buffer.concat(packed.chunks.map(chunk=>inflateRawSync(Buffer.from(chunk.data,'base64'))));
}
/** Input arrays and legacy bytes remain detached. Shared chunk objects contain
 * only frozen strings, so exported snapshots cannot mutate another owner. */
export function copyGraphData(packed:PackedGraphData):PackedGraphData{
  return 'bytes' in packed?{bytes:new Uint8Array(packed.bytes)}:{chunks:packed.chunks.map(copyChunk)};
}
export function sameGraphData(left:PackedGraphData,right:PackedGraphData):boolean{
  if(left===right)return true;
  if('bytes' in left&&'bytes' in right)return Buffer.compare(left.bytes,right.bytes)===0;
  if('chunks' in left&&'chunks' in right)return left.chunks.length===right.chunks.length&&left.chunks.every((chunk,i)=>chunk.data===right.chunks[i]!.data);
  return Buffer.compare(decodeGraphData(left),decodeGraphData(right))===0;
}
export function graphDataBytes(packed:PackedGraphData):number{
  return 'bytes' in packed?packed.bytes.byteLength:packed.chunks.reduce((size,chunk)=>size+Buffer.byteLength(chunk.data,'base64'),0);
}
