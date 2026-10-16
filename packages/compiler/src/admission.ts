import { transformSync } from '@babel/core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const forbidden = new Set(['eval', 'process', 'global', 'window', 'document', 'fetch', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'require', 'module', 'exports', '__filename', '__dirname']);
const syntax = new Set('File Program Identifier StringLiteral NumericLiteral BooleanLiteral NullLiteral BigIntLiteral RegExpLiteral TemplateLiteral TemplateElement VariableDeclaration VariableDeclarator BlockStatement ExpressionStatement EmptyStatement ReturnStatement IfStatement SwitchStatement SwitchCase ThrowStatement TryStatement CatchClause BreakStatement ContinueStatement ForStatement ForInStatement ForOfStatement WhileStatement DoWhileStatement FunctionDeclaration FunctionExpression ArrowFunctionExpression CallExpression NewExpression MemberExpression OptionalMemberExpression OptionalCallExpression AwaitExpression YieldExpression SpreadElement RestElement AssignmentPattern AssignmentExpression UnaryExpression UpdateExpression BinaryExpression LogicalExpression ConditionalExpression SequenceExpression ObjectExpression ObjectProperty ObjectMethod ArrayExpression ArrayPattern ObjectPattern ClassDeclaration ClassExpression ClassBody StaticBlock ClassMethod ClassProperty ClassPrivateMethod ClassPrivateProperty PrivateName Super ThisExpression MetaProperty ImportAttribute ImportDeclaration ImportSpecifier ImportDefaultSpecifier ImportNamespaceSpecifier ExportNamedDeclaration ExportSpecifier ExportNamespaceSpecifier ExportAllDeclaration ExportDefaultDeclaration LabeledStatement Directive DirectiveLiteral'.split(' '));
/** A policy rejection is not an ECMAScript parse error. Keep that distinction
 * through Babel diagnostics so callers cannot satisfy a negative language test
 * with an unsupported capability or syntax-policy rejection. */
export class AuthorAdmissionError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthorAdmissionError'; }
}
const authorParseErrors = new WeakSet<Error>();
export function isAuthorParseError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError && authorParseErrors.has(error);
}
export function admitSource(source: string, filename: string, mode: 'standalone' | 'linked' = 'linked'): {hasTopLevelAwait:boolean;hasModuleResources:boolean} {
  if (!/\.(?:js|mjs|ts|mts)$/.test(filename)) throw new AuthorAdmissionError('ESM source format required: ' + filename);
  let hasTopLevelAwait = false, hasModuleResources = false;
  function dependency(path: any, value: string): void {
    if (value.includes('\0')) throw path.buildCodeFrameError('Invalid module specifier', AuthorAdmissionError);
    if (/^(node:|https?:|data:)/.test(value)) throw path.buildCodeFrameError('External host dependency is forbidden', AuthorAdmissionError);
  }
  function hasArguments(path: any): boolean {
    for (let scope = path.scope; scope; scope = scope.parent) {
      if (scope.path.isFunction() && !scope.path.isArrowFunctionExpression()) return true;
    }
    return false;
  }
  function localAssignment(path: any, node: any): void {
    if (!node) return;
    if (node.type === 'Identifier' && forbidden.has(node.name) && !path.scope.getBinding(node.name)) throw path.buildCodeFrameError('Undeclared capability ' + node.name, AuthorAdmissionError);
    if (node.type === 'ArrayPattern') for (const value of node.elements) localAssignment(path, value);
    if (node.type === 'ObjectPattern') for (const property of node.properties) localAssignment(path, property.type === 'RestElement' ? property.argument : property.value);
    if (node.type === 'AssignmentPattern') localAssignment(path, node.left);
    if (node.type === 'RestElement') localAssignment(path, node.argument);
  }
  const visitor = () => ({
    visitor: {
      Program(path: any) {
        path.traverse({
          enter(child: any) {
            if (child.node.type === 'Identifier' && ['__tick', '__remaining', '__bearBudgetExceeded', '__bearHostViolation', '__bearCapabilities', '__bearModule', '__bearExports', '__bearOps'].includes(child.node.name)) throw child.buildCodeFrameError('Reserved execution identifier', AuthorAdmissionError);
            if (!syntax.has(child.node.type) && !child.node.type.startsWith('TS')) throw child.buildCodeFrameError('Unsupported author syntax ' + child.node.type, AuthorAdmissionError);
          }
        });
      },
      ImportDeclaration(path: any) {
        if (mode === 'standalone') throw path.buildCodeFrameError('Use compileEntry for module dependencies', AuthorAdmissionError);
        if (path.node.phase != null)
          throw path.buildCodeFrameError('Unsupported import phase ' + path.node.phase, AuthorAdmissionError);
        dependency(path, path.node.source.value);
      },
      ImportExpression(path: any) {
        throw path.buildCodeFrameError('Dynamic dependency is forbidden', AuthorAdmissionError);
      },
      MetaProperty(path: any) {
        if (!(path.node.meta.name === 'new' && path.node.property.name === 'target') &&
            !(path.node.meta.name === 'import' && path.node.property.name === 'meta')) {
          throw path.buildCodeFrameError('Ambient module metadata is not admitted', AuthorAdmissionError);
        }
      },
      ExportNamedDeclaration(path: any) {
        if (path.node.source) {
          if (mode === 'standalone') throw path.buildCodeFrameError('Use compileEntry for module dependencies', AuthorAdmissionError);
          dependency(path, path.node.source.value);
        }
      },
      ExportAllDeclaration(path: any) {
        if (mode === 'standalone') throw path.buildCodeFrameError('Use compileEntry for module dependencies', AuthorAdmissionError);
        dependency(path, path.node.source.value);
      },
      CallExpression(path: any) {
        if (path.node.callee.type === 'Import') throw path.buildCodeFrameError('Dynamic dependency is forbidden', AuthorAdmissionError);
        if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'Function' && !path.scope.getBinding('Function'))
          throw path.buildCodeFrameError('Dynamic code construction is forbidden', AuthorAdmissionError);
      },
      NewExpression(path: any) {
        if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'Function' && !path.scope.getBinding('Function'))
          throw path.buildCodeFrameError('Dynamic code construction is forbidden', AuthorAdmissionError);
      },
      ReferencedIdentifier(path: any) {
        const name = path.node.name;
        const binding = path.scope.getBinding(name);
        if (binding && !binding.path.node?.declare && !binding.path.parentPath?.node?.declare) return;
        if (name === 'arguments' && hasArguments(path)) return;
        if (forbidden.has(name) || name === 'arguments') throw path.buildCodeFrameError('Undeclared capability ' + name, AuthorAdmissionError);
      },
      AssignmentExpression(path: any) { localAssignment(path, path.node.left); },
      VariableDeclaration(path: any) {
        if (['using','await using'].includes(path.node.kind) && !path.scope.getFunctionParent()) hasModuleResources = true;
        if (path.node.kind === 'await using' && !path.scope.getFunctionParent()) hasTopLevelAwait = true;
        if (!['var', 'let', 'const', 'using', 'await using'].includes(path.node.kind))
          throw path.buildCodeFrameError('Unsupported declaration kind ' + path.node.kind, AuthorAdmissionError);
      },
      UpdateExpression(path: any) { localAssignment(path, path.node.argument); },
      ForInStatement(path: any) { localAssignment(path, path.node.left); },
      AwaitExpression(path: any) {
        // Computed method keys execute in the enclosing scope, even though an
        // ObjectMethod/ClassMethod is their syntactic ancestor.
        if (!path.scope.getFunctionParent()) hasTopLevelAwait = true;
      },
      ForOfStatement(path: any) {
        localAssignment(path, path.node.left);
        if (path.node.await && !path.scope.getFunctionParent()) hasTopLevelAwait = true;
      },
      WithStatement(path: any) {
        throw path.buildCodeFrameError('with is forbidden', AuthorAdmissionError);
      }
    }
  });
  try {
    transformSync(source, {
      filename,
      sourceType: 'module',
      configFile: false,
      babelrc: false,
      // Recognize module-phase grammar before policy checking. Parsing support
      // does not authorize loading or evaluating those module phases.
      parserOpts: { plugins: ['deferredImportEvaluation', 'sourcePhaseImports'] },
      plugins: /\.(?:ts|tsx|mts|cts)$/.test(filename)
        ? [[require('@babel/plugin-transform-typescript'), {onlyRemoveTypeImports:true}], visitor]
        : [visitor]
    });
  } catch (error) {
    // Missing parser support says nothing about the source's grammatical
    // validity. In particular it must not satisfy an expected early error.
    if (error instanceof SyntaxError && (error as SyntaxError & {missingPlugin?:unknown}).missingPlugin !== undefined)
      throw new AuthorAdmissionError(error.message);
    // Later transformation passes also parse generated code. Only errors from
    // this original-source admission pass describe an author parse failure.
    if (error instanceof SyntaxError && (error as SyntaxError & {code?:string}).code === 'BABEL_PARSE_ERROR')
      authorParseErrors.add(error);
    throw error;
  }
  return {hasTopLevelAwait,hasModuleResources};
}
