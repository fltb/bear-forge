"use strict";

exports.__esModule = true;
exports.approxLoc = approxLoc;
exports.assign = assign;
exports.assignStmt = assignStmt;
exports.consume = consume;
exports.copyMeta = copyMeta;
exports.exprStmt = exprStmt;
exports.hasDirective = hasDirective;
exports.isWindows = void 0;
exports.locStr = locStr;
exports.memExpr = memExpr;
exports.resetNames = resetNames;
exports.setSymName = void 0;
exports.throwStmt = throwStmt;
exports.varDecl = varDecl;
exports.void0 = void0;
var _core = require("@effectful/transducers/v2/core");
exports.node = _core.node;
exports.num = _core.num;
exports.str = _core.str;
exports.tok = _core.tok;
exports.produce = _core.produce;
exports.produceNode = _core.produceNode;
exports.replace = _core.replace;
exports.detach = _core.detach;
exports.append = _core.append;
exports.prepend = _core.prepend;
exports.insertAfter = _core.insertAfter;
exports.insertBefore = _core.insertBefore;
exports.id = _core.id;
exports.bool = _core.bool;
exports.block = _core.block;
exports.arr = _core.arr;
exports.appendBlock = _core.appendBlock;
exports.clone = _core.clone;
exports.resetFieldInfo = _core.resetFieldInfo;
exports.error = _core.error;
exports.dft = _core.dft;
exports.next = _core.next;
exports.prev = _core.prev;
exports.after = _core.after;
var _combinators = require("@effectful/transducers/v2/combinators");
exports.curry = _combinators.curry;
exports.pipe = _combinators.pipe;
var _template = require("@effectful/transducers/v2/template");
exports.emitConst = _template.emitConst;
exports.toks = _template.toks;
exports.toksRaw = _template.toksRaw;
exports.template = _template.template;
var _types = require("@effectful/transducers/v2/types");
exports.Tag = _types.Tag;
exports.typeInfo = _types.typeInfo;
exports.invariant = _types.invariant;
exports.symName = _types.symName;
var _config = require("./config");
function memExpr(pos, objSym, propName) {
  const res = (0, _core.node)(pos, _types.Tag.MemberExpression);
  const obj = (0, _core.node)(_types.Tag.object, _types.Tag.Identifier);
  obj.sym = objSym;
  const prop = (0, _core.tok)(_types.Tag.property, _types.Tag.Identifier, {
    name: propName
  });
  (0, _core.append)(res, prop);
  (0, _core.insertBefore)(prop, obj);
  res.pure = true;
  return res;
}
function exprStmt(par, doc) {
  doc.pos = _types.Tag.expression;
  const res = (0, _core.node)(_types.Tag.push, _types.Tag.ExpressionStatement);
  (0, _core.append)(res, doc);
  (0, _core.append)(par, res);
  copyMeta(doc, res);
  return doc;
}
function assign(pos) {
  const ret = (0, _core.assign)(pos);
  ret.isBlockScope = false;
  ret.isExpr = true;
  ret.isStmt = false;
  return ret;
}
function assignStmt(par, l, r) {
  l.pos = _types.Tag.left;
  r.pos = _types.Tag.right;
  const res = assign(_types.Tag.expression);
  (0, _core.append)(res, r);
  (0, _core.insertBefore)(r, l);
  res.node.loc = l.node.loc || r.node.loc;
  return exprStmt(par, res);
}
function throwStmt(par, msg, name) {
  const res = (0, _core.append)(par, (0, _core.node)(_types.Tag.push, _types.Tag.ThrowStatement));
  const arg = (0, _core.append)(res, (0, _core.node)(_types.Tag.argument, _types.Tag.NewExpression));
  const params = (0, _core.append)(arg, (0, _core.arr)(_types.Tag.arguments));
  (0, _core.append)(params, (0, _core.tok)(_types.Tag.push, _types.Tag.StringLiteral, {
    value: msg
  }));
  (0, _core.insertBefore)(params, (0, _core.tok)(_types.Tag.callee, _types.Tag.Identifier, {
    name
  }));
  return par;
}
const setSymName = exports.setSymName = _config.default.debug ? function setSymName(sym, index, prefix) {
  sym.index = index + 1;
  sym.name = `${prefix || "_"}${sym.orig ? sym.orig.replace(/\W/g, "_") + "$" : ""}${index}`;
} : function setSymName(sym, index, prefix) {
  sym.index = index + 1;
  sym.name = `${prefix || "_"}${index}`;
};

/**
 * assign `node.name` from `sym.name`
 */
function resetNames(root) {
  let sym,
    i = root;
  do {
    if (i.type === _types.Tag.Identifier && (sym = i.sym) != null) i.node.name = (sym.varSym || sym).name;
  } while ((i = (0, _core.next)(i)) !== root);
}
function locStr(loc) {
  return loc ? `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}` : null;
}
function approxLoc(i) {
  let loc = i.node.loc;
  if (loc) return loc;
  loc = {};
  const last = (0, _core.after)(i);
  let j = i;
  let minLine = Number.MAX_SAFE_INTEGER;
  let minCol = Number.MAX_SAFE_INTEGER;
  let maxLine = 0;
  let maxCol = 0;
  do {
    if (j.node && j.node.loc) {
      const {
        start,
        end
      } = j.node.loc;
      if (start.line <= minLine) {
        minLine = start.line;
        if (start.column < minCol) minCol = start.column;
      }
      if (end.line >= maxLine) {
        maxLine = end.line;
        if (end.column > maxCol) maxCol = end.column;
      }
    }
  } while ((j = (0, _core.next)(j)) !== last);
  if (maxLine === 0) return null;
  return {
    start: {
      line: minLine,
      column: minCol
    },
    end: {
      line: maxLine,
      column: maxCol
    }
  };
}
function consume(root) {
  let i = root;
  let sym;
  const seen = _config.default.debug ? new Set() : null;
  do {
    if (seen) {
      if (seen.has(i)) throw new TypeError("INTERNAL: loop in a AST");
      seen.add(i);
    }
    const {
      parent,
      node
    } = i;
    if (parent) {
      if (i.pos === _types.Tag.push) {
        parent.node.push(node);
      } else parent.node[(0, _types.symName)(i.pos)] = node;
    }
    if (i.type === _types.Tag.Array) node.length = 0;else if (node) {
      if (i.type === _types.Tag.Identifier && (sym = i.sym) != null) node.name = (sym.varSym || sym).name;
      const ti = (0, _types.symInfo)(i.type);
      if (ti) {
        if (ti.esType != null) i.node.type = ti.esType;
        if (ti.fields) Object.assign(i.node, ti.fields);
      }
    }
  } while ((i = (0, _core.next)(i)) !== root);
}
const isWindows = exports.isWindows = typeof process !== "undefined" && process.platform === "win32";
function void0(pos) {
  const res = (0, _core.tok)(pos, _types.Tag.UnaryExpression, {
    operator: "void"
  });
  (0, _core.append)(res, (0, _core.num)(_types.Tag.argument, 0));
  return res;
}
function varDecl() {
  return (0, _core.tok)(_types.Tag.push, _types.Tag.VariableDeclaration, {
    kind: "var"
  });
}
function copyMeta(from, to) {
  to.node.loc = from.node.loc;
  to.parentFunc = from.parentFunc;
  to.parentBlock = from.parentBlock;
  to.parentLoop = from.parentLoop;
  to.parentMaybeScope = from.parentMaybeScope;
}
function hasDirective(node, value) {
  for (const i of node.directives) {
    if (i.value && i.value.value === value) return true;
  }
  return false;
}