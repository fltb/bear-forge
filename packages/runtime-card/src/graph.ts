import { types } from 'node:util';
import {serialize,deserialize} from 'node:v8';
import {type PackedGraphData,encodeGraphData,decodeGraphData,copyGraphData,sameGraphData,graphDataBytes} from './graph-codec.ts';
import {createHash} from 'node:crypto';
import { CowStore } from './cow-index.ts';
import {CowProperties} from './cow-properties.ts';
import { arrayPrototypeIsPlain } from '../../boundary/src/values.ts';
import { isImmutableRuleValue, isContextRuleValue, admitImmutableRuleBlock, immutableRuleBirth } from '../../card-engine/src/rules-values.ts';
import { Publication,publishNativeStop } from './publication.ts';

type Reference = { readonly ref: number };
type Block = { readonly block: object };
type Value = null | undefined | boolean | string | number | bigint | Reference | Block;
type Row = { array: boolean; nullPrototype: boolean; length: number; props: CowProperties<Value>; pages: CowStore<Record<string, Value>> | null; exportCache?: { value: any; dense: boolean } };
type Identity = { next: number; originals: WeakMap<object, Reference> };
type EdgeCursor = { value: Value; advance(): boolean };
type Collection = { live: Set<number>; pending: number[]; scan: EdgeCursor | null; sweep: number; cutoff: number };
type GraphImage<T>={root:T;immutable:object[];nullPrototypes:object[];contextValues:object[]};
export type PackedGraphImage=PackedGraphData&{anchors:object[];key?:string};
/** Context-owned identities may be reconstructed with their complete alias
 * graph. Program/external identities cannot: opaque placeholders refer to the
 * same retained immutable anchors, including anchors nested inside a block.
 * The placeholder table is separate from user fields, so no data key is magic.
 * V8 preserves aliases, cycles, holes, bigint and non-finite scalar values. */
export function packGraphImage<T>(image:GraphImage<T>,contextAfter:number):PackedGraphImage{
  const seen=new Map<object,object>(),anchors:object[]=[],references:object[]=[],nulls:object[]=[];
  const copy=(value:any):any=>{
    if(value===null||typeof value!=='object')return value;
    if(seen.has(value))return seen.get(value);
    const contextual=isContextRuleValue(value)&&(immutableRuleBirth(value)??0)>contextAfter;
    if(isImmutableRuleValue(value)&&!contextual){
      const reference={};seen.set(value,reference);anchors.push(value);references.push(reference);return reference;
    }
    const out=Array.isArray(value)?new Array(value.length):{};seen.set(value,out);
    if(Object.getPrototypeOf(value)===null)nulls.push(out);
    for(const key of Reflect.ownKeys(value)){
      if(Array.isArray(value)&&key==='length')continue;
      const field=Object.getOwnPropertyDescriptor(value,key)!;
      Object.defineProperty(out,key,{value:copy(field.value),writable:true,enumerable:true,configurable:true});
    }
    return out;
  };
  const copied=copy(image);
  const raw=serialize({image:copied,references,nulls});
  return{...encodeGraphData(raw),anchors,key:createHash('sha256').update(raw).digest('hex')};
}
export function unpackGraphImage<T>(packed:PackedGraphImage):GraphImage<T>{
  return decodeGraphImage<T>(packed,decodeGraphData(packed));
}
function decodeGraphImage<T>(packed:PackedGraphImage,raw:Uint8Array):GraphImage<T>{
  const decoded=deserialize(raw) as {image:GraphImage<T>;references:object[];nulls:object[]};
  const references=new Map(decoded.references.map((reference,i)=>[reference,packed.anchors[i]!])),seen=new Set<object>();
  const restore=(value:any):any=>{
    if(value===null||typeof value!=='object')return value;
    if(references.has(value))return references.get(value);
    if(seen.has(value))return value;seen.add(value);
    for(const key of Object.keys(value))Object.defineProperty(value,key,{value:restore(value[key]),writable:true,enumerable:true,configurable:true});
    return value;
  };
  const image=restore(decoded.image) as GraphImage<T>;
  for(const value of decoded.nulls)Object.setPrototypeOf(value,null);
  const contextual=new Set(image.contextValues);
  for(const value of image.immutable)admitImmutableRuleBlock(value,()=>{},node=>contextual.has(node));
  return image;
}
const proxies = new WeakMap<object, { graph: CardGraph<any>; id: number; reference: Reference; generation:number }>();
const blocks = new WeakMap<object, Block>();
// Only the loader's no-projection execution may keep detached exports private.
// Public graphs always produce fresh, unbranded values.
const privateGraphs = new WeakSet<object>();
export function privateCardGraph<T>(value: T, immutable?: readonly object[],nullPrototypes?:readonly object[],contextValues?:readonly object[]): CardGraph<T> {
  const graph = new CardGraph(value, immutable,nullPrototypes,contextValues); privateGraphs.add(graph); return graph;
}
const pageWidth = 64;
const numeric = (key: string): number | undefined => {
  const first = key.charCodeAt(0);
  if (first < 48 || first > 57 || key.length === 0 || key.length > 10) return undefined;
  if (first === 48) return key.length === 1 ? 0 : undefined;
  let value = first - 48;
  for (let index = 1; index < key.length; index++) { const digit = key.charCodeAt(index) - 48; if (digit < 0 || digit > 9) return undefined; value = value * 10 + digit; }
  return value < 0xffffffff ? value : undefined;
};
const fields = (): Record<string, Value> => Object.create(null);
// Numeric pages have a null prototype and at most 64 own fields. Stop at the
// first retained field instead of allocating a complete key array per delete.
const emptyFields = (values: Record<string, Value>): boolean => { for (const _key in values) return false; return true; };
const clone = (row: Row): Row => ({ ...row, props: row.props.fork(), pages: row.pages?.fork() ?? null });

/** Branch-local views of data identities; shared nodes contain no live proxies. */
export class CardGraph<T> {
  /** Retain a detached encoding; decode the complete Context only on access. */
  static restorePacked<T>(packed:PackedGraphImage,contextAfter:number):CardGraph<T>{
    const graph=privateCardGraph<T>(undefined as T);
    graph.parked={...copyGraphData(packed),anchors:[...packed.anchors]};
    graph.parkedContextAfter=contextAfter;return graph;
  }
  private rows = new CowStore<Row>();
  private identity: Identity = { next: 0, originals: new WeakMap() };
  private views = new Map<number, object>();
  // Only fork/collection/close invalidate row pointers. Ordinary writes update
  // the locally owned row and do not invalidate unrelated proxy reads.
  private epoch = 0;
  private collectionAt = 2048;
  private collection: Collection | null = null;
  private allocationAtBoundary = 0;
  private writesAtBoundary = 0;
  private restoring: Set<object> | null = null;
  private restoringNull:Set<object>|null=null;
  private restoringContext:Set<object>|null=null;
  private open = true;
  private rootValue: Value;
  private generation=0;
  private parked:PackedGraphImage|null=null;
  private parkedContextAfter:number|null=null;
  // Activation for observation/equality does not itself change Context data.
  // Retain the immutable image until a managed write invalidates it, so a pure
  // read followed by parking need not export/compress the same graph again.
  private cleanImage:{image:PackedGraphImage;contextAfter:number}|null=null;
  constructor(value: T, immutable?: readonly object[],nullPrototypes?:readonly object[],contextValues?:readonly object[]) {
    if(immutable)this.restoring=new Set(immutable);
    if(nullPrototypes)this.restoringNull=new Set(nullPrototypes);
    if(contextValues)this.restoringContext=new Set(contextValues);
    this.rootValue = this.encode(value);
    this.restoring=null;
    this.restoringNull=null;
    this.restoringContext=null;
    // The complete import already encoded every alias. Subsequent computation
    // uses managed references, never retained transferred source objects.
    if (this.identity.next) this.identity.originals = new WeakMap();
    this.allocationAtBoundary=this.identity.next;this.writesAtBoundary=0;
  }
  private activate():void{
    if(!this.open)throw Error('Closed card storage');
    if(!this.parked)return;
    const image=this.parked,contextAfter=this.parkedContextAfter!;
    const saved=unpackGraphImage<T>(image),loaded=new CardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
    // Import data before exchanging ownership. Failure retains the complete
    // parked image; no Program operation or previous input is executed.
    this.rows=loaded.rows;this.identity=loaded.identity;this.rootValue=loaded.rootValue;
    this.collectionAt=loaded.collectionAt;this.allocationAtBoundary=loaded.allocationAtBoundary;this.writesAtBoundary=0;
    this.cleanImage={image,contextAfter};this.parked=null;this.parkedContextAfter=null;this.epoch++;
  }
  get root(): T { this.activate();return this.decode(this.rootValue) as T; }
  get isParked():boolean{return this.parked!==null;}
  /** Read an owned publication from the complete retained image. Observation
   * needs no writable proxy/radix graph. Decode with the ordinary identity and
   * immutable admission path, then publish just the requested root field.
   * The parked Context stays intact; its next operation still activates it. */
  exportRootField<K extends keyof T>(key:K):T[K]{
    if(!this.open)throw Error('Closed card storage');
    if(!this.parked)return this.export(this.root[key]);
    const image=unpackGraphImage<T>(this.parked),value=image.root[key];
    return privateGraphs.has(this)?publishNativeStop(value,item=>this.materialize(item)):this.materialize(value);
  }
  /** Candidate bucket only. External anchors and full graph equality must
   * still be checked; a digest match never establishes equivalence. */
  candidateKey(contextAfter=0):string{
    this.park(contextAfter);const image=this.parked!;
    return image.key??=createHash('sha256').update(decodeGraphData(image)).digest('hex');
  }
  get parkedBytes():number{return this.parked?graphDataBytes(this.parked):0;}
  /** Detached durable bytes from the complete parked image. Reclassification
   * at a different ownership boundary still uses the ordinary full export. */
  packedSnapshot(contextAfter=0):PackedGraphImage{
    this.park(contextAfter);
    const image=this.parkedContextAfter===contextAfter?this.parked!:
      packGraphImage(this.snapshot(true,contextAfter),contextAfter);
    return{...copyGraphData(image),anchors:[...image.anchors]};
  }
  /** Private retained search storage only: keep all current data and immutable
   * identity anchors, release the proxy/radix execution representation. */
  park(contextAfter=0):void{
    if(!this.open)throw Error('Closed card storage');
    if(this.parked)return;
    const saved=this.cleanImage?.contextAfter===contextAfter?this.cleanImage.image:packGraphImage(this.snapshot(true,contextAfter),contextAfter);
    this.parked=saved;this.parkedContextAfter=contextAfter;this.rows.clear();this.views.clear();this.identity={next:0,originals:new WeakMap()};
    this.cleanImage=null;this.collection=null;this.rootValue=undefined;this.generation++;this.epoch++;
  }
  private encode(value: any): Value {
    if (value === null) return value;
    if (typeof value !== 'object') { if (typeof value === 'function' || typeof value === 'symbol') throw TypeError('Card state must contain data only'); return value; }
    const view = proxies.get(value);
    if (view) {
      if (view.graph !== this) throw TypeError('Foreign card instance reference');
      if(view.generation!==this.generation)throw Error('Released card view');
      return view.reference;
    }
    if(this.restoring?.has(value))admitImmutableRuleBlock(value,node=>this.restoring!.delete(node),node=>this.restoringContext?.has(node)===true);
    const savedNull=this.restoringNull?.has(value)===true;
    if (isImmutableRuleValue(value)) { let block = blocks.get(value); if (!block) { block = {block:value}; blocks.set(value, block); } return block; }
    if (types.isProxy(value)) throw TypeError('External proxy in card state');
    const known = this.identity.originals.get(value);
    if (known !== undefined && this.rows.has(known.ref)) return known;
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (!array && proto !== null && proto !== Object.prototype) throw TypeError('Non-data card object');
    if (array && proto !== Array.prototype) throw TypeError('Non-standard card array');
    const id = this.identity.next++, row: Row = { array, nullPrototype: savedNull||proto === null, length: array ? value.length : 0, props: new CowProperties(), pages: new CowStore() };
    const reference = {ref:id};
    this.identity.originals.set(value, reference); this.rows.set(id, row); this.shade(reference);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw TypeError('Symbol card property');
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(d, 'value') || !d.enumerable) throw TypeError('Accessor or hidden card property');
      this.put(row, key, this.encode(d.value));
    }
    return reference;
  }
  private get(row: Row, key: string): Value {
    const index = numeric(key);
    return index === undefined ? row.props.get(key) : row.pages!.get(Math.floor(index / pageWidth))?.[key];
  }
  private has(row: Row, key: string): boolean {
    const index = numeric(key);
    return index === undefined ? row.props.has(key) : Object.hasOwn(row.pages!.get(Math.floor(index / pageWidth)) ?? {}, key);
  }
  private put(row: Row, key: string, value: Value): void {
    this.cleanImage=null;
    this.writesAtBoundary++;
    this.shade(value);
    const index = numeric(key);
    if (index === undefined) row.props.set(key,value);
    else {
      const page = Math.floor(index / pageWidth);
      if (!row.pages!.has(page)) row.pages!.set(page, fields());
      row.pages!.edit(page, value => Object.assign(fields(), value))[key] = value;
      if(row.array)row.length = Math.max(row.length, index + 1);
    }
  }
  private decode(value: Value): any {
    if (value === null || typeof value !== 'object') return value;
    if ('block' in value) return value.block;
    const id = value.ref, existing = this.views.get(id); if (existing) return existing;
    const graph = this, initial = this.rows.get(id), privateExport = privateGraphs.has(this); if (!initial) throw Error('Missing card node');
    const generation=this.generation;
    let cached = initial, at = graph.epoch, writtenAt = -1;
    const row = () => { if (at !== graph.epoch) { if(generation!==graph.generation)throw Error('Released card view');const result = graph.rows.get(id); if (!result) throw Error('Released card node'); cached = result; at = graph.epoch; } return cached; };
    const writable = () => {
      graph.cleanImage=null;
      if (writtenAt !== graph.epoch) { if(generation!==graph.generation)throw Error('Released card view');cached = graph.rows.edit(id, clone); at = writtenAt = graph.epoch; }
      if (privateExport) delete cached.exportCache;
      return cached;
    };
    const proxy: any = new Proxy(initial.array ? [] : Object.create(initial.nullPrototype ? null : Object.prototype), {
      get(_target, key, receiver) {
        const current = row();
        if (current.array && key === 'length') return current.length;
        if (typeof key === 'string') {
          const value = graph.get(current, key);
          if (value !== undefined || graph.has(current, key)) return graph.decode(value);
        }
        return current.nullPrototype ? undefined : Reflect.get(current.array ? Array.prototype : Object.prototype, key, receiver);
      },
      set(_target, key, value) {
        if (typeof key !== 'string') throw TypeError('Symbol card property');
        const current = writable();
        if (current.array && key === 'length') {
          if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw RangeError('Invalid array length');
          if (value < current.length) {
            const pages=current.pages!;
            if(value===0)pages.clear();
            else if(value===current.length-1){
              // Shrinking by one can discard only this index. Array.pop has
              // already deleted it, so that path needs neither edits nor a cursor.
              const page=Math.floor(value/pageWidth),retained=pages.get(page);
              if(retained&&Object.hasOwn(retained,value)){
                const values=pages.edit(page,values=>Object.assign(fields(),values));delete values[value];
                if(emptyFields(values))pages.delete(page);
              }
            }
            else {
              // Start at the truncation boundary. Scanning the retained prefix
              // on every pop made draining N items quadratic in page count.
              // The radix cursor skips holes, including huge sparse arrays;
              // removing its current entry does not invalidate its traversal.
              const cursor=pages.cursor(Math.floor(value/pageWidth));
              while(cursor.advance()){
                const page=cursor.key;
                if(page*pageWidth>=value)pages.delete(page);
                else {
                  const values=pages.edit(page,values=>Object.assign(fields(),values));
                  for(const name of Object.keys(values))if(Number(name)>=value)delete values[name];
                  if(emptyFields(values))pages.delete(page);
                }
              }
            }
          }
          current.length = value;
        } else graph.put(current, key, graph.encode(value));
        return true;
      },
      deleteProperty(_target, key) {
        if (typeof key !== 'string' || key === 'length' && row().array) return false;
        const current = writable(), index = numeric(key);
        if (index === undefined) current.props.delete(key);
        else {
          const pages=current.pages!,page=Math.floor(index/pageWidth);
          if(pages.has(page)){
            const values=pages.edit(page,values=>Object.assign(fields(),values));delete values[key];
            // Monotonic identity tables must not retain one empty page for
            // every historical group of IDs while a few entries remain live.
            if(emptyFields(values))pages.delete(page);
          }
        }
        return true;
      },
      has(_target, key) { return typeof key === 'string' && (key === 'length' && row().array || graph.has(row(), key)) || !row().nullPrototype && key in (row().array ? Array.prototype : Object.prototype); },
      ownKeys() {
        const current = row(), result: string[] = [];
        current.pages!.forEach(values => result.push(...Object.keys(values)));
        if(current.array)result.push('length');
        current.props.forEach((_value,key)=>result.push(key)); return result;
      },
      getOwnPropertyDescriptor(_target, key) {
        if (key === 'length' && row().array) return { value: row().length, writable: true, enumerable: false, configurable: false };
        if (typeof key !== 'string' || !graph.has(row(), key)) return undefined;
        return { value: graph.decode(graph.get(row(), key)), writable: true, enumerable: true, configurable: true };
      },
      defineProperty(_target, key, d): boolean {
        if (!Object.hasOwn(d, 'value') || typeof key !== 'string' || key !== 'length' && (!d.configurable || !d.enumerable || !d.writable)) throw TypeError('Card properties must be mutable data');
        return Reflect.set(proxy, key, d.value);
      },
      setPrototypeOf() { throw TypeError('Card prototype is fixed'); },
      preventExtensions() { throw TypeError('Card state cannot be frozen'); },
    });
    this.views.set(id, proxy); proxies.set(proxy, { graph: this, id, reference: value,generation }); return proxy;
  }
  /** Conservative equality of complete current graphs. Reference IDs are
   * paired bijectively, preserving aliases/cycles across different allocations.
   * Immutable data is compared with the same alias guarantee. No root field
   * is omitted, including frames, queues and remaining execution budget. */
  sameCurrent(other:CardGraph<T>,check:()=>void,createdAfter?:number,contextAfter=0):boolean{
    if(!this.open||!other.open)throw Error('Closed card storage');
    check();
    // Equal lossless bytes plus the exact same external identity table prove
    // equality of the entire decoded graph. Unlike a digest, this is not a
    // candidate test. Only use the ownership boundary that encoded both data
    // images; a different comparison boundary needs the structural fallback.
    if(createdAfter===undefined&&this.parked&&other.parked&&this.parkedContextAfter===contextAfter&&other.parkedContextAfter===contextAfter&&
      sameGraphData(this.parked,other.parked)){
      if(this.parked.anchors.length!==other.parked.anchors.length||!this.parked.anchors.every((anchor,i)=>anchor===other.parked!.anchors[i]))return false;
      // The complete proof also permits sharing this immutable representation.
      // Each owner still decodes independently on access; closing either owner
      // does not release the other, and exported bytes remain detached.
      other.parked=this.parked;return true;
    }
    this.activate();other.activate();
    const pending:[Value,Value][]=[[this.rootValue,other.rootValue]],leftIds=new Map<number,number>(),rightIds=new Map<number,number>();let visited=0;
    const leftBlocks=new Map<object,object>(),rightBlocks=new Map<object,object>();
    const sameBlocks=(first:object,second:object):boolean=>{
      const work:[unknown,unknown][]=[[first,second]];
      while(work.length){
        if((visited++&255)===0)check();const [x,y]=work.pop()!;
        if(x===null||y===null||typeof x!=='object'||typeof y!=='object'){if(!Object.is(x,y))return false;continue;}
        // Context-owned values may be renamed with their complete alias
        // topology. External Program-held objects remain identity anchors.
        const fresh=createdAfter!==undefined&&(immutableRuleBirth(x)??0)>createdAfter&&(immutableRuleBirth(y)??0)>createdAfter;
        const contextual=isContextRuleValue(x)&&isContextRuleValue(y)&&(immutableRuleBirth(x)??0)>contextAfter&&(immutableRuleBirth(y)??0)>contextAfter;
        if(!fresh&&!contextual){if(x!==y)return false;continue;}
        if(leftBlocks.has(x)||rightBlocks.has(y)){if(leftBlocks.get(x)!==y||rightBlocks.get(y)!==x)return false;continue;}
        leftBlocks.set(x,y);rightBlocks.set(y,x);
        if(Object.getPrototypeOf(x)!==Object.getPrototypeOf(y))return false;
        const a=Reflect.ownKeys(x),b=Reflect.ownKeys(y);if(a.length!==b.length)return false;
        for(let i=0;i<a.length;i++){const key=a[i]!;if(key!==b[i])return false;work.push([(x as Record<PropertyKey,unknown>)[key],(y as Record<PropertyKey,unknown>)[key]]);}
      }
      return true;
    };
    const entries=(row:Row):[string,Value][]=>{const out:[string,Value][]=[];row.pages!.forEach(values=>{for(const key of Object.keys(values))out.push([key,values[key]!]);});row.props.forEach((value,key)=>out.push([key,value]));return out;};
    while(pending.length){
      if((visited++&255)===0)check();const [a,b]=pending.pop()!;
      if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){if(!Object.is(a,b))return false;continue;}
      if('block' in a||'block' in b){if(!('block' in a)||!('block' in b)||!sameBlocks(a.block,b.block))return false;continue;}
      if(leftIds.has(a.ref)||rightIds.has(b.ref)){if(leftIds.get(a.ref)!==b.ref||rightIds.get(b.ref)!==a.ref)return false;continue;}
      leftIds.set(a.ref,b.ref);rightIds.set(b.ref,a.ref);
      const left=this.rows.get(a.ref),right=other.rows.get(b.ref);if(!left||!right)throw Error('Missing card node');
      if(left===right){
        // Shared rows can still point at independently changed descendants.
        const visit=(value:Value)=>{if(value!==null&&typeof value==='object')pending.push([value,value]);};
        left.pages!.forEach(values=>{for(const value of Object.values(values))visit(value);});left.props.forEach(visit);continue;
      }
      if(left.array!==right.array||left.nullPrototype!==right.nullPrototype||left.length!==right.length)return false;
      const x=entries(left),y=entries(right);if(x.length!==y.length)return false;
      for(let i=0;i<x.length;i++){if(x[i]![0]!==y[i]![0])return false;pending.push([x[i]![1],y[i]![1]]);}
    }
    check();return true;
  }
  own<V>(value: V): V { this.activate();return this.decode(this.encode(value)); }
  export<V>(value: V): V { this.activate();return this.materialize(value); }
  snapshot(shareImmutable=false,contextAfter=0):{root:T;immutable:object[];nullPrototypes:object[];contextValues:object[]}{
    if(!this.open)throw Error('Closed card storage');
    const immutable:object[]=[],nullPrototypes:object[]=[],contextValues:object[]=[];
    // Saving an inactive current must not rebuild all execution indexes just
    // to export them again. Copy its data directly, retaining null-prototype
    // metadata, aliases and immutable ownership exactly as a live export does.
    const source=this.parked?unpackGraphImage<T>(this.parked):null;
    return{root:this.materialize(source?source.root:this.root,immutable,shareImmutable,nullPrototypes,contextValues,contextAfter,source?new Set(source.nullPrototypes):undefined),immutable,nullPrototypes,contextValues};
  }
  private materialize<V>(value: V, immutable?:object[],shareImmutable=false,nullPrototypes?:object[],contextValues?:object[],contextAfter=0,sourceNull?:ReadonlySet<object>): V {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw TypeError('Non-data export');
      return value;
    }
    const privateExport = !immutable && privateGraphs.has(this);
    if (privateExport && isImmutableRuleValue(value)) { const publication = new Publication(); return publication.finish(publication.borrow(value)); }
    const root = privateExport ? proxies.get(value) : undefined;
    if(root?.graph===this&&root.generation!==this.generation)throw Error('Released card view');
    if (!immutable && root?.graph === this && Object.getPrototypeOf(Array.prototype) === Object.prototype) return this.exportPrivate(root.id);
    const seen = new Map<object, any>();
    const marked=new Set<object>();
    const markContext=(value:object)=>{
      const pending=[value];
      while(pending.length){const next=pending.pop()!;if(marked.has(next))continue;marked.add(next);if(isContextRuleValue(next)&&(immutableRuleBirth(next)??0)>contextAfter)contextValues?.push(next);
        for(const child of Object.values(next))if(child!==null&&typeof child==='object')pending.push(child);
      }
    };
    const ids = new Map<number, any>();
    const plainArrayBase = arrayPrototypeIsPlain();
    const encoded = (value: Value): any => value !== null && typeof value === 'object' ? 'block' in value ? visit(value.block) : node(value.ref) : value;
    const node = (id: number): any => {
      if (ids.has(id)) return ids.get(id);
      const row = this.rows.get(id); if (!row) throw Error('Missing card node');
      const out = row.array ? new Array(row.length) : Object.create(row.nullPrototype&&!nullPrototypes ? null : Object.prototype); ids.set(id, out);
      if(row.nullPrototype)nullPrototypes?.push(out);
      const inherited = row.array ? Array.prototype : Object.prototype;
      const put = (key: string, value: Value) => {
        const item = encoded(value);
        if (row.array && !plainArrayBase || (!row.nullPrototype||nullPrototypes) && key in inherited) Object.defineProperty(out, key, { value: item, writable: true, configurable: true, enumerable: true });
        else out[key] = item;
      };
      row.pages!.forEach(values => { for (const key of Object.keys(values)) put(key, values[key]!); });
      row.props.forEach((value,key)=>put(key,value));
      return out;
    };
    const visit = (x: any): any => {
      if (x === null || typeof x !== 'object') { if (typeof x === 'function' || typeof x === 'symbol') throw TypeError('Non-data export'); return x; }
      if (seen.has(x)) return seen.get(x);
      // Search saves many sibling Contexts in one image. Preserve shared
      // frozen blocks in that image; only mutable containers need detaching.
      // The immutable references also survive serialization as admission data.
      if(immutable&&shareImmutable&&isImmutableRuleValue(x)){seen.set(x,x);immutable.push(x);markContext(x);return x;}
      const view = proxies.get(x);
      if (view && view.graph !== this) throw TypeError('Foreign card instance reference');
      if(view&&view.generation!==this.generation)throw Error('Released card view');
      if (view) return node(view.id);
      if (!view && types.isProxy(x)) throw TypeError('External proxy');
      const nullPrototype=Object.getPrototypeOf(x)===null||sourceNull?.has(x)===true;
      const out = Array.isArray(x) ? new Array(x.length) : Object.create(nullPrototype?(nullPrototypes?Object.prototype:null):Object.getPrototypeOf(x)); seen.set(x, out);
      if(nullPrototype)nullPrototypes?.push(out);
      if(immutable&&isImmutableRuleValue(x))immutable.push(out);
      if(contextValues&&isContextRuleValue(x)&&(immutableRuleBirth(x)??0)>contextAfter)contextValues.push(out);
      for (const key of Reflect.ownKeys(x)) {
        if (Array.isArray(x) && key === 'length') continue;
        if (typeof key !== 'string') throw TypeError('Symbol data');
        const d = Object.getOwnPropertyDescriptor(x, key)!;
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw TypeError('Non-data export');
        Object.defineProperty(out, key, { value: visit(d.value), writable: true, configurable: true, enumerable: true });
      }
      return out;
    };
    return visit(value);
  }
  /** The caller has established a managed root in a no-projection execution.
   * Each output remains private; scalar leaves may outlive their source row. */
  private exportPrivate<V>(root: number): V {
    const ids = new Map<number, any>();
    const publication = new Publication();
    const plainArrayBase = arrayPrototypeIsPlain();
    const node = (id: number): any => {
      if (ids.has(id)) { publication.tree = false; return ids.get(id); }
      const row = this.rows.get(id); if (!row) throw Error('Missing card node');
      const cached = Object.hasOwn(row, 'exportCache') ? row.exportCache : undefined;
      if (cached) {
        publication.add(cached.value, cached.dense);
        ids.set(id, cached.value); return cached.value;
      }
      // Private publications have the same ordinary DTO prototypes as copy().
      // Read-only adapters can borrow them without another normalization pass.
      const out: any = row.array ? new Array(row.length) : {}; ids.set(id, out);
      const inherited = row.array ? Array.prototype : Object.prototype;
      let leaf = true, indexed = 0;
      const put = (key: string, value: Value) => {
        let item: unknown = value;
        if (value !== null && typeof value === 'object') { leaf = false; item = 'block' in value ? publication.borrow(value.block) : node(value.ref); }
        if (row.array && !plainArrayBase || key in inherited) Object.defineProperty(out, key, { value: item, writable: true, configurable: true, enumerable: true });
        else out[key] = item;
      };
      row.pages!.forEach(values => { for (const key of Object.keys(values)) { indexed++; put(key, values[key]!); } });
      row.props.forEach((value,key)=>put(key,value));
      const localDense = !row.array || indexed === row.length && row.props.size === 0;
      publication.add(out, localDense);
      // A non-enumerable derived field stays out of COW clones, snapshots and
      // logical graph edges; this cache needs no global weak-table write.
      if (leaf) Object.defineProperty(row, 'exportCache', { value: { value: out, dense: localDense }, writable: true, configurable: true });
      return out;
    };
    return publication.finish(node(root));
  }
  fork(): CardGraph<T> {
    if(!this.open)throw Error('Closed card storage');
    if(this.parked){
      // The packed data and identity anchors are immutable. Each branch
      // decodes its own owned graph only when it actually resumes execution.
      const next=new CardGraph<T>(undefined as T);next.parked=this.parked;next.parkedContextAfter=this.parkedContextAfter;
      if(privateGraphs.has(this))privateGraphs.add(next);return next;
    }
    this.activate();
    const next = new CardGraph<T>(undefined as T); next.rows = this.rows.fork(); next.identity.next = this.identity.next; next.rootValue = this.rootValue;next.cleanImage=this.cleanImage;
    next.collectionAt = this.collectionAt; next.allocationAtBoundary = this.identity.next; this.epoch++;
    if (privateGraphs.has(this)) privateGraphs.add(next);
    return next;
  }
  private shade(value: Value): void {
    const cycle = this.collection;
    if (cycle && value !== null && typeof value === 'object' && 'ref' in value && !cycle.live.has(value.ref)) {
      cycle.live.add(value.ref); cycle.pending.push(value.ref);
    }
  }
  private beginCollection(): void {
    this.collection = { live: new Set(), pending: [], scan: null, sweep: 0, cutoff: this.identity.next };
    this.shade(this.rootValue);
  }
  private edges(row: Row): EdgeCursor {
    const props = row.props.valueCursor(), pages = row.pages?.cursor();
    let properties = true, keys: string[] = [], position = 0, page: Record<string, Value> | undefined;
    return { value: undefined, advance() {
      if (properties) { if (props.advance()) { this.value = props.value; return true; } properties = false; }
      if (position >= keys.length) {
        if (!pages?.advance()) return false;
        page = pages.value; keys = Object.keys(page); position = 0;
        // Even an emptied page consumes a bounded GC work unit.
        if (!keys.length) { this.value = undefined; return true; }
      }
      this.value = page![keys[position++]!]; return true;
    } };
  }
  /** Incremental tracing with an insertion barrier. Work is charged to new
   * allocations, never to fork or the first write to a large retained world. */
  private collectSlice(work: number): void {
    const cycle = this.collection!;
    while (work > 0) {
      if (cycle.scan) {
        const present = cycle.scan.advance(); work--;
        if (!present) cycle.scan = null; else this.shade(cycle.scan.value);
      } else if (cycle.pending.length) {
        const row = this.rows.get(cycle.pending.pop()!); work--;
        if (row) cycle.scan = this.edges(row);
      } else {
        // Reopen the radix iterator per slice; mutations cannot retain an old
        // tree traversal or skip newly detached pages in the next slice.
        let ended = true;
        const cursor = this.rows.cursor(cycle.sweep);
        while (cursor.advance()) {
          const id = cursor.key;
          if (id >= cycle.cutoff) break;
          cycle.sweep = id + 1;
          if (!cycle.live.has(id)) { this.rows.delete(id); this.views.delete(id); }
          if (--work <= 0) { ended = false; break; }
        }
        if (ended) {
          this.collection = null; this.epoch++;
          this.collectionAt = Math.max(2048, this.rows.size * 2 + 512);
          return;
        }
      }
    }
  }
  boundary(): void {
    this.activate();
    this.identity.originals = new WeakMap();
    const allocated = this.identity.next - this.allocationAtBoundary;
    this.allocationAtBoundary = this.identity.next;
    const writes=this.writesAtBoundary;this.writesAtBoundary=0;
    if (!this.collection && this.rows.size >= this.collectionAt) this.beginCollection();
    // Marking visits fields as well as rows. Paying only per new object cannot
    // keep up with wide live frames: the insertion barrier continually adds
    // more fields than the collector scans, so even dead rows never sweep.
    // Charge to actual writes; fork and first edit still do no world scan.
    if (this.collection) this.collectSlice(Math.max(256, allocated * 4 + writes * 2));
  }
  collect(): void {
    this.activate();
    this.beginCollection();
    while (this.collection) this.collectSlice(4096);
  }
  /** Short probability continuations fork again at the next random point.
   * Finish due collection there so child forks do not keep restarting it. */
  finishCollection(): void {
    this.activate();
    if (!this.collection && this.rows.size >= this.collectionAt) this.beginCollection();
    while (this.collection) this.collectSlice(4096);
  }
  close(): void { this.rows.clear(); this.views.clear(); this.collection = null; this.parked=null;this.cleanImage=null;this.rootValue=undefined;this.open=false;this.generation++;this.epoch++; }
  get nodeCount() { return this.rows.size; }
}
