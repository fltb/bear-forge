import test from 'node:test';
import assert from 'node:assert/strict';
import {CardGraph,privateCardGraph} from '../src/graph.ts';
import type {CowStore} from '../src/cow-index.ts';

/** Observe physical storage, since exported values cannot expose empty pages. */
function numericPages<T>(graph:CardGraph<T>):number{
  const {rows}=graph as unknown as {rows:CowStore<{pages:CowStore<unknown>|null}>};
  let count=0;rows.forEach(row=>{count+=row.pages?.size??0;});return count;
}

function numericStores<T>(graph:CardGraph<T>):number{
  const {rows}=graph as unknown as {rows:CowStore<{pages:CowStore<unknown>|null}>};
  let count=0;rows.forEach(row=>{if(row.pages)count++;});return count;
}

test('named records and hole-only arrays allocate numeric storage only when a branch writes an index',()=>{
  const record:Record<string,string|number>={label:'record'};
  const items=Object.assign(new Array<number>(129),{label:'holes'});
  const parent=privateCardGraph({record,items}),child=parent.fork();
  try{
    const before=child.export(child.root);
    assert.equal(numericStores(parent),0);assert.equal(numericStores(child),0);
    assert.equal(child.root.record[7],undefined);assert.equal(7 in child.root.record,false);
    assert.equal(child.root.items[128],undefined);assert.equal(Object.hasOwn(child.root.items,128),false);
    delete child.root.record[7];delete child.root.items[128];
    child.root.items.length=0;child.root.items.length=129;
    assert.deepEqual(Object.keys(child.root.record),['label']);
    assert.deepEqual(Reflect.ownKeys(child.root.items),['length','label']);
    assert.equal(numericStores(child),0,'reads, absent deletes and sparse length changes need no numeric storage');

    child.root.record[0]=7;child.root.items[128]=9;
    assert.deepEqual(Object.keys(child.root.record),['0','label']);
    assert.deepEqual(Object.keys(child.root.items),['128','label']);
    assert.equal(numericStores(parent),0);
    assert.equal(parent.root.record[0],undefined);assert.equal(parent.root.items[128],undefined);
    assert.equal(before.record[0],undefined);assert.equal(Object.hasOwn(before.items,128),false);
    parent.root.record.label='parent';
    child.collect();parent.collect();
    assert.deepEqual(child.export(child.root.record),{0:7,label:'record'});
    assert.equal(child.export(child.root.items)[128],9);
    assert.equal(child.root.items.label,'holes');assert.equal(parent.root.record.label,'parent');
  }finally{child.close();parent.close();}
});

test('empty numeric storage history does not change graph equality, aliases or restored holes',()=>{
  const record:Record<string,string|number>={label:'retained'};
  const items=Object.assign(new Array<number>(129),{label:'holes'});
  const parent=privateCardGraph({record,alias:record,items}),child=parent.fork();
  try{
    child.root.record[64]=1;delete child.root.record[64];
    child.root.items[128]=2;child.root.items.length=0;child.root.items.length=129;
    assert.equal(numericStores(parent),0);
    assert.equal(numericPages(child),0);
    child.collect();parent.collect();
    assert.equal(parent.sameCurrent(child,()=>{}),true);
    assert.equal(child.sameCurrent(parent,()=>{}),true);
    const published=child.export(child.root);
    assert.equal(published.record,published.alias);
    assert.deepEqual(Object.keys(published.items),['label']);assert.equal(published.items.length,129);

    const saved=child.snapshot(),restored=new CardGraph(saved.root,saved.immutable,saved.nullPrototypes,saved.contextValues);
    try{
      restored.collect();
      assert.equal(restored.root.record,restored.root.alias);
      assert.equal(Object.hasOwn(restored.root.items,128),false);
      assert.equal(restored.sameCurrent(parent,()=>{}),true);
      assert.deepEqual(restored.export(restored.root),published);
      restored.root.alias[5]=3;
      assert.equal(restored.root.record[5],3);assert.equal(child.root.record[5],undefined);
    }finally{restored.close();}
  }finally{child.close();parent.close();}
});

test('rolling numeric identities retain only live pages and isolate parent and child deletion',()=>{
  const parent=privateCardGraph({table:{0:0,1:1} as Record<number,number>}),child=parent.fork();
  try{
    const table=child.root.table;
    // The table never becomes empty: two adjacent identities stay alive while
    // historical identities cross 128 page boundaries.
    for(let next=2;next<=8192;next++){
      table[next]=next;delete table[next-2];
      if((next&63)===0)assert.ok(numericPages(child)<=2,`empty pages survived through identity ${next}`);
    }
    assert.deepEqual(child.export(table),{8191:8191,8192:8192});assert.equal(numericPages(child),2);
    assert.deepEqual(parent.export(parent.root.table),{0:0,1:1});assert.equal(numericPages(parent),1);
    delete parent.root.table[0];delete parent.root.table[1];
    assert.equal(numericPages(parent),0);assert.deepEqual(child.export(table),{8191:8191,8192:8192});
    const sibling=child.fork();
    try{
      delete table[8191];delete table[8192];
      assert.equal(numericPages(child),0);assert.equal(numericPages(sibling),2);
      assert.deepEqual(sibling.export(sibling.root.table),{8191:8191,8192:8192});
    }finally{sibling.close();}
  }finally{child.close();parent.close();}
});

test('empty boundary pages are reclaimed without shortening sparse arrays or restoring holes',()=>{
  const items=Object.assign(new Array<number>(8193),{label:'retained','4294967295':9});
  items[5]=5;items[70]=70;items[8192]=8192;
  const parent=privateCardGraph({items}),child=parent.fork();
  try{
    const array=child.root.items;
    delete array[5];
    assert.equal(numericPages(child),2);assert.equal(array.length,8193);assert.equal(Object.hasOwn(array,5),false);
    // 70 is inside its 64-entry page. Its only element is discarded, so the
    // boundary page must disappear along with the distant complete page.
    array.length=70;
    assert.equal(numericPages(child),0);assert.equal(array.length,70);
    assert.deepEqual(Object.keys(array),['label','4294967295']);
    array.length=8193;
    for(const id of [5,64,69,70,8192])assert.equal(Object.hasOwn(array,id),false);
    array[64]=64;array[65]=65;array.length=65;
    assert.equal(numericPages(child),1);assert.equal(array[64],64);assert.equal(Object.hasOwn(array,65),false);
    array.length=64;
    assert.equal(numericPages(child),0);assert.equal(array.length,64);
    assert.equal(array.label,'retained');assert.equal(array['4294967295'],9);
    assert.equal(numericPages(parent),3);assert.equal(parent.root.items.length,8193);
    for(const id of [5,70,8192])assert.equal(parent.root.items[id],id);
  }finally{child.close();parent.close();}
});
