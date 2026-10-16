import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const t = require('@babel/types');
const upstream = require('@babel/plugin-transform-optional-chaining');
const assumptions = { noDocumentAll: false, pureGetters: false };

/** Retain Babel's nullish-chain control flow, but express reference calls with
 * our existing invocation operation instead of observable .call/.bind reads. */
export function optionalCalls() {
  return { visitor: { 'OptionalCallExpression|OptionalMemberExpression'(path: any) {
    const receiverCalls: { node: any; argumentCount: number }[] = [];
    let chain = path.node;
    while (t.isOptionalCallExpression(chain) || t.isOptionalMemberExpression(chain)) {
      if (t.isOptionalCallExpression(chain)) {
        if (chain.optional && (t.isMemberExpression(chain.callee) || t.isOptionalMemberExpression(chain.callee))) {
          receiverCalls.push({ node: chain, argumentCount: chain.arguments.length });
        }
        chain = chain.callee;
      } else chain = chain.object;
    }

    const parent = path.parentPath;
    if (path.isOptionalMemberExpression() && parent.isCallExpression() && parent.node.callee === path.node) {
      // Parentheses end short-circuiting but retain a property reference. A null
      // chain must still evaluate the outer call's arguments before throwing.
      const scope = path.scope, receiver = scope.generateUidIdentifier('receiver');
      const reference = scope.generateUidIdentifier('callReference');
      scope.push({ id: receiver }); scope.push({ id: reference });
      const pair = (fn: any, self: any) => t.objectExpression([
        t.objectProperty(t.identifier('fn'), fn), t.objectProperty(t.identifier('self'), self)
      ]);
      const args = parent.node.arguments;
      upstream.transformOptionalChain(path, assumptions, path,
        pair(t.unaryExpression('void', t.numericLiteral(0)), t.unaryExpression('void', t.numericLiteral(0))),
        (member: any) => {
          if (!t.isMemberExpression(member)) throw path.buildCodeFrameError('Optional-chain lowering lost member reference');
          return t.sequenceExpression([
            t.assignmentExpression('=', t.cloneNode(receiver), member.object),
            pair(t.memberExpression(t.cloneNode(receiver), member.property, member.computed), t.cloneNode(receiver))
          ]);
        });
      parent.replaceWith(t.sequenceExpression([
        t.assignmentExpression('=', t.cloneNode(reference), path.node),
        t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('invoke')), [
          t.memberExpression(t.cloneNode(reference), t.identifier('fn')),
          t.memberExpression(t.cloneNode(reference), t.identifier('self')), t.arrayExpression(args)
        ])
      ]));
    } else upstream.transform(path, assumptions);

    // These are exact original optional-call node identities, not matches on
    // emitted temporary names or an author's call property.
    for (const { node, argumentCount } of receiverCalls) {
      const callee = node.callee;
      if (!t.isMemberExpression(callee) || callee.computed || !t.isIdentifier(callee.property, { name: 'call' })
          || node.arguments.length !== argumentCount + 1) throw path.buildCodeFrameError('Optional-chain lowering changed the receiver-call contract');
      const [self, ...args] = node.arguments;
      node.callee = t.memberExpression(t.identifier('__bearOps'), t.identifier('invoke'));
      node.arguments = [callee.object, self, t.arrayExpression(args)];
    }
  } } };
}
