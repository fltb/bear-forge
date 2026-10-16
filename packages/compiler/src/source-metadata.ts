import {takeCallableOrigin, assertCallableOriginsConsumed, type SourceOrigins} from './source-origins.ts';
import {preserveAssignmentName} from './import-writes.ts';
import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');

/** Capture identity before any lowering. Metadata belongs to compiler nodes,
 * never to author-visible properties or guessed emitted function names. */
export function captureSourceRanges() { return captureRanges(); }
export function captureLinkedSourceRanges(origins:SourceOrigins) { return captureRanges(origins); }
function captureRanges(origins?:SourceOrigins) {
  return { visitor: { Program(path: any) {
    const tokens = path.hub.file.ast.tokens;
    const positions = new Map(tokens.map((token: any, index: number) => [token.start, index]));
    path.traverse({ 'Function|Class'(p: any) {
      if(!origins)preserveAssignmentName(p.parentPath.node);
      if(!origins&&!p.node.id&&p.parentPath.isExportDefaultDeclaration())
        p.node.extra={...p.node.extra,bearInferredName:'default'};
      const original=origins?takeCallableOrigin(p,origins):undefined;
      let start = p.node.start;
      if ((p.isClassMethod() || p.isClassPrivateMethod()) && p.node.static) {
        let index = Number(positions.get(start)) + 1;
        while (typeof tokens[index]?.type === 'string') index++;
        start = tokens[index].start;
      }
      p.node.extra = { ...p.node.extra, bearSourceRange: original ?? [start+(origins?.text.length??0), p.node.end+(origins?.text.length??0)], bearArrow: p.isArrowFunctionExpression(), bearAsync: p.node.async === true, bearGeneratorKind: p.node.generator ? (p.node.async ? 'async' : 'sync') : undefined };
    } });
    if(origins)assertCallableOriginsConsumed(path);
  } } };
}

/** Babel parameter lowering rewrites arrows to ordinary functions after
 * capturing their lexical this/arguments/new.target. Retain nonconstructibility
 * with an actual method, without wrapping calls or changing function identity. */
export function nativeArrowKinds() {
  return { visitor: { FunctionExpression: { exit(path: any) {
    const node = path.node;
    if (!node.extra?.bearArrow) return;
    const method = t.objectMethod('method', t.identifier('method'), node.params, node.body, false, node.generator, node.async);
    method.extra = node.extra;
    const expression = t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('nameFunction')), [
      t.memberExpression(t.objectExpression([method]), t.identifier('method')), t.stringLiteral('')
    ]);
    expression.extra = { bearAnonymousCallable: true };
    path.replaceWith(expression);
    path.skip();
  } } } };
}

function parameterWrapperKind(node: any): 'sync' | 'async' | 'async-function' | undefined {
  if (!node.generator && node.extra?.bearGeneratorKind) return node.extra.bearGeneratorKind;
  if (!node.async && node.extra?.bearAsync && !node.extra.bearGeneratorKind) return 'async-function';
}
/** Native functions retain V8 identity; register their original source when
 * instantiated. Declarations are registered at lexical scope entry, before
 * any author statement can reflect on a hoisted declaration. */
export function registerNativeSources(sourceName: string) {
  const op = (name: string, args: any[]) => t.callExpression(
    t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
  return { visitor: { Program(program: any) {
    const initializers = new Map<any, any[]>();
    program.traverse({
      Function: { exit(path: any) {
        const range = path.node.extra?.bearSourceRange;
        if (!range || path.isObjectMethod()) return;
        const wrapperKind = parameterWrapperKind(path.node);
        const register = (fn: any) => op('rememberSource', [fn, t.identifier(sourceName), ...range.map(t.numericLiteral),
          ...(wrapperKind ? [t.stringLiteral(wrapperKind)] : [])]);
        if (!path.isFunctionDeclaration()) {
          const fn = path.node;
          delete fn.extra.bearSourceRange;
          if (wrapperKind && fn.id) {
            // A named expression's immutable self binding must denote the
            // public callable, not its hidden eager-parameter implementation.
            const name = fn.id.name, self = path.scope.generateUidIdentifier('callableSelf');
            const binding = path.scope.getBinding(name);
            if (binding?.kind === 'local' && binding.path.node === fn) binding.scope.rename(name, self.name);
            fn.id = null;
            path.replaceWith(t.callExpression(t.arrowFunctionExpression([], t.blockStatement([
              t.variableDeclaration('const', [t.variableDeclarator(t.cloneNode(self), register(op('nameFunction', [fn, t.stringLiteral(name)])))]),
              t.returnStatement(t.cloneNode(self))
            ])), []));
            path.skip(); return;
          }
          path.replaceWith(register(fn)); path.skip(); return;
        }
        if (!path.node.id) throw path.buildCodeFrameError('Native declaration lost its binding');
        let owner = path.parentPath;
        if (owner.isExportDeclaration()) owner = owner.parentPath;
        if (owner.isSwitchCase()) owner = owner.parentPath;
        if (!owner.isProgram() && !owner.isBlockStatement() && !owner.isSwitchStatement()) {
          throw path.buildCodeFrameError('Native declaration lost its lexical scope');
        }
        if (!initializers.has(owner)) initializers.set(owner, []);
        const expression = register(t.cloneNode(path.node.id));
        initializers.get(owner)!.push(wrapperKind ? t.assignmentExpression('=', t.cloneNode(path.node.id), expression) : expression);
      } },
      ObjectExpression: { exit(path: any) {
        const entries = path.node.properties.filter((p: any) => p.type === 'ObjectMethod' && p.extra?.bearSourceRange);
        if (!entries.length) return;
        const descriptions = entries.map((p: any) => {
          // Accessor/class lowering has already materialized each method in a
          // plain, noncomputed container. Never reevaluate an authored key.
          if (p.computed) throw path.buildCodeFrameError('Native method lost its materialized key');
          const range = p.extra.bearSourceRange;
          delete p.extra.bearSourceRange;
          const wrapperKind = parameterWrapperKind(p);
          return t.arrayExpression([t.stringLiteral(String(p.key.name ?? p.key.value)), t.stringLiteral(p.kind), ...range.map(t.numericLiteral),
            ...(wrapperKind ? [t.stringLiteral(wrapperKind)] : [])]);
        });
        path.replaceWith(op('rememberObjectSources', [path.node, t.identifier(sourceName), t.arrayExpression(descriptions)]));
        path.skip();
      } }
    });
    for (const [scope, expressions] of initializers) {
      if (!scope.isSwitchStatement()) {
        scope.unshiftContainer('body', expressions.map((expression: any) => t.expressionStatement(expression)));
        continue;
      }
      // Switch declarations are initialized after the discriminant, before
      // case tests. Register once at the first tested case or entered body:
      // fall-through may reassign a declaration binding, so re-registering it
      // later would incorrectly attach old source to the replacement function.
      const initialized = scope.scope.generateUidIdentifier('sourcesInitialized');
      const initialize = () => t.logicalExpression('||', t.cloneNode(initialized), t.sequenceExpression([
        ...expressions.map((x: any) => t.cloneNode(x, true)), t.assignmentExpression('=', t.cloneNode(initialized), t.booleanLiteral(true))
      ]));
      for (const clause of scope.node.cases) {
        if (clause.test) clause.test = t.sequenceExpression([initialize(), clause.test]);
        clause.consequent.unshift(t.expressionStatement(initialize()));
      }
      scope.replaceWith(t.blockStatement([
        t.variableDeclaration('let', [t.variableDeclarator(t.cloneNode(initialized), t.booleanLiteral(false))]), scope.node
      ]));
    }
  } } };
}
