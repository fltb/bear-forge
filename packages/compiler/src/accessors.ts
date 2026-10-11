import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');
/** Preserve evaluation/key order while lowering literal accessors, which are used
 * by Zod internally. Author boundary data still rejects accessors. */
export function lowerAccessors() {
  return {
    visitor: {
      ObjectExpression: {
        exit(path: any) {
          if (!path.node.properties.some((p: any) => p.type === 'ObjectMethod' && (p.kind === 'get' || p.kind === 'set'))) return;
          const object = path.scope.generateUidIdentifier('object');
          const statements = [t.variableDeclaration('const', [t.variableDeclarator(object, t.objectExpression([]))])];
          for (const p of path.node.properties) {
            if (p.type === 'SpreadElement') throw path.buildCodeFrameError('Spread must be lowered first');
            const key = p.computed ? p.key : t.stringLiteral(p.key.name ?? p.key.value);
            const value = p.type === 'ObjectMethod' ? t.functionExpression(null, p.params, p.body, p.generator, p.async) : p.value;
            statements.push(t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('defineProperty')), [object, key, t.objectExpression([t.objectProperty(t.identifier(p.kind === 'get' || p.kind === 'set' ? p.kind : 'value'), value), ...(p.kind === 'get' || p.kind === 'set' ? [] : [t.objectProperty(t.identifier('writable'), t.booleanLiteral(true))]), t.objectProperty(t.identifier('enumerable'), t.booleanLiteral(true)), t.objectProperty(t.identifier('configurable'), t.booleanLiteral(true))])])));
          }
          statements.push(t.returnStatement(object));
          path.replaceWith(t.callExpression(t.functionExpression(null, [], t.blockStatement(statements)), []));
        }
      }
    }
  };
}
