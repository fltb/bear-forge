import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import { TraceMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping';
const t = createRequire(import.meta.url)('@babel/types');

function functionName(path: any): string | undefined {
  if (path.node.id) return path.node.id.name;
  const parent = path.parentPath;
  if (parent.isExportDefaultDeclaration()) return 'default';
  const node = parent.node;
  const binding = parent.isVariableDeclarator() && node.init === path.node ? node.id
    : (parent.isAssignmentPattern() || parent.isAssignmentExpression() && ['=', '&&=', '||=', '??='].includes(node.operator)) && node.right === path.node ? node.left : undefined;
  return t.isIdentifier(binding) ? binding.name : undefined;
}

/** Linking may rename bindings, but Function.name is a language-observable
 * value. Recover authored names from source positions, never generated spelling.
 * Source content is compiler input metadata, not a runtime snapshot dependency. */
export function linkedNames(sourceMap: any) {
  const map = new TraceMap(sourceMap);
  const originals = new Map<string, Map<string, string>>();
  function originalName(node: any): string | undefined {
    if (!node.loc) return;
    const position = originalPositionFor(map, node.loc.start);
    if (!position.source || position.line === null || position.column === null) return;
    let names = originals.get(position.source);
    if (!names) {
      names = new Map(); originals.set(position.source, names);
      const content = sourceContentFor(map, position.source);
      if (content === null) throw new Error('Linked source map omitted original source content');
      transformSync(content, {
        filename: position.source, configFile: false, babelrc: false, code: false,
        parserOpts: { sourceType: 'module', plugins: ['typescript'] },
        plugins: [() => ({ visitor: {
          'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|Class'(path: any) {
            const name = functionName(path);
            if (name !== undefined) names!.set(`${path.node.loc.start.line}:${path.node.loc.start.column}`, name);
          }
        } })]
      });
    }
    return names.get(`${position.line}:${position.column}`);
  }
  return { visitor: { Program(program: any) {
    const initializers = new Map<any, any[]>();
    program.traverse({ 'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|Class': { exit(path: any) {
      const name = originalName(path.node);
      if (name === undefined || name === functionName(path)) return;
      const rename = (value: any) => t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('nameFunction')),
        [value, t.stringLiteral(name)]);
      if (path.isClass()) {
        // Class names are observable during static initialization. Restore the
        // name before authored static fields/blocks, preserving later overrides.
        path.node.body.body.unshift(t.staticBlock([t.expressionStatement(t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier('nameClass')), [t.thisExpression(), t.stringLiteral(name)]))]));
        return;
      }
      if (!path.isFunctionDeclaration()) {
        path.replaceWith(rename(path.node)); path.skip(); return;
      }
      if (!path.node.id) path.node.id = path.scope.generateUidIdentifier('defaultFunction');
      let owner = path.parentPath;
      if (owner.isExportDeclaration()) owner = owner.parentPath;
      if (!owner.isProgram() && !owner.isBlockStatement()) throw path.buildCodeFrameError('Linked function declaration lost its initialization scope');
      if (!initializers.has(owner)) initializers.set(owner, []);
      initializers.get(owner)!.push(t.expressionStatement(rename(t.cloneNode(path.node.id))));
    } } });
    // Declarations are initialized before their scope executes. Put restoration
    // ahead of every module body so cyclic imports observe the original name.
    for (const [scope, statements] of initializers) scope.unshiftContainer('body', statements);
  } } };
}
