"use strict";

exports.__esModule = true;
exports.asserts = asserts;
exports.blockScoping = blockScoping;
exports.emptyBlocs = emptyBlocs;
exports.main = void 0;
exports.removeUndefinedArgs = removeUndefinedArgs;
var _kit = require("./kit");
var Kit = _kit;
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
/**
 * simply replaces all `const`/`let` with `var`
 * loops block scoping is handled by `Loop.blockScoping`
 * activated with `{loose:true, blockScoping: true}`
 */
function blockScoping(si) {
  const s = Kit.auto(si);
  if (!s.opts.blockScoping) return s;
  return walk();
  function* walk() {
    for (const i of s) {
      if (i.enter && i.type === _kit.Tag.VariableDeclaration) i.value.node.kind = "var";
      yield i;
    }
  }
}

/** removes asserts */
function asserts(si) {
  const s = Kit.auto(si);
  if (!s.opts.removeAsserts) return s;
  return Kit.cleanEmptyExprs(calls(mark()));
  function* mark() {
    for (const i of s) {
      if (i.enter) {
        if (i.type === _kit.Tag.MemberExpression) {
          const c = s.cur();
          if (c.type === _kit.Tag.Identifier && c.value.node.name === "assert") {
            yield s.tok(i.pos, _kit.Tag.Null);
            Kit.skip(s.copy(i));
            continue;
          }
        } else if (i.type === _kit.Tag.CallExpression) {
          const c = s.cur();
          if (c.type === _kit.Tag.Identifier && c.value.node.name === "invariant") {
            yield s.tok(i.pos, _kit.Tag.Null);
            Kit.skip(s.copy(i));
            continue;
          }
        }
      }
      yield i;
    }
  }
  function* calls(si) {
    const s = Kit.auto(si);
    for (const i of s) {
      if (i.enter && i.type === _kit.Tag.CallExpression && s.cur().type === _kit.Tag.Null) {
        Kit.skip(s.copy(i));
        yield s.tok(i.pos, _kit.Tag.Null);
      } else yield i;
    }
  }
}

/** removing useless BlockStatements */
function* emptyBlocs(si) {
  const s = Kit.auto(si);
  up: for (const i of s) {
    if (i.enter && i.type === _kit.Tag.BlockStatement && i.pos === _kit.Tag.push) {
      const buf = [i];
      for (const j of s.sub()) {
        buf.push(j);
        if (j.type === _kit.Tag.Array && j.pos === _kit.Tag.body) {
          if (j.leave || s.cur().value === j.value) {
            for (const j of s) if (j.value === i.value) continue up;
          }
          break;
        }
      }
      yield* buf;
    } else yield i;
  }
}

/** removes last `undefined` arguments from calls */
function removeUndefinedArgs(si) {
  const s = Kit.auto(si);
  return walk();
  function* walk() {
    for (const i of s.sub()) {
      yield i;
      if (i.enter && i.pos === _kit.Tag.arguments) {
        const buf = [];
        for (const j of s.sub()) {
          if (j.type === _kit.Tag.Identifier && j.value.sym === Kit.scope.undefinedSym && (!j.value.node || !j.value.node.loc)) {
            buf.push.apply(buf, _toConsumableArray(s.copy(j)));
          } else {
            yield* buf;
            buf.length = 0;
            yield j;
            if (!j.leave) {
              yield* walk();
              yield s.close(j);
            }
          }
        }
      }
    }
  }
}
const main = exports.main = Kit.pipe(
// iife,
emptyBlocs, asserts, removeUndefinedArgs);