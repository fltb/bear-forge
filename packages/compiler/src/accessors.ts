import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');
const ReplaceSupers = createRequire(import.meta.url)('@babel/helper-replace-supers').default;
/** Lower accessors in the existing lexical scope; never introduce a function
 * around an author's property initializers or suspension points. */
export function lowerAccessors() {
  const generated = new WeakSet<object>();
  const anonymousProperty = (p: any) => p.type === 'ObjectProperty' &&
    (p.value.extra?.bearAnonymousCallable || t.isArrowFunctionExpression(p.value) || t.isFunctionExpression(p.value) && !p.value.id);
  const operation = (name: string, args: any[]) => t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
  return {
    visitor: {
      ObjectExpression: {
        exit(path: any, state: any) {
          if (generated.has(path.node)) return;
          const homes = new Map<any, any>();
          for (const method of path.get('properties')) {
            if (!method.isObjectMethod()) continue;
            let usesSuper = false;
            method.traverse({ Super() { usesSuper = true; } });
            if (!usesSuper) continue;
            const home = path.scope.generateUidIdentifier('home');
            new ReplaceSupers({ methodPath: method, file: state.file, objectRef: home }).replace();
            homes.set(method.node, home);
          }
          // A literal prototype must enter the logical heap before it can be
          // shared. Native literal allocation otherwise pins the initial
          // prototype in V8's object shape after later logical replacement.
          if (!path.node.properties.some((p: any) => p.type === 'ObjectMethod' || p.type === 'SpreadElement' || anonymousProperty(p)
            || p.type === 'ObjectProperty' && !p.computed && !p.shorthand && (p.key.name ?? p.key.value) === '__proto__')) return;
          const object = path.scope.generateUidIdentifier('object');
          path.scope.push({ id: t.cloneNode(object) });
          const expressions = [t.assignmentExpression('=', t.cloneNode(object), t.objectExpression([]))];
          for (const p of path.node.properties) {
            if (p.type === 'SpreadElement') {
              expressions.push(operation('objectSpread', [t.cloneNode(object), p.argument]));
              continue;
            }
            const key = p.computed ? operation('propertyKey', [p.key]) : t.stringLiteral(String(p.key.name ?? p.key.value));
            let value = p.value;
            if (p.type === 'ObjectMethod') {
              const method = t.objectMethod('method', t.identifier('method'), p.params, p.body, false, p.generator, p.async);
              method.extra = p.extra;
              const container = t.objectExpression([method]);
              generated.add(container);
              value = t.memberExpression(container, t.identifier('method'));
            }
            const home = homes.get(p);
            if (home) value = t.callExpression(t.functionExpression(null, [home], t.blockStatement([t.returnStatement(value)])), [t.cloneNode(object)]);
            if (p.type === 'ObjectProperty' && !p.computed && !p.shorthand && key.value === '__proto__') {
              expressions.push(operation('literalPrototype', [t.cloneNode(object), value]));
              continue;
            }
            if (p.type === 'ObjectMethod' || anonymousProperty(p)) {
              expressions.push(operation('defineMethod', [t.cloneNode(object), key, value, t.stringLiteral(p.type === 'ObjectMethod' ? p.kind : 'method')]));
              continue;
            }
            expressions.push(operation('literalProperty', [t.cloneNode(object), key, value]));
          }
          expressions.push(t.cloneNode(object));
          path.replaceWith(t.sequenceExpression(expressions));
        }
      }
    }
  };
}

/** Preserve method kind as compiler metadata, never as an author-visible flag. */
export function lowerMethods() {
  return { visitor: {
    ObjectMethod(path: any) {
      const node = path.node;
      if (node.kind !== 'method') throw path.buildCodeFrameError('Accessors must be lowered before methods');
      const fn = t.functionExpression(null, node.params, node.body, node.generator, node.async);
      fn.extra = { ...node.extra, bearMethod: true };
      const key = node.computed ? node.key : t.stringLiteral(String(node.key.name ?? node.key.value));
      path.replaceWith(t.objectProperty(key, fn, true));
    },
    ObjectProperty(path: any) {
      if (path.node.shorthand) {
        path.node.key = t.stringLiteral(path.node.key.name);
        path.node.computed = true;
      }
      path.node.shorthand = false;
    }
  } };
}
