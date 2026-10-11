"use strict";

exports.__esModule = true;
exports.injectMeta = injectMeta;
exports.prepare = prepare;
exports.substVars = substVars;
exports.wrap = wrap;
var _kit = require("./kit");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
/**
 * If the code is an argument of `eval` this injects context variables refs
 */
function substVars(si) {
  const s = (0, _kit.auto)(si);
  const ctx = s.opts.evalCtx;
  if (!ctx) return s;
  const opts = s.opts;
  if (!opts.contextState) throw s.error("`eval` requires `contextState` option");
  const varField = opts.varStorageField;
  const name = opts.closureStorageField || opts.varStorageField || "$$";
  const root = s.first.value;
  const ctxSym = root.contextSym;
  let parDepth = 0;
  for (let cur = root; cur = cur.parScope;) ++parDepth;
  return _injectCtx();
  function* _injectCtx() {
    for (const i of s) {
      if (i.enter) {
        if (i.type === _kit.Tag.Identifier && i.value.sym && !i.value.sym.declScope && !(0, _kit.isSynthetic)(i.value.node)) {
          const info = ctx[i.value.sym.orig];
          if (info) {
            let [prop, depth] = info;
            depth += parDepth;
            yield s.enter(i.pos, _kit.Tag.MemberExpression);
            if (varField) yield s.enter(_kit.Tag.object, _kit.Tag.MemberExpression);
            for (let i = 0; i < depth; ++i) yield s.enter(_kit.Tag.object, _kit.Tag.MemberExpression);
            yield s.tok(_kit.Tag.object, _kit.Tag.Identifier, {
              sym: ctxSym
            });
            for (let i = 0; i < depth; ++i) {
              yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
                node: {
                  name
                }
              });
              yield* s.leave();
            }
            if (varField) {
              yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
                node: {
                  name: varField
                }
              });
              yield* s.leave();
            }
            yield s.tok(_kit.Tag.property, _kit.Tag.Identifier, {
              node: {
                name: prop
              }
            });
            yield* s.leave();
            s.close(i);
            continue;
          }
        }
      }
      yield i;
    }
  }
}

/** for each `eval` call calculates its scope description */
function prepare(si) {
  const s = (0, _kit.auto)(si);
  const root = s.first.value;
  if (!s.opts.injectEvalCtx) return s;
  if (!s.opts.injectFuncMeta && !s.opts.injectModuleMeta) throw s.error(`"injectEvalCtx" requires "injectFuncMeta"`);
  if (s.opts.closureShortcuts !== false) throw s.error(`"injectEvalCtx" doesn't work with "closureShortcuts"`);
  const loc = root.node && root.node.program && root.node.program.loc;
  if (!loc) return s;
  const stack = [];
  let tup;
  const evalCtx = root.evalCtxSym;
  return _injectScopeInfo(s);
  function* _injectScopeInfo(sw) {
    for (const i of sw) {
      if (i.enter && tup) {
        if (i.type === _kit.Tag.CallExpression && i.value.node && i.value.node.loc) {
          const callee = s.cur();
          if (callee.type === _kit.Tag.Identifier && callee.value.sym && callee.value.sym.declScope == null && callee.value.sym.orig === "eval") {
            yield i;
            yield* _injectScopeInfo(s.one());
            yield s.peel();
            yield* _injectScopeInfo(s.sub());
            yield _emitScope(i);
            yield* s.leave();
            continue;
          }
        }
        if (evalCtx && i.type === _kit.Tag.Identifier && evalCtx === i.value.sym) {
          yield _emitScope(i);
          s.close(i);
          continue;
        }
      }
      if (i.value.func) {
        if (i.enter) {
          stack.push(i.value);
          tup = i.value.scopeMeta = [];
        }
        if (i.leave) {
          stack.pop();
          tup = stack.length && stack[stack.length - 1].scopeMeta;
        }
      }
      yield i;
    }
    function _emitScope(i) {
      const id = tup.length;
      const scope = getScope(i.value.node.loc);
      const meta = {
        value: i.value,
        scope,
        node: []
      };
      tup.push(meta);
      return s.tok(_kit.Tag.push, _kit.Tag.NumericLiteral, {
        node: {
          value: id
        }
      });
    }
    function getScope(nodeLoc) {
      let current = null;
      for (const root of stack) {
        let rootLoc = root.node.loc;
        /** some babel passes break location, trying to recover,
         * but this needs something better
         */
        if (!rootLoc) {
          const {
            body
          } = root.node;
          if (body) {
            rootLoc = body.loc;
            if (!rootLoc) {
              const block = body.body;
              if (block && Array.isArray(block)) {
                const locs = block.map(i => i.loc).filter(Boolean);
                if (!locs.length) rootLoc = {
                  start: locs.start,
                  end: locs.end
                };
              }
            }
          }
        }
        if (!rootLoc) return current;
        const memo = root.scopeMemo || (root.scopeMemo = new Map());
        const scopeStack = [];
        for (const j of root.scopeDecls) {
          if (!j.decl || !j.strict || !j.decl.value.node.loc) continue;
          const range = _objectSpread({}, j.declRange && j.declRange.node && j.declRange.node.loc || loc);
          if (!j.unordered) {
            const decl = j.decl.value.node.loc;
            range.line = decl.line;
            range.column = decl.column;
          }
          if ((nodeLoc.start.line > range.start.line || nodeLoc.start.line === range.start.line && nodeLoc.start.column > range.start.column) && (nodeLoc.end.line < range.end.line || nodeLoc.end.line === range.end.line && nodeLoc.end.column < range.end.column)) scopeStack.push({
            loc: range.start,
            sym: j
          });
        }
        scopeStack.sort((a, b) => {
          const l = a.loc.line - b.loc.line;
          if (l === 0) return a.loc.column - b.loc.column;
          return l;
        });
        const vars = {};
        for (const j of scopeStack) vars[j.sym.orig] = j.sym;
        const hash = Object.values(vars).map(i => i.id).join();
        let descr = memo.get(hash);
        if (!descr) {
          memo.set(hash, descr = {
            vars,
            parent: current
          });
        } else if (!descr.sym) {
          descr.sym = _kit.scope.newSym("v_");
        }
        current = descr;
      }
      return current;
    }
  }
}

/** injects scope descriptions into meta arguments */
function injectMeta(si) {
  const s = (0, _kit.auto)(si);
  if (!s.opts.injectEvalCtx) return s;
  const root = s.first.value;
  const decls = root.memoVars || (root.memoVars = new Map());
  for (const i of s.first.value.scopes) {
    if (i.scopeMemo) {
      for (const descr of i.scopeMemo.values()) {
        const expr = scopeExpr(descr);
        const {
          sym
        } = descr;
        if (sym) {
          decls.set(sym, _toConsumableArray((0, _kit.emitConst)(_kit.Tag.init, expr)));
          descr.expr = sym;
        } else descr.expr = expr;
      }
    }
  }
  for (const i of s.first.value.scopes) {
    if (i.scopeMeta && i.metaArgs) {
      const tup = [];
      for (const j of i.scopeMeta) {
        j.node.unshift(j.scope ? j.scope.expr : null);
        tup.push(j.node);
      }
      i.metaArgs[50] = _toConsumableArray((0, _kit.emitConst)(_kit.Tag.push, tup));
    }
  }
  function scopeExpr({
    vars,
    parent
  }) {
    const props = {};
    for (const name in vars) {
      const sym = vars[name];
      props[name] = sym.fieldName || sym.name;
    }
    const parExpr = parent && (parent.sym || scopeExpr(parent));
    return [props, parExpr || null];
  }
  return s;
}

/** Replaces global `eval` with `eval` RT operation */
function wrap(si) {
  const s = (0, _kit.auto)(si);
  if (!s.opts.evalWrapArg) return s;
  const sym = (0, _kit.sysId)(s.opts.evalWrapArg);
  return _replace();
  function* _replace() {
    for (const i of s.sub()) {
      if (i.enter && i.pos === _kit.Tag.callee && i.type === _kit.Tag.Identifier && i.value.sym && !i.value.sym.declScope && i.value.sym.orig === "eval") {
        yield* s.copy(i);
        for (const j of s) {
          yield j;
          if (j.pos === _kit.Tag.arguments) break;
        }
        const lab = s.label();
        yield s.enter(_kit.Tag.push, _kit.Tag.CallExpression);
        yield s.tok(_kit.Tag.callee, _kit.Tag.Identifier, {
          sym
        });
        yield s.enter(_kit.Tag.arguments, _kit.Tag.Array);
        yield* s.sub();
        yield* lab();
        continue;
      }
      yield i;
    }
  }
}