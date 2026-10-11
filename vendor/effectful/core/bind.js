"use strict";

exports.__esModule = true;
exports.flatten = exports.ctxField = exports.closureVar = void 0;
exports.interpretPureLet = interpretPureLet;
exports.paramThread = void 0;
exports.setSymInterpr = setSymInterpr;
exports.tempVarSym = tempVarSym;
var _kit = require("./kit");
var Kit = _kit;
var Block = require("./block");
var Prop = require("./propagate");
function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
/**
 * Converts `letStmt` without `eff` into JS expressions
 */
function interpretPureLet(si) {
  const s = Kit.auto(si);
  function* walk() {
    for (const i of s.sub()) {
      if (i.enter && i.type === Block.letStmt && !i.value.eff) {
        const lab = s.label();
        let pos = i.pos;
        if (i.value.sym && i.value.sym.bound) {
          (0, _kit.invariant)(i.pos === _kit.Tag.push);
          yield s.enter(_kit.Tag.push, _kit.Tag.ExpressionStatement);
          yield s.enter(_kit.Tag.expression, _kit.Tag.AssignmentExpression, {
            node: {
              operator: "="
            }
          });
          yield s.tok(_kit.Tag.left, _kit.Tag.Identifier, {
            sym: i.value.sym
          });
          pos = _kit.Tag.right;
        }
        yield* Kit.reposOne(walk(), pos);
        yield* lab();
        s.close(i);
      } else yield i;
    }
  }
  return walk();
}

/**
 * Generates temporal function-local variable
 */
function tempVarSym(top, pat, hasDecl) {
  const sym = Kit.scope.newSym(pat);
  top.scopeDecls.add(sym);
  sym.track = true;
  sym.byVal = top.opts.state;
  sym.declScope = top;
  sym.bound = true;
  sym.optional = false;
  sym.local = true;
  setSymInterpr(sym);
  if (!hasDecl && sym.interpr === closureVar && top.savedDecls) top.savedDecls.set(sym, {
    raw: null
  });
  return sym;
}
function isBindTrue(p) {
  return p.value.bind;
}

/**
 * extracts all effectful expressions into separate statements in a block,
 * injects `letStmt` and `bindPat` to mark extracted expressions and its
 * original location
 */
const flatten = exports.flatten = Kit.pipe(Kit.removeNulls, function* flatten(si) {
  const s = Kit.auto(si);
  const root = s.first.value;
  function* scope() {
    for (const i of s.sub()) {
      if (i.enter) {
        if (i.type === Block.chain) {
          yield s.peel(i);
          yield* scope();
          yield* s.leave();
        } else if (i.value.eff || i.value.shallowEff) {
          const sub = [];
          const inner = [];
          if (i.leave) {
            yield i;
            s.close(i);
          } else {
            Kit.result(walk(sub, s.sub()), inner);
            for (const j of sub) yield* j;
            yield i;
            yield* inner;
            yield s.close(i);
          }
        } else {
          yield* s.copy(i);
        }
      }
    }
  }
  function bind(i, buf, sym) {
    if (!sym) sym = tempVarSym(root);
    sym.bound = false;
    buf.push(_toConsumableArray(function* () {
      const lab = s.label();
      yield s.enter(_kit.Tag.push, Block.letStmt, {
        sym
      });
      if (!i.leave) {
        yield s.peel(Kit.setPos(i, _kit.Tag.expression));
        yield* i.value.eff ? walk(buf, s.sub(), true) : s.sub();
      } else yield Kit.setPos(i, _kit.Tag.expression);
      yield* lab();
    }()));
    return s.tok(i.pos, Block.bindPat, {
      sym
    });
  }
  function bindOne(i, buf, sym) {
    if (!sym) sym = tempVarSym(root);
    sym.bound = false;
    buf.push(_toConsumableArray(function* () {
      yield s.enter(_kit.Tag.push, Block.letStmt, {
        sym
      });
      yield* Kit.reposOne(i.value.eff ? walk(buf, s.one(), true) : s.one(), _kit.Tag.expression);
      yield* s.leave();
    }()));
    return s.tok(i.pos, Block.bindPat, {
      sym
    });
  }
  function* walk(buf, sw, expr) {
    for (const i of sw) {
      if (i.enter) {
        if (!expr && i.value.expr && !i.value.eff) {
          yield* s.copy(i);
          continue;
        }
        switch (i.type) {
          case Block.chain:
            yield s.peel(i);
            yield* scope();
            yield* s.leave();
            continue;
          case _kit.Tag.AssignmentExpression:
            if (i.value.eff) {
              const sym = tempVarSym(root);
              sym.bound = false;
              buf.push(_toConsumableArray(function* () {
                yield s.enter(_kit.Tag.push, Block.letStmt, {
                  sym
                });
                const op = i.value.node.operator;
                const lhs = [s.peel()].concat(_toConsumableArray(walk(buf, s.sub(), true)), _toConsumableArray(s.leave()));
                if (op !== "=" && s.cur().value.eff && lhs[0].type !== Block.bindPat && lhs.some(i => i.enter && (i.type === Block.bindPat || i.type === _kit.Tag.Identifier && i.value.sym && i.value.sym.closCapt))) {
                  // closure scoped variable may change in parent context
                  // but we still need to capture its rhs
                  const sub = tempVarSym(root);
                  sub.bound = false;
                  buf.push(_toConsumableArray(function* () {
                    yield s.enter(_kit.Tag.push, Block.letStmt, {
                      sym: sub
                    });
                    yield* Kit.clone(lhs);
                    yield* s.leave();
                  }()));
                  yield s.enter(_kit.Tag.expression, _kit.Tag.AssignmentExpression, {
                    node: {
                      operator: "="
                    }
                  });
                  yield* lhs;
                  yield s.enter(_kit.Tag.right, _kit.Tag.BinaryExpression, {
                    node: {
                      operator: op.substr(0, op.length - 1)
                    }
                  });
                  yield s.tok(_kit.Tag.left, Block.bindPat, {
                    sym: sub
                  });
                  yield* walk(buf, s.one(), true);
                  yield* s.leave();
                  yield* s.leave();
                  s.close(i);
                } else {
                  yield s.peel(i);
                  yield* lhs;
                  yield* walk(buf, s.one(), true);
                  yield* s.leave();
                }
                yield* s.leave();
              }()));
              yield s.tok(i.pos, Block.bindPat, {
                sym
              });
              continue;
            }
          case _kit.Tag.UpdateExpression:
            s.cur().value.lhs = true;
            yield bind(i, buf);
            continue;
          case _kit.Tag.UnaryExpression:
            if (i.value.node.operator === "delete") {
              s.cur().value.lhs = true;
              yield bind(i, buf);
              continue;
            }
            break;
          case _kit.Tag.MemberExpression:
            yield i.pos === _kit.Tag.callee || i.value.lhs || i.value.pure ? i : bind(i, buf);
            continue;
          case _kit.Tag.Identifier:
            if (!i.value.sym || i.value.lhs || !i.value.sym.closCapt || i.value.sym.singleAssign) {
              break;
            }
          case Block.op:
          case _kit.Tag.CallExpression:
            yield bind(i, buf);
            continue;
          case _kit.Tag.ConditionalExpression:
            if (!i.value.eff) {
              yield bind(i, buf);
              continue;
            }
            let sym;
            buf.push(_toConsumableArray(function* () {
              yield s.enter(_kit.Tag.push, _kit.Tag.IfStatement, {
                node: {
                  loc: i.value.node && i.value.node.loc
                }
              });
              const ilab = s.label();
              yield* walk(buf, s.one(), true);
              const cbuf = [];
              const abuf = [];
              const c = s.cur();
              sym = tempVarSym(root);
              sym.bound = false;
              bindOne(c, cbuf, sym);
              /**
               * this is always letStmt with `sym` === `psym` in the last step
               * but is it effectful or not isn't yet known
               */
              const cl = cbuf[cbuf.length - 1];
              /** however it's enough to check if there is any `bind` there */
              const cleff = cl.some(isBindTrue);
              const a = s.cur();
              const eff = a.value.eff || c.value.eff;
              bindOne(a, abuf, sym);
              const al = abuf[abuf.length - 1];
              const aleff = al.some(isBindTrue);
              /**
               * the experssion in bufs is always letStmt,
               * but it should have same eff in both cases
               */
              function* branch(pos, c, cbuf, wrap) {
                if (eff) yield s.enter(pos, Block.chain);else {
                  yield s.enter(pos, _kit.Tag.BlockStatement);
                  yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                }
                if (wrap) {
                  const [last] = cbuf.splice(-1);
                  for (const j of cbuf) yield* j;
                  yield s.enter(_kit.Tag.push, Block.letStmt, {
                    sym,
                    eff: true
                  });
                  yield s.enter(_kit.Tag.expression, Block.pure, {
                    bind: true
                  });
                  yield* last.splice(1, last.length - 2);
                } else {
                  for (const j of cbuf) yield* j;
                }
                yield* ilab();
              }
              yield* branch(_kit.Tag.consequent, c, cbuf, !cleff && aleff);
              yield* branch(_kit.Tag.alternate, a, abuf, !aleff && cleff);
              yield* s.leave();
            }()));
            yield s.tok(i.pos, Block.bindPat, {
              sym
            });
            s.close(i);
            continue;
          case _kit.Tag.LogicalExpression:
            if (!i.value.eff) {
              yield bind(i, buf);
              continue;
            }
            const or = i.value.node.operator === "||";
            const left = s.cur();
            let rpat;
            buf.push(_toConsumableArray(function* () {
              const lab = s.label();
              yield s.enter(_kit.Tag.push, _kit.Tag.IfStatement, {
                node: {
                  loc: i.value.node && i.value.node.loc
                }
              });
              const lsym = tempVarSym(root);
              lsym.bound = false;
              const ilab = s.label();
              if (or) {
                yield s.enter(_kit.Tag.test, _kit.Tag.UnaryExpression, {
                  node: {
                    operator: "!"
                  }
                });
                yield bindOne(Kit.setPos(left, _kit.Tag.argument), buf, lsym);
                yield* s.leave();
              } else {
                yield bindOne(Kit.setPos(left, _kit.Tag.test), buf, lsym);
              }
              const right = s.cur();
              const subBuf = [];
              if (right.value.eff) {
                yield s.enter(_kit.Tag.consequent, Block.chain);
                const rsym = tempVarSym(root);
                rsym.bound = false;
                rpat = bindOne(Kit.setPos(right, i.pos), subBuf, rsym);
                for (const i of subBuf) yield* i;
                yield* ilab();
                yield s.enter(_kit.Tag.alternate, Block.chain);
                // two let to same var, they both should have equal `eff`
                if (right.value.bind) {
                  yield s.enter(_kit.Tag.push, Block.letStmt, {
                    sym: rsym,
                    eff: true
                  });
                  yield s.enter(_kit.Tag.expression, Block.pure, {
                    bind: true
                  });
                } else yield s.enter(_kit.Tag.push, Block.letStmt, {
                  sym: rsym
                });
                yield s.tok(_kit.Tag.push, Block.bindPat, {
                  sym: lsym
                });
              } else {
                yield s.enter(_kit.Tag.consequent, _kit.Tag.BlockStatement);
                yield s.enter(_kit.Tag.body, _kit.Tag.Array);
                rpat = s.tok(i.pos, Block.bindPat, {
                  sym: lsym
                });
                bindOne(right, subBuf, lsym);
                for (const j of subBuf) yield* j;
              }
              yield* lab();
            }()));
            yield rpat;
            s.close(i);
            continue;
        }
        if (i.value.bind) {
          yield bind(i, buf);
          continue;
        }
        if (!i.value.stmt && !i.value.expr) {
          yield i;
          continue;
        }
        if (!expr && i.value.expr) {
          yield i;
          yield* walk(buf, s.sub(), true);
          yield s.close(i);
          continue;
        }
        if (!i.value.eff && !i.value.shallowEff) {
          yield* s.copy(i);
          continue;
        }
      }
      yield i;
    }
  }
  yield* s.till(i => i.type === Block.chain);
  yield* scope();
  yield* s;
}, function* flattenCleanup(si) {
  const s = Kit.auto(si);
  for (const i of s) {
    if (i.enter) {
      switch (i.type) {
        case _kit.Tag.ExpressionStatement:
          const b = s.curLev();
          if (b && b.type === Block.bindPat) {
            b.value.sym.result = i.type === _kit.Tag.ReturnStatement;
            Kit.skip(s.copy(i));
            continue;
          }
          break;
      }
    }
    yield i;
  }
}, Prop.recalcEff);

/**
 * as Sym::interp value means the var is a field of threaded context object
 */
const ctxField = exports.ctxField = {
  $: "xf",
  frameLocal: true
};
/** as Sym::interp value means the var is threaded as parameter to frames */
const paramThread = exports.paramThread = {
  $: "t",
  frameLocal: false
};
const closureVar = exports.closureVar = {
  $: "cv",
  frameLocal: true
};
paramThread.ctxStore = false;

/** assigns interpr field to a symbol depending on current options */
function setSymInterpr(si) {
  function calc() {
    const opts = si.declScope.opts;
    const topLevel = opts.topLevel;
    const ctx = opts.contextState;
    const capt = si.closCapt;
    const byVal = si.byVal;
    const transform = si.declScope.opts.transform;
    const effScope = si.declScope.topEff;
    if (si.global || !si.track || !effScope && !capt) return undefined;
    if (ctx) return ctxField;
    if (!transform) return topLevel && capt ? ctxField : undefined;
    if (byVal) return paramThread;
    if (topLevel) return ctxField;
    return closureVar;
  }
  si.interpr = calc();
}