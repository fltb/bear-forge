import { evaluateQuery } from './rules-queries.ts';
import type { Query } from './rules-query.types.ts';
import type { Borrowed, Builder, Command, Input, Local, ReadView, Statement, Value } from './rules.types.ts';
import { expression, readExpression, slots, statements, handle } from './rules-internal.ts';
import type { Node, Owner } from './rules-internal.ts';
function makeStatement(node: Node): Statement { const value = handle<Statement>(); statements.set(value,node); return value; }
/** Construct one lexical scope while linking. Kept private to the authoring/linker implementation. */
export function createBuilder<I, O>(owner: Owner, allocated: Map<object, string>): Builder<I, O> {
  return Object.freeze({
    input: expression<I>(owner, c => c.input),
    local<T>(): Local<T> {
      const value = expression<T>(owner, c => {
        const key = c.slots.get(value);
        if (key === undefined || !Object.hasOwn(c.locals, key)) throw Error('Uninitialized rule local');
        return c.locals[key];
      }) as Local<T>;
      slots.set(value, owner); allocated.set(value, 'v' + allocated.size); return value;
    },
    assign<T>(slot: Local<T>, value: Input<T> | Command<T>): Statement {
      if (slots.get(slot) !== owner) throw Error('Foreign rule local');
      return makeStatement({ kind: 'assign', slot, value });
    },
    read<T>(fn: (view: ReadView<I>) => T): Value<T> {
      if (typeof fn !== 'function') throw Error('Rule read requires an expression');
      return expression<T>(owner, context => {
        const result = fn(Object.freeze({ input: context.input as Borrowed<I>,
          get: <V>(value: Value<V>): Borrowed<V> => readExpression(value, context),
          query:<A,B>(definition:Query<A,B>,input:Borrowed<A>):Borrowed<B>=>evaluateQuery(definition,input,context.world,context.bindings),
        }));
        if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('Rule read must be synchronous');
        return result;
      },{source:fn.toString()});
    },
    return(value: Input<O>): Statement { return makeStatement({ kind: 'return', value }); },
  });
}
