import {CowStore} from './cow-index.ts';

type Property<T>={value:T;order:number};
const cloneProperty=<T>(entry:Property<T>):Property<T>=>({value:entry.value,order:entry.order});

/** Property names are interned metadata only. Values and insertion order belong
 * to each branch. A sibling learning a name never adds a property here. */
export class CowProperties<T> {
  private names=new Map<string,number>();
  private values=new CowStore<Property<T>>();
  private order=new CowStore<string>();
  private next=0;
  get size():number{return this.values.size;}
  get(key:string):T|undefined{const id=this.names.get(key);return id===undefined?undefined:this.values.get(id)?.value;}
  has(key:string):boolean{const id=this.names.get(key);return id!==undefined&&this.values.has(id);}
  set(key:string,value:T):void{
    let id=this.names.get(key);if(id===undefined){id=this.names.size;this.names.set(key,id);}
    if(this.values.has(id)){this.values.edit(id,cloneProperty).value=value;return;}
    const order=this.next++;
    this.order.set(order,key);this.values.set(id,{value,order});
  }
  delete(key:string):void{const id=this.names.get(key),entry=id===undefined?undefined:this.values.get(id);if(entry){this.values.delete(id!);this.order.delete(entry.order);}}
  fork():CowProperties<T>{const result=new CowProperties<T>();result.names=this.names;result.values=this.values.fork();result.order=this.order.fork();result.next=this.next;return result;}
  forEach(visit:(value:T,key:string)=>void):void{this.order.forEach(key=>visit(this.get(key)!,key));}
  /** GC only needs values, so it does not walk the insertion-order index too. */
  valueCursor():{value:T;advance():boolean}{const cursor=this.values.cursor();return{value:undefined as T,advance(){if(!cursor.advance())return false;this.value=cursor.value.value;return true;}};}
  *entries():IterableIterator<[string,T]>{for(const [,key]of this.order.entries())yield[key,this.get(key)!];}
}
