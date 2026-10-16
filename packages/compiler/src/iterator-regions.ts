import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');

/** Destructuring records live in an activation-local stack. Protect complete
 * existing lexical regions, rather than moving individual declarations into a
 * new scope or wrapping author expressions in async functions. */
export function iteratorRegions() {
  const operation = (name: string, args: any[]) => t.callExpression(
    t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
  function wrap(path: any) {
    const stack = path.node.extra?.bearIteratorStack;
    if (!stack) return;
    delete path.node.extra.bearIteratorStack;
    const stackRef = () => t.cloneNode(stack);
    function protectedBlock(body: any[], depth: any) {
      const error = path.scope.generateUidIdentifier('iteratorError');
      const drain = (throwing: boolean) => t.expressionStatement(operation('iteratorDrain', [
        stackRef(), t.cloneNode(depth), t.booleanLiteral(throwing)
      ]));
      return t.tryStatement(t.blockStatement(body), t.catchClause(error, t.blockStatement([
        drain(true), t.throwStatement(t.cloneNode(error))
      ])), t.blockStatement([drain(false)]));
    }
    // Protect the nearest existing exception region of each opening. An outer
    // region does not need another cleanup if all its openings are protected
    // by inner regions. Retain semantic AST identity, never helper-name matches.
    const blocks = new Set<any>();
    path.traverse({
      Function(inner: any) { inner.skip(); },
      CallExpression(inner: any) {
        if (!inner.node.extra?.bearIteratorOpen) return;
        delete inner.node.extra.bearIteratorOpen;
        let region = inner.parentPath;
        while (region && region !== path) {
          if (region.isBlockStatement() && (region.parentPath.isTryStatement() || region.parentPath.isCatchClause())) break;
          region = region.parentPath;
        }
        if (!region) throw inner.buildCodeFrameError('Iterator opening lost its activation');
        blocks.add(region === path ? path.isProgram() ? path.node : path.node.body : region.node);
      }
    });
    if (blocks.size === 0) throw path.buildCodeFrameError('Iterator activation lost its opening metadata');
    const body = path.isProgram() ? path.node : path.node.body;
    if (!t.isProgram(body) && !t.isBlockStatement(body)) throw path.buildCodeFrameError('Iterator activation has no statement body');
    for (const block of blocks) {
      if (block === body) {
        block.body = [protectedBlock(block.body, t.numericLiteral(0))];
        continue;
      }
      const depth = path.scope.generateUidIdentifier('iteratorDepth');
      block.body = [t.variableDeclaration('const', [t.variableDeclarator(depth,
        t.memberExpression(stackRef(), t.identifier('length')))]), protectedBlock(block.body, depth)];
    }
    body.body.unshift(t.variableDeclaration('var', [t.variableDeclarator(stackRef(), t.arrayExpression([]))]));
    path.scope.crawl();
  }
  return { visitor: { Function: { exit: wrap }, Program: { exit: wrap } } };
}
