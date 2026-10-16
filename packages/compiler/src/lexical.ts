import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');

/** Explicit lexical binding operations survive continuation lowering. Generated
 * slot variables are ordinary compiler locals; authors never manage these cells. */
export function lexicalBindings() {
  const op = (name: string, args: any[]) => {
    const call = t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
    // Only this closed set cannot invoke author conversion methods or suspend.
    if (['lexicalCreate', 'lexicalInitialize', 'lexicalRead', 'lexicalWrite', 'lexicalCopy', 'immutableWrite'].includes(name)) call.extra = { bearSynchronousIntrinsic: true };
    return call;
  };
  const id = (value: any) => t.cloneNode(value);
  return { visitor: { Program(program: any) {
    // A for-in/of binding is initialized anew after each acquired value. RHS
    // lexical-head references have already been handled by the syntax pass.
    program.traverse({ ForXStatement(path: any) {
      const left = path.node.left;
      if (t.isVariableDeclaration(left) && left.kind === 'var') return;
      if (t.isVariableDeclaration(left) && (left.declarations.length !== 1 || !t.isIdentifier(left.declarations[0].id))) throw path.buildCodeFrameError('Unlowered iteration binding');
      const value = path.scope.generateUidIdentifier('iterationBinding');
      path.node.left = t.variableDeclaration('var', [t.variableDeclarator(id(value))]);
      const bind = t.isVariableDeclaration(left)
        ? t.variableDeclaration(left.kind, [t.variableDeclarator(left.declarations[0].id, id(value))])
        : t.expressionStatement(t.assignmentExpression('=', left, id(value)));
      path.node.body = t.blockStatement([bind, path.node.body]);
    } });
    program.scope.crawl();
    type Entry = { binding: any; slot: any; initial: any; declaration: any; loop?: any; mutable: boolean };
    const entries = new Map<any, Entry>();
    const declarations = new Set<any>();
    const loopEntries = new Map<any, Entry[]>();
    const scopes = new Map<any, Entry[]>();
    // A straight-line earlier declaration dominates a later statement, including
    // function-expression creation there. Hoisted functions and loop-initializer
    // captures are deliberately excluded from this proof. Unknown flow retains
    // explicit records; no source/package identity participates.
    function dominates(declaration: any, binding: any, usage: any): boolean {
      const header = declaration.parentPath.isForStatement() && declaration.key === 'init';
      let nestedFunction = false;
      for (let current = usage; current && current !== declaration.parentPath; current = current.parentPath) {
        if (current.isFunctionDeclaration()) return false;
        if (current.isFunction()) nestedFunction = true;
        if (current.parentPath === declaration) {
          if (header && nestedFunction) return false;
          return current.isVariableDeclarator() && current.key > binding.path.key;
        }
        if (current.parentPath === declaration.parentPath) {
          if (header) return current.key !== 'init';
          return current.listKey === declaration.listKey && typeof current.key === 'number'
            && typeof declaration.key === 'number' && current.key > declaration.key;
        }
      }
      return false;
    }
    program.traverse({ VariableDeclaration(path: any) {
      if (path.node.kind === 'var') return;
      const proven = path.node.declarations.every((decl: any) => {
        if (!t.isIdentifier(decl.id) || !decl.init) return false;
        const binding = path.scope.getBinding(decl.id.name);
        if (!binding || path.node.kind === 'const' && binding.constantViolations.length) return false;
        return [...binding.referencePaths, ...binding.constantViolations].every(usage => dominates(path, binding, usage));
      });
      if (proven) return;
      declarations.add(path);
      const loop = path.parentPath.isForStatement() && path.key === 'init' ? path.parentPath : undefined;
      for (const decl of path.node.declarations) {
        if (!t.isIdentifier(decl.id)) throw path.buildCodeFrameError('Unlowered lexical pattern');
        const binding = path.scope.getBinding(decl.id.name);
        if (!binding) throw path.buildCodeFrameError('Missing lexical binding');
        const slot = path.scope.generateUidIdentifier(decl.id.name + 'Binding');
        const entry = { binding, slot, initial: loop ? path.scope.generateUidIdentifier(decl.id.name + 'Initial') : slot,
          declaration: path, loop, mutable: path.node.kind === 'let' };
        entries.set(binding, entry);
        const collection = loop ? loopEntries : scopes;
        const owner = loop ?? binding.scope.path;
        if (!collection.has(owner)) collection.set(owner, []);
        collection.get(owner)!.push(entry);
      }
    } });
    const lookup = (path: any, name: string) => entries.get(path.scope.getBinding(name));
    const shadowedFunctionNames = new WeakMap<object, Map<string, boolean>>();
    const functionName = (path: any, name: string) => {
      const binding = path.scope.getBinding(name);
      if (binding?.kind !== 'local' || !binding.path.isFunctionExpression()) return false;
      const expression = binding.path;
      let names = shadowedFunctionNames.get(expression.node);
      if (!names) { names = new Map(); shadowedFunctionNames.set(expression.node, names); }
      if (!names.has(name)) {
        let shadowed = false;
        expression.get('body').traverse({
          Function(inner: any) { inner.skip(); },
          VariableDeclarator(declaration: any) {
            if (declaration.parentPath.node.kind === 'var' && name in t.getBindingIdentifiers(declaration.node.id)) shadowed = true;
          }
        });
        names.set(name, shadowed);
      }
      return !names.get(name);
    };
    const slotAt = (entry: Entry, path: any) => id(entry.loop && (path === entry.declaration || path.findParent((p: any) => p === entry.declaration)) ? entry.initial : entry.slot);
    program.traverse({
      ReferencedIdentifier(path: any) {
        const entry = lookup(path, path.node.name);
        if (!entry) return;
        const parent = path.parentPath;
        if (parent.isAssignmentExpression() && parent.node.left === path.node || parent.isUpdateExpression()) return;
        if (parent.isObjectProperty() && parent.node.shorthand && path.key === 'value') {
          parent.node.shorthand = false; parent.node.computed = true;
          parent.node.key = t.stringLiteral(parent.node.key.name);
        }
        path.replaceWith(op('lexicalRead', [slotAt(entry, path)])); path.skip();
      },
      AssignmentExpression: { exit(path: any) {
        if (!t.isIdentifier(path.node.left)) return;
        const entry = lookup(path, path.node.left.name);
        const immutable = functionName(path, path.node.left.name);
        if (!entry && !immutable) return;
        const { operator, right, left } = path.node;
        const read = () => entry ? op('lexicalRead', [slotAt(entry, path)]) : id(left);
        const write = (value: any) => entry ? op('lexicalWrite', [slotAt(entry, path), value])
          : op('immutableWrite', [value, t.booleanLiteral(true)]);
        path.replaceWith(operator === '=' ? write(right)
          : ['&&=', '||=', '??='].includes(operator) ? t.logicalExpression(operator.slice(0, -1), read(), write(right))
          : write(t.binaryExpression(operator.slice(0, -1), read(), right)));
        path.skip();
      } },
      UpdateExpression: { exit(path: any) {
        if (!t.isIdentifier(path.node.argument)) return;
        const entry = lookup(path, path.node.argument.name);
        const immutable = functionName(path, path.node.argument.name);
        if (!entry && !immutable) return;
        const args = [entry ? slotAt(entry, path) : id(path.node.argument),
          t.valueToNode(path.node.operator === '++' ? 1 : -1), t.booleanLiteral(path.node.prefix)];
        if (immutable) args.push(t.booleanLiteral(true));
        path.replaceWith(op(entry ? 'lexicalUpdate' : 'immutableUpdate', args));
        path.skip();
      } }
    });
    // Read all declaration metadata before replacing paths/removing bindings.
    const initialized = new Map<any, any[]>();
    for (const path of declarations) initialized.set(path, path.node.declarations.map((decl: any) => {
      const entry = entries.get(path.scope.getBinding(decl.id.name));
      if (!entry) throw path.buildCodeFrameError('Lost lexical declaration');
      return op('lexicalInitialize', [id(entry.initial), decl.init ?? t.unaryExpression('void', t.numericLiteral(0))]);
    }));
    for (const path of declarations) {
      if (path.parentPath.isForStatement() && path.key === 'init') continue;
      path.replaceWith(t.expressionStatement(t.sequenceExpression(initialized.get(path)!)));
    }
    const replacements = new Map<any, any>();
    const create = (entry: Entry) => t.variableDeclarator(id(entry.initial), op('lexicalCreate', [t.booleanLiteral(entry.mutable)]));
    for (const [owner, bindings] of scopes) {
      const declaration = t.variableDeclaration('let', bindings.map(create));
      if (owner.isFunction() || owner.isCatchClause()) owner.get('body').unshiftContainer('body', declaration);
      else if (owner.isProgram() || owner.isBlockStatement()) owner.unshiftContainer('body', declaration);
      else if (owner.isSwitchStatement()) {
        replacements.set(owner.node, t.blockStatement([declaration, owner.node]));
      } else throw owner.buildCodeFrameError('Unsupported lexical environment owner');
    }
    for (const [loop, bindings] of loopEntries) {
      const init = initialized.get(bindings[0]!.declaration)!;
      loop.node.init = t.variableDeclaration('let', bindings.map(entry => t.variableDeclarator(id(entry.slot), op('lexicalCopy', [id(entry.initial)]))));
      const copies = bindings.filter(entry => entry.mutable).map(entry => t.assignmentExpression('=', id(entry.slot), op('lexicalCopy', [id(entry.slot)])));
      if (copies.length) loop.node.update = t.sequenceExpression([...copies, ...(loop.node.update ? [loop.node.update] : [])]);
      let labelled = loop;
      while (labelled.parentPath.isLabeledStatement()) labelled = labelled.parentPath;
      replacements.set(labelled.node, t.blockStatement([
        t.variableDeclaration('let', bindings.map(create)),
        t.expressionStatement(t.sequenceExpression(init)), labelled.node
      ]));
    }
    program.traverse({ exit(path: any) {
      const replacement = replacements.get(path.node);
      if (!replacement) return;
      replacements.delete(path.node); path.replaceWith(replacement); path.skip();
    } });
    program.scope.crawl();
  } } };
}
