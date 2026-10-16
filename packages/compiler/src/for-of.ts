import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');

/** All for-in/of forms retain their RHS lexical head environment. Synchronous
 * for-of uses the guarded iterator records without array/legacy shortcuts. */
export function lowerForOf() {
  const op = (name: string, args: any[]) => t.callExpression(
    t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
  return { visitor: { ForXStatement(path: any) {
    const { left, body } = path.node;
    const record = path.scope.generateUidIdentifier('forIterator');
    const value = path.scope.generateUidIdentifier('forValue');
    const throwing = path.scope.generateUidIdentifier('forThrowing');
    const error = path.scope.generateUidIdentifier('forError');
    const head = t.isVariableDeclaration(left) && left.kind !== 'var'
      ? Object.keys(t.getBindingIdentifiers(left)).map(name => path.scope.getBinding(name)) : [];
    const uninitialized = path.scope.generateUidIdentifier('loopHead');
    let retainsHead = false;
    if (head.length) {
      if (head.some(binding => !binding)) throw path.buildCodeFrameError('Iteration lost its lexical head binding');
      const replace = (reference: any) => {
        if (!reference.isIdentifier() || !head.includes(reference.scope.getBinding(reference.node.name))) return;
        if (!reference.isReferencedIdentifier() && !reference.isBindingIdentifier()) return;
        retainsHead = true;
        if (reference.parentPath.isObjectProperty() && reference.key === 'value') reference.parentPath.node.shorthand = false;
        reference.replaceWith(t.memberExpression(t.cloneNode(uninitialized), t.identifier('value')));
      };
      const rhs = path.get('right');
      if (rhs.isIdentifier()) replace(rhs);
      else rhs.traverse({ Identifier: replace });
    }
    if (path.isForInStatement() || path.node.await) {
      // RHS evaluation has its own uninitialized lexical head, distinct from
      // the bindings subsequently initialized for each iteration.
      if (retainsHead) {
        let replacement = path;
        while (replacement.parentPath.isLabeledStatement()) replacement = replacement.parentPath;
        const loop = replacement.node;
        replacement.replaceWith(t.blockStatement([
          t.variableDeclaration('var', [t.variableDeclarator(t.cloneNode(uninitialized), op('uninitializedCell', []))]),
          loop
        ]));
        replacement.scope.crawl();
      }
      return;
    }
    const ref = () => t.cloneNode(record);
    const assignment = t.isVariableDeclaration(left)
      ? t.variableDeclaration(left.kind, [t.variableDeclarator(left.declarations[0].id, t.cloneNode(value))])
      : t.expressionStatement(t.assignmentExpression('=', left, t.cloneNode(value)));
    let loop = t.forStatement(null, t.sequenceExpression([
      t.assignmentExpression('=', t.cloneNode(value), op('iteratorStep', [ref()])),
      t.unaryExpression('!', t.memberExpression(ref(), t.identifier('done')))
    ]), null, t.blockStatement([assignment, body]));
    // Labels must still target the loop, so labelled continue stays within the
    // protected iteration and labelled break exits through IteratorClose.
    let replacement = path;
    while (replacement.parentPath.isLabeledStatement()) {
      replacement = replacement.parentPath;
      loop = t.labeledStatement(t.cloneNode(replacement.node.label), loop);
    }
    replacement.replaceWith(t.blockStatement([
      t.variableDeclaration('var', [
        ...(retainsHead ? [t.variableDeclarator(t.cloneNode(uninitialized), op('uninitializedCell', []))] : []),
        t.variableDeclarator(ref(), op('iteratorOpen', [path.node.right])),
        t.variableDeclarator(t.cloneNode(value)),
        t.variableDeclarator(t.cloneNode(throwing), t.booleanLiteral(false))
      ]),
      t.tryStatement(t.blockStatement([loop]), t.catchClause(error, t.blockStatement([
        t.expressionStatement(t.assignmentExpression('=', t.cloneNode(throwing), t.booleanLiteral(true))),
        t.throwStatement(t.cloneNode(error))
      ])), t.blockStatement([t.expressionStatement(op('iteratorClose', [ref(), t.cloneNode(throwing)]))]))
    ]));
    replacement.scope.crawl();
  } } };
}
