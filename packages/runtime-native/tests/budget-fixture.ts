import { z } from 'zod';
export const program = {
  schemas: {
    setup: z.enum(['join-coercion-loop', 'join-getter-loop', 'sparse-callback-loop', 'sparse-search-loop', 'sparse-write-loop', 'concat-loop', 'flat-map-nested-loop', 'slice-loop', 'flat-loop', 'splice-delete-loop', 'splice-left-loop', 'splice-right-loop', 'array-callback-loop', 'typed-callback-loop', 'apply-list-loop', 'reflect-apply-list-loop', 'reflect-construct-list-loop', 'typed-from-loop', 'typed-construct-loop', 'typed-from-list-loop', 'typed-construct-list-loop', 'loop', 'spread-loop', 'collection-loop', 'collection-map-loop', 'collection-weak-map-loop', 'collection-weak-set-loop', 'array-from-loop', 'from-entries-loop', 'object-group-loop', 'map-group-loop', 'promise-all-loop', 'promise-settled-loop', 'promise-any-loop', 'promise-race-loop', 'aggregate-construct-loop', 'aggregate-call-loop']),
    result: z.number(),
    ports: {}
  },
  async run(mode: string) {
    if (mode === 'join-coercion-loop' || mode === 'join-getter-loop') {
      function spin() { for (let index=0;index<200000;index++) {} return 'x'; }
      try {
        if (mode === 'join-coercion-loop') [{toString:spin}].join(',');
        else Array.prototype.join.call({length:1,get 0(){return spin();}},',');
      } catch {}
      return 4;
    }
    if (mode === 'sparse-callback-loop' || mode === 'sparse-search-loop' || mode === 'sparse-write-loop' || mode === 'concat-loop' || mode === 'flat-map-nested-loop') {
      const source={length:200000};
      try {
        if (mode === 'sparse-callback-loop') Reflect.apply(Array.prototype.forEach,source,[Math.abs]);
        else if (mode === 'sparse-search-loop') Reflect.apply(Array.prototype.includes,source,[7]);
        else if (mode === 'sparse-write-loop') Reflect.apply(Array.prototype.fill,source,[7]);
        else if (mode === 'concat-loop') [].concat({length:200000,[Symbol.isConcatSpreadable]:true} as any);
        else [1].flatMap(()=>Array(200000));
      } catch {}
      return 4;
    }
    if (mode === 'slice-loop' || mode === 'flat-loop' || mode === 'splice-delete-loop' || mode === 'splice-left-loop' || mode === 'splice-right-loop') {
      const source={length:200000};
      try {
        if (mode === 'slice-loop') Reflect.apply(Array.prototype.slice,source,[]);
        else if (mode === 'flat-loop') Reflect.apply(Array.prototype.flat,source,[]);
        else if (mode === 'splice-delete-loop') Reflect.apply(Array.prototype.splice,source,[0,200000]);
        else if (mode === 'splice-left-loop') Reflect.apply(Array.prototype.splice,source,[0,1]);
        else Reflect.apply(Array.prototype.splice,source,[0,0,7]);
      } catch {}
      return 4;
    }
    if (mode === 'array-callback-loop' || mode === 'typed-callback-loop') {
      try {
        const values = mode === 'array-callback-loop' ? Array(200000).fill(1) : new Uint8Array(200000);
        values.forEach(Math.abs);
      } catch {}
      return 4;
    }
    if (mode === 'apply-list-loop' || mode === 'reflect-apply-list-loop' || mode === 'reflect-construct-list-loop') {
      const list: any = {length:200000};
      function target() { return {}; }
      try {
        if (mode === 'apply-list-loop') target.apply(null,list);
        else if (mode === 'reflect-apply-list-loop') Reflect.apply(target,null,list);
        else Reflect.construct(target,list);
      } catch {}
      return 4;
    }
    if (mode === 'typed-from-loop' || mode === 'typed-construct-loop' || mode === 'typed-from-list-loop' || mode === 'typed-construct-list-loop') {
      const source: any = mode === 'typed-from-list-loop' || mode === 'typed-construct-list-loop'
        ? {length:200000} : {next:Object.prototype.valueOf,value:7,[Symbol.iterator](){return this;}};
      try {
        if (mode === 'typed-from-loop' || mode === 'typed-from-list-loop') Uint8Array.from(source);
        else new Uint8Array(source);
      } catch {}
      return 4;
    }
    if (mode === 'aggregate-construct-loop' || mode === 'aggregate-call-loop') {
      const iterable: any = {next:Object.prototype.valueOf,value:7,[Symbol.iterator](){return this;}};
      try {
        if (mode === 'aggregate-construct-loop') new AggregateError(iterable);
        else AggregateError(iterable);
      } catch {}
      return 4;
    }
    if (mode === 'promise-all-loop' || mode === 'promise-settled-loop' || mode === 'promise-any-loop' || mode === 'promise-race-loop') {
      const iterable: any = {next:Object.prototype.valueOf,value:7,[Symbol.iterator](){return this;}};
      try {
        if (mode === 'promise-all-loop') await Promise.all(iterable);
        else if (mode === 'promise-settled-loop') await Promise.allSettled(iterable);
        else if (mode === 'promise-any-loop') await Promise.any(iterable);
        else await Promise.race(iterable);
      } catch {}
      return 4;
    }
    if (mode === 'array-from-loop' || mode === 'from-entries-loop' || mode === 'object-group-loop' || mode === 'map-group-loop') {
      const iterable: any = {next:Object.prototype.valueOf,value:['key',7],[Symbol.iterator](){return this;}};
      try {
        if (mode === 'array-from-loop') Array.from(iterable);
        else if (mode === 'from-entries-loop') Object.fromEntries(iterable);
        else if (mode === 'object-group-loop') (Object as any).groupBy(iterable,()=>0);
        else (Map as any).groupBy(iterable,()=>0);
      } catch {}
      return 4;
    }
    try {
      if (mode === 'collection-map-loop' || mode === 'collection-weak-map-loop' || mode === 'collection-weak-set-loop') {
        const Constructor: new (iterable: any) => object = mode === 'collection-map-loop' ? Map : mode === 'collection-weak-map-loop' ? WeakMap : WeakSet;
        const iterable: any = { next: Object.prototype.valueOf,
          value: mode === 'collection-weak-set-loop' ? {} : [{}, 7],
          [Symbol.iterator]() { return this; } };
        try { new Constructor(iterable); } catch {}
        return 4;
      }
      if (mode === 'collection-loop') {
        const iterable: any = { [Symbol.iterator]() { return { next: Object }; } };
        new Set(iterable);
      } else if (mode === 'spread-loop') {
        const iterable: any = { [Symbol.iterator]() { return { next: Object }; } };
        const values = [...iterable];
      } else {
        let count = 0;
        while (true) count++;
      }
    } catch {}
    return 4;
  }
};
