import { transformSync } from '@babel/core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const globals = new Set(['undefined', 'NaN', 'Infinity', 'Math', 'Object', 'Array', 'Number', 'String', 'Boolean', 'JSON', 'Map', 'Set', 'BigInt', 'Symbol', 'RegExp', 'Error', 'TypeError', 'RangeError', 'module', 'exports']);
const forbidden = new Set(['eval', 'Function', 'process', 'global', 'globalThis', 'window', 'document', 'fetch', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'Date', 'Promise', 'WeakMap', 'WeakSet', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'require']);
const syntax = new Set('File Program Identifier StringLiteral NumericLiteral BooleanLiteral NullLiteral BigIntLiteral RegExpLiteral TemplateLiteral TemplateElement VariableDeclaration VariableDeclarator BlockStatement ExpressionStatement EmptyStatement ReturnStatement IfStatement SwitchStatement SwitchCase ThrowStatement TryStatement CatchClause BreakStatement ContinueStatement ForStatement ForInStatement ForOfStatement WhileStatement DoWhileStatement FunctionDeclaration FunctionExpression ArrowFunctionExpression CallExpression NewExpression MemberExpression OptionalMemberExpression OptionalCallExpression AwaitExpression YieldExpression SpreadElement RestElement AssignmentPattern AssignmentExpression UnaryExpression UpdateExpression BinaryExpression LogicalExpression ConditionalExpression SequenceExpression ObjectExpression ObjectProperty ObjectMethod ArrayExpression ArrayPattern ObjectPattern ClassDeclaration ClassExpression ClassBody ClassMethod ClassProperty Super ThisExpression MetaProperty ImportDeclaration ImportSpecifier ImportDefaultSpecifier ImportNamespaceSpecifier ExportNamedDeclaration ExportSpecifier ExportAllDeclaration ExportDefaultDeclaration LabeledStatement Directive DirectiveLiteral'.split(' '));
function mapLike(path: any, node: any, seen = new Set<string>()): boolean {
  if (!node) return false;
  if (node.type === 'NewExpression') return ['Map', 'Set'].includes(node.callee.name);
  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return false;
    seen.add(node.name);
    const binding = path.scope.getBinding(node.name);
    return mapLike(path, binding?.path.node.init, seen);
  }
  return false;
}
export function admitSource(source: string, filename: string): void {
  const visitor = () => ({
    visitor: {
      Program(path: any) {
        path.traverse({
          enter(child: any) {
            if (child.node.type === 'Identifier' && ['__tick', '__remaining', '__bearBudgetExceeded', '__bearHostViolation', '__bearCapabilities'].includes(child.node.name)) throw child.buildCodeFrameError('Reserved execution identifier');
            if (!syntax.has(child.node.type) && !child.node.type.startsWith('TS')) throw child.buildCodeFrameError('Unsupported author syntax ' + child.node.type);
          }
        });
      },
      ThisExpression(path: any) {
        let scope = path.getFunctionParent();
        while (scope?.isArrowFunctionExpression()) scope = scope.parentPath.getFunctionParent();
        if (!scope && !path.findParent((p: any) => p.isClassBody())) throw path.buildCodeFrameError('Top-level ambient this is not admitted');
      },
      ImportDeclaration(path: any) {
        if (/^(node:|https?:|data:)/.test(path.node.source.value)) throw path.buildCodeFrameError('External host dependency is forbidden');
      },
      ImportExpression(path: any) {
        throw path.buildCodeFrameError('Dynamic dependency is forbidden');
      },
      ExportNamedDeclaration(path: any) {
        if (path.node.source && /^(node:|https?:|data:)/.test(path.node.source.value)) throw path.buildCodeFrameError('External host dependency is forbidden');
      },
      ExportAllDeclaration(path: any) {
        if (/^(node:|https?:|data:)/.test(path.node.source.value)) throw path.buildCodeFrameError('External host dependency is forbidden');
      },
      CallExpression(path: any) {
        if (path.node.callee.type === 'Import' || path.node.callee.name === 'require') throw path.buildCodeFrameError('Dynamic dependency is forbidden');
        const callee = path.node.callee;
        if (callee.type === 'MemberExpression' && ['values', 'keys', 'entries'].includes(callee.property.name)) {
          if (mapLike(path, callee.object)) {
            const parent = path.parentPath.node;
            const materialized = parent.type === 'SpreadElement' || parent.type === 'CallExpression' && parent.callee.type === 'MemberExpression' && parent.callee.object.name === 'Array' && parent.callee.property.name === 'from';
            if (!materialized) throw path.buildCodeFrameError('Native Map/Set iterators must be materialized before a suspension');
          }
        }
      },
      ReferencedIdentifier(path: any) {
        const name = path.node.name;
        const binding = path.scope.getBinding(name);
        if (binding && !binding.path.node?.declare && !binding.path.parentPath?.node?.declare) return;
        if (forbidden.has(name) || !globals.has(name)) throw path.buildCodeFrameError('Undeclared capability ' + name);
      },
      MemberExpression(path: any) {
        const node = path.node;
        const name = node.computed && node.property.type === 'StringLiteral' ? node.property.value : !node.computed ? node.property.name : null;
        if (['__proto__', 'constructor', 'prototype', 'eval'].includes(name)) throw path.buildCodeFrameError('Prototype/capability escape is forbidden');
        if (node.object.name === 'Math' && name === 'random') throw path.buildCodeFrameError('Implicit random entropy is forbidden');
      },
      ObjectMethod(path: any) {
        if (path.node.kind === 'get' || path.node.kind === 'set') throw path.buildCodeFrameError('Author accessors are not admitted');
      },
      ClassMethod(path: any) {
        if (path.node.kind === 'get' || path.node.kind === 'set') throw path.buildCodeFrameError('Author accessors are not admitted');
      },
      ForOfStatement(path: any) {
        if (mapLike(path, path.node.right)) {
          let suspension = false;
          path.traverse({
            AwaitExpression() {
              suspension = true;
            }
          });
          if (suspension) throw path.buildCodeFrameError('Map/Set iteration across suspension is not admitted');
        }
      },
      WithStatement(path: any) {
        throw path.buildCodeFrameError('with is forbidden');
      }
    }
  });
  transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [[require('@babel/plugin-transform-typescript'), {
      onlyRemoveTypeImports: true
    }], visitor]
  });
}
