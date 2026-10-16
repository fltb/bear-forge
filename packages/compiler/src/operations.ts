import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('@babel/types');

/** Bind compiler helper semantics to guarded operations through Babel's helper
 * API. This does not inspect or replace author identifiers. */
export function runtimeHelpers() {
  return { pre(this: any) {
    const previous = this.file.get('helperGenerator');
    const operations = new Map([
      ['superPropGet', 'superProperty'], ['toPropertyKey', 'propertyKey'], ['toPrimitive', 'toPrimitive'],
      ['objectWithoutProperties', 'objectRest']
    ]);
    this.file.set('helperGenerator', (name: string) => {
      const operation = operations.get(name);
      return operation ? t.memberExpression(t.identifier('__bearOps'), t.identifier(operation)) : previous?.(name);
    });
  } };
}

/** Run after syntax lowering and before continuation conversion. Temporary
 * references are plain data and therefore survive IO inside an expression. */
export function guardedOperations(_api?: unknown, options: {allocations?: boolean; script?: boolean} = {}) {
  const op = (name: string, args: any[]) => t.callExpression(t.memberExpression(t.identifier('__bearOps'), t.identifier(name)), args);
  // Author modules always use strict writes. Script mode is for the trusted
  // Test262 harness adapter, not an additional source-admission mode.
  const strict = (path: any) => t.booleanLiteral(!options.script || path.isInStrictMode());
  const allocation = (node: any) => options.allocations ? op('allocation', [node]) : node;
  const reference = (node: any) => op('memberReference', [node.object, node.computed ? node.property : t.stringLiteral(node.property.name)]);
  function temporary(path: any) {
    const id = path.scope.generateUidIdentifier('reference');
    path.scope.push({ id });
    return id;
  }
  function list(path: any, elements: any[]) {
    if (!elements.some(element => t.isSpreadElement(element))) return t.arrayExpression(elements);
    const result = temporary(path);
    return t.sequenceExpression([
      t.assignmentExpression('=', t.cloneNode(result), allocation(t.arrayExpression([]))),
      ...elements.map(element => element === null ? op('arrayHole', [t.cloneNode(result)])
        : t.isSpreadElement(element) ? op('arraySpread', [t.cloneNode(result), element.argument])
        : op('arrayAppend', [t.cloneNode(result), element])),
      t.cloneNode(result)
    ]);
  }
  return { visitor: {
    SwitchStatement: { exit(path: any) {
      if (path.node.extra?.bearSwitchBudgeted) return;
      path.node.extra = {...path.node.extra, bearSwitchBudgeted: true};
      // Keep V8's case selection and fallthrough. Only evaluated values are
      // charged while it searches for the first matching case.
      path.node.discriminant = op('comparisonValue', [path.node.discriminant]);
      for (const branch of path.node.cases) if (branch.test) branch.test = op('comparisonValue', [branch.test]);
    } },
    ForXStatement(path: any) {
      // The loop acquires a value before evaluating an assignment target.
      // Materialize that assignment so it uses the same guarded writes as
      // ordinary source assignments, rather than escaping through CFG lowering.
      if (t.isVariableDeclaration(path.node.left)) return;
      const target = path.node.left;
      const value = path.scope.generateUidIdentifier('iterationValue');
      path.node.left = t.variableDeclaration('const', [t.variableDeclarator(t.cloneNode(value))]);
      path.node.body = t.blockStatement([
        t.expressionStatement(t.assignmentExpression('=', target, t.cloneNode(value))),
        path.node.body
      ]);
      path.scope.crawl();
    },
    ArrayExpression: { exit(path: any) {
      if (!path.node.elements.some((element: any) => t.isSpreadElement(element))) {
        if (options.allocations) { path.replaceWith(allocation(path.node)); path.skip(); }
        return;
      }
      path.replaceWith(list(path, path.node.elements)); path.skip();
    } },
    ObjectExpression: { exit(path: any) {
      if (options.allocations) { path.replaceWith(allocation(path.node)); path.skip(); }
    } },
    RegExpLiteral: { exit(path: any) {
      if (options.allocations) { path.replaceWith(allocation(path.node)); path.skip(); }
    } },
    ObjectProperty: { exit(path: any) {
      const key = path.node.key;
      if (!path.parentPath.isObjectExpression() || !path.node.computed ||
          t.isStringLiteral(key) || t.isNumericLiteral(key) || t.isBooleanLiteral(key) || t.isNullLiteral(key) || t.isBigIntLiteral(key)) return;
      path.node.key = op('propertyKey', [key]);
    } },
    BinaryExpression: { exit(path: any) {
      if (['-','*','/','%','**','<<','>>','>>>','&','|','^'].includes(path.node.operator)) {
        path.replaceWith(op('numericBinary', [t.stringLiteral(path.node.operator), path.node.left, path.node.right])); path.skip(); return;
      }
      if (['==','!=','===','!==','<','<=','>','>='].includes(path.node.operator)) {
        path.replaceWith(op('compare', [t.stringLiteral(path.node.operator), path.node.left, path.node.right])); path.skip(); return;
      }
      if (path.node.operator === 'in') {
        path.replaceWith(op('has', [path.node.left, path.node.right])); path.skip(); return;
      }
      if (path.node.operator === '+') {
        path.replaceWith(op('add', [path.node.left, path.node.right])); path.skip(); return;
      }
      if (path.node.operator === 'instanceof') {
        path.replaceWith(op('instanceOf', [path.node.left, path.node.right])); path.skip();
      }
    } },
    AssignmentExpression: { exit(path: any) {
      const { left, right, operator } = path.node;
      if (t.isIdentifier(left) && operator !== '=') {
        const operation = operator.slice(0, -1);
        path.replaceWith(['&&', '||', '??'].includes(operation)
          ? t.logicalExpression(operation, t.cloneNode(left), t.assignmentExpression('=', left, right))
          : t.assignmentExpression('=', left, t.binaryExpression(operation, t.cloneNode(left), right)));
        return;
      }
      if (!t.isMemberExpression(left)) return;
      if (operator === '=') { path.replaceWith(op('set', [reference(left), right,strict(path)])); return; }
      const id = temporary(path), value = temporary(path), operation = operator.slice(0, -1);
      const write = (rhs: any) => op('set', [t.cloneNode(id), rhs,strict(path)]);
      const result = ['&&', '||', '??'].includes(operation)
        ? t.logicalExpression(operation, t.cloneNode(value), write(right))
        : write(t.binaryExpression(operation, t.cloneNode(value), right));
      path.replaceWith(t.sequenceExpression([
        t.assignmentExpression('=', t.cloneNode(id), reference(left)),
        t.assignmentExpression('=', t.cloneNode(value), op('get', [t.cloneNode(id)])), result,
      ]));
    } },
    UpdateExpression: { exit(path: any) {
      if (t.isMemberExpression(path.node.argument)) path.replaceWith(op('update', [reference(path.node.argument), t.valueToNode(path.node.operator === '++' ? 1 : -1), t.booleanLiteral(path.node.prefix),strict(path)]));
      else if (t.isIdentifier(path.node.argument)) {
        const { argument, operator, prefix } = path.node, result = temporary(path);
        const field = (name: string) => op('get', [op('ref', [t.cloneNode(result), t.stringLiteral(name)])]);
        path.replaceWith(t.sequenceExpression([
          t.assignmentExpression('=', t.cloneNode(result), op('increment', [argument, t.valueToNode(operator === '++' ? 1 : -1)])),
          t.assignmentExpression('=', t.cloneNode(argument), field('value')),
          field(prefix ? 'value' : 'old'),
        ]));
        path.skip();
      }
    } },
    UnaryExpression: { exit(path: any) {
      if (['+','-','~'].includes(path.node.operator)) {
        path.replaceWith(op('numericUnary', [t.stringLiteral(path.node.operator), path.node.argument])); path.skip(); return;
      }
      if (path.node.operator === 'delete' && t.isMemberExpression(path.node.argument)) path.replaceWith(op('remove', [reference(path.node.argument),strict(path)]));
    } },
    CallExpression: { exit(path: any) {
      const { callee, arguments: args } = path.node;
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: '__bearOps' })) return;
      if (t.isMemberExpression(callee)) {
        const id = temporary(path);
        path.replaceWith(t.sequenceExpression([
          t.assignmentExpression('=', t.cloneNode(id), reference(callee)),
          op('invoke', [op('get', [t.cloneNode(id)]), t.memberExpression(t.cloneNode(id), t.identifier('object')), list(path, args)]),
        ]));
        path.skip();
      } else { path.replaceWith(op('invoke', [callee, t.unaryExpression('void', t.numericLiteral(0)), list(path, args)])); path.skip(); }
    } },
    NewExpression: { exit(path: any) {
      path.replaceWith(op('construct', [path.node.callee, list(path, path.node.arguments)])); path.skip();
    } },
    MemberExpression: { exit(path: any) {
      if (t.isIdentifier(path.node.object, { name: '__bearOps' })) return;
      const parent = path.parentPath;
      if (parent.isAssignmentExpression() && parent.node.left === path.node || parent.isUpdateExpression()
        || parent.isUnaryExpression({ operator: 'delete' }) || parent.isCallExpression() && parent.node.callee === path.node) return;
      path.replaceWith(op('get', [reference(path.node)])); path.skip();
    } },
  } };
}
