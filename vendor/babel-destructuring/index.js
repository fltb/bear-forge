import { declare } from '@babel/helper-plugin-utils';
import { types } from '@babel/core';

function isPureVoid(node) {
  return types.isUnaryExpression(node) && node.operator === "void" && types.isPureish(node.argument);
}
function unshiftForXStatementBody(statementPath, newStatements) {
  statementPath.ensureBlock();
  const {
    scope,
    node
  } = statementPath;
  const bodyScopeBindings = statementPath.get("body").scope.bindings;
  const hasShadowedBlockScopedBindings = Object.keys(bodyScopeBindings).some(name => scope.hasBinding(name));
  if (hasShadowedBlockScopedBindings) {
    node.body = types.blockStatement([...newStatements, node.body]);
  } else {
    node.body.body.unshift(...newStatements);
  }
}
class DestructuringTransformer {
  blockHoist;
  operator;
  nodes;
  scope;
  kind;
  iterableIsArray;
  arrayLikeIsIterable;
  objectRestNoSymbols;
  useBuiltIns;
  addHelper;
  constructor(opts) {
    this.blockHoist = opts.blockHoist;
    this.operator = opts.operator;
    this.nodes = opts.nodes || [];
    this.scope = opts.scope;
    this.kind = opts.kind;
    this.iterableIsArray = opts.iterableIsArray;
    this.arrayLikeIsIterable = opts.arrayLikeIsIterable;
    this.objectRestNoSymbols = opts.objectRestNoSymbols;
    this.useBuiltIns = opts.useBuiltIns;
    this.addHelper = opts.addHelper;
  }
  getExtendsHelper() {
    return this.useBuiltIns ? types.memberExpression(types.identifier("Object"), types.identifier("assign")) : this.addHelper("extends");
  }
  buildVariableAssignment(id, init) {
    let op = this.operator;
    if (types.isMemberExpression(id) || types.isOptionalMemberExpression(id)) op = "=";
    let node;
    if (op) {
      node = types.expressionStatement(types.assignmentExpression(op, id, types.cloneNode(init) || types.buildUndefinedNode()));
    } else {
      let nodeInit;
      if (this.kind === "const" && init === null) {
        nodeInit = types.buildUndefinedNode();
      } else {
        nodeInit = types.cloneNode(init);
      }
      node = types.variableDeclaration(this.kind, [types.variableDeclarator(id, nodeInit)]);
    }
    node._blockHoist = this.blockHoist;
    return node;
  }
  buildVariableDeclaration(id, init) {
    const declar = types.variableDeclaration("var", [types.variableDeclarator(types.cloneNode(id), types.cloneNode(init))]);
    declar._blockHoist = this.blockHoist;
    return declar;
  }
  push(id, _init) {
    const init = types.cloneNode(_init);
    if (types.isObjectPattern(id)) {
      this.pushObjectPattern(id, init);
    } else if (types.isArrayPattern(id)) {
      this.pushArrayPattern(id, init);
    } else if (types.isAssignmentPattern(id)) {
      this.pushAssignmentPattern(id, init);
    } else {
      this.nodes.push(this.buildVariableAssignment(id, init));
    }
  }
  pushAssignmentPattern({
    left,
    right
  }, valueRef) {
    if (this.operator && types.isMemberExpression(left)) {
      const op = (name, args) => types.callExpression(types.memberExpression(types.identifier("__bearOps"), types.identifier(name)), args);
      const reference = this.scope.generateUidIdentifier("bindingReference");
      const value = this.scope.generateUidIdentifier("bindingValue");
      this.nodes.push(this.buildVariableDeclaration(reference, op("ref", [left.object, left.computed ? left.property : types.stringLiteral(left.property.name)])));
      this.nodes.push(this.buildVariableDeclaration(value, valueRef));
      this.nodes.push(types.expressionStatement(op("set", [types.cloneNode(reference),
        types.conditionalExpression(types.binaryExpression("===", types.cloneNode(value), types.buildUndefinedNode()), right, types.cloneNode(value))])));
      return;
    }
    if (isPureVoid(valueRef)) {
      this.push(left, right);
      return;
    }
    const tempId = this.scope.generateUidIdentifierBasedOnNode(valueRef);
    this.nodes.push(this.buildVariableDeclaration(tempId, valueRef));
    const tempConditional = types.conditionalExpression(types.binaryExpression("===", types.cloneNode(tempId), types.buildUndefinedNode()), right, types.cloneNode(tempId));
    if (types.isPattern(left)) {
      let patternId;
      let node;
      if (this.kind === "const" || this.kind === "let") {
        patternId = this.scope.generateUidIdentifier(tempId.name);
        node = this.buildVariableDeclaration(patternId, tempConditional);
      } else {
        patternId = tempId;
        node = types.expressionStatement(types.assignmentExpression("=", types.cloneNode(tempId), tempConditional));
      }
      this.nodes.push(node);
      this.push(left, patternId);
    } else {
      this.nodes.push(this.buildVariableAssignment(left, tempConditional));
    }
  }
  pushObjectRest(pattern, objRef, spreadProp, spreadPropIndex) {
    const value = buildObjectExcludingKeys(pattern.properties.slice(0, spreadPropIndex), objRef, this.scope, name => this.addHelper(name), this.objectRestNoSymbols, this.useBuiltIns);
    this.nodes.push(this.buildVariableAssignment(spreadProp.argument, value));
  }
  pushObjectProperty(prop, propRef) {
    if (types.isLiteral(prop.key)) prop.computed = true;
    const pattern = prop.value;
    const objRef = types.memberExpression(types.cloneNode(propRef), prop.key, prop.computed);
    if (types.isPattern(pattern)) {
      this.push(pattern, objRef);
    } else {
      this.nodes.push(this.buildVariableAssignment(pattern, objRef));
    }
  }
  pushObjectPattern(pattern, objRef) {
    if (!pattern.properties.length) {
      this.nodes.push(types.expressionStatement(types.callExpression(this.addHelper("objectDestructuringEmpty"), isPureVoid(objRef) ? [] : [objRef])));
      return;
    }
    // Capture the RHS value before evaluating any property key or initializer.
    // A source identifier can be reassigned by either operation.
    {
      const temp = this.scope.generateUidIdentifierBasedOnNode(objRef);
      this.nodes.push(this.buildVariableDeclaration(temp, objRef));
      objRef = temp;
    }
    this.nodes.push(types.expressionStatement(types.callExpression(this.addHelper("objectDestructuringEmpty"), [types.cloneNode(objRef)])));
    pattern = { ...pattern, properties: pattern.properties.slice() };
    for (let i = 0; i < pattern.properties.length; i++) {
      let prop = pattern.properties[i];
      if (types.isRestElement(prop)) {
        this.pushObjectRest(pattern, objRef, prop, i);
      } else {
        // ToPropertyKey occurs once, immediately before this property's read.
        // The same primitive key subsequently excludes it from the rest object.
        if (prop.computed) {
          const key = this.scope.generateUidIdentifierBasedOnNode(prop.key);
          this.nodes.push(this.buildVariableDeclaration(key, types.callExpression(this.addHelper("toPropertyKey"), [prop.key])));
          prop = pattern.properties[i] = { ...prop, key };
        }
        this.pushObjectProperty(prop, objRef);
      }
    }
  }
  pushArrayPattern(pattern, arrayRef) {
    const owner = this.scope.getFunctionParent() || this.scope.getProgramParent();
    const extra = owner.path.node.extra ||= {};
    const stack = extra.bearIteratorStack ||= owner.generateUidIdentifier("iterators");
    const op = (name, args) => types.callExpression(types.memberExpression(types.identifier("__bearOps"), types.identifier(name)), args);
    const record = this.scope.generateUidIdentifier("iterator");
    const opening = op("iteratorPush", [types.cloneNode(stack), arrayRef]);
    opening.extra = { bearIteratorOpen: true };
    this.nodes.push(this.buildVariableDeclaration(record, opening));
    for (const element of pattern.elements) {
      const read = op(types.isRestElement(element) ? "iteratorRest" : "iteratorStep", [types.cloneNode(record), ...(!element ? [types.booleanLiteral(false)] : [])]);
      if (!element) this.nodes.push(types.expressionStatement(read));
      else this.push(types.isRestElement(element) ? element.argument : element, read);
    }
    this.nodes.push(types.expressionStatement(op("iteratorFinish", [types.cloneNode(stack), types.cloneNode(record)])));
  }
  init(pattern, ref) {
    if (!types.isArrayExpression(ref) && !types.isMemberExpression(ref)) {
      const memo = this.scope.maybeGenerateMemoised(ref, true);
      if (memo) {
        this.nodes.push(this.buildVariableDeclaration(memo, types.cloneNode(ref)));
        ref = memo;
      }
    }
    this.push(pattern, ref);
    return this.nodes;
  }
}
function buildObjectExcludingKeys(excludedKeys, objRef, scope, addHelper, objectRestNoSymbols, useBuiltIns) {
  const keys = [];
  let allLiteral = true;
  let hasTemplateLiteral = false;
  for (let i = 0; i < excludedKeys.length; i++) {
    const prop = excludedKeys[i];
    const key = prop.key;
    if (types.isIdentifier(key) && !prop.computed) {
      keys.push(types.stringLiteral(key.name));
    } else if (types.isTemplateLiteral(key)) {
      keys.push(types.cloneNode(key));
      hasTemplateLiteral = true;
    } else if (types.isLiteral(key)) {
      keys.push(types.stringLiteral(String(key.value)));
    } else if (types.isPrivateName(key)) ; else {
      keys.push(types.cloneNode(key));
      allLiteral = false;
    }
  }
  let value;
  if (keys.length === 0) {
    value = types.callExpression(addHelper("objectWithoutProperties"), [types.cloneNode(objRef), types.arrayExpression([])]);
  } else {
    let keyExpression = types.arrayExpression(keys);
    if (allLiteral && !hasTemplateLiteral && !types.isProgram(scope.block)) {
      const programScope = scope.getProgramParent();
      const id = programScope.generateUidIdentifier("excluded");
      programScope.push({
        id,
        init: keyExpression,
        kind: "const"
      });
      keyExpression = types.cloneNode(id);
    }
    value = types.callExpression(addHelper(`objectWithoutProperties${objectRestNoSymbols ? "Loose" : ""}`), [types.cloneNode(objRef), keyExpression]);
  }
  return value;
}
function convertVariableDeclaration(path, addHelper, arrayLikeIsIterable, iterableIsArray, objectRestNoSymbols, useBuiltIns) {
  const {
    node,
    scope
  } = path;
  const nodeKind = node.kind;
  const nodeLoc = node.loc;
  const nodes = [];
  for (let i = 0; i < node.declarations.length; i++) {
    const declar = node.declarations[i];
    const patternId = declar.init;
    const pattern = declar.id;
    const destructuring = new DestructuringTransformer({
      blockHoist: node._blockHoist,
      nodes: nodes,
      scope: scope,
      kind: node.kind,
      iterableIsArray,
      arrayLikeIsIterable,
      useBuiltIns,
      objectRestNoSymbols,
      addHelper
    });
    if (types.isPattern(pattern)) {
      destructuring.init(pattern, patternId);
      if (+i !== node.declarations.length - 1) {
        types.inherits(nodes[nodes.length - 1], declar);
      }
    } else {
      nodes.push(types.inherits(destructuring.buildVariableAssignment(pattern, patternId), declar));
    }
  }
  // A for initializer is a single declaration, not a statement list. Keep its
  // lexical bindings in the loop (and therefore its per-iteration scope).
  // Babel's generic replaceWithMultiple would synthesize an IIFE here.
  if (types.isForStatement(path.parent, { init: node })) {
    const declarations = [];
    for (const step of nodes) {
      if (types.isVariableDeclaration(step)) declarations.push(...step.declarations);
      else if (types.isExpressionStatement(step)) declarations.push(types.variableDeclarator(scope.generateUidIdentifier("bindingStep"), step.expression));
      else throw path.buildCodeFrameError("Unsupported destructuring initializer step");
    }
    path.replaceWith(types.variableDeclaration(nodeKind, declarations));
    scope.crawl();
    return;
  }
  let tail = null;
  let nodesOut = [];
  for (const node of nodes) {
    if (types.isVariableDeclaration(node)) {
      if (tail !== null) {
        tail.declarations.push(...node.declarations);
        continue;
      } else {
        node.kind = nodeKind;
        tail = node;
      }
    } else {
      tail = null;
    }
    if (!node.loc) {
      node.loc = nodeLoc;
    }
    nodesOut.push(node);
  }
  if (nodesOut.length === 2 && types.isVariableDeclaration(nodesOut[0]) && types.isExpressionStatement(nodesOut[1]) && types.isCallExpression(nodesOut[1].expression) && nodesOut[0].declarations.length === 1 && types.isIdentifier(nodesOut[1].expression.arguments[0], {
    name: nodesOut[0].declarations[0].id.name
  })) {
    const expr = nodesOut[1].expression;
    expr.arguments = [nodesOut[0].declarations[0].init];
    nodesOut = [expr];
  } else {
    if (types.isForStatement(path.parent, {
      init: node
    }) && !nodesOut.some(v => types.isVariableDeclaration(v))) {
      for (let i = 0; i < nodesOut.length; i++) {
        const node = nodesOut[i];
        if (types.isExpressionStatement(node)) {
          nodesOut[i] = node.expression;
        }
      }
    }
  }
  if (nodesOut.length === 1) {
    path.replaceWith(nodesOut[0]);
  } else {
    path.replaceWithMultiple(nodesOut);
  }
  scope.crawl();
}
function convertAssignmentExpression(path, addHelper, arrayLikeIsIterable, iterableIsArray, objectRestNoSymbols, useBuiltIns) {
  const {
    node,
    scope,
    parentPath
  } = path;
  const nodes = [];
  const destructuring = new DestructuringTransformer({
    operator: node.operator,
    scope: scope,
    nodes: nodes,
    arrayLikeIsIterable,
    iterableIsArray,
    objectRestNoSymbols,
    useBuiltIns,
    addHelper
  });
  let ref;
  if (!parentPath.isExpressionStatement() && !parentPath.isSequenceExpression() || path.isCompletionRecord()) {
    ref = scope.generateUidIdentifierBasedOnNode(node.right, "ref");
    nodes.push(types.variableDeclaration("var", [types.variableDeclarator(ref, node.right)]));
  }
  destructuring.init(node.left, ref || node.right);
  if (ref) {
    if (parentPath.isArrowFunctionExpression()) {
      path.replaceWith(types.blockStatement([]));
      nodes.push(types.returnStatement(types.cloneNode(ref)));
    } else {
      nodes.push(types.expressionStatement(types.cloneNode(ref)));
    }
  }
  path.replaceWithMultiple(nodes);
  scope.crawl();
}

function variableDeclarationHasDestructuringPattern(node) {
  for (const declar of node.declarations) {
    if (types.isPattern(declar.id) && declar.id.type !== "VoidPattern") {
      return true;
    }
  }
  return false;
}
const index = declare((api, options) => {
  api.assertVersion("^7.0.0-0 || ^8.0.0");
  if ("loose" in options) {
    console.warn("@babel/plugin-transform-destructuring: The 'loose' option has been deprecated, " + "use the `iterableIsArray` and `objectRestNoSymbols` assumptions instead (https://babeljs.io/assumptions).");
  }
  const {
    useBuiltIns = false
  } = options;
  const iterableIsArray = api.assumption("iterableIsArray") ?? options.loose ?? false;
  const arrayLikeIsIterable = options.allowArrayLike ?? api.assumption("arrayLikeIsIterable") ?? false;
  const objectRestNoSymbols = api.assumption("objectRestNoSymbols") ?? options.loose ?? false;
  return {
    name: "transform-destructuring",
    visitor: {
      ExportNamedDeclaration(path) {
        const declaration = path.get("declaration");
        if (!declaration.isVariableDeclaration()) return;
        if (!variableDeclarationHasDestructuringPattern(declaration.node)) return;
        path.splitExportDeclaration();
      },
      ForXStatement(path) {
        const {
          node,
          scope
        } = path;
        const left = node.left;
        if (types.isPattern(left)) {
          const temp = scope.generateUidIdentifier("ref");
          node.left = types.variableDeclaration("var", [types.variableDeclarator(temp)]);
          path.ensureBlock();
          const statementBody = path.node.body.body;
          const nodes = [];
          if (statementBody.length === 0 && path.isCompletionRecord()) {
            nodes.unshift(types.expressionStatement(types.buildUndefinedNode()));
          }
          nodes.unshift(types.expressionStatement(types.assignmentExpression("=", left, types.cloneNode(temp))));
          unshiftForXStatementBody(path, nodes);
          scope.crawl();
          return;
        }
        if (!types.isVariableDeclaration(left)) return;
        const pattern = left.declarations[0].id;
        if (!types.isPattern(pattern) || pattern.type === "VoidPattern") return;
        const key = scope.generateUidIdentifier("ref");
        node.left = types.variableDeclaration(left.kind, [types.variableDeclarator(key, null)]);
        const nodes = [];
        const destructuring = new DestructuringTransformer({
          kind: left.kind,
          scope: scope,
          nodes: nodes,
          arrayLikeIsIterable,
          iterableIsArray,
          objectRestNoSymbols,
          useBuiltIns,
          addHelper: name => this.addHelper(name)
        });
        destructuring.init(pattern, key);
        unshiftForXStatementBody(path, nodes);
        scope.crawl();
      },
      CatchClause({
        node,
        scope
      }) {
        const pattern = node.param;
        if (!types.isPattern(pattern)) return;
        const ref = scope.generateUidIdentifier("ref");
        node.param = ref;
        const nodes = [];
        const destructuring = new DestructuringTransformer({
          kind: "let",
          scope: scope,
          nodes: nodes,
          arrayLikeIsIterable,
          iterableIsArray,
          objectRestNoSymbols,
          useBuiltIns,
          addHelper: name => this.addHelper(name)
        });
        destructuring.init(pattern, ref);
        node.body.body = [...nodes, ...node.body.body];
        scope.crawl();
      },
      AssignmentExpression(path, state) {
        if (!types.isPattern(path.node.left)) return;
        convertAssignmentExpression(path, name => state.addHelper(name), arrayLikeIsIterable, iterableIsArray, objectRestNoSymbols, useBuiltIns);
      },
      VariableDeclaration(path, state) {
        const {
          node,
          parent
        } = path;
        if (types.isForXStatement(parent)) return;
        if (!parent || !path.container) return;
        if (!variableDeclarationHasDestructuringPattern(node)) return;
        convertVariableDeclaration(path, name => state.addHelper(name), arrayLikeIsIterable, iterableIsArray, objectRestNoSymbols, useBuiltIns);
      }
    }
  };
});

export { buildObjectExcludingKeys, index as default, unshiftForXStatementBody };
