import test from 'node:test';
import assert from 'node:assert/strict';
import {CardGraph,privateCardGraph} from '../src/graph.ts';
import type {CowStore} from '../src/cow-index.ts';

/** Observe physical storage, since exported values cannot expose empty pages. */
function numericPages<T>(graph:CardGraph<T>):number{
  const {rows}=graph as unknown as {rows:CowStore<{pages:CowStore<unknown>|null}>};
  let count=0;rows.forEach(row=>{count+=row.pages?.size??0;});return count;
}

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
